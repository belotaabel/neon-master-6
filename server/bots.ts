import { randomInt } from "node:crypto";
import type { PoolClient } from "pg";
import { BOT_ROSTER } from "@shared/api";
import { BOT_DEFAULT_BALANCE, BOT_TELEGRAM_ID_BASE, CARD_SELECTION_LOCKED_ERROR, db, getBotSettings, persistSelectedCards } from "./db";

const CARD_PRICE = 10;
const BOT_SELECTION_MIN_DELAY_MS = 450;
const BOT_SELECTION_MAX_DELAY_MS = 650;

export { BOT_ROSTER };

export function chooseBotCards(availableCards: number[]) {
  const cards = [...availableCards];
  const selected: number[] = [];
  const count = Math.min(randomInt(1, 3), cards.length);
  for (let index = 0; index < count; index += 1) {
    const selectedIndex = randomInt(cards.length);
    selected.push(cards.splice(selectedIndex, 1)[0]);
  }
  return selected;
}

async function botUser(client: PoolClient, index: number, name: string) {
  const result = await client.query(
    `INSERT INTO users (telegram_id, username, display_name, is_bot, bot_key, updated_at)
     VALUES ($1, $2, $3, TRUE, $4, NOW())
     ON CONFLICT (telegram_id) DO UPDATE
     SET username = EXCLUDED.username, display_name = EXCLUDED.display_name, is_bot = TRUE, bot_key = EXCLUDED.bot_key, updated_at = NOW()
     RETURNING id`,
    [BOT_TELEGRAM_ID_BASE + index, name.toLowerCase(), name, `global-bot:${index}`],
  );
  return Number(result.rows[0].id);
}

async function fundBot(client: PoolClient, userId: number) {
  await client.query(
    `INSERT INTO balances (user_id, balance, player_balance, main_balance)
     VALUES ($1, 0, $2, 0)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, BOT_DEFAULT_BALANCE],
  );
  const balance = await client.query(
    "SELECT player_balance, main_balance FROM balances WHERE user_id = $1 FOR UPDATE",
    [userId],
  );
  const available = Number(balance.rows[0]?.player_balance ?? 0) + Number(balance.rows[0]?.main_balance ?? 0);
  const amount = Math.max(0, CARD_PRICE * 2 - available);
  if (amount > 0) {
    await client.query("UPDATE balances SET player_balance = player_balance + $1, updated_at = NOW() WHERE user_id = $2", [amount, userId]);
    await client.query(
      "INSERT INTO transactions (user_id, type, amount, balance_type, status, external_reference) VALUES ($1, 'bot_funding', $2, 'player', 'approved', $3)",
      [userId, amount, `bot-funding:${userId}`],
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
    if (!game.rowCount || game.rows[0].status !== "selecting" || Date.now() - selectingStartedAt >= 45000) {
      await client.query("COMMIT");
      return 0;
    }
    const existing = await client.query<{ bot_key: string }>(
      `SELECT u.bot_key
       FROM game_cards gc JOIN users u ON u.id = gc.user_id
       WHERE gc.game_id = $1 AND u.is_bot = TRUE`,
      [gameId],
    );
    const existingBots = new Set(existing.rows.map((row) => row.bot_key));
    const nextBotIndex = BOT_ROSTER.findIndex((_, index) => index < settings.botCount && !existingBots.has(`global-bot:${index}`));
    if (nextBotIndex === -1) {
      await client.query("COMMIT");
      return 0;
    }
    const latestBotCard = await client.query<{ latest_purchased_at: string | Date | null }>(
      `SELECT MAX(gc.purchased_at) AS latest_purchased_at
       FROM game_cards gc JOIN users u ON u.id = gc.user_id
       WHERE gc.game_id = $1 AND u.is_bot = TRUE`,
      [gameId],
    );
    const latestPurchasedAt = latestBotCard.rows[0]?.latest_purchased_at;
    const delay = randomInt(BOT_SELECTION_MIN_DELAY_MS, BOT_SELECTION_MAX_DELAY_MS + 1);
    if (latestPurchasedAt && Date.now() - new Date(latestPurchasedAt).getTime() < delay) {
      await client.query("COMMIT");
      return 0;
    }
    const cards = chooseBotCards(await availableCards(client, gameId));
    if (Date.now() - selectingStartedAt >= 45000 || !cards.length) {
      await client.query("COMMIT");
      return 0;
    }
    const userId = await botUser(client, nextBotIndex, BOT_ROSTER[nextBotIndex]);
    await fundBot(client, userId);
    await persistSelectedCards(gameId, userId, cards, client);
    await client.query("COMMIT");
    return 1;
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
