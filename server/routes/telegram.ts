import { RequestHandler } from "express";
import { createDepositRequest, createWithdrawalRequest, getTelegramProfile, redeemPromoCode, registerTelegramUser, reviewDepositRequest, reviewWithdrawalRequest } from "../db";

const depositSteps = new Map<number, { step: "amount" | "reference"; amount?: number }>();
const withdrawalSteps = new Map<number, { step: "amount" | "account" | "owner"; amount?: number; account?: string }>();
const promoSteps = new Set<number>();

function isTelegramAdmin(userId: number) {
  const adminId = Number(process.env.TELEGRAM_ADMIN_USER_ID ?? process.env.TELEGRAM_ADMIN_CHAT_ID);
  return Number.isSafeInteger(adminId) && userId === adminId;
}

function mainMenu() {
  const playButton = { text: "🎮 Play Bingo" };
  return {
    keyboard: [
      [{ text: "📝 Register" }, playButton],
      [{ text: "🎁 Promo Code" }, { text: "💰 Deposit" }],
      [{ text: "💸 Withdraw" }, { text: "🔗 Invite & Earn" }],
      [{ text: "👤 Profile & Account" }, { text: "🆘 Support" }],
    ],
    resize_keyboard: true,
  };
}

function gameMenu(miniAppUrl?: string) {
  if (!miniAppUrl) return mainMenu();
  const url = new URL(miniAppUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/bingo/75`;
  return { inline_keyboard: [[{ text: "75 BINGO", web_app: { url: url.toString() } }], [{ text: "↩️ Back to Menu", callback_data: "back_to_menu" }]] };
}

function backMenu() {
  return {
    keyboard: [[{ text: "↩️ Back to Menu" }]],
    resize_keyboard: true,
  };
}

function contactRequestMenu() {
  return {
    keyboard: [[{ text: "📱 Share Contact", request_contact: true }], [{ text: "↩️ Back to Menu" }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function requiredChannelReference() {
  return (process.env.TELEGRAM_REQUIRED_CHANNEL_ID ?? process.env.TELEGRAM_REQUIRED_CHANNEL_USERNAME ?? process.env.REQUIRED_CHANNEL_USERNAME ?? "").trim();
}

function requiredChannelUsername() {
  const reference = requiredChannelReference().replace(/^@/, "");
  return /^-?\d+$/.test(reference) || reference.startsWith("https://") ? "" : reference;
}

function requiredChannelLink() {
  const configuredLink = (process.env.TELEGRAM_REQUIRED_CHANNEL_LINK ?? process.env.REQUIRED_CHANNEL_LINK ?? "").trim();
  if (configuredLink) return configuredLink;
  const username = requiredChannelUsername();
  return username ? `https://t.me/${username}` : "";
}

function channelJoinMenu() {
  const link = requiredChannelLink();
  return {
    inline_keyboard: [
      ...(link ? [[{ text: "📢 Join Channel", url: link }]] : []),
      [{ text: "✅ I Joined, Check", callback_data: "check_channel_join" }],
      [{ text: "↩️ Back to Menu", callback_data: "back_to_menu" }],
    ],
  };
}

async function hasJoinedRequiredChannel(token: string, userId: number) {
  const channel = requiredChannelReference();
  if (!channel) return true;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getChatMember?chat_id=${encodeURIComponent(channel)}&user_id=${userId}`);
    if (!response.ok) return false;
    const body = await response.json() as { ok?: boolean; result?: { status?: string; is_member?: boolean } };
    if (!body.ok || !body.result) return false;
    return body.result.status === "creator" || body.result.status === "administrator" || body.result.status === "member" || (body.result.status === "restricted" && body.result.is_member === true);
  } catch {
    return false;
  }
}

async function sendRegistrationPrompt(token: string, chatId: number, userId: number) {
  if (await hasJoinedRequiredChannel(token, userId)) {
    await sendTelegramMessage(token, chatId, { text: "ምዝገባዎን ለመጨረስ ከታች ያለውን 'Share Contact' ቁልፍ ይጫኑ።", reply_markup: contactRequestMenu() });
    return true;
  }
  await sendTelegramMessage(token, chatId, { text: "ምዝገባ ለመቀጠል እባክዎ ቻናሉን ይቀላቀሉ። ከተቀላቀሉ በኋላ 'I Joined, Check' ይጫኑ።", reply_markup: channelJoinMenu() });
  return false;
}

export async function sendTelegramMessage(token: string, chatId: number, payload: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, ...payload }),
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Telegram sendMessage failed (${response.status}): ${details}`);
  }
}

