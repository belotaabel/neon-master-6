import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  ArrowLeft,
  Bell,
  Gamepad2,
  Home,
  MoreVertical,
  Star,
  Users,
  Volume2,
  VolumeX,
  Wallet,
} from "lucide-react";
import { io } from "socket.io-client";
import { useNavigate } from "react-router-dom";
import type { BingoWinner, WalletResponse } from "@shared/api";

type Cell = number | null;
type Card = { card_number: number; rows: Cell[][] };
type User = {
  id: number;
  telegram_id: string | number;
  username: string | null;
  display_name: string;
  balance: number | string;
  player_balance: number | string;
  main_balance: number | string;
};
type GameType = "75";
type GameState = {
  calledNumbers: number[];
  currentBall: number | null;
  playerCount: number;
  cardCount: number;
  occupiedCardNumbers: number[];
  botCardNumbers: number[];
  prizeAmount: number;
  status: string;
  winners: BingoWinner[];
  selectionEndsAt: string | null;
  gameId: string;
};
type WalletForm = { amount: string; reference: string; account: string; owner: string };

const numberAudioPaths: Partial<Record<number, string>> = {
  1: "/audio/B1.mp3",
  2: "/audio/B2.mp3",
  4: "/audio/B4.mp3",
  5: "/audio/B5.mp3",
  10: "/audio/B10.mp3",
  6: "/audio/B6.mp3",
  7: "/audio/B7.mp3",
  8: "/audio/B8.mp3",
  9: "/audio/B9.mp3",
  12: "/audio/B12.mp3",
  13: "/audio/B13.mp3",
  15: "/audio/B15.mp3",
  21: "/audio/I21.mp3",
  24: "/audio/I24.mp3",
  25: "/audio/I25.mp3",
  28: "/audio/I28.mp3",
  31: "/audio/N31.mp3",
  32: "/audio/N32.mp3",
  33: "/audio/N33.mp3",
  35: "/audio/N35.mp3",
  38: "/audio/N38.mp3",
  41: "/audio/N41.mp3",
  43: "/audio/N43.mp3",
  47: "/audio/G47.mp3",
  48: "/audio/G48.mp3",
  50: "/audio/G50.mp3",
  51: "/audio/G51.mp3",
  53: "/audio/G53.mp3",
  54: "/audio/G54.mp3",
  56: "/audio/G56.mp3",
  59: "/audio/G59.mp3",
  63: "/audio/O63.mp3",
  64: "/audio/O64.mp3",
  65: "/audio/O65.mp3",
  66: "/audio/O66.mp3",
  67: "/audio/O67.mp3",
  68: "/audio/O68.mp3",
  71: "/audio/O71.mp3",
  72: "/audio/O72.mp3",
  73: "/audio/O73.mp3",
};

const isWinningCell = (lineId: number, rowIndex: number, columnIndex: number) => {
  if (lineId >= 1 && lineId <= 5) return rowIndex === lineId - 1;
  if (lineId >= 6 && lineId <= 10) return columnIndex === lineId - 6;
  if (lineId === 11) return rowIndex === columnIndex;
  if (lineId === 12) return rowIndex + columnIndex === 4;
  if (lineId === 13) return (rowIndex === 0 || rowIndex === 4) && (columnIndex === 0 || columnIndex === 4);
  return false;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: { initData?: string; ready?: () => void } };
  }
}

