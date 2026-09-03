import { Server } from "socket.io";
import { getTelegramUser } from "./routes/me";
import { advanceSelectingGame, callNextNumber, claimGameWinners, getActiveGame, getTelegramProfile, persistSelectedCards, readGameState, startFinalizingGame, type GameType } from "./db";
import { ensureBotsForSelectingGame } from "./bots";
import { isSimulationSocketData } from "./simulation";
import type { BingoWinner } from "@shared/api";

type GameState = {
  gameId: string;
  calledNumbers: number[];
  currentBall: number | null;
  status: "waiting" | "finalizing" | "active" | "complete";
  playerCount: number;
  cardCount: number;
  occupiedCardNumbers: number[];
  botCardNumbers: number[];
  prizeAmount: number;
  winners: BingoWinner[];
  selectionEndsAt: string | null;
};

function toGameState(row: any): GameState {
  return {
    gameId: String(row.id),
    calledNumbers: row.called_numbers ?? [],
    currentBall: row.current_number ?? null,
    status: row.status === "finished" ? "complete" : row.status === "playing" ? "active" : row.status === "finalizing" ? "finalizing" : "waiting",
    playerCount: Number(row.player_count ?? 0),
    cardCount: Number(row.card_count ?? 0),
    occupiedCardNumbers: (row.occupied_card_numbers ?? []).map(Number),
    botCardNumbers: (row.bot_card_numbers ?? []).map(Number),
    prizeAmount: Number(row.prize_pool ?? 0),
    selectionEndsAt: row.selecting_started_at ? new Date(new Date(row.selecting_started_at).getTime() + 50000).toISOString() : null,
    winners: (row.winners ?? []).map((winner: BingoWinner) => ({
      ...winner,
      userId: Number(winner.userId),
      cardNumber: Number(winner.cardNumber),
      prizeAmount: Number(winner.prizeAmount),
    })),
  };
}