export async function notifyAdminDeposit(token: string, transaction: { id: number; amount: number | string }, telegramId: number, reference: string) {
  const adminChatId = Number(process.env.TELEGRAM_ADMIN_CHAT_ID);
  if (!Number.isSafeInteger(adminChatId)) return;
  await sendTelegramMessage(token, adminChatId, {
    text: `🔔 አዲስ Deposit ጥያቄ\n\nተጠቃሚ ID: ${telegramId}\nመጠን: ${transaction.amount} ETB\nTx Ref/SMS:\n${reference}\n\nTransaction ID: ${transaction.id}\nሁኔታ: Pending`,
    reply_markup: { inline_keyboard: [[{ text: "✅ Approve", callback_data: `deposit_approve:${transaction.id}` }, { text: "❌ Reject", callback_data: `deposit_reject:${transaction.id}` }]] },
  });
}

export async function notifyAdminWithdrawal(token: string, transaction: { id: number; amount: number | string }, telegramId: number, account: string, ownerName: string) {
  const adminChatId = Number(process.env.TELEGRAM_ADMIN_CHAT_ID);
  if (!Number.isSafeInteger(adminChatId)) return;
  await sendTelegramMessage(token, adminChatId, {
    text: `🔔 አዲስ Withdraw ጥያቄ\nUser: ${telegramId}\nAmount: ${transaction.amount} ETB\nAccount: ${account}\nOwner: ${ownerName}\nTransaction ID: ${transaction.id}\nStatus: Pending`,
    reply_markup: { inline_keyboard: [[{ text: "✅ Approve", callback_data: `withdraw_approve:${transaction.id}` }, { text: "❌ Reject", callback_data: `withdraw_reject:${transaction.id}` }]] },
  });
}

