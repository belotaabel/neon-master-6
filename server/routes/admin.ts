import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { creditBotWallet, db, createAdminPromoCode, fundAllBotWallets, getAdminBots, getAdminOverview, getAdminPlayers, getAdminPromoCodes, getBotSettings, getDepositBonusSettings, updateBotSettings, updateDepositBonusSettings } from "../db";
import { getTelegramUser } from "./me";
import { clearSimulationRun, defaultSimulationConfig, simulationEnabled, simulationRunStatus, startSimulationRun, stopSimulationRun } from "../simulation";

type Audience = "all" | "active" | "new";

type TelegramResponse = { ok?: boolean; description?: string };

function adminTelegramId(req: Parameters<RequestHandler>[0]) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const initData = req.header("x-telegram-init-data");
  const allowedId = Number(process.env.TELEGRAM_ADMIN_CHAT_ID);
  if (!token || !initData || !Number.isSafeInteger(allowedId)) return null;
  const user = getTelegramUser(initData, token);
  return user?.id === allowedId ? user.id : null;
}

function validAdminToken(value: string | undefined) {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret || !value) return false;
  const [expiresAt, nonce, signature] = value.split(".");
  if (!expiresAt || !nonce || !signature || Number(expiresAt) < Date.now()) return false;
  const expected = createHmac("sha256", secret).update(`${expiresAt}.${nonce}`).digest("hex");
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function isAdminRequest(req: Parameters<RequestHandler>[0]) {
  return Boolean(adminTelegramId(req) || validAdminToken(req.header("x-admin-token")));
}

export const handleAdminLogin: RequestHandler = (req, res) => {
  const secret = process.env.ADMIN_PASSWORD;
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!secret) {
    res.status(503).json({ error: "Admin password is not configured" });
    return;
  }
  const suppliedHash = createHmac("sha256", "admin-password").update(password).digest();
  const expectedHash = createHmac("sha256", "admin-password").update(secret).digest();
  if (!timingSafeEqual(suppliedHash, expectedHash)) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }
  const expiresAt = String(Date.now() + 8 * 60 * 60 * 1000);
  const nonce = randomBytes(24).toString("hex");
  const signature = createHmac("sha256", secret).update(`${expiresAt}.${nonce}`).digest("hex");
  res.json({ token: `${expiresAt}.${nonce}.${signature}` });
};

function requireAdmin(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) {
  if (!isAdminRequest(req)) {
    res.status(403).json({ error: "Admin Telegram authentication required" });
    return false;
  }
  return true;
}

function dataUrlToPhoto(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const match = value.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("Only PNG, JPG, or WEBP images are supported");
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.byteLength) throw new Error("The selected image is empty");
  if (buffer.byteLength > 5 * 1024 * 1024) throw new Error("Image must be smaller than 5MB");
  return { mimeType: match[1] === "image/jpg" ? "image/jpeg" : match[1], buffer };
}

async function sendTelegramMessage(token: string, chatId: number, message: string, photo: ReturnType<typeof dataUrlToPhoto>) {
  let response: Response;
  if (photo) {
    const form = new FormData();
    form.set("chat_id", String(chatId));
    form.set("caption", message);
    const extension = photo.mimeType === "image/png" ? "png" : photo.mimeType === "image/webp" ? "webp" : "jpg";
    form.set("photo", new Blob([photo.buffer], { type: photo.mimeType }), `broadcast-image.${extension}`);
    response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form });
  } else {
    response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message }),
    });
  }
  const body = await response.json() as TelegramResponse;
  if (!response.ok || !body.ok) throw new Error(body.description ?? "Telegram delivery failed");
}

export const handleAdminBonusSettings: RequestHandler = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    res.json(await getDepositBonusSettings());
  } catch (error) {
    console.error("Admin bonus settings load failed", error);
    res.status(500).json({ error: "Bonus settings unavailable" });
  }
};

