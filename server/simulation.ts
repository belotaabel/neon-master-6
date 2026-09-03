import { createHmac, timingSafeEqual } from "node:crypto";
import { Pool } from "pg";
import { io as connectSocket, type Socket } from "socket.io-client";
import type { Server } from "socket.io";

export type SimulationConfig = {
  playerCount: number;
  initialBalance: number;
  selectionDelayMs: number;
  selectionSeconds: number;
  callIntervalMs: number;
  releaseProbability: number;
  remainThroughRound: boolean;
  seed: number;
};

export type SimulationRun = {
  id: string;
  status: "running" | "stopped" | "completed";
  config: SimulationConfig;
  playerCount: number;
  cardCount: number;
  createdAt: string;
  stoppedAt: string | null;
};

type SimulationSocketData = { simulation?: { runId: string; playerId: number } };

const simulationPool = process.env.SIMULATION_DATABASE_URL
  ? new Pool({ connectionString: process.env.SIMULATION_DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;
const activeRuns = new Map<string, { timer: ReturnType<typeof setInterval>; sockets: Socket[] }>();
let simulationIo: Server | null = null;

export const simulationEnabled = () => process.env.SIMULATION_ENABLED === "true" && process.env.NODE_ENV !== "production" && Boolean(process.env.SIMULATION_DATABASE_URL) && Boolean(process.env.SIMULATION_SOCKET_URL) && Boolean(process.env.SIMULATION_AUTH_TOKEN);
export const simulationDatabase = simulationPool;

export function simulationAuthEnabled() {
  return simulationEnabled() && Boolean(process.env.SIMULATION_AUTH_TOKEN);
}

export function verifySimulationToken(token: unknown) {
  const expected = process.env.SIMULATION_AUTH_TOKEN;
  if (!simulationAuthEnabled() || typeof token !== "string" || !expected || token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

function assertSimulationEnabled() {
  if (!simulationEnabled()) throw new Error("Staging simulation is disabled");
  if (!simulationPool) throw new Error("Simulation database is not configured");
  if (!process.env.SIMULATION_SOCKET_URL) throw new Error("Simulation socket URL is not configured");
}

function normalizeConfig(input: Partial<SimulationConfig>): SimulationConfig {
  const config: SimulationConfig = {
    playerCount: Number(input.playerCount ?? 5),
    initialBalance: Number(input.initialBalance ?? 100),
    selectionDelayMs: Number(input.selectionDelayMs ?? 250),
    selectionSeconds: Number(input.selectionSeconds ?? 12),
    callIntervalMs: Number(input.callIntervalMs ?? 1000),
    releaseProbability: Number(input.releaseProbability ?? 0.2),
    remainThroughRound: input.remainThroughRound !== false,
    seed: Number(input.seed ?? 1),
  };
  if (!Number.isInteger(config.playerCount) || config.playerCount < 1 || config.playerCount > 100) throw new Error("Player count must be between 1 and 100");
  if (!Number.isFinite(config.initialBalance) || config.initialBalance < 10) throw new Error("Initial balance must be at least 10 ETB");
  if (!Number.isInteger(config.selectionDelayMs) || config.selectionDelayMs < 0 || config.selectionDelayMs > 60000) throw new Error("Selection delay is invalid");
  if (!Number.isInteger(config.selectionSeconds) || config.selectionSeconds < 4 || config.selectionSeconds > 300) throw new Error("Selection duration must be between 4 and 300 seconds");
  if (!Number.isInteger(config.callIntervalMs) || config.callIntervalMs < 100 || config.callIntervalMs > 60000) throw new Error("Call interval is invalid");
  if (!Number.isFinite(config.releaseProbability) || config.releaseProbability < 0 || config.releaseProbability > 1) throw new Error("Release probability must be between 0 and 1");
  if (!Number.isSafeInteger(config.seed)) throw new Error("Seed must be an integer");
  return config;
}

export function defaultSimulationConfig(): SimulationConfig {
  return normalizeConfig({});
}

export async function initializeSimulationDatabase() {
  if (!simulationPool || !simulationEnabled()) return;
  await simulationPool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS simulation_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      status TEXT NOT NULL CHECK (status IN ('running', 'stopped', 'completed')),
      config JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      stopped_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS simulation_players (
      id BIGSERIAL PRIMARY KEY,
      run_id UUID NOT NULL REFERENCES simulation_runs(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL,
      player_balance NUMERIC(12, 2) NOT NULL CHECK (player_balance >= 0),
      main_balance NUMERIC(12, 2) NOT NULL CHECK (main_balance >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (run_id, username)
    );
    CREATE TABLE IF NOT EXISTS simulation_games (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES simulation_runs(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('selecting', 'finalizing', 'playing', 'finished')),
      prize_pool NUMERIC(12, 2) NOT NULL DEFAULT 0,
      called_numbers INTEGER[] NOT NULL DEFAULT '{}',
      current_number INTEGER,
      selecting_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS simulation_game_cards (
      id BIGSERIAL PRIMARY KEY,
      game_id UUID NOT NULL REFERENCES simulation_games(id) ON DELETE CASCADE,
      player_id BIGINT NOT NULL REFERENCES simulation_players(id) ON DELETE CASCADE,
      card_number INTEGER NOT NULL CHECK (card_number BETWEEN 1 AND 400),
      rows JSONB NOT NULL,
      UNIQUE (game_id, card_number),
      UNIQUE (game_id, player_id, card_number)
    );
    CREATE TABLE IF NOT EXISTS simulation_winners (
      id BIGSERIAL PRIMARY KEY,
      game_id UUID NOT NULL REFERENCES simulation_games(id) ON DELETE CASCADE,
      player_id BIGINT NOT NULL REFERENCES simulation_players(id) ON DELETE CASCADE,
      card_number INTEGER NOT NULL,
      prize_amount NUMERIC(12, 2) NOT NULL,
      winning_rows INTEGER[] NOT NULL,
      UNIQUE (game_id, player_id, card_number)
    );
    CREATE TABLE IF NOT EXISTS simulation_transactions (
      id BIGSERIAL PRIMARY KEY,
      run_id UUID NOT NULL REFERENCES simulation_runs(id) ON DELETE CASCADE,
      player_id BIGINT NOT NULL REFERENCES simulation_players(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      amount NUMERIC(12, 2) NOT NULL,
      balance_type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS simulation_players_run_idx ON simulation_players(run_id);
    CREATE INDEX IF NOT EXISTS simulation_games_run_idx ON simulation_games(run_id);
  `);
}

function buildCard(cardNumber: number) {
  const ranges = [[1, 15], [16, 30], [31, 45], [46, 60], [61, 75]];
  return Array.from({ length: 5 }, (_, row) => ranges.map(([min, max], col) => row === 2 && col === 2 ? 0 : min + ((cardNumber * 13 + row * 7 + col * 3) % (max - min + 1))));
}

function roomFor(runId: string, gameId: string) {
  return `simulation:${runId}:${gameId}`;
}

async function activeGame(runId: string) {
  assertSimulationEnabled();
  const result = await simulationPool!.query("SELECT * FROM simulation_games WHERE run_id = $1 AND status IN ('selecting', 'finalizing', 'playing') ORDER BY selecting_started_at LIMIT 1", [runId]);
  return result.rows[0] ?? null;
}

async function broadcastRun(runId: string, gameId: string) {
  if (!simulationIo) return;
  const state = await simulationGameState(gameId);
  if (state) simulationIo.to(roomFor(runId, gameId)).emit("game:state", state);
}

export async function simulationGameState(gameId: string) {
  assertSimulationEnabled();
  const result = await simulationPool!.query(`
    SELECT g.id, g.run_id, g.status, g.prize_pool, g.called_numbers, g.current_number, g.selecting_started_at,
           COUNT(DISTINCT gc.player_id)::int AS player_count, COUNT(gc.card_number)::int AS card_count
    FROM simulation_games g LEFT JOIN simulation_game_cards gc ON gc.game_id = g.id
    WHERE g.id = $1 GROUP BY g.id`, [gameId]);
  if (!result.rowCount) return null;
  const winners = await simulationPool!.query(`
    SELECT w.player_id AS "userId", p.display_name AS "displayName", w.card_number AS "cardNumber",
           w.winning_rows AS rows, w.prize_amount AS "prizeAmount"
    FROM simulation_winners w JOIN simulation_players p ON p.id = w.player_id WHERE w.game_id = $1 ORDER BY w.id`, [gameId]);
  const row = result.rows[0];
  return {
    gameId: String(row.id), calledNumbers: row.called_numbers ?? [], currentBall: row.current_number ?? null,
    status: row.status === "finished" ? "complete" : row.status === "playing" ? "active" : row.status === "finalizing" ? "finalizing" : "waiting",
    playerCount: Number(row.player_count), cardCount: Number(row.card_count), prizeAmount: Number(row.prize_pool),
    selectionEndsAt: new Date(new Date(row.selecting_started_at).getTime() + 1000 * Number((await simulationPool!.query("SELECT (config->>'selectionSeconds')::int AS seconds FROM simulation_runs WHERE id = $1", [row.run_id])).rows[0]?.seconds ?? 12)).toISOString(),
    winners: winners.rows.map((winner) => ({ ...winner, userId: Number(winner.userId), cardNumber: Number(winner.cardNumber), prizeAmount: Number(winner.prizeAmount) })),
  };
}

export async function simulationRunStatus(runId?: string): Promise<(SimulationRun & { players: Array<{ id: number; name: string; balance: number; cardCount: number }> }) | null> {
  assertSimulationEnabled();
  const run = runId
    ? await simulationPool!.query("SELECT * FROM simulation_runs WHERE id = $1", [runId])
    : await simulationPool!.query("SELECT * FROM simulation_runs WHERE status = 'running' ORDER BY created_at DESC LIMIT 1");
  if (!run.rowCount) return null;
  const row = run.rows[0];
  const players = await simulationPool!.query(`SELECT p.id, p.display_name AS name, (p.player_balance + p.main_balance)::numeric AS balance,
    COALESCE((SELECT COUNT(*) FROM simulation_game_cards gc JOIN simulation_games g ON g.id = gc.game_id WHERE gc.player_id = p.id AND g.status IN ('selecting', 'finalizing', 'playing')), 0)::int AS "cardCount"
    FROM simulation_players p WHERE p.run_id = $1 ORDER BY p.id`, [row.id]);
  const game = await activeGame(String(row.id));
  return { id: String(row.id), status: row.status, config: row.config, playerCount: players.rowCount ?? 0, cardCount: Number(game ? (await simulationPool!.query("SELECT COUNT(*)::int AS count FROM simulation_game_cards WHERE game_id = $1", [game.id])).rows[0]?.count : 0), createdAt: new Date(row.created_at).toISOString(), stoppedAt: row.stopped_at ? new Date(row.stopped_at).toISOString() : null, players: players.rows.map((player) => ({ id: Number(player.id), name: String(player.name), balance: Number(player.balance), cardCount: Number(player.cardCount) })) };
}

export async function startSimulationRun(input: Partial<SimulationConfig>) {
  assertSimulationEnabled();
  const config = normalizeConfig(input);
  const existing = await simulationPool!.query("SELECT id FROM simulation_runs WHERE status = 'running' LIMIT 1");
  if (existing.rowCount) throw new Error("A simulation run is already active");
  const client = await simulationPool!.connect();
  let runId = "";
  try {
    await client.query("BEGIN");
    const run = await client.query("INSERT INTO simulation_runs (status, config) VALUES ('running', $1) RETURNING id", [JSON.stringify(config)]);
    runId = String(run.rows[0].id);
    for (let index = 0; index < config.playerCount; index += 1) {
      const player = await client.query("INSERT INTO simulation_players (run_id, username, display_name, player_balance, main_balance) VALUES ($1, $2, $3, $4, 0) RETURNING id", [runId, `sim_player_${index + 1}`, `[SIMULATION] Player ${index + 1}`, config.initialBalance]);
      await client.query("INSERT INTO simulation_transactions (run_id, player_id, type, amount, balance_type) VALUES ($1, $2, 'simulation_seed', $3, 'player')", [runId, player.rows[0].id, config.initialBalance]);
    }
    await client.query("INSERT INTO simulation_games (run_id, status) VALUES ($1, 'selecting')", [runId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  runSimulationDriver(runId, config);
  return simulationRunStatus(runId);
}

export async function stopSimulationRun(runId?: string) {
  assertSimulationEnabled();
  const run = await simulationRunStatus(runId);
  if (!run) return null;
  const entry = activeRuns.get(run.id);
  if (entry) {
    clearInterval(entry.timer);
    entry.sockets.forEach((socket) => socket.disconnect());
    activeRuns.delete(run.id);
  }
  await simulationPool!.query("UPDATE simulation_runs SET status = 'stopped', stopped_at = NOW() WHERE id = $1 AND status = 'running'", [run.id]);
  return simulationRunStatus(run.id);
}

export async function clearSimulationRun(runId?: string) {
  assertSimulationEnabled();
  const run = await simulationRunStatus(runId);
  if (!run) return null;
  await stopSimulationRun(run.id);
  await simulationPool!.query("DELETE FROM simulation_runs WHERE id = $1", [run.id]);
  return { id: run.id, cleared: true };
}

async function persistSimulationSelection(runId: string, playerId: number, cardNumbers: number[], allowEmpty: boolean) {
  assertSimulationEnabled();
  const cards = [...new Set(cardNumbers)].filter((card) => Number.isInteger(card) && card >= 1 && card <= 400).slice(0, 2);
  if (!cards.length && !allowEmpty) throw new Error("Select at least one bingo card before joining.");
  const client = await simulationPool!.connect();
  try {
    await client.query("BEGIN");
    const game = await client.query("SELECT * FROM simulation_games WHERE run_id = $1 AND status = 'selecting' FOR UPDATE", [runId]);
    if (!game.rowCount) throw new Error("Simulation game is not accepting cards");
    const elapsed = Date.now() - new Date(game.rows[0].selecting_started_at).getTime();
    const run = await client.query("SELECT config FROM simulation_runs WHERE id = $1", [runId]);
    const selectionSeconds = Number(run.rows[0]?.config?.selectionSeconds ?? 12);
    if (elapsed >= (selectionSeconds - 3) * 1000) throw new Error("Card selection is locked");
    const stored = await client.query("SELECT card_number FROM simulation_game_cards WHERE game_id = $1 AND player_id = $2 FOR UPDATE", [game.rows[0].id, playerId]);
    const current = stored.rows.map((row) => Number(row.card_number));
    const removed = current.filter((card) => !cards.includes(card));
    const added = cards.filter((card) => !current.includes(card));
    const conflict = await client.query("SELECT 1 FROM simulation_game_cards WHERE game_id = $1 AND card_number = ANY($2::int[]) AND player_id <> $3 FOR UPDATE", [game.rows[0].id, cards, playerId]);
    if (conflict.rowCount) throw new Error("One or more selected cards are already taken");
    const cost = added.length * 10;
    const refund = removed.length * 10;
    const balance = await client.query("SELECT player_balance, main_balance FROM simulation_players WHERE id = $1 AND run_id = $2 FOR UPDATE", [playerId, runId]);
    if (!balance.rowCount) throw new Error("Simulation player not found");
    const playerBalance = Number(balance.rows[0].player_balance);
    const mainBalance = Number(balance.rows[0].main_balance);
    if (playerBalance + mainBalance + refund < cost) throw new Error("Insufficient balance");
    const playerDebit = Math.min(playerBalance + refund, cost);
    const mainDebit = cost - playerDebit;
    await client.query("UPDATE simulation_players SET player_balance = player_balance - $1 + $2, main_balance = main_balance - $3 WHERE id = $4", [playerDebit, refund, mainDebit, playerId]);
    if (playerDebit) await client.query("INSERT INTO simulation_transactions (run_id, player_id, type, amount, balance_type) VALUES ($1, $2, 'card_purchase', $3, 'player')", [runId, playerId, playerDebit]);
    if (mainDebit) await client.query("INSERT INTO simulation_transactions (run_id, player_id, type, amount, balance_type) VALUES ($1, $2, 'card_purchase', $3, 'main')", [runId, playerId, mainDebit]);
    if (refund) await client.query("INSERT INTO simulation_transactions (run_id, player_id, type, amount, balance_type) VALUES ($1, $2, 'card_refund', $3, 'player')", [runId, playerId, refund]);
    await client.query("DELETE FROM simulation_game_cards WHERE game_id = $1 AND player_id = $2 AND NOT (card_number = ANY($3::int[]))", [game.rows[0].id, playerId, cards]);
    for (const card of added) await client.query("INSERT INTO simulation_game_cards (game_id, player_id, card_number, rows) VALUES ($1, $2, $3, $4)", [game.rows[0].id, playerId, card, JSON.stringify(buildCard(card))]);
    await client.query("UPDATE simulation_games SET prize_pool = (SELECT COUNT(*) * 10 * 0.8 FROM simulation_game_cards WHERE game_id = $1) WHERE id = $1", [game.rows[0].id]);
    const updated = await client.query("SELECT player_balance, main_balance FROM simulation_players WHERE id = $1", [playerId]);
    await client.query("COMMIT");
    return { gameId: String(game.rows[0].id), playerBalance: Number(updated.rows[0].player_balance), mainBalance: Number(updated.rows[0].main_balance) };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

function seededRandom(seed: number) {
  let value = (seed >>> 0) || 1;
  return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; };
}

async function completeSimulationRun(runId: string) {
  await simulationPool!.query("UPDATE simulation_runs SET status = 'completed', stopped_at = NOW() WHERE id = $1 AND status = 'running'", [runId]);
  const entry = activeRuns.get(runId);
  if (entry) {
    clearInterval(entry.timer);
    entry.sockets.forEach((socket) => socket.disconnect());
    activeRuns.delete(runId);
  }
}

async function advanceSimulation(runId: string, random: () => number) {
  const game = await activeGame(runId);
  if (!game) return;
  const run = await simulationPool!.query("SELECT config FROM simulation_runs WHERE id = $1", [runId]);
  const config = run.rows[0]?.config as SimulationConfig;
  const elapsed = Date.now() - new Date(game.selecting_started_at).getTime();
  if (game.status === "selecting" && elapsed >= config.selectionSeconds * 1000) {
    const cards = await simulationPool!.query("SELECT COUNT(*)::int AS count FROM simulation_game_cards WHERE game_id = $1", [game.id]);
    if (Number(cards.rows[0].count) > 0) await simulationPool!.query("UPDATE simulation_games SET status = 'playing' WHERE id = $1", [game.id]);
    else await simulationPool!.query("UPDATE simulation_games SET selecting_started_at = NOW() WHERE id = $1", [game.id]);
    await broadcastRun(runId, String(game.id));
    return;
  }
  if (game.status !== "playing") return;
  const called = (game.called_numbers ?? []) as number[];
  const remaining = Array.from({ length: 75 }, (_, index) => index + 1).filter((number) => !called.includes(number));
  if (!remaining.length) {
    await simulationPool!.query("UPDATE simulation_games SET status = 'finished', finished_at = NOW() WHERE id = $1", [game.id]);
    await broadcastRun(runId, String(game.id));
    await completeSimulationRun(runId);
    return;
  }
  const next = remaining[Math.floor(random() * remaining.length)];
  await simulationPool!.query("UPDATE simulation_games SET called_numbers = $1, current_number = $2 WHERE id = $3", [[...called, next], next, game.id]);
  const current = await simulationPool!.query("SELECT player_id, card_number, rows FROM simulation_game_cards WHERE game_id = $1", [game.id]);
  const calledSet = new Set([...called, next]);
  const candidates = current.rows.map((row) => {
    const grid = row.rows as number[][];
    const complete = (values: number[]) => values.every((number) => number === 0 || calledSet.has(number));
    const lines = grid.map((values, index) => complete(values) ? index + 1 : null).filter((line): line is number => line !== null);
    lines.push(...grid[0].map((_, col) => complete(grid.map((values) => values[col])) ? col + 6 : null).filter((line): line is number => line !== null));
    if (complete(grid.map((values, index) => values[index]))) lines.push(11);
    if (complete(grid.map((values, index) => values[4 - index]))) lines.push(12);
    if ([grid[0][0], grid[0][4], grid[4][0], grid[4][4]].every((number) => number === 0 || calledSet.has(number))) lines.push(13);
    return lines.length ? { ...row, lines } : null;
  }).filter(Boolean) as Array<{ player_id: number; card_number: number; lines: number[] }>;
  if (candidates.length) {
    const prize = Number(game.prize_pool) / candidates.length;
    for (const candidate of candidates) {
      const inserted = await simulationPool!.query("INSERT INTO simulation_winners (game_id, player_id, card_number, prize_amount, winning_rows) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING id", [game.id, candidate.player_id, candidate.card_number, prize, candidate.lines]);
      if (inserted.rowCount) {
        await simulationPool!.query("UPDATE simulation_players SET main_balance = main_balance + $1 WHERE id = $2", [prize, candidate.player_id]);
        await simulationPool!.query("INSERT INTO simulation_transactions (run_id, player_id, type, amount, balance_type) VALUES ($1, $2, 'bingo_prize', $3, 'main')", [runId, candidate.player_id, prize]);
      }
    }
    await simulationPool!.query("UPDATE simulation_games SET status = 'finished', finished_at = NOW() WHERE id = $1", [game.id]);
  }
  await broadcastRun(runId, String(game.id));
  if (candidates.length) await completeSimulationRun(runId);
}

function runSimulationDriver(runId: string, config: SimulationConfig) {
  const random = seededRandom(config.seed);
  const socketUrl = process.env.SIMULATION_SOCKET_URL;
  const sockets: Socket[] = [];
  if (socketUrl && simulationIo) {
    void simulationPool!.query("SELECT id FROM simulation_players WHERE run_id = $1 ORDER BY id", [runId]).then(({ rows }) => {
      rows.forEach((row, index) => {
        setTimeout(() => {
          const playerId = Number(row.id);
          const socket = connectSocket(socketUrl, { auth: { simulationToken: process.env.SIMULATION_AUTH_TOKEN, simulationRunId: runId, simulationPlayerId: playerId }, transports: ["polling", "websocket"], upgrade: false });
          sockets.push(socket);
          socket.on("connect", () => {
            const firstCard = ((index * 17) % 400) + 1;
            const secondCard = ((index * 17 + 137) % 400) + 1;
            socket.emit("game:join", { playerId, cardNumbers: [firstCard, secondCard], gameType: "75" });
            if (config.releaseProbability > 0 && random() < config.releaseProbability) setTimeout(() => socket.emit("game:selection", { playerId, cardNumbers: [firstCard], gameType: "75" }), Math.max(100, config.selectionDelayMs));
          });
          socket.on("game:state", (state: { status?: string }) => {
            if (!config.remainThroughRound && state.status === "active") socket.disconnect();
          });
        }, index * config.selectionDelayMs);
      });
    }).catch((error) => console.error("Unable to start simulation players", error));
  }
  const timer = setInterval(() => {
    void advanceSimulation(runId, random).catch((error) => console.error("Simulation tick failed", error));
  }, Math.max(100, Math.min(config.callIntervalMs, 1000)));
  activeRuns.set(runId, { timer, sockets });
}

export function registerSimulationSockets(io: Server) {
  simulationIo = io;
  io.use((socket, next) => {
    const auth = socket.handshake.auth ?? {};
    if (!verifySimulationToken(auth.simulationToken)) return next();
    const runId = typeof auth.simulationRunId === "string" ? auth.simulationRunId : "";
    const playerId = Number(auth.simulationPlayerId);
    if (!runId || !Number.isSafeInteger(playerId) || playerId <= 0) return next(new Error("Simulation authentication is invalid."));
    void simulationPool!.query("SELECT 1 FROM simulation_players p JOIN simulation_runs r ON r.id = p.run_id WHERE p.id = $1 AND p.run_id = $2 AND r.status = 'running'", [playerId, runId])
      .then((result) => {
        if (!result.rowCount) { next(new Error("Simulation identity is not active.")); return; }
        (socket.data as SimulationSocketData).simulation = { runId, playerId };
        next();
      })
      .catch(() => next(new Error("Simulation authentication is unavailable.")));
  });
  io.on("connection", (socket) => {
    const simulation = (socket.data as SimulationSocketData).simulation;
    if (!simulation) return;
    let queue = Promise.resolve();
    const sync = async (payload: { playerId?: string | number; cardNumbers?: number[]; allowEmpty?: boolean }, acknowledge?: (response: { ok: boolean; message?: string; playerBalance?: number; mainBalance?: number }) => void) => {
      try {
        if (Number(payload.playerId) !== simulation.playerId) throw new Error("Simulation player verification failed.");
        const result = await persistSimulationSelection(simulation.runId, simulation.playerId, Array.isArray(payload.cardNumbers) ? payload.cardNumbers.map(Number) : [], payload.allowEmpty === true);
        const game = await activeGame(simulation.runId);
        if (!game) throw new Error("Simulation game is unavailable");
        const room = roomFor(simulation.runId, String(game.id));
        await socket.join(room);
        socket.data.gameId = String(game.id);
        socket.data.gameType = "75";
        socket.data.playerId = simulation.playerId;
        const occupied = await simulationPool!.query("SELECT card_number FROM simulation_game_cards WHERE game_id = $1 AND player_id <> $2", [game.id, simulation.playerId]);
        io.to(room).emit("cards:occupied", occupied.rows.map((row) => Number(row.card_number)));
        await broadcastRun(simulation.runId, String(game.id));
        acknowledge?.({ ok: true, playerBalance: result.playerBalance, mainBalance: result.mainBalance });
      } catch (error) { acknowledge?.({ ok: false, message: error instanceof Error ? error.message : String(error) }); }
    };
    const release = () => {
      queue = queue.then(async () => {
        const game = await activeGame(simulation.runId);
        if (game && game.status === "selecting") await persistSimulationSelection(simulation.runId, simulation.playerId, [], true);
      }).catch(() => undefined);
    };
    socket.on("game:join", (payload, acknowledge) => { queue = queue.then(() => sync(payload, acknowledge)); });
    socket.on("game:selection", (payload, acknowledge) => { queue = queue.then(() => sync({ ...payload, allowEmpty: true }, acknowledge)); });
    socket.on("game:leave", release);
    socket.on("disconnect", release);
  });
}

export function isSimulationSocketData(data: unknown): data is SimulationSocketData {
  return Boolean((data as SimulationSocketData | undefined)?.simulation);
}