export const handleTelegramWebhook: RequestHandler = async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const callback = req.body?.callback_query;
  const message = req.body?.message ?? callback?.message;
  const chatId = message?.chat?.id;
  const text = message?.text;
  const contact = message?.contact;
  const miniAppUrl = process.env.MINI_APP_URL ?? process.env.APP_URL ?? process.env.RENDER_EXTERNAL_URL;

  if (!token || !chatId) {
    res.sendStatus(200);
    return;
  }

  if (callback?.data === "back_to_menu") {
    if (callback.from?.id) {
      depositSteps.delete(callback.from.id);
      withdrawalSteps.delete(callback.from.id);
      promoSteps.delete(callback.from.id);
    }
    await sendTelegramMessage(token, chatId, { text: "ዋና ምናሌ።", reply_markup: mainMenu() });
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ callback_query_id: callback.id }) });
    res.sendStatus(200);
    return;
  }

  if (callback?.data === "check_channel_join" && callback.from?.id) {
    const joined = await hasJoinedRequiredChannel(token, callback.from.id);
    if (joined) {
      await sendTelegramMessage(token, chatId, { text: "✅ ቻናሉን መቀላቀልዎ ተረጋግጧል። አሁን ምዝገባዎን ይቀጥሉ።", reply_markup: contactRequestMenu() });
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ callback_query_id: callback.id, text: "Membership confirmed" }) });
    } else {
      await sendTelegramMessage(token, chatId, { text: "ቻናሉን መቀላቀልዎ አልተረጋገጠም። ቻናሉን ከተቀላቀሉ በኋላ እንደገና Check ይጫኑ።", reply_markup: channelJoinMenu() });
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ callback_query_id: callback.id, text: "Please join the channel first", show_alert: true }) });
    }
    res.sendStatus(200);
    return;
  }

  if (callback?.data && callback.from?.id && isTelegramAdmin(callback.from.id)) {
    const [action, transactionIdText] = String(callback.data).split(":");
    const transactionId = Number(transactionIdText);
    if ((action === "deposit_approve" || action === "deposit_reject" || action === "withdraw_approve" || action === "withdraw_reject") && Number.isSafeInteger(transactionId)) {
      try {
        const approved = action.endsWith("approve");
        const reviewed = action.startsWith("deposit")
          ? await reviewDepositRequest(transactionId, approved)
          : await reviewWithdrawalRequest(transactionId, approved);
        const isDeposit = action.startsWith("deposit");
        await sendTelegramMessage(token, chatId, { text: `${approved ? "✅" : "❌"} ${isDeposit ? "Deposit" : "Withdraw"} ${approved ? "ተፈቅዷል" : "ተሰርዟል"}\nTransaction ID: ${transactionId}` });
        try {
          const userText = isDeposit
            ? approved
              ? `✅ የDeposit ጥያቄዎ ተፈቅዷል።\n\nመጠን: ${reviewed.amount} ETB\nቦነስዎን ጨምሮ በPlayer Balance ላይ ተጨምሯል።\nTransaction ID: ${transactionId}`
              : `❌ የDeposit ጥያቄዎ ተሰርዟል።\n\nመጠን: ${reviewed.amount} ETB\nባላንስዎ አልተጨመረም።\nTransaction ID: ${transactionId}`
            : approved
              ? `✅ የWithdraw ጥያቄዎ ተፈቅዷል።\n\nመጠን: ${reviewed.amount} ETB\nTransaction ID: ${transactionId}`
              : `❌ የWithdraw ጥያቄዎ ተሰርዟል።\n\nመጠን: ${reviewed.amount} ETB ወደ Main Balance ተመልሷል።\nTransaction ID: ${transactionId}`;
          await sendTelegramMessage(token, Number(reviewed.telegram_id), { text: userText, reply_markup: mainMenu() });
        } catch (error) {
          console.error("Telegram wallet review user notification failed", { transactionId, error });
        }
      } catch (error) {
        console.error("Telegram transaction review failed", error);
        await sendTelegramMessage(token, chatId, { text: "ይህን የገንዘብ ጥያቄ ማስተካከል አልተቻለም። ቀድሞ ተከናውኖ ሊሆን ይችላል።" });
      }
    }
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ callback_query_id: callback.id }) });
    res.sendStatus(200);
    return;
  }

  if (text === "/start" || (typeof text === "string" && text.startsWith("/start "))) {
    // Reply before touching the database. A database outage must not make Telegram
    // wait for (and eventually retry) the /start update without a response.
    await sendTelegramMessage(token, chatId, {
      text: "እንኳን ወደ 75Bingo በደህና መጡ! ከታች ያለውን ምናሌ ይጠቀሙ።",
      reply_markup: mainMenu(),
    });
    if (message.from?.id) {
      const name = [message.from.first_name, message.from.last_name].filter(Boolean).join(" ");
      try {
        await registerTelegramUser({
          telegramId: message.from.id,
          username: message.from.username,
          displayName: name || message.from.username || `Telegram User ${message.from.id}`,
        });
      } catch (error) {
        console.error("Telegram /start user registration failed", error);
      }
    }
  } else if (contact && contact.user_id === message.from?.id) {
    const joined = await hasJoinedRequiredChannel(token, message.from.id);
    if (!joined) {
      await sendTelegramMessage(token, chatId, { text: "ምዝገባ ለመቀጠል እባክዎ ቻናሉን ይቀላቀሉ።", reply_markup: channelJoinMenu() });
    } else {
    const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ");
    try {
      await registerTelegramUser({
        telegramId: message.from.id,
        username: message.from.username,
        displayName: name || message.from.username || `Telegram User ${message.from.id}`,
        phone: contact.phone_number,
      });
      await sendTelegramMessage(token, chatId, {
        text: `እንኳን ደስ አለዎት ${name}! ምዝገባዎ ተሳክቷል።`,
        reply_markup: mainMenu(),
      });
    } catch (error) {
      console.error("Telegram user registration failed", error);
      await sendTelegramMessage(token, chatId, {
        text: "ምዝገባው አልተሳካም። እባክዎ DATABASE_URL እና ዳታቤዝ ግንኙነቱን ያረጋግጡ።",
        reply_markup: mainMenu(),
      });
    }
    }
  } else if (typeof text === "string") {
    if (text === "↩️ Back to Menu" && message.from?.id) {
      depositSteps.delete(message.from.id);
      withdrawalSteps.delete(message.from.id);
      promoSteps.delete(message.from.id);
      await sendTelegramMessage(token, chatId, { text: "ዋና ምናሌ።", reply_markup: mainMenu() });
    } else {
    const responses: Record<string, string> = {
      "📝 Register": "ምዝገባዎን ለመጨረስ ከታች ያለውን 'Share Contact' ቁልፍ ይጫኑ።",
      "💰 Deposit": "Deposit ለማድረግ Mini App ውስጥ ይግቡ።",
      "💸 Withdraw": "Withdraw ለማድረግ Mini App ውስጥ ይግቡ።",
      "🔗 Invite & Earn": "ጓደኞችዎን ይጋብዙ እና ሽልማት ያግኙ።",
      "👤 Profile & Account": "የመለያዎን መረጃ Mini App ውስጥ ይመልከቱ።",
      "🆘 Support": "እርዳታ ከፈለጉ የጉዳይዎን መልዕክት ይላኩ።",
    };
    if (text === "🎮 Play Bingo") {
      await sendTelegramMessage(token, chatId, {
        text: "75 ቢንጎ ይጫወቱ።",
        reply_markup: gameMenu(miniAppUrl),
      });
    } else if (text === "📝 Register" && message.from?.id) {
      await sendRegistrationPrompt(token, chatId, message.from.id);
    } else if (text === "🎁 Promo Code" && message.from?.id) {
      depositSteps.delete(message.from.id);
      withdrawalSteps.delete(message.from.id);
      promoSteps.add(message.from.id);
      await sendTelegramMessage(token, chatId, { text: "የPromo Code ኮድዎን ይላኩ።", reply_markup: backMenu() });
    } else if (message.from?.id && promoSteps.has(message.from.id)) {
      promoSteps.delete(message.from.id);
      const code = text.trim().toUpperCase();
      if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
        await sendTelegramMessage(token, chatId, { text: "ትክክለኛ የPromo Code ያስገቡ።", reply_markup: mainMenu() });
      } else {
        try {
          const redemption = await redeemPromoCode(message.from.id, code);
          await sendTelegramMessage(token, chatId, { text: `✅ Promo Code ተቀብሏል።\n\n${redemption.amount.toFixed(2)} ብር ወደ Player Balance ተጨምሯል።\nአዲስ Player Balance: ${redemption.playerBalance.toFixed(2)} ብር`, reply_markup: mainMenu() });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Promo code redemption failed";
          const text = message === "Telegram user is not registered"
            ? "መጀመሪያ /start በመላክ ይመዝገቡ።"
            : message === "Promo code is invalid"
              ? "ይህ Promo Code አልተገኘም።"
              : message === "Promo code is inactive"
                ? "ይህ Promo Code አሁን ንቁ አይደለም።"
                : message === "Promo code has expired"
                  ? "የዚህ Promo Code ጊዜ አልፏል።"
                  : message === "Promo code usage limit reached"
                    ? "ይህ Promo Code የተፈቀደው ብዛት ሞልቷል።"
                    : message === "Promo code has already been used"
                      ? "ይህን Promo Code ከዚህ በፊት ተጠቅመውታል።"
                      : "Promo Code መቀበል አልተቻለም። እባክዎ እንደገና ይሞክሩ።";
          if (!text.startsWith("Promo Code መቀበል")) console.error("Telegram promo code redemption failed", error);
          await sendTelegramMessage(token, chatId, { text, reply_markup: mainMenu() });
        }
      }
    } else if (text === "💰 Deposit" && message.from?.id) {
      promoSteps.delete(message.from.id);
      withdrawalSteps.delete(message.from.id);
      depositSteps.set(message.from.id, { step: "amount" });
      const depositNumber = process.env.TELEBIRR_DEPOSIT_NUMBER;
      await sendTelegramMessage(token, chatId, {
        text: `🏦 ባንክ: TeleBirr\n\n⚠️ ከ TeleBirr ወደ TeleBirr ብቻ ያስገቡ።\n\nእባክዎ ብሩን ወደዚህ አካውንት ያስገቡ:\n👉 ቁጥር: ${depositNumber || "Not configured"}\n\nከዚያ ያስገቡትን የብር መጠን ብቻ ይላኩ።\nምሳሌ: 10`,
        reply_markup: backMenu(),
      });
    } else if (text === "💸 Withdraw" && message.from?.id) {
      depositSteps.delete(message.from.id);
      promoSteps.delete(message.from.id);
      withdrawalSteps.set(message.from.id, { step: "amount" });
      await sendTelegramMessage(token, chatId, { text: "💸 Withdraw\n\nለማውጣት የሚፈልጉትን የብር መጠን ያስገቡ።", reply_markup: backMenu() });
    } else if (message.from?.id && withdrawalSteps.get(message.from.id)?.step === "amount") {
      const amount = Number(text.replace(/[, ]/g, ""));
      if (!Number.isFinite(amount) || amount < 100) await sendTelegramMessage(token, chatId, { text: "እባክዎ ትክክለኛ መጠን ያስገቡ። ዝቅተኛው Withdraw 100 ብር ነው።", reply_markup: backMenu() });
      else { withdrawalSteps.set(message.from.id, { step: "account", amount }); await sendTelegramMessage(token, chatId, { text: "የሚላክበትን TeleBirr/Bank account ቁጥር ያስገቡ።", reply_markup: backMenu() }); }
    } else if (message.from?.id && withdrawalSteps.get(message.from.id)?.step === "account") {
      const state = withdrawalSteps.get(message.from.id)!;
      withdrawalSteps.set(message.from.id, { ...state, step: "owner", account: text.trim() });
      await sendTelegramMessage(token, chatId, { text: "የaccount ባለቤት ሙሉ ስም ያስገቡ።", reply_markup: backMenu() });
    } else if (message.from?.id && withdrawalSteps.get(message.from.id)?.step === "owner") {
      const state = withdrawalSteps.get(message.from.id)!;
      try {
        const transaction = await createWithdrawalRequest(message.from.id, state.amount!, state.account!, text.trim());
        withdrawalSteps.delete(message.from.id);
        const adminChatId = Number(process.env.TELEGRAM_ADMIN_CHAT_ID);
        if (Number.isSafeInteger(adminChatId)) await sendTelegramMessage(token, adminChatId, { text: `🔔 አዲስ Withdraw ጥያቄ\nUser: ${message.from.id}\nAmount: ${transaction.amount} ETB\nAccount: ${state.account}\nOwner: ${text.trim()}\nTransaction ID: ${transaction.id}\nStatus: Pending`, reply_markup: { inline_keyboard: [[{ text: "✅ Approve", callback_data: `withdraw_approve:${transaction.id}` }, { text: "❌ Reject", callback_data: `withdraw_reject:${transaction.id}` }]] } });
        await sendTelegramMessage(token, chatId, { text: `✅ Withdraw ጥያቄዎ ተቀብሏል።\nመጠን: ${transaction.amount} ETB\nሁኔታ: Pending`, reply_markup: mainMenu() });
      } catch (error) { withdrawalSteps.delete(message.from.id); await sendTelegramMessage(token, chatId, { text: error instanceof Error && error.message === "Insufficient main balance" ? "በቂ Main Balance የለዎትም።" : "Withdraw ጥያቄውን ማስመዝገብ አልተቻለም።", reply_markup: mainMenu() }); }
    } else if (message.from?.id && depositSteps.get(message.from.id)?.step === "amount") {
      const amount = Number(text.replace(/[, ]/g, ""));
      if (!Number.isFinite(amount) || amount < 10) {
        await sendTelegramMessage(token, chatId, { text: "እባክዎ ትክክለኛ የብር መጠን ያስገቡ። ዝቅተኛው Deposit 10 ብር ነው።", reply_markup: backMenu() });
      } else {
        depositSteps.set(message.from.id, { step: "reference", amount });
        await sendTelegramMessage(token, chatId, { text: `✅ መጠን: ${amount.toFixed(2)} ETB\n\nእባክዎ የTeleBirr SMS ማረጋገጫ ሙሉ ጽሑፍ (Tx Ref ያለበት) አሁን ይላኩ።`, reply_markup: backMenu() });
      }
    } else if (message.from?.id && depositSteps.get(message.from.id)?.step === "reference") {
      const deposit = depositSteps.get(message.from.id)!;
      if (text.trim().length < 6) {
        await sendTelegramMessage(token, chatId, { text: "እባክዎ የትክክለኛውን TeleBirr SMS ሙሉ ጽሑፍ ይላኩ።", reply_markup: backMenu() });
      } else {
        try {
          const transaction = await createDepositRequest(message.from.id, deposit.amount!, text.trim());
          depositSteps.delete(message.from.id);
          const adminChatId = Number(process.env.TELEGRAM_ADMIN_CHAT_ID);
          if (Number.isSafeInteger(adminChatId)) {
            await sendTelegramMessage(token, adminChatId, {
              text: `🔔 አዲስ Deposit ጥያቄ\n\nተጠቃሚ ID: ${message.from.id}\nመጠን: ${transaction.amount} ETB\nTx Ref/SMS:\n${text.trim()}\n\nTransaction ID: ${transaction.id}\nሁኔታ: Pending`,
              reply_markup: { inline_keyboard: [[{ text: "✅ Approve", callback_data: `deposit_approve:${transaction.id}` }, { text: "❌ Reject", callback_data: `deposit_reject:${transaction.id}` }]] },
            });
          }
          await sendTelegramMessage(token, chatId, { text: `✅ የDeposit ጥያቄዎ ተቀብሏል።\n\nመጠን: ${transaction.amount} ETB\nሁኔታ: Pending\n\nአስተዳዳሪ ካረጋገጠ በኋላ ባላንስዎ ይጨምራል።`, reply_markup: mainMenu() });
        } catch (error) {
          console.error("Telegram deposit request failed", error);
          await sendTelegramMessage(token, chatId, { text: "Deposit ጥያቄውን ማስመዝገብ አልተቻለም። /start ይላኩና እንደገና ይሞክሩ።", reply_markup: mainMenu() });
        }
      }
    } else if (text === "🔗 Invite & Earn" && message.from?.id) {
      const botUsername = process.env.TELEGRAM_BOT_USERNAME;
      const inviteLink = botUsername ? `https://t.me/${botUsername}?start=ref_${message.from.id}` : null;
      await sendTelegramMessage(token, chatId, {
        text: inviteLink
          ? `🔗 የእርስዎ የInvite Link:\n\n${inviteLink}\n\n5 ሰዎች ሲመዘገቡ 10 ብር Player Balance ያገኛሉ።\nይህን link ለጓደኞችዎ ያጋሩ።`
          : "የInvite Link ለማመንጨት TELEGRAM_BOT_USERNAME በserver environment ውስጥ ያስገቡ።",
        reply_markup: backMenu(),
      });
    } else if (text === "🆘 Support") {
      const supportUsername = (process.env.TELEGRAM_SUPPORT_USERNAME ?? process.env.SUPPORT_USERNAME ?? "").trim().replace(/^@/, "");
      await sendTelegramMessage(token, chatId, {
        text: supportUsername
          ? `🆘 Support\n\nእርዳታ ለማግኘት @${supportUsername} ያነጋግሩ።`
          : "🆘 Support username አልተዋቀረም።",
        reply_markup: supportUsername
          ? { inline_keyboard: [[{ text: "Contact Support", url: `https://t.me/${supportUsername}` }], [{ text: "↩️ Back to Menu", callback_data: "back_to_menu" }]] }
          : backMenu(),
      });
    } else if (text === "👤 Profile & Account" && message.from?.id) {
      try {
        const profile = await getTelegramProfile(message.from.id);
        if (!profile) {
          await sendTelegramMessage(token, chatId, { text: "መለያዎ አልተመዘገበም። /start ይላኩ።", reply_markup: backMenu() });
        } else {
          await sendTelegramMessage(token, chatId, {
            text: `👤 የእኔ ፕሮፋይል\n\nስም: ${profile.display_name}\nUsername: ${profile.username ? `@${profile.username}` : "—"}\nTelegram ID: ${profile.telegram_id}\nስልክ: ${profile.phone ?? "—"}\nPlayer Balance: ${profile.player_balance} ብር\nMain Balance: ${profile.main_balance} ብር\nየተያዙ ካርዶች: ${profile.card_count}`,
            reply_markup: backMenu(),
          });
        }
      } catch {
        await sendTelegramMessage(token, chatId, { text: "ፕሮፋይልዎን ማምጣት አልተቻለም።", reply_markup: backMenu() });
      }
    } else if (responses[text]) {
      await sendTelegramMessage(token, chatId, { text: responses[text], reply_markup: backMenu() });
    }
    }
  }

  res.sendStatus(200);
};