export function registerGameSockets(io: Server, serviceMode: GameType = "75") {
  const activeGames = new Map<GameType, string>();
  const tickInProgress = new Set<GameType>();
  const botTickInProgress = new Set<GameType>();

  const roomFor = (gameType: GameType, gameId: string) => `game:${gameType}:${gameId}`;

  const broadcastState = async (gameType: GameType) => {
    const gameId = activeGames.get(gameType);
    if (!gameId) return;
    const row = await readGameState(gameId);
    if (row) io.to(roomFor(gameType, gameId)).emit("game:state", toGameState(row));
  };

  const finishFinalizingGame = async (gameType: GameType, gameId: string) => {
    if (await startFinalizingGame(gameId)) {
      io.to(roomFor(gameType, gameId)).emit("game:announcement", { message: "Game started" });
    }
    await broadcastState(gameType);
  };

  const advanceBots = async (gameType: GameType) => {
    if (botTickInProgress.has(gameType)) return;
    botTickInProgress.add(gameType);
    try {
      const liveGame = await getActiveGame();
      if (liveGame.status !== "selecting") return;
      const addedBot = await ensureBotsForSelectingGame(String(liveGame.id));
      if (addedBot > 0) {
        activeGames.set(gameType, String(liveGame.id));
        await broadcastState(gameType);
      }
    } catch (error) {
      console.error(`Unable to coordinate ${gameType} bingo bots`, error);
    } finally {
      botTickInProgress.delete(gameType);
    }
  };

  const advanceMode = async (gameType: GameType) => {
    if (tickInProgress.has(gameType)) return;
    tickInProgress.add(gameType);
    try {
      const liveGame = await getActiveGame();
      const liveGameId = String(liveGame.id);
      activeGames.set(gameType, liveGameId);
      if (liveGame.status === "finalizing") {
        await finishFinalizingGame(gameType, liveGameId);
      }
      const transition = liveGame.status === "selecting" ? await advanceSelectingGame() : null;
      if (transition?.started && transition.gameId === activeGames.get(gameType)) {
        await broadcastState(gameType);
        if (transition.finalizing) await finishFinalizingGame(gameType, transition.gameId);
      }
      const gameId = activeGames.get(gameType);
      if (!gameId) return;
      const activeState = await readGameState(gameId);
      if (activeState?.status !== "playing") return;
      const nextNumber = await callNextNumber(gameId);
      if (nextNumber !== null) {
        await claimGameWinners(gameId);
        await broadcastState(gameType);
        const finalized = await readGameState(gameId);
        if (finalized?.status === "finished") activeGames.delete(gameType);
      }
    } catch (error) {
      console.error(`Unable to advance ${gameType} bingo game`, error);
    } finally {
      tickInProgress.delete(gameType);
    }
  };

  const timer = setInterval(() => {
    void advanceMode(serviceMode);
  }, 2500);
  const botTimer = setInterval(() => {
    void advanceBots(serviceMode);
  }, 100);

  io.use((socket, next) => {
    if (isSimulationSocketData(socket.data)) return next();
    const initData = typeof socket.handshake.auth?.initData === "string" ? socket.handshake.auth.initData : "";
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const telegramUser = token && initData ? getTelegramUser(initData, token) : null;
    if (!telegramUser) return next(new Error("Telegram authentication is required."));
    socket.data.telegramId = telegramUser.id;
    next();
  });

  io.on("connection", (socket) => {
    let selectionQueue = Promise.resolve();

    const syncSelection = async (
      { playerId, cardNumbers, allowEmpty = false }: { playerId?: string | number; cardNumbers?: number[]; allowEmpty?: boolean },
      acknowledge?: (response: { ok: boolean; message?: string; playerBalance?: number; mainBalance?: number }) => void,
    ) => {
      try {
        const parsedPlayerId = Number(playerId);
        const profile = await getTelegramProfile(socket.data.telegramId);
        const authenticatedPlayerId = profile ? Number(profile.id) : null;
        if (!profile || !Number.isSafeInteger(parsedPlayerId) || parsedPlayerId <= 0 || parsedPlayerId !== authenticatedPlayerId) {
          throw new Error("Telegram player verification failed.");
        }
        const cards = Array.isArray(cardNumbers)
          ? [...new Set(cardNumbers.map(Number))].filter((card) => Number.isInteger(card) && card >= 1 && card <= 400).slice(0, 2)
          : [];
        if (!cards.length && !allowEmpty) throw new Error("Select at least one bingo card before joining.");
        const mode = serviceMode;
        const game = socket.data.gameId ? await getActiveGame() : await getActiveGame(parsedPlayerId);
        const gameId = String(game.id);
        activeGames.set(mode, gameId);
        const result = await persistSelectedCards(gameId, parsedPlayerId, cards);
        const room = roomFor(mode, gameId);
        await socket.join(room);
        socket.data.gameId = gameId;
        socket.data.gameType = mode;
        socket.data.playerId = parsedPlayerId;
        const updatedGame = await getActiveGame();
        io.to(room).emit("cards:occupied", updatedGame.occupiedCardNumbers);
        await broadcastState(mode);
        acknowledge?.({ ok: true, playerBalance: result.playerBalance, mainBalance: result.mainBalance });
      } catch (error) {
        const selectionError = error instanceof Error ? error : new Error(String(error));
        console.error("Unable to synchronize bingo cards", { message: selectionError.message, stack: selectionError.stack, code: (error as { code?: string }).code });
        acknowledge?.({ ok: false, message: selectionError.message });
        socket.emit("game:error", { message: `የካርድ ምርጫውን ማስቀመጥ አልተቻለም: ${selectionError.message}` });
      }
    };

    const queueSelection = (
      payload: { playerId?: string | number; cardNumbers?: number[]; allowEmpty?: boolean },
      acknowledge?: (response: { ok: boolean; message?: string; playerBalance?: number; mainBalance?: number }) => void,
    ) => {
      selectionQueue = selectionQueue.then(() => syncSelection(payload, acknowledge));
    };

    socket.on("game:join", (payload: { playerId?: string | number; cardNumbers?: number[] }, acknowledge) => {
      queueSelection(payload, acknowledge);
    });
    socket.on("game:selection", (payload: { playerId?: string | number; cardNumbers?: number[] }, acknowledge) => {
      queueSelection({ ...payload, allowEmpty: true }, acknowledge);
    });

    const leaveGame = () => {
      const gameId = socket.data.gameId as string | undefined;
      const gameType = socket.data.gameType as GameType | undefined;
      const playerId = socket.data.playerId as number | undefined;
      socket.data.gameId = undefined;
      socket.data.gameType = undefined;
      socket.data.playerId = undefined;
      if (!gameId || !gameType || !playerId) return;
      const room = roomFor(gameType, gameId);
      selectionQueue = selectionQueue.then(async () => {
        const game = await getActiveGame(playerId);
        if (String(game.id) === gameId && game.status === "selecting") {
          await persistSelectedCards(gameId, playerId, []);
          const updatedGame = await getActiveGame();
          io.to(room).emit("cards:occupied", updatedGame.occupiedCardNumbers);
        }
        await socket.leave(room);
      }).catch((error) => console.error("Unable to release bingo cards", error));
    };

    socket.on("game:leave", leaveGame);
    socket.on("disconnect", leaveGame);
  });

  return () => {
    clearInterval(timer);
    clearInterval(botTimer);
  };
}
