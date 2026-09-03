import type { RequestHandler } from "express";
import { createDepositRequest, createWithdrawalRequest, getTelegramProfile, getWalletTransactions } from "../db";
import { getTelegramUser } from "./me";
import { notifyAdminDeposit, notifyAdminWithdrawal } from "./telegram";

function authenticatedTelegramId(req: Parameters<RequestHandler>[0]) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const initData = req.header("x-telegram-init-data");
  if (!token || !initData) return null;
  return getTelegramUser(initData, token)?.id ?? null;
}

export const handleWallet: RequestHandler = async (req, res) => {
  const telegramId = authenticatedTelegramId(req);
  if (!telegramId) return res.sendStatus(401);
  try {
    const profile = await getTelegramProfile(telegramId);
    if (!profile) return res.sendStatus(404);
    return res.json({
      profile,
      transactions: await getWalletTransactions(telegramId),
      depositReceiver: process.env.TELEBIRR_DEPOSIT_NUMBER ?? null,
    });
  } catch (error) { console.error("Wallet load failed", error); return res.status(500).json({ error: "Wallet unavailable" }); }
};

export const handleDeposit: RequestHandler = async (req, res) => {
  const telegramId = authenticatedTelegramId(req);
  const amount = Number(req.body?.amount);
  const reference = String(req.body?.reference ?? "").trim();
  if (!telegramId) return res.sendStatus(401);
  if (!Number.isFinite(amount) || amount < 10 || amount > 1000000 || !reference) return res.status(400).json({ error: "Minimum deposit is 10 ETB, and a payment reference is required." });
  try {
    const transaction = await createDepositRequest(telegramId, Math.round(amount * 100) / 100, reference.slice(0, 200));
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (token) {
      try { await notifyAdminDeposit(token, transaction, telegramId, reference.slice(0, 200)); }
      catch (error) { console.error("Admin deposit notification failed", error); }
    }
    return res.status(201).json(transaction);
  } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Deposit request failed" }); }
};

export const handleWithdrawal: RequestHandler = async (req, res) => {
  const telegramId = authenticatedTelegramId(req);
  const amount = Number(req.body?.amount);
  const account = String(req.body?.account ?? "").trim();
  const ownerName = String(req.body?.owner ?? "").trim();
  if (!telegramId) return res.sendStatus(401);
  if (!Number.isFinite(amount) || amount < 100 || amount > 1000000 || !account || !ownerName) return res.status(400).json({ error: "Minimum withdrawal is 100 ETB, and account details are required." });
  try {
    const transaction = await createWithdrawalRequest(telegramId, Math.round(amount * 100) / 100, account.slice(0, 200), ownerName.slice(0, 120));
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (token) {
      try { await notifyAdminWithdrawal(token, transaction, telegramId, account.slice(0, 200), ownerName.slice(0, 120)); }
      catch (error) { console.error("Admin withdrawal notification failed", error); }
    }
    return res.status(201).json(transaction);
  } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Withdrawal request failed" }); }
};
