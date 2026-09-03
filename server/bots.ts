import { randomInt } from "node:crypto";
import type { PoolClient } from "pg";
import { BOT_ROSTER } from "@shared/api";
import { BOT_DEFAULT_BALANCE, BOT_TELEGRAM_ID_BASE, CARD_SELECTION_LOCKED_ERROR, db, getBotSettings } from "./db";

const CARD_PRICE = 10;
const BOT_SELECTION_CUTOFF_MS = 45000;

type BotAssignment = {
  index: number;
  name: string;
  cardNumber: number;
};

type BotBalance = {
  userId: number;
  playerBalance: number;
  mainBalance: number;
};

export { BOT_ROSTER };

export function chooseBotCards(availableCards: number[]) {
  if (!availableCards.length) return [];
  return [availableCards[randomInt(availableCards.length)]];
}

export function planBotAssignments(existingBotKeys: Iterable<string>, availableCards: number[], botCount: number): BotAssignment[] {
  const existing = new Set(existingBotKeys);
  const target = Math.min(Math.max(0, Math.floor(botCount)), BOT_ROSTER.length);
  const missingIndexes = BOT_ROSTER
    .map((_, index) => index)
    .filter((index) => index < target && !existing.has(`global-bot:${index}`));

  return missingIndexes.slice(0, availableCards.length).map((index, cardIndex) => ({
    index,
    name: BOT_ROSTER[index],
    cardNumber: availableCards[cardIndex],
  }));
}

async function botUsers(client: PoolClient, assignments: BotAssignment[]) {
  const result = await client.query<{ id: number | string; bot_key: string }>(
    `INSERT INTO users (telegram_id, username, display_name, is_bot, bot_key, updated_at)
     SELECT incoming.telegram_id, incoming.username, incoming.display_name, TRUE, incoming.bot_key, NOW()
     FROM UNNEST($1::bigint[], $2::text[], $3::text[], $4::text[])
       AS incoming(telegram_id, username, display_name, bot_key)
     ON CONFLICT (telegram_id) DO UPDATE
     SET username = EXCLUDED.username, display_name = EXCLUDED.display_name, is_bot = TRUE, bot_key = EXCLUDED.bot_key, updated_at = NOW()
     RETURNING id, bot_key`,
    [
      assignments.map(({ index }) => BOT_TELEGRAM_ID_BASE + index),
      assignments.map(({ name }) => name.toLowerCase()),
      assignments.map(({ name }) => name),
      assignments.map(({ index }) => `global-bot:${index}`),
    ],
  );
  return new Map(result.rows.map((row) => [row.bot_key, Number(row.id)]));
}

async function fundBots(client: PoolClient, userIds: number[]): Promise<BotBalance[]> {
  await client.query(
    `INSERT INTO balances (user_id, balance, player_balance, main_balance)
     SELECT ids.user_id, 0, $2, 0
     FROM UNNEST($1::bigint[]) AS ids(user_id)
     ON CONFLICT (user_id) DO NOTHING`,
    [userIds, BOT_DEFAULT_BALANCE],
  );
  const result = await client.query<{ user_id: number | string; player_balance: number | string; main_balance: number | string }>(
    "SELECT user_id, player_balance, main_balance FROM balances WHERE user_id = ANY($1::bigint[]) FOR UPDATE",
    [userIds],
  );
  const balances = result.rows.map((row) => ({
    userId: Number(row.user_id),
    playerBalance: Number(row.player_balance),
    mainBalance: Number(row.main_balance),
  }));
  const funding = balances.map((balance) => ({
    ...balance,
    amount: Math.max(0, CARD_PRICE - balance.playerBalance - balance.mainBalance),
  })).filter(({ amount }) => amount > 0);

  if (funding.length) {
    await client.query(
      `UPDATE balances b
       SET player_balance = b.player_balance + funding.amount, updated_at = NOW()
       FROM UNNEST($1::bigint[], $2::numeric[]) AS funding(user_id, amount)
       WHERE b.user_id = funding.user_id`,
      [funding.map(({ userId }) => userId), funding.map(({ amount }) => amount)],
    );
    await client.query(
      `INSERT INTO transactions (user_id, type, amount, balance_type, status, external_reference)
       SELECT funding.user_id, 'bot_funding', funding.amount, 'player', 'approved', 'bot-funding:' || funding.user_id
       FROM UNNEST($1::bigint[], $2::numeric[]) AS funding(user_id, amount)`,
      [funding.map(({ userId }) => userId), funding.map(({ amount }) => amount)],
    );
    for (const balance of balances) {
      const amount = funding.find((item) => item.userId === balance.userId)?.amount ?? 0;
      balance.playerBalance += amount;
    }
  }
  return balances;
}