export async function registerTelegramWebhook() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const appUrl = process.env.APP_URL ?? process.env.RENDER_EXTERNAL_URL;
  if (!token || !appUrl) {
    console.log("Telegram webhook registration skipped", {
      missingBotToken: !token,
      missingAppUrl: !appUrl,
    });
    return;
  }

  const normalizedUrl = appUrl.replace(/\/$/, "");
  const webhookUrl = `${normalizedUrl}/api/telegram/webhook`;
  const webhookInfoResponse = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  if (!webhookInfoResponse.ok) {
    throw new Error(`Telegram getWebhookInfo failed (${webhookInfoResponse.status})`);
  }

  const webhookInfo = await webhookInfoResponse.json() as {
    ok?: boolean;
    result?: { url?: string };
  };
  if (!webhookInfo.ok) throw new Error("Telegram getWebhookInfo returned an unsuccessful response");

  if (webhookInfo.result?.url === webhookUrl) {
    console.log("Telegram webhook already configured", { url: webhookUrl });
  } else {
    const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: webhookUrl }),
    });

    if (!response.ok) throw new Error(`Telegram webhook registration failed (${response.status})`);
    console.log("Telegram webhook registered", { url: webhookUrl });
  }

  const miniAppUrl = process.env.MINI_APP_URL ?? normalizedUrl;
  const menuResponse = await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ menu_button: { type: "web_app", text: "🎮 Play Bingo", web_app: { url: miniAppUrl } } }),
  });

  if (!menuResponse.ok) console.error("Telegram Mini App menu button setup failed", menuResponse.status);
}