export const handleAdminBonusSettingsUpdate: RequestHandler = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const firstPercent = Number(req.body?.firstPercent);
  const repeatPercent = Number(req.body?.repeatPercent);
  if (!Number.isFinite(firstPercent) || !Number.isFinite(repeatPercent) || firstPercent < 0 || firstPercent > 100 || repeatPercent < 0 || repeatPercent > 100) {
    res.status(400).json({ error: "Bonus percentages must be between 0 and 100" });
    return;
  }
  try {
    res.json(await updateDepositBonusSettings(firstPercent, repeatPercent));
  } catch (error) {
    console.error("Admin bonus settings update failed", error);
    res.status(500).json({ error: "Bonus settings could not be saved" });
  }
};

export const handleAdminBotSettings: RequestHandler = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    res.json(await getBotSettings());
  } catch (error) {
    console.error("Admin bot settings load failed", error);
    res.status(500).json({ error: "Bot settings unavailable" });
  }
};

export const handleAdminBotSettingsUpdate: RequestHandler = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (typeof req.body?.enabled !== "boolean" || !Number.isInteger(req.body?.botCount) || req.body.botCount < 0 || req.body.botCount > 200) {
    res.status(400).json({ error: "Bot settings require a boolean enabled value and a count from 0 to 200" });
    return;
  }
  try {
    res.json(await updateBotSettings(req.body.enabled, req.body.botCount));
  } catch (error) {
    console.error("Admin bot settings update failed", error);
    res.status(500).json({ error: "Bot settings could not be saved" });
  }
};

export const handleAdminBots: RequestHandler = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    res.json(await getAdminBots());
  } catch (error) {
    console.error("Admin bot accounts load failed", error);
    res.status(500).json({ error: "Bot accounts unavailable" });
  }
};

export const handleAdminBotBulkFunding: RequestHandler = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    res.status(400).json({ error: "Funding amount must be between 0 and 1,000,000 ETB" });
    return;
  }
  try {
    res.json(await fundAllBotWallets(Math.round(amount * 100) / 100));
  } catch (error) {
    console.error("Admin bulk bot funding failed", error);
    res.status(500).json({ error: "Bot wallets could not be funded" });
  }
};

export const handleAdminBotFunding: RequestHandler = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const botId = Number(req.params.botId);
  const amount = Number(req.body?.amount);
  if (!Number.isSafeInteger(botId) || botId <= 0 || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    res.status(400).json({ error: "Funding amount must be between 0 and 1,000,000 ETB" });
    return;
  }
  try {
    res.json(await creditBotWallet(botId, Math.round(amount * 100) / 100));
  } catch (error) {
    if (error instanceof Error && error.message === "Bot account not found") {
      res.status(404).json({ error: error.message });
      return;
    }
    console.error("Admin bot funding failed", error);
    res.status(500).json({ error: "Bot wallet could not be funded" });
  }
};

export const handleAdminOverview: RequestHandler = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    res.json(await getAdminOverview());
  } catch (error) {
    console.error("Admin overview load failed", error);
    res.status(500).json({ error: "Admin overview unavailable" });
  }
};

export const handleAdminPlayers: RequestHandler = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    res.json(await getAdminPlayers());
  } catch (error) {
    console.error("Admin player list failed", error);
    res.status(500).json({ error: "Player list unavailable" });
  }
};

export const handleAdminPromoCodes: RequestHandler = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    res.json(await getAdminPromoCodes());
  } catch (error) {
    console.error("Admin promo list failed", error);
    res.status(500).json({ error: "Promo code list unavailable" });
  }
};