async function chargeBotCards(client: PoolClient, gameId: string, balances: BotBalance[]) {
  const debits = balances.map(({ userId, playerBalance }) => ({
    userId,
    player: Math.min(playerBalance, CARD_PRICE),
    main: Math.max(0, CARD_PRICE - Math.min(playerBalance, CARD_PRICE)),
  }));
  await client.query(
    `UPDATE balances b
     SET player_balance = b.player_balance - debits.player,
         main_balance = b.main_balance - debits.main,
         updated_at = NOW()
     FROM UNNEST($1::bigint[], $2::numeric[], $3::numeric[]) AS debits(user_id, player, main)
     WHERE b.user_id = debits.user_id`,
    [debits.map(({ userId }) => userId), debits.map(({ player }) => player), debits.map(({ main }) => main)],
  );
  const playerDebits = debits.filter(({ player }) => player > 0);
  const mainDebits = debits.filter(({ main }) => main > 0);
  if (playerDebits.length) {
    await client.query(
      `INSERT INTO transactions (user_id, type, amount, balance_type, status, external_reference)
       SELECT debits.user_id, 'card_purchase', debits.amount, 'player', 'approved', 'game:' || $1 || ':bot:' || debits.user_id
       FROM UNNEST($2::bigint[], $3::numeric[]) AS debits(user_id, amount)`,
      [gameId, playerDebits.map(({ userId }) => userId), playerDebits.map(({ player }) => player)],
    );
  }
  if (mainDebits.length) {
    await client.query(
      `INSERT INTO transactions (user_id, type, amount, balance_type, status, external_reference)
       SELECT debits.user_id, 'card_purchase', debits.amount, 'main', 'approved', 'game:' || $1 || ':bot:' || debits.user_id
       FROM UNNEST($2::bigint[], $3::numeric[]) AS debits(user_id, amount)`,
      [gameId, mainDebits.map(({ userId }) => userId), mainDebits.map(({ main }) => main)],
    );
  }
}

async function availableCards(client: PoolClient, gameId: string) {
  const result = await client.query<{ card_number: number }>(
    `SELECT bc.card_number - 400 AS card_number
     FROM bingo_cards bc
     WHERE bc.game_type = '75'
       AND NOT EXISTS (SELECT 1 FROM game_cards gc WHERE gc.game_id = $1 AND gc.card_number = bc.card_number)
     ORDER BY bc.card_number`,
    [gameId],
  );
  return result.rows.map((row) => Number(row.card_number));
}

async function runBotCoordinator(gameId: string) {
  if (!db) return 0;
  const settings = await getBotSettings();
  if (!settings.enabled || settings.botCount === 0) return 0;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(90213, hashtext($1))", [gameId]);
    const game = await client.query("SELECT status, selecting_started_at FROM games WHERE id = $1 AND game_type = '75' FOR UPDATE", [gameId]);
    const selectingStartedAt = game.rowCount ? new Date(game.rows[0].selecting_started_at).getTime() : 0;
    const selectionExpired = () => Date.now() - selectingStartedAt >= BOT_SELECTION_CUTOFF_MS;
    if (!game.rowCount || game.rows[0].status !== "selecting" || selectionExpired()) {
      await client.query("COMMIT");
      return 0;
    }
    const existing = await client.query<{ bot_key: string }>(
      `SELECT u.bot_key
       FROM game_cards gc JOIN users u ON u.id = gc.user_id
       WHERE gc.game_id = $1 AND u.is_bot = TRUE`,
      [gameId],
    );
    const assignments = planBotAssignments(existing.rows.map((row) => row.bot_key), await availableCards(client, gameId), settings.botCount).slice(0, 1);
    if (!assignments.length || selectionExpired()) {
      await client.query("COMMIT");
      return 0;
    }

    const userIdsByKey = await botUsers(client, assignments);
    const userIds = assignments.map(({ index }) => {
      const userId = userIdsByKey.get(`global-bot:${index}`);
      if (!userId) throw new Error(`Bot user global-bot:${index} is unavailable`);
      return userId;
    });
    const balances = await fundBots(client, userIds);
    if (selectionExpired()) throw new Error(CARD_SELECTION_LOCKED_ERROR);

    const storedCards = assignments.map(({ cardNumber }) => cardNumber + 400);
    await client.query(
      `INSERT INTO game_cards (game_id, user_id, card_number)
       SELECT $1, cards.user_id, cards.card_number
       FROM UNNEST($2::bigint[], $3::int[]) AS cards(user_id, card_number)`,
      [gameId, userIds, storedCards],
    );
    if (selectionExpired()) throw new Error(CARD_SELECTION_LOCKED_ERROR);
    await chargeBotCards(client, gameId, balances);
    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
       SELECT audits.user_id, 'bot_card_purchase', 'game', $1, jsonb_build_object('cardNumber', audits.card_number, 'amount', $2)
       FROM UNNEST($3::bigint[], $4::int[]) AS audits(user_id, card_number)`,
      [gameId, CARD_PRICE, userIds, storedCards],
    );
    await client.query(
      `UPDATE games
       SET prize_pool = (SELECT COUNT(*) * 10 * 0.8 FROM game_cards WHERE game_id = $1)
       WHERE id = $1 AND status = 'selecting'`,
      [gameId],
    );
    await client.query("COMMIT");
    return assignments.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureBotsForSelectingGame(gameId: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await runBotCoordinator(gameId);
    } catch (error) {
      if (error instanceof Error && error.message === CARD_SELECTION_LOCKED_ERROR) return 0;
      if ((error as { code?: string }).code !== "23505" || attempt === 2) throw error;
    }
  }
  return 0;
}