function CardView({
  card,
  selected,
  called,
  onClick,
  winningLineIds,
  gameType = "75",
}: {
  card: Card;
  selected: boolean;
  called: Set<number>;
  onClick: () => void;
  winningLineIds?: number[];
  gameType?: GameType;
}) {
  return (
    <article
      className={`ticket-card ${selected ? "selected" : ""}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
    >
      <header className="ticket-title">
        <span>✦ {gameType} BINGO</span>
        <b>#{card.card_number}</b>
      </header>
      {gameType === "75" && (
        <div className="ticket-columns" aria-hidden="true">
          {['B', 'I', 'N', 'G', 'O'].map((letter) => <b key={letter}>{letter}</b>)}
        </div>
      )}
      <div className="ticket-grid">
        {card.rows.flatMap((row, rowIndex) =>
          row.map((number, columnIndex) => (
            <span
              key={`${rowIndex}-${columnIndex}`}
              className={[
                number === 0 || (number !== null && called.has(number)) ? "marked" : "",
                winningLineIds?.some((lineId) => isWinningCell(lineId, rowIndex, columnIndex)) ? "winning-cell" : "",
                winningLineIds ? "winner-card-cell" : "",
              ].filter(Boolean).join(" ")}
            >
              {number === 0 ? "FREE" : number}
            </span>
          )),
        )}
      </div>
      {selected && <small>✓ የተመረጠ</small>}
    </article>
  );
}

function WalletPanel({
  panel,
  user,
  wallet,
  apiBase,
  initData,
  walletForm,
  setWalletForm,
  walletBusy,
  setWalletBusy,
  loadWallet,
  onClose,
  onNotice,
}: {
  panel: "profile" | "wallet";
  user: User | null;
  wallet: WalletResponse | null;
  apiBase: string;
  initData: string;
  walletForm: WalletForm;
  setWalletForm: Dispatch<SetStateAction<WalletForm>>;
  walletBusy: boolean;
  setWalletBusy: (busy: boolean) => void;
  loadWallet: () => Promise<void>;
  onClose: () => void;
  onNotice: (message: string) => void;
}) {
  const [requestNotice, setRequestNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const submitDeposit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRequestNotice(null);
    setWalletBusy(true);
    try {
      const response = await fetch(`${apiBase}/api/wallet/deposit`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-telegram-init-data": initData },
        body: JSON.stringify({ amount: walletForm.amount, reference: walletForm.reference }),
      });
      const data = await response.json().catch(() => ({} as { error?: string }));
      if (!response.ok) throw new Error(data.error || "Deposit failed");
      setWalletForm((form) => ({ ...form, amount: "", reference: "" }));
      const successMessage = "Deposit ጥያቄዎ ተቀብሏል። Admin እስኪያጸድቀው ይጠብቁ።";
      setRequestNotice({ type: "success", text: successMessage });
      onNotice(successMessage);
      await loadWallet().catch(() => undefined);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Deposit failed";
      setRequestNotice({ type: "error", text: errorMessage });
      onNotice(errorMessage);
    } finally {
      setWalletBusy(false);
    }
  };

  const submitWithdrawal = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRequestNotice(null);
    setWalletBusy(true);
    try {
      const response = await fetch(`${apiBase}/api/wallet/withdraw`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-telegram-init-data": initData },
        body: JSON.stringify({ amount: walletForm.amount, account: walletForm.account, owner: walletForm.owner }),
      });
      const data = await response.json().catch(() => ({} as { error?: string }));
      if (!response.ok) throw new Error(data.error || "Withdrawal failed");
      setWalletForm((form) => ({ ...form, amount: "", account: "", owner: "" }));
      const successMessage = "Withdraw ጥያቄዎ ተቀብሏል። Admin እስኪያጸድቀው ይጠብቁ።";
      setRequestNotice({ type: "success", text: successMessage });
      onNotice(successMessage);
      await loadWallet().catch(() => undefined);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Withdrawal failed";
      setRequestNotice({ type: "error", text: errorMessage });
      onNotice(errorMessage);
    } finally {
      setWalletBusy(false);
    }
  };

  return (
    <aside className="account-panel" role="dialog" aria-label={panel === "profile" ? "Profile" : "Wallet"}>
      <button className="icon-button" onClick={onClose} aria-label="Close"><ArrowLeft /></button>
      <h2>{panel === "profile" ? "መገለጫ" : "Wallet"}</h2>
      {panel === "profile" ? (
        <>
          <p>{user?.display_name || "Telegram player"}</p>
          <div className="wallet-balances">
            <p><span>Player Balance</span><strong>{user?.player_balance ?? 0} ብር</strong><small>Deposit balance · ለመውጣት አይቻልም</small></p>
            <p><span>Main Balance</span><strong>{user?.main_balance ?? 0} ብር</strong><small>የጨዋታ ውጤት · Withdrawable</small></p>
          </div>
        </>
      ) : (
        <>
          <div className="wallet-balances">
            <p><span>Player Balance</span><strong>{wallet?.profile.player_balance ?? user?.player_balance ?? 0} ብር</strong><small>Deposit balance · ለመውጣት አይቻልም</small></p>
            <p><span>Main Balance</span><strong>{wallet?.profile.main_balance ?? user?.main_balance ?? 0} ብር</strong><small>የጨዋታ ውጤት · Withdrawable</small></p>
          </div>
          <form onSubmit={submitDeposit}>
            <h3>Deposit request</h3>
            <p className="deposit-receiver">TeleBirr receiving number: <strong>{wallet?.depositReceiver ?? "Not configured"}</strong></p>
            <p className="wallet-hint">Minimum deposit: 10 ብር · First deposit bonus: 65% · Second and later: 20%</p>
            <input required type="number" min="10" step="0.01" placeholder="Minimum 10 ብር" value={walletForm.amount} onChange={(event) => setWalletForm({ ...walletForm, amount: event.target.value })} />
            <input required placeholder="Payment reference" value={walletForm.reference} onChange={(event) => setWalletForm({ ...walletForm, reference: event.target.value })} />
            <button disabled={walletBusy}>Submit deposit</button>
            {requestNotice && <p className={`wallet-request-notice ${requestNotice.type}`} role="status">{requestNotice.text}</p>}
          </form>
          <form onSubmit={submitWithdrawal}>
            <h3>Withdraw from Main Balance</h3>
            <p className="wallet-hint">Minimum withdrawal: 100 ብር</p>
            <input required type="number" min="100" step="0.01" placeholder="Minimum 100 ብር" value={walletForm.amount} onChange={(event) => setWalletForm({ ...walletForm, amount: event.target.value })} />
            <input required placeholder="Account" value={walletForm.account} onChange={(event) => setWalletForm({ ...walletForm, account: event.target.value })} />
            <input required placeholder="Account owner" value={walletForm.owner} onChange={(event) => setWalletForm({ ...walletForm, owner: event.target.value })} />
            <button disabled={walletBusy}>Submit withdrawal</button>
            {requestNotice && <p className={`wallet-request-notice ${requestNotice.type}`} role="status">{requestNotice.text}</p>}
          </form>
          <h3 className="wallet-history-title">Recent transactions</h3>
          {wallet?.transactions.map((transaction) => (
            <p className="wallet-transaction" key={transaction.id}><b>{["deposit", "deposit_bonus", "invite_bonus", "bingo_prize", "card_refund"].includes(transaction.type) ? "+" : "-"}{transaction.amount} ብር</b> · {transaction.status} · {new Date(transaction.created_at).toLocaleDateString()}</p>
          ))}
        </>
      )}
    </aside>
  );
}

function AdminPasswordDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: (token: string) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Admin login failed");
      onSuccess(body.token);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Admin login failed");
    } finally {
      setBusy(false);
    }
  };
  return <div className="admin-unlock-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="admin-unlock-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-unlock-title" onSubmit={submit}><div className="admin-unlock-icon">75</div><h2 id="admin-unlock-title">Admin መግቢያ</h2><p>የአድሚን ፓናሉን ለመክፈት ፓስወርድዎን ያስገቡ።</p><label>ፓስወርድ<input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" /></label>{error && <div className="admin-unlock-error" role="alert">{error}</div>}<div className="admin-unlock-actions"><button type="button" onClick={onClose}>ሰርዝ</button><button type="submit" disabled={busy || !password}>{busy ? "እየገባ..." : "ግባ"}</button></div></form></div>;
}

export default function Index() {
  const gameType: GameType = "75";
  const navigate = useNavigate();
  const adminTapTimes = useRef<number[]>([]);
  const [adminUnlockOpen, setAdminUnlockOpen] = useState(false);
  const handleAdminTap = () => {
    const now = Date.now();
    const recentTaps = adminTapTimes.current.filter((tap) => now - tap < 900);
    if (recentTaps.length >= 2) {
      adminTapTimes.current = [];
      setAdminUnlockOpen(true);
      return;
    }
    adminTapTimes.current = [...recentTaps, now];
  };
  const completeAdminLogin = (token: string) => {
    sessionStorage.setItem("neon-admin-token", token);
    navigate("/admin");
  };
  const [screen, setScreen] = useState<"landing" | "selection">("landing");
  // The gateway selects the configured game service from the gameType query parameter.
  // Empty bases preserve the local same-origin development fallback.
  const apiBase = "";
  const socketBase = "";
  const [user, setUser] = useState<User | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [cards, setCards] = useState<Card[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const selectionLoaded = useRef(false);
  const selectedRef = useRef<number[]>([]);
  const gameSocket = useRef<ReturnType<typeof io> | null>(null);
  selectedRef.current = selected;

  const selectionScope = user ? String(user.telegram_id) : "anonymous";
  const selectionKey = `neon-${gameType}-selected-cards-${selectionScope}`;
  const readSelected = (key: string) => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "[]");
      return Array.isArray(saved)
        ? saved.filter((id): id is number => Number.isInteger(id) && id >= 1 && id <= 400).slice(0, 2)
        : [];
    } catch {
      return [];
    }
  };
  const [called, setCalled] = useState<Set<number>>(new Set());
  const [currentBall, setCurrentBall] = useState<number | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("neon-number-sound") !== "false";
  });
  const audioCache = useRef(new Map<number, HTMLAudioElement>());
  const activeAudio = useRef<HTMLAudioElement | null>(null);
  const lastAudioBall = useRef<number | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [winnerAnnouncement, setWinnerAnnouncement] = useState<GameState | null>(null);
  const [currentCardCount, setCurrentCardCount] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [selectionEndsAt, setSelectionEndsAt] = useState<string | null>(null);
  const [selectionGameStatus, setSelectionGameStatus] = useState<string | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const currentGameId = useRef<string | null>(null);
  const [occupiedCardIds, setOccupiedCardIds] = useState<Set<number>>(new Set());
  const [botCardIds, setBotCardIds] = useState<Set<number>>(new Set());
  const [playing, setPlaying] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [notice, setNotice] = useState("ካርዶች እየተጫኑ ነው...");
  const [panel, setPanel] = useState<"profile" | "wallet" | null>(null);
  const [wallet, setWallet] = useState<WalletResponse | null>(null);
  const [walletForm, setWalletForm] = useState({ amount: "", reference: "", account: "", owner: "" });
  const [walletBusy, setWalletBusy] = useState(false);
  const updateBalancesForCardChange = (playerBalance: number | string, mainBalance: number | string, cardDelta: number) => {
    let nextPlayerBalance = Number(playerBalance);
    let nextMainBalance = Number(mainBalance);
    if (cardDelta > 0) {
      const fee = cardDelta * 10;
      const playerDebit = Math.min(nextPlayerBalance, fee);
      nextPlayerBalance -= playerDebit;
      nextMainBalance -= fee - playerDebit;
    } else if (cardDelta < 0) {
      nextPlayerBalance += Math.abs(cardDelta) * 10;
    }
    return { player_balance: nextPlayerBalance, main_balance: nextMainBalance, balance: nextPlayerBalance + nextMainBalance };
  };
  const applyServerBalances = (playerBalance: number, mainBalance: number) => {
    setUser((current) => current ? { ...current, ...updateBalancesForCardChange(playerBalance, mainBalance, 0) } : current);
    setWallet((current) => current ? { ...current, profile: { ...current.profile, ...updateBalancesForCardChange(playerBalance, mainBalance, 0) } } : current);
  };
  const loadWallet = async () => {
    if (!initData) return;
    const response = await fetch(`${apiBase}/api/wallet`, { headers: { "x-telegram-init-data": initData } });
    if (!response.ok) throw new Error("Wallet unavailable");
    const data = await response.json();
    setWallet(data); setUser(data.profile);
  };
  useEffect(() => {
    if (!authLoaded) return;
    selectionLoaded.current = false;
    setSelected(readSelected(selectionKey));
    selectionLoaded.current = true;
  }, [authLoaded, selectionKey]);
  useEffect(() => {
    if (!authLoaded || !selectionLoaded.current) return;
    localStorage.setItem(selectionKey, JSON.stringify(selected));
  }, [authLoaded, selected, selectionKey]);
  const initData =
    window.Telegram?.WebApp?.initData ||
    new URLSearchParams(window.location.hash.replace(/^#/, "")).get(
      "tgWebAppData",
    ) ||
    new URLSearchParams(window.location.search).get("tgWebAppData") ||
    "";

  useEffect(() => {
    window.Telegram?.WebApp?.ready?.();
    if (!initData) {
      setNotice("ጨዋታውን ለመጫወት Telegram ውስጥ ይክፈቱ።");
      setAuthLoaded(true);
      return;
    }
    fetch(`${apiBase}/api/me`, { headers: { "x-telegram-init-data": initData } })
      .then(async (r) => {
        if (!r.ok)
          throw new Error(
            r.status === 401
              ? "Telegram authentication አልተረጋገጠም።"
              : "Telegram authentication ላይ ስህተት ተፈጥሯል።",
          );
        setUser(await r.json());
      })
      .catch((e) => setNotice(e.message))
      .finally(() => setAuthLoaded(true));
  }, [initData, apiBase]);
  useEffect(() => { if (panel === "wallet") loadWallet().catch((error) => setNotice(error.message)); }, [panel]);
  useEffect(() => {
    const url = `${apiBase}/api/game?gameType=${gameType}${user ? `&userId=${user.id}` : ""}`;
    const applyGameInfo = (activeGame: { id?: string | number; status?: string; selectionEndsAt?: string | null; occupiedCardNumbers?: unknown; botCardNumbers?: unknown; playerCount?: number; player_count?: number; cardCount?: number; called_numbers?: unknown; current_number?: unknown; prize_pool?: unknown } | null) => {
      if (!activeGame) {
        setSelectionGameStatus(null);
        setOccupiedCardIds(new Set());
        setBotCardIds(new Set());
        return;
      }
      const calledNumbers = Array.isArray(activeGame.called_numbers)
        ? activeGame.called_numbers.filter((number): number is number => Number.isInteger(number) && number >= 1 && number <= 75)
        : [];
      const currentBall = Number.isInteger(activeGame.current_number) ? Number(activeGame.current_number) : null;
      const occupiedCardNumbers = Array.isArray(activeGame.occupiedCardNumbers)
        ? activeGame.occupiedCardNumbers.filter((id): id is number => Number.isInteger(id) && id >= 1 && id <= 400)
        : [];
      const botCardNumbers = Array.isArray(activeGame.botCardNumbers)
        ? activeGame.botCardNumbers.filter((id): id is number => Number.isInteger(id) && id >= 1 && id <= 400)
        : [];
      if (activeGame.id !== undefined) {
        const nextGameId = String(activeGame.id);
        if (currentGameId.current && currentGameId.current !== nextGameId) {
          gameSocket.current?.emit("game:leave");
          setSelected([]);
          setOccupiedCardIds(new Set());
          setBotCardIds(new Set());
        }
        currentGameId.current = nextGameId;
        setGameId(nextGameId);
        setGame((current) => ({
          gameId: nextGameId,
          calledNumbers,
          currentBall,
          playerCount: Number(activeGame.playerCount ?? activeGame.player_count ?? 0),
          cardCount: Number(activeGame.cardCount ?? 0),
          occupiedCardNumbers,
          botCardNumbers,
          prizeAmount: Number(activeGame.prize_pool ?? 0),
          status: activeGame.status === "finished" ? "complete" : activeGame.status === "playing" || activeGame.status === "active" ? "active" : activeGame.status === "finalizing" ? "finalizing" : "waiting",
          winners: current?.gameId === nextGameId ? current.winners : [],
          selectionEndsAt: activeGame.selectionEndsAt ?? null,
        }));
        setCalled(new Set(calledNumbers));
        setCurrentBall(currentBall);
      }
      setSelectionGameStatus(activeGame.status ?? null);
      setCurrentCardCount(activeGame.cardCount ?? 0);
      if (activeGame.selectionEndsAt) {
        setSelectionEndsAt(activeGame.selectionEndsAt);
      } else {
        setSelectionEndsAt(null);
      }
      if (activeGame.status === "finalizing") {
        setFinalizing(true);
        setPlaying(false);
        setCountdown(null);
      }
      if (activeGame.status === "playing" || activeGame.status === "active") {
        setFinalizing(false);
        setCountdown(null);
        if (selected.length) {
          setPlaying(true);
        } else {
          setPlaying(false);
          setNotice("ይህን ጨዋታ ለመጫወት ቢያንስ አንድ ካርድ ይግዙ። የሚቀጥለውን ዙር ይጠብቁ።");
        }
      }
      setOccupiedCardIds(new Set(occupiedCardNumbers));
      setBotCardIds(new Set(botCardNumbers));
    };
    fetch(url).then((r) => r.ok ? r.json() : null).then(applyGameInfo).catch(() => { setSelectionGameStatus(null); setOccupiedCardIds(new Set()); setBotCardIds(new Set()); });
    const statusTimer = window.setInterval(() => fetch(url).then((r) => r.ok ? r.json() : null).then(applyGameInfo).catch(() => { setSelectionGameStatus(null); setOccupiedCardIds(new Set()); setBotCardIds(new Set()); }), 2000);
    return () => window.clearInterval(statusTimer);
  }, [gameType, apiBase, user, selected.length]);
  useEffect(() => {
    fetch(`${apiBase}/api/game/cards?gameType=${gameType}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Card catalog unavailable");
        setCards(await r.json());
        setNotice("");
      })
      .catch((e) => setNotice(e.message));
  }, [gameType, apiBase]);
  useEffect(() => {
    if (playing || !selectionEndsAt) return;
    const update = () => setCountdown(Math.max(0, Math.ceil((Date.parse(selectionEndsAt) - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [selectionEndsAt, playing]);
  const playNumberAudio = async (number: number, force = false) => {
    if (!soundEnabled && !force) return;
    const source = numberAudioPaths[number];
    if (!source) return;
    let audio = audioCache.current.get(number);
    if (!audio) {
      audio = new Audio(source);
      audio.preload = "auto";
      audioCache.current.set(number, audio);
    }
    activeAudio.current?.pause();
    activeAudio.current = audio;
    audio.currentTime = 0;
    await audio.play();
  };
  useEffect(() => {
    if (currentBall === null) {
      lastAudioBall.current = null;
      return;
    }
    if (lastAudioBall.current === currentBall) return;
    lastAudioBall.current = currentBall;
    void playNumberAudio(currentBall).catch(() => undefined);
  }, [currentBall, soundEnabled]);
  const toggleSound = () => {
    const nextEnabled = !soundEnabled;
    setSoundEnabled(nextEnabled);
    window.localStorage.setItem("neon-number-sound", String(nextEnabled));
    if (!nextEnabled) {
      activeAudio.current?.pause();
      return;
    }
    if (currentBall !== null && numberAudioPaths[currentBall]) {
      void playNumberAudio(currentBall, true).catch(() => undefined);
    }
  };
  useEffect(() => {
    if (!user) return;
    const socket = io(socketBase || undefined, {
      transports: ["polling", "websocket"],
      upgrade: false,
      query: { gameType },
      auth: { initData },
    });
    gameSocket.current = socket;
    const applySelectionResponse = (response: { ok: boolean; message?: string; playerBalance?: number; mainBalance?: number }) => {
      if (!response.ok) {
        setNotice(response.message === "Insufficient balance" ? "ቀሪ ባላንስዎ በቂ አይደለም።" : response.message || "የካርድ ምርጫውን ማስቀመጥ አልተቻለም።");
        return;
      }
      if (response.playerBalance === undefined || response.mainBalance === undefined) return;
      applyServerBalances(response.playerBalance, response.mainBalance);
    };
    socket.on("connect", () => {
      setNotice("");
      socket.emit("game:join", { playerId: user.id, cardNumbers: selectedRef.current, gameType, allowEmpty: true }, applySelectionResponse);
    });
    socket.on("connect_error", () => setNotice("የጨዋታ ሰርቨር አይገናኝም።"));
    socket.on("game:error", (e: { message?: string }) =>
      setNotice(e.message || "ወደ ጨዋታው መግባት አልተቻለም።"),
    );
    socket.on("cards:occupied", (cardNumbers: unknown) => {
      if (!Array.isArray(cardNumbers)) return;
      setOccupiedCardIds(new Set(cardNumbers.filter((id): id is number => Number.isInteger(id) && id >= 1 && id <= 400 && !selectedRef.current.includes(id))));
    });
    socket.on("game:announcement", ({ message }: { message?: string }) => setNotice(message || "Game started"));
    socket.on("game:state", (state: GameState) => {
      setGame(state);
      if (state.winners.length > 0) {
        setWinnerAnnouncement((current) => current?.gameId === state.gameId ? current : state);
      }
      setCurrentCardCount(state.cardCount);
      setOccupiedCardIds(new Set(state.occupiedCardNumbers.filter((id) => Number.isInteger(id) && id >= 1 && id <= 400 && !selectedRef.current.includes(id))));
      setBotCardIds(new Set(state.botCardNumbers.filter((id) => Number.isInteger(id) && id >= 1 && id <= 400)));
      setFinalizing(state.status === "finalizing");
      setPlaying(state.status === "complete" || (state.status === "active" && selectedRef.current.length > 0));
      setCalled(new Set(state.calledNumbers));
      setCurrentBall(state.currentBall);
    });
    return () => {
      if (gameSocket.current === socket) gameSocket.current = null;
      socket.emit("game:leave");
      socket.disconnect();
    };
  }, [user?.id, gameType, socketBase, initData]);
  useEffect(() => {
    const socket = gameSocket.current;
    if (!user || !selectionLoaded.current || !socket?.connected) return;
    socket.emit("game:selection", { playerId: user.id, cardNumbers: selected, gameType }, (response: { ok: boolean; message?: string; playerBalance?: number; mainBalance?: number }) => {
      if (!response.ok) {
        setNotice(response.message === "Insufficient balance" ? "ቀሪ ባላንስዎ በቂ አይደለም።" : response.message || "የካርድ ምርጫውን ማስቀመጥ አልተቻለም።");
        return;
      }
      if (response.playerBalance === undefined || response.mainBalance === undefined) return;
      applyServerBalances(response.playerBalance, response.mainBalance);
    });
  }, [selected, user?.id, gameType]);
  const cardIdentifiers = useMemo(
    () => Array.from({ length: 400 }, (_, index) => index + 1),
    [],
  );
  const cardForId = (id: number) => {
    const visibleId = gameType === "75" && id > 400 ? id - 400 : id;
    const card = cards.find((candidate) => {
      const cardNumber = Number(candidate.card_number);
      return cardNumber === visibleId || (gameType === "75" && cardNumber === visibleId + 400);
    });
    return card ? { ...card, card_number: visibleId } : undefined;
  };
  const selectionCountdownExpired = selectionGameStatus === "selecting" && countdown !== null && countdown <= 3;
  const selectionLocked = selectionCountdownExpired || selectionGameStatus === "playing" || selectionGameStatus === "finalizing";
  const toggle = (id: number) => {
    if (selectionLocked || occupiedCardIds.has(id)) return;
    const wasSelected = selected.includes(id);
    if (!wasSelected && selected.length >= 2) return;
    if (!wasSelected && Number(user?.player_balance ?? 0) + Number(user?.main_balance ?? 0) < 10) {
      setNotice("ቀሪ ባላንስዎ በቂ አይደለም።");
      return;
    }
    const cardDelta = wasSelected ? -1 : 1;
    setSelected((old) => wasSelected ? old.filter((x) => x !== id) : [...old, id]);
    setCurrentCardCount((count) => Math.max(0, count + cardDelta));
    setUser((current) => current ? { ...current, ...updateBalancesForCardChange(current.player_balance, current.main_balance, cardDelta) } : current);
    setWallet((current) => current ? { ...current, profile: { ...current.profile, ...updateBalancesForCardChange(current.profile.player_balance, current.profile.main_balance, cardDelta) } } : current);
  };
  const start = () => {
    if (selectionLocked) return setNotice("ጨዋታ እየተካሄደ ነው");
    if (!user) return setNotice("Telegram authentication is required.");
    if (!selected.length) return setNotice("");
    setNotice("ጨዋታው ይጀምራል...");
  };
  const winningLines = (card: Card | undefined) => {
    if (!card) return [];
    const complete = (values: Cell[]) =>
      values.every((cell) => cell === null || cell === 0 || called.has(cell));
    const rows = card.rows
      .map((row, index) => (complete(row) ? index + 1 : null))
      .filter((line): line is number => line !== null);
    const columns = card.rows[0]
      ?.map((_, columnIndex) =>
        complete(card.rows.map((row) => row[columnIndex])) ? columnIndex + 6 : null,
      )
      .filter((line): line is number => line !== null) ?? [];
    const diagonals = [
      complete(card.rows.map((row, index) => row[index])) ? 11 : null,
      complete(card.rows.map((row, index) => row[4 - index])) ? 12 : null,
    ].filter((line): line is number => line !== null);
    const corners = [card.rows[0]?.[0], card.rows[0]?.[4], card.rows[4]?.[0], card.rows[4]?.[4]]
      .every((cell) => cell !== undefined && (cell === 0 || called.has(cell)));
    return [...rows, ...columns, ...diagonals, ...(corners ? [13] : [])];
  };
  useEffect(() => {
    if (!finalizing) {
      setLoadingError(null);
      return;
    }
    setLoadingError(null);
    const timer = window.setTimeout(() => {
      setLoadingError("የጨዋታው መጀመር በጣም ዘግይቷል።");
    }, 15000);
    return () => window.clearTimeout(timer);
  }, [finalizing, game?.gameId]);
  const winners = winnerAnnouncement?.winners ?? [];
  const winnerCardIds = winners.map((winner) => winner.cardNumber);
  const winnerCardId = winnerCardIds[0] ?? null;
  useEffect(() => {
    if (!winnerAnnouncement) return;
    const resetTimer = window.setTimeout(() => {
      setWinnerAnnouncement(null);
      setPlaying(false);
      setScreen("selection");
      setGame(null);
      setCalled(new Set());
      setCurrentBall(null);
      setSelected([]);
      setGameId(null);
      currentGameId.current = null;
      setOccupiedCardIds(new Set());
      setSelectionEndsAt(null);
      setCountdown(50);
      setNotice("");
    }, 8000);
    return () => window.clearTimeout(resetTimer);
  }, [winnerAnnouncement]);
  const winningRows = winningLines(cardForId(winnerCardId ?? -1));
  if (screen === "landing")
    return (
      <main className="app-shell landing-shell">
        <div className="landing-glow landing-glow-one" />
        <div className="landing-glow landing-glow-two" />
        <section className="landing-content">
          <span className="landing-kicker">WELCOME TO</span>
          <h2>
            <span>NEON</span> <strong className="admin-unlock-target" onClick={handleAdminTap} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") handleAdminTap(); }} role="button" tabIndex={0}>{gameType}</strong>
            <br />
            <em>BINGO</em>
          </h2>
          <p>የ75 ቢንጎ ጨዋታን ይጫወቱ።</p>
          <div className="landing-highlights">
            <span>400 ካርዶች</span>
            <i /> <span>እስከ 2 ካርዶች</span>
            <i /> <span>{gameType} ቁጥሮች</span>
          </div>
        </section>
        <button
          className="landing-start"
          onClick={() => {
            setScreen("selection");
            setNotice("");
          }}
        >
          ጨዋታ ጀምር <b>→</b>
        </button>
        <small className="landing-note">ካርድዎን ለመምረጥ ይቀጥሉ</small>
      {adminUnlockOpen && <AdminPasswordDialog onClose={() => setAdminUnlockOpen(false)} onSuccess={completeAdminLogin} />}
      </main>
    );
  if (finalizing && loadingError)
    return (
      <main className="app-shell app-error-shell" role="alert">
        <div className="app-error-icon">!</div>
        <h1>የጨዋታ መጀመር ስህተት</h1>
        <p>{loadingError}</p>
        <button className="start-button" type="button" onClick={() => window.location.reload()}>እንደገና ሞክር</button>
      </main>
    );
  if (finalizing)
    return (
      <main className="app-shell finalizing-shell" aria-live="polite">
        <div className="finalizing-orb" aria-hidden="true" />
        <h1>ጨዋታው እየተዘጋጀ ነው</h1>
        <p>ካርዶች ተረጋግጠዋል። ጨዋታው በቅርቡ ይጀምራል...</p>
      {adminUnlockOpen && <AdminPasswordDialog onClose={() => setAdminUnlockOpen(false)} onSuccess={completeAdminLogin} />}
      </main>
    );
  if (playing)
    return (
      <main className="app-shell playing-shell">
        <header className="topbar">
          <button
            className="icon-button"
            onClick={() => { setPlaying(false); setCountdown(50); }}
            aria-label="Back"
          >
            <ArrowLeft />
          </button>
          <h1 className="brand">
            <span>NEON</span> <strong className="admin-unlock-target" onClick={handleAdminTap} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") handleAdminTap(); }} role="button" tabIndex={0}>{gameType}</strong> <em>BINGO</em>
          </h1>
          <span className="game-id">Game ID: {game?.gameId ?? gameId ?? "—"}</span>
        </header>
        <section className="stats-row">
          <div className="stat purple">
            <Users />
            <span>
              <small>የአሁኑ ጨዋታ ካርዶች</small>
              <b>{game?.cardCount ?? 0}</b>
            </span>
          </div>
          <div className="stat blue">
            <Wallet />
            <span>
              <small>የሽልማት ፈንድ</small>
              <b>{game?.prizeAmount ?? 0} ብር</b>
            </span>
          </div>
          <div className="stat gold">
            <Star />
            <span>
              <small>የተጠሩ</small>
              <b>{called.size}/75</b>
            </span>
          </div>
        </section>
        <section className="draw">
          <div className="draw-heading">
            <p>የአሁኑ ቁጥር</p>
            <button
              type="button"
              className="sound-toggle"
              onClick={toggleSound}
              aria-label={soundEnabled ? "Mute number sounds" : "Turn on number sounds"}
              title={soundEnabled ? "Mute number sounds" : "Turn on number sounds"}
            >
              {soundEnabled ? <Volume2 /> : <VolumeX />}
            </button>
          </div>
          <div className="current-ball-layout">
            <strong className="ball-letter">{currentBall === null ? "—" : currentBall <= 15 ? "B" : currentBall <= 30 ? "I" : currentBall <= 45 ? "N" : currentBall <= 60 ? "G" : "O"}</strong>
            <div className="orb">{currentBall ?? "—"}</div>
            <span className="called-count">{called.size}/75</span>
          </div>
        </section>
        <section className="ball-history" aria-label="Called ball history">
          <h2>የኳስ ማሽን</h2>
          <div className="ball-history-list">
            {(game?.calledNumbers ?? []).slice(-45).reverse().map((number, index) => (
              <span key={`${number}-${index}`} className={`ball-cell ${number === currentBall ? "latest" : ""}`} style={{ animationDelay: `${index * 35}ms` }}>{number}</span>
            ))}
            {!game?.calledNumbers?.length && <small>እስካሁን ኳስ አልተጠራም</small>}
          </div>
        </section>
        <section className="tickets">
          {selected.map((id) => {
            const card = cardForId(id);
            return (
              card && (
                <CardView
                  key={id}
                  card={card}
                  selected
                  called={called}
                  onClick={() => undefined}
                  gameType={gameType}
                />
              )
            );
          })}
        </section>
        {winnerAnnouncement && (
          <>
            <div className="winner-modal" role="status">
              <div className="winner-badge">BINGO!</div>
              <h2>እንኳን ደስ አለዎት</h2>
              <div className="winner-details">
                <p>አሸናፊ: <b>{winners.map((item) => item.displayName).join(", ")}</b></p>
                <p>የሽልማቱ መጠን: <b>{((winnerAnnouncement.prizeAmount ?? 0) / winners.length).toFixed(2)} ብር</b></p>
                <p>የካርድ ቁጥር: <b>#{winnerCardIds.map((id) => id > 400 ? id - 400 : id).join(", #")}</b></p>
              </div>
              <div className="winner-card-preview">
                {winnerCardIds.slice(0, 1).map((id, index) => { const card = cardForId(id); return card && <div className="winner-card-item" key={id}><CardView card={card} selected={false} called={called} winningLineIds={winners[index]?.rows} onClick={() => undefined} gameType={gameType} /><span>የዘጋው: {winners[index]?.rows.map((row) => row <= 5 ? `መስመር ${row}` : row === 13 ? "አራት ማዕዘኖች" : row === 11 || row === 12 ? "ዲያጎናል" : `አምድ ${row - 5}`).join(", ")}</span></div>; })}
              </div>
              <button type="button" className="winner-confirm">እሺ!</button>
              <small>አዲስ ጨዋታ በቅርቡ ይጀምራል...</small>
            </div>
          </>
        )}
        {panel && <aside className="account-panel" role="dialog" aria-label={panel === "profile" ? "Profile" : "Wallet"}><button className="icon-button" onClick={() => setPanel(null)} aria-label="Close"><ArrowLeft /></button><h2>{panel === "profile" ? "መገለጫ" : "Wallet"}</h2>{panel === "profile" ? <p>{user?.display_name || "Telegram player"}</p> : <><div className="wallet-balances"><p><span>Player Balance</span><strong>{wallet?.profile.player_balance ?? user?.player_balance ?? 0} ብር</strong><small>Deposit balance · ለመውጣት አይቻልም</small></p><p><span>Main Balance</span><strong>{wallet?.profile.main_balance ?? user?.main_balance ?? 0} ብር</strong><small>የጨዋታ ውጤት · Withdrawable</small></p></div><form onSubmit={async (event) => { event.preventDefault(); setWalletBusy(true); try { const response = await fetch(`${apiBase}/api/wallet/deposit`, { method: "POST", headers: { "content-type": "application/json", "x-telegram-init-data": initData }, body: JSON.stringify({ amount: walletForm.amount, reference: walletForm.reference }) }); if (!response.ok) throw new Error((await response.json()).error || "Deposit failed"); setWalletForm({ ...walletForm, amount: "", reference: "" }); setNotice("Deposit ጥያቄዎ ተቀብሏል። Admin እስኪያጸድቀው ይጠብቁ።"); await loadWallet().catch(() => undefined); } catch (error) { setNotice(error instanceof Error ? error.message : "Deposit failed"); } finally { setWalletBusy(false); } }}><h3>Deposit request</h3><p className="wallet-hint">First deposit bonus: 65% · Second and later: 20%</p><input required type="number" min="1" step="0.01" placeholder="Amount" value={walletForm.amount} onChange={(e) => setWalletForm({ ...walletForm, amount: e.target.value })} /><input required placeholder="Payment reference" value={walletForm.reference} onChange={(e) => setWalletForm({ ...walletForm, reference: e.target.value })} /><button disabled={walletBusy}>Submit deposit</button></form><form onSubmit={async (event) => { event.preventDefault(); setWalletBusy(true); try { const response = await fetch(`${apiBase}/api/wallet/withdraw`, { method: "POST", headers: { "content-type": "application/json", "x-telegram-init-data": initData }, body: JSON.stringify({ amount: walletForm.amount, account: walletForm.account, owner: walletForm.owner }) }); if (!response.ok) throw new Error((await response.json()).error || "Withdrawal failed"); setWalletForm({ ...walletForm, amount: "", account: "", owner: "" }); setNotice("Withdraw ጥያቄዎ ተቀብሏል። Admin እስኪያጸድቀው ይጠብቁ።"); await loadWallet().catch(() => undefined); } catch (error) { setNotice(error instanceof Error ? error.message : "Withdrawal failed"); } finally { setWalletBusy(false); } }}><h3>Withdraw from Main Balance</h3><input required type="number" min="1" step="0.01" placeholder="Amount" value={walletForm.amount} onChange={(e) => setWalletForm({ ...walletForm, amount: e.target.value })} /><input required placeholder="Account" value={walletForm.account} onChange={(e) => setWalletForm({ ...walletForm, account: e.target.value })} /><input required placeholder="Account owner" value={walletForm.owner} onChange={(e) => setWalletForm({ ...walletForm, owner: e.target.value })} /><button disabled={walletBusy}>Submit withdrawal</button></form><h3>Recent transactions</h3>{wallet?.transactions.map((transaction) => <p key={transaction.id}><b>{["deposit", "deposit_bonus", "invite_bonus", "bingo_prize", "card_refund"].includes(transaction.type) ? "+" : "-"}{transaction.amount} ብር</b> · {transaction.status} · {new Date(transaction.created_at).toLocaleDateString()}</p>)}</>}</aside>}
      {adminUnlockOpen && <AdminPasswordDialog onClose={() => setAdminUnlockOpen(false)} onSuccess={completeAdminLogin} />}
      </main>
    );
  return (
    <main className="app-shell">
      <header className="topbar">
        <button
          className="icon-button"
          onClick={() => history.back()}
          aria-label="Back"
        >
          <ArrowLeft />
        </button>
        <h1 className="brand">
          <span>NEON</span> <strong className="admin-unlock-target" onClick={handleAdminTap} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") handleAdminTap(); }} role="button" tabIndex={0}>{gameType}</strong> <em>BINGO</em>
        </h1>
        <div className="top-actions">
          <button
            onClick={() => setNotice("ማሳወቂያ የለም።")}
            aria-label="Notifications"
          >
            <Bell />
          </button>
          <button aria-label="More" onClick={() => setPanel("profile")}>
            <MoreVertical />
          </button>
        </div>
      </header>
      <section className="stats-row">
        <div className="stat purple">
          <Users />
          <span>
            <small>የአሁኑ ጨዋታ ካርዶች</small>
            <b>{currentCardCount}</b>
          </span>
        </div>
        <div className="stat blue">
          <Wallet />
          <span>
            <small>Player Balance</small>
            <b>{user?.player_balance ?? 0} ብር</b>
          </span>
        </div>
        <div className="stat gold">
          <Star />
          <span>
            <small>የተመረጡ ካርዶች</small>
            <b>{selected.length}/2</b>
          </span>
        </div>
      </section>
      <div className="game-id selection-game-id">Game ID: {game?.gameId ?? gameId ?? "—"}</div>
      <p className="purchase-note">Card fee: Player Balance first, then Main Balance</p>
      <div className="selection-countdown" aria-live="polite">
        <span>{selectionCountdownExpired ? "የካርድ ምርጫው ተዘግቷል" : selectionLocked ? "ጨዋታ እየተካሄደ ነው" : "ጨዋታው ይጀምራል"}</span>
        <b>{selectionCountdownExpired ? String(countdown ?? 0).padStart(2, "0") : selectionLocked ? "00" : countdown ?? 50}</b>
        <small>ሰከንድ</small>
      </div>
      <section className="number-grid" aria-label="Card identifiers">
        {cardIdentifiers.map((id) => (
          <button
            key={id}
            className={`${selected.includes(id) ? "active" : ""} ${occupiedCardIds.has(id) ? "occupied" : ""} ${botCardIds.has(id) ? "bot-occupied" : ""}`}
            onClick={() => toggle(id)}
            disabled={selectionLocked || occupiedCardIds.has(id)}
            aria-pressed={selected.includes(id)}
            aria-label={botCardIds.has(id) ? `Card ${id}, occupied by bot` : occupiedCardIds.has(id) ? `Card ${id}, occupied` : `Card ${id}`}
          >
            {id}
          </button>
        ))}
      </section>
      <section
        className="selected-previews"
        aria-label="Selected card previews"
      >
        <h2>
          የተመረጡ ካርዶች <span>{selected.length}/2</span>
        </h2>
        <div className="tickets">
          {selected.map((id) => {
            const card = cardForId(id);
            return (
              card && (
                <CardView
                  key={id}
                  card={card}
                  selected
                  called={called}
                  onClick={() => toggle(id)}
                  gameType={gameType}
                />
              )
            );
          })}
        </div>
      </section>
      {panel && (
        <WalletPanel
          panel={panel}
          user={user}
          wallet={wallet}
          apiBase={apiBase}
          initData={initData}
          walletForm={walletForm}
          setWalletForm={setWalletForm}
          walletBusy={walletBusy}
          setWalletBusy={setWalletBusy}
          loadWallet={loadWallet}
          onClose={() => setPanel(null)}
          onNotice={setNotice}
        />
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      <button
        className="start-button"
        disabled={selectionLocked || !selected.length || countdown !== null}
        onClick={start}
      >
        {countdown !== null ? `ይጀምራል ${countdown}` : "ጨዋታ ጀምር"}
      </button>
      <nav className="bottom-nav">
        <button className="lobby" onClick={() => { setScreen("landing"); setCountdown(null); setSelected([]); setNotice(""); }}>
          <Home />
          <span>Lobby</span>
        </button>
        <button
          className="game-tab"
          onClick={() => {
            setScreen("selection");
            setPanel(null);
            setNotice("");
            if (selectionGameStatus === "playing") {
              setFinalizing(false);
              setCountdown(null);
              setPlaying(true);
            } else if (selectionGameStatus === "finalizing") {
              setPlaying(false);
              setFinalizing(true);
              setCountdown(null);
            } else {
              setPlaying(false);
              setFinalizing(false);
            }
          }}
          aria-current="page"
        >
          <Gamepad2 />
          <span>Game</span>
        </button>
        <button onClick={() => setPanel("wallet")}>
          <Wallet />
          <span>Wallet</span>
        </button>
      </nav>
    {adminUnlockOpen && <AdminPasswordDialog onClose={() => setAdminUnlockOpen(false)} onSuccess={completeAdminLogin} />}
      </main>
  );
}