export const handleAdminPromoCodeCreate: RequestHandler = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const code = typeof req.body?.code === "string" ? req.body.code.trim().toUpperCase() : "";
  const amount = Number(req.body?.amount);
  const maxUses = req.body?.maxUses === "" || req.body?.maxUses == null ? null : Number(req.body.maxUses);
  const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : null;
  if (!/^[A-Z0-9_-]{3,32}$/.test(code) || !Number.isFinite(amount) || amount <= 0 || (maxUses !== null && (!Number.isInteger(maxUses) || maxUses <= 0)) || (expiresAt && Number.isNaN(expiresAt.getTime()))) {
    res.status(400).json({ error: "Invalid promo code details" });
    return;
  }
  try {
    res.status(201).json(await createAdminPromoCode({ code, amount, maxUses, expiresAt: expiresAt?.toISOString() ?? null }));
  } catch (error) {
    const codeValue = (error as { code?: string }).code;
    if (codeValue === "23505") {
      res.status(409).json({ error: "Promo code already exists" });
      return;
    }
    console.error("Admin promo creation failed", error);
    res.status(500).json({ error: "Promo code could not be created" });
  }
};

export const handleAdminSimulationStatus: RequestHandler = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!simulationEnabled()) {
    res.json({ enabled: false, run: null, defaults: defaultSimulationConfig() });
    return;
  }
  try {
    res.json({ enabled: true, run: await simulationRunStatus(typeof req.query.runId === "string" ? req.query.runId : undefined), defaults: defaultSimulationConfig() });
  } catch (error) {
    console.error("Admin simulation status failed", error);
    res.status(503).json({ error: error instanceof Error ? error.message : "Simulation status unavailable" });
  }
};

export const handleAdminSimulationStart: RequestHandler = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!simulationEnabled()) {
    res.status(404).json({ error: "Staging simulation is disabled" });
    return;
  }
  try {
    res.status(201).json(await startSimulationRun(req.body ?? {}));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Simulation could not be started";
    res.status(message.includes("already active") ? 409 : 400).json({ error: message });
  }
};

export const handleAdminSimulationStop: RequestHandler = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!simulationEnabled()) {
    res.status(404).json({ error: "Staging simulation is disabled" });
    return;
  }
  try {
    res.json({ run: await stopSimulationRun(typeof req.body?.runId === "string" ? req.body.runId : undefined) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Simulation could not be stopped" });
  }
};

export const handleAdminSimulationClear: RequestHandler = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!simulationEnabled()) {
    res.status(404).json({ error: "Staging simulation is disabled" });
    return;
  }
  try {
    res.json(await clearSimulationRun(typeof req.body?.runId === "string" ? req.body.runId : undefined));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Simulation could not be cleared" });
  }
};

export const handleAdminBroadcast: RequestHandler = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const audience: Audience = req.body?.audience === "active" || req.body?.audience === "new" ? req.body.audience : "all";
  if (!token || !db) {
    res.status(503).json({ error: "Broadcast service is not configured" });
    return;
  }
  if (!message || message.length > 1000) {
    res.status(400).json({ error: "Message must contain 1–1,000 characters" });
    return;
  }
  let photo: ReturnType<typeof dataUrlToPhoto>;
  try {
    photo = dataUrlToPhoto(req.body?.image);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid image" });
    return;
  }
  const filters = audience === "active"
    ? "WHERE updated_at >= NOW() - INTERVAL '10 minutes'"
    : audience === "new"
      ? "WHERE created_at >= NOW() - INTERVAL '30 days'"
      : "";
  try {
    const users = await db.query<{ telegram_id: number }>(`SELECT telegram_id FROM users ${filters} ORDER BY id`);
    let sent = 0;
    let failed = 0;
    for (const user of users.rows) {
      try {
        await sendTelegramMessage(token, Number(user.telegram_id), message, photo);
        sent += 1;
      } catch (error) {
        failed += 1;
        console.error("Telegram broadcast delivery failed", { telegramId: user.telegram_id, error });
      }
    }
    res.json({ total: users.rowCount, sent, failed });
  } catch (error) {
    console.error("Admin broadcast failed", error);
    res.status(500).json({ error: "Broadcast could not be sent" });
  }
};
