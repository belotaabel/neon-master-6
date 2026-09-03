import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  Bell,
  Bot,
  CalendarDays,
  ChevronRight,
  CircleCheck,
  Clock3,
  ImagePlus,
  LayoutDashboard,
  Play,
  RefreshCw,
  Square,
  Trash2,
  Menu,
  Megaphone,
  Plus,
  Search,
  Send,
  Save,
  Settings,
  ShieldCheck,
  TicketPercent,
  TrendingUp,
  UploadCloud,
  UserRound,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { BOT_ROSTER, type AdminBotAccount, type BotSettings, type SimulationAdminStatus, type SimulationConfig } from "@shared/api";

type AdminTab = "overview" | "broadcast" | "promos" | "players" | "bots" | "simulation" | "settings";
type PromoCode = { code: string; amount: string; uses: string; expires: string; active: boolean };

type Player = {
  name: string;
  handle: string;
  status: "active" | "idle";
  games: number;
  balance: string;
  joined: string;
};

type AdminActivity = {
  name: string;
  type: string;
  status: string;
  amount: number | string;
  created_at: string;
};

type AdminOverview = {
  totalPlayers: number;
  activePlayers: number;
  newPlayers: number;
  todayRevenue: number;
  pendingTransactions: number;
  activePromoCodes: number;
  totalPromoCodes: number;
  dailySignups: { label: string; value: number | string }[];
  recentActivity: AdminActivity[];
};

type PromoApiRow = {
  code: string;
  amount: number | string;
  used_count: number;
  max_uses: number | null;
  expires_at: string | null;
  active: boolean;
};

const emptyOverview: AdminOverview = {
  totalPlayers: 0,
  activePlayers: 0,
  newPlayers: 0,
  todayRevenue: 0,
  pendingTransactions: 0,
  activePromoCodes: 0,
  totalPromoCodes: 0,
  dailySignups: [],
  recentActivity: [],
};

const formatPromo = (promo: PromoApiRow): PromoCode => ({
  code: promo.code,
  amount: String(promo.amount),
  uses: `${promo.used_count} / ${promo.max_uses ?? "∞"}`,
  expires: promo.expires_at ? new Date(promo.expires_at).toLocaleDateString() : "No expiry",
  active: promo.active && (!promo.expires_at || new Date(promo.expires_at).getTime() > Date.now()),
});

const navItems: { id: AdminTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "አጠቃላይ እይታ", icon: LayoutDashboard },
  { id: "broadcast", label: "ብሮድካስት", icon: Megaphone },
  { id: "promos", label: "ፕሮሞ ኮዶች", icon: TicketPercent },
  { id: "players", label: "ፕሌየርስ", icon: UsersRound },
  { id: "bots", label: "Bot Control / ቦት ቁጥጥር", icon: Bot },
  { id: "simulation", label: "Staging simulator", icon: Bot },
];

function AdminSidebar({ activeTab, onSelect, open, onClose }: { activeTab: AdminTab; onSelect: (tab: AdminTab) => void; open: boolean; onClose: () => void }) {
  return (
    <>
      {open && <button className="admin-sidebar-backdrop" aria-label="Close menu" onClick={onClose} />}
      <aside className={`admin-sidebar ${open ? "is-open" : ""}`}>
        <div className="admin-brand">
          <div className="admin-brand-mark"><Bot size={22} /></div>
          <div><strong>NEON</strong><span>ADMIN CONSOLE</span></div>
          <button className="admin-mobile-close" aria-label="Close menu" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="admin-workspace"><span className="admin-live-dot" /> LIVE WORKSPACE <ChevronRight size={14} /></div>
        <nav className="admin-nav" aria-label="Admin navigation">
          <small>MENU</small>
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} className={activeTab === id ? "active" : ""} onClick={() => { onSelect(id); onClose(); }}>
              <Icon size={19} /><span>{label}</span>{id === "broadcast" && <i>NEW</i>}
            </button>
          ))}
          <small className="admin-nav-section">SYSTEM</small>
          <button className={activeTab === "settings" || activeTab === "bots" ? "active" : ""} onClick={() => { onSelect("bots"); onClose(); }}><Settings size={19} /><span>ቅንብሮች</span></button>
        </nav>
        <div className="admin-sidebar-footer">
          <div className="admin-user-avatar">YA</div>
          <div><strong>Yelbekemer Admin</strong><span>Super administrator</span></div>
          <ChevronRight size={16} />
        </div>
      </aside>
    </>
  );
}

function StatCard({ icon: Icon, label, value, change, accent }: { icon: typeof UsersRound; label: string; value: string; change: string; accent: string }) {
  return <article className="admin-stat-card">
    <div className={`admin-stat-icon ${accent}`}><Icon size={19} /></div>
    <div><span>{label}</span><strong>{value}</strong><small><TrendingUp size={12} /> {change}</small></div>
  </article>;
}

function BonusSettings() {
  const [firstPercent, setFirstPercent] = useState("65");
  const [repeatPercent, setRepeatPercent] = useState("20");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const headers = { "content-type": "application/json", "x-telegram-init-data": window.Telegram?.WebApp?.initData || "", "x-admin-token": sessionStorage.getItem("neon-admin-token") || "" };
  useEffect(() => { fetch("/api/admin/bonus-settings", { headers }).then((response) => response.ok ? response.json() : null).then((data) => { if (!data) return; setFirstPercent(String(data.firstPercent)); setRepeatPercent(String(data.repeatPercent)); }).catch(() => undefined); }, []);
  const save = async (event: FormEvent) => { event.preventDefault(); setSaved(false); setError(""); const response = await fetch("/api/admin/bonus-settings", { method: "PUT", headers, body: JSON.stringify({ firstPercent: Number(firstPercent), repeatPercent: Number(repeatPercent) }) }); const data = await response.json().catch(() => ({})); if (!response.ok) { setError(data.error || "Bonus settings could not be saved"); return; } setSaved(true); };
  return <form className="admin-panel bonus-settings-panel" onSubmit={save}><div className="admin-panel-heading"><div><h2>የDeposit Bonus ቅንብር</h2><p>Deposit ሲጸድቅ የሚጨመረውን ቦነስ ያስተካክሉ</p></div><span className="bonus-settings-icon"><PercentIcon /></span></div><div className="bonus-settings-fields"><label>የመጀመሪያ Deposit<input type="number" min="0" max="100" step="0.1" value={firstPercent} onChange={(event) => setFirstPercent(event.target.value)} /><small>%</small></label><label>ቀጣይ Deposits<input type="number" min="0" max="100" step="0.1" value={repeatPercent} onChange={(event) => setRepeatPercent(event.target.value)} /><small>%</small></label></div><div className="bonus-settings-footer"><span>Invite bonus እና Register bonus ተወግደዋል።</span><button type="submit" className="admin-primary-button"><Save size={15} /> ቅንብሩን አስቀምጥ</button></div>{saved && <div className="admin-success"><CircleCheck size={16} /> የDeposit bonus ቅንብር ተቀምጧል</div>}{error && <div className="admin-error"><X size={16} /> {error}</div>}</form>;
}

function PercentIcon() { return <span>%</span>; }

function BotSettingsPanel({ headers }: { headers: Record<string, string> }) {
  const [settings, setSettings] = useState<BotSettings>({ enabled: false, botCount: 0 });
  const [botCount, setBotCount] = useState("0");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [bots, setBots] = useState<AdminBotAccount[]>([]);
  const [fundAmounts, setFundAmounts] = useState<Record<number, string>>({});
  const [fundingId, setFundingId] = useState<number | null>(null);
  const [bulkFundAmount, setBulkFundAmount] = useState("100000");
  const [bulkFunding, setBulkFunding] = useState(false);
  const [bulkFundedCount, setBulkFundedCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/admin/bot-settings", { headers })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Bot settings unavailable");
        return data;
      })
      .then((data) => {
        if (typeof data.enabled !== "boolean") throw new Error("Bot settings unavailable");
        const next = { enabled: data.enabled, botCount: Number(data.botCount) } satisfies BotSettings;
        setSettings(next);
        setBotCount(String(next.botCount));
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Bot settings unavailable"))
      .finally(() => setLoading(false));
    fetch("/api/admin/bots", { headers })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Bot accounts unavailable");
        return data;
      })
      .then((data) => { if (Array.isArray(data)) setBots(data as AdminBotAccount[]); })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Bot accounts unavailable"));
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    setError("");
    const count = Number(botCount);
    const response = await fetch("/api/admin/bot-settings", {
      method: "PUT",
      headers,
      body: JSON.stringify({ enabled: settings.enabled, botCount: count }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error || "Bot settings could not be saved");
      return;
    }
    setSettings(data as BotSettings);
    setBotCount(String(data.botCount));
    setSaved(true);
  };

  const fundAllWallets = async () => {
    const amount = Number(bulkFundAmount);
    setError("");
    setBulkFundedCount(null);
    if (!Number.isFinite(amount) || amount <= 0) { setError("የመሙያ መጠን ከ0 በላይ ይሁን"); return; }
    const normalizedAmount = Math.round(amount * 100) / 100;
    setBulkFunding(true);
    try {
      const response = await fetch("/api/admin/bots/fund-all", { method: "POST", headers, body: JSON.stringify({ amount: normalizedAmount }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Bot wallets could not be funded");
      setBots((current) => current.map((bot) => ({ ...bot, player_balance: Number(bot.player_balance) + normalizedAmount, balance: Number(bot.balance) + normalizedAmount })));
      setBulkFundedCount(Number(data.count));
    } catch (fundingError) { setError(fundingError instanceof Error ? fundingError.message : "Bot wallets could not be funded"); }
    finally { setBulkFunding(false); }
  };

  const fundWallet = async (botId: number) => {
    const amount = Number(fundAmounts[botId]);
    setError("");
    if (!Number.isFinite(amount) || amount <= 0) { setError("የመሙያ መጠን ከ0 በላይ ይሁን"); return; }
    setFundingId(botId);
    try {
      const response = await fetch(`/api/admin/bots/${botId}/fund`, { method: "POST", headers, body: JSON.stringify({ amount }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Bot wallet could not be funded");
      setBots((current) => current.map((bot) => bot.id === botId ? { ...bot, player_balance: data.playerBalance, balance: Number(data.playerBalance) + Number(data.mainBalance), main_balance: data.mainBalance } : bot));
      setFundAmounts((current) => ({ ...current, [botId]: "" }));
    } catch (fundingError) { setError(fundingError instanceof Error ? fundingError.message : "Bot wallet could not be funded"); }
    finally { setFundingId(null); }
  };

  return <div className="admin-section-page"><div className="admin-page-heading"><div><p className="admin-eyebrow">LIVE GAME CONTROL</p><h1>ቦት ቁጥጥር</h1><p className="admin-subtitle">በቀጥታ 75-ball ጨዋታ ውስጥ የሚገቡ ቦቶችን ያስተዳድሩ።</p></div><div className={`admin-bot-status ${settings.enabled ? "" : "is-off"}`}><span /> {settings.enabled ? "Bots ON" : "Bots OFF"}</div></div><form className="admin-panel bot-settings-panel" onSubmit={save}><div className="admin-panel-heading"><div><h2>የቀጥታ ቦት ተሳትፎ</h2><p>OFF ሲደረግ አዲስ ጨዋታ ላይ አዲስ ቦት አይገባም፤ ያለው ጨዋታ ግን ይቀጥላል።</p></div><Bot size={22} className="panel-gold-icon" /></div><div className="bot-settings-controls"><label className="bot-switch-row"><span><strong>ቦቶችን አብራ</strong><small>{settings.enabled ? "ቦቶች ወደ አዲስ ጨዋታ ይገባሉ" : "ቦቶች አይገቡም"}</small></span><button type="button" role="switch" aria-label="Toggle live bots" aria-checked={settings.enabled} className={`bot-switch ${settings.enabled ? "on" : ""}`} onClick={() => { setSettings((current) => ({ ...current, enabled: !current.enabled })); setSaved(false); }}><span /></button></label><label className="bot-count-field">ወደ ጨዋታ የሚገቡ ቦቶች<small>ከ 0 እስከ 200</small><input type="number" min="0" max="200" step="1" value={botCount} onChange={(event) => { setBotCount(event.target.value); setSaved(false); }} disabled={loading} /></label></div><div className="bot-settings-controls"><label className="bot-count-field">ለሁሉም ቦቶች ባላንስ ጨምር<small>በእያንዳንዱ bot wallet ላይ የሚጨመር መጠን</small><input type="number" min="0.01" max="1000000" step="0.01" value={bulkFundAmount} onChange={(event) => { setBulkFundAmount(event.target.value); setBulkFundedCount(null); }} disabled={bulkFunding} /></label><button type="button" className="admin-primary-button" onClick={() => void fundAllWallets()} disabled={bulkFunding}>{bulkFunding ? "በመጨመር ላይ..." : "ለሁሉም ቦቶች ጨምር"}</button></div>{bulkFundedCount !== null && <div className="admin-success"><CircleCheck size={16} /> {bulkFundedCount} ቦቶች ላይ ባላንስ ተጨምሯል</div>}<div className="bot-settings-summary"><strong>{settings.enabled ? `${botCount || 0} bots ready` : "Bots are paused"}</strong><span>በአጠቃላይ {BOT_ROSTER.length} የተዘጋጁ ቦት ስሞች አሉ።</span><button type="submit" className="admin-primary-button" disabled={loading}><Save size={15} /> ቅንብሩን አስቀምጥ</button></div>{saved && <div className="admin-success"><CircleCheck size={16} /> የቦት ቅንብር ተቀምጧል</div>}{error && <div className="admin-error"><X size={16} /> {error}</div>}</form><section className="admin-panel bot-roster-panel"><div className="admin-panel-heading"><div><h2>የቦቶች ዝርዝር</h2><p>የተዘጋጀው ዝርዝር ከዚህ ማስተካከል አይቻልም።</p></div><span className="admin-draft-badge">{BOT_ROSTER.length} NAMES</span></div><div className="bot-roster-grid">{BOT_ROSTER.map((name, index) => <span key={name}><i>{String(index + 1).padStart(2, "0")}</i>{name}</span>)}</div></section><section className="admin-panel bot-wallet-panel"><div className="admin-panel-heading"><div><h2>የቦቶች ፕሮፋይል እና ዋሌት</h2><p>እያንዳንዱ bot የራሱ የplayer balance እና የtransaction history አለው።</p></div><WalletCards size={22} className="panel-gold-icon" /></div><div className="bot-wallet-list">{bots.length ? bots.map((bot) => <article className="bot-wallet-row" key={bot.id}><div className="bot-wallet-identity"><span><Bot size={17} /></span><div><strong>{bot.name}</strong><small>@{bot.handle} · ID {bot.id}</small></div></div><div className="bot-wallet-stats"><span>Player wallet<strong>{Number(bot.player_balance).toLocaleString()} ብር</strong></span><span>Main balance<strong>{Number(bot.main_balance).toLocaleString()} ብር</strong></span><span>Games<strong>{Number(bot.games).toLocaleString()}</strong></span><span>Cards<strong>{Number(bot.card_count).toLocaleString()}</strong></span></div><div className="bot-fund-control"><input aria-label={`Fund ${bot.name} wallet`} type="number" min="1" max="1000000" step="0.01" placeholder="Amount" value={fundAmounts[bot.id] ?? ""} onChange={(event) => setFundAmounts((current) => ({ ...current, [bot.id]: event.target.value }))} /><button type="button" className="admin-outline-button" disabled={fundingId === bot.id} onClick={() => void fundWallet(bot.id)}>{fundingId === bot.id ? "Saving..." : "Fund wallet"}</button></div></article>) : <p className="admin-empty-state">Bot profiles are being provisioned.</p>}</div></section></div>;
}

function formatActivity(activity: AdminActivity) {
  if (activity.type === "deposit") return activity.status === "approved" ? "Deposit ጸድቋል" : "Deposit ጥያቄ";
  if (activity.type === "withdrawal") return activity.status === "approved" ? "Withdraw ጸድቋል" : "Withdraw ጥያቄ";
  if (activity.type === "bingo_prize") return "Bingo አሸነፈ";
  if (activity.type === "card_refund") return "Card refund";
  if (activity.type === "bot_funding") return "Bot wallet funded";
  return activity.type.replace(/_/g, " ");
}

function formatRelativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function Overview({ overview, onBroadcast, onPromo }: { overview: AdminOverview; onBroadcast: () => void; onPromo: () => void }) {
  const chartRows = overview.dailySignups.length ? overview.dailySignups : Array.from({ length: 7 }, (_, index) => ({ label: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][index], value: 0 }));
  const chartValues = chartRows.map((row) => Number(row.value));
  const chartMax = Math.max(...chartValues, 1);
  const chartPoints = chartValues.map((value, index) => `${(index / Math.max(chartValues.length - 1, 1)) * 100},${100 - (value / chartMax) * 82 - 8}`).join(" ");
  return <>
    <div className="admin-page-heading">
      <div><p className="admin-eyebrow">LIVE DASHBOARD</p><h1>እንደምን አደሩ, Yelbekemer</h1><p className="admin-subtitle">የNEON BINGO እንቅስቃሴን ከዚህ ይቆጣጠሩ።</p></div>
      <div className="admin-heading-actions"><button className="admin-icon-button" aria-label="Notifications"><Bell size={19} /><b /></button><button className="admin-outline-button"><CalendarDays size={16} /> Live data</button></div>
    </div>
    <section className="admin-stats-grid">
      <StatCard icon={UsersRound} label="ጠቅላላ ፕሌየርስ" value={overview.totalPlayers.toLocaleString()} change={`${overview.activePlayers.toLocaleString()} active now`} accent="purple" />
      <StatCard icon={WalletCards} label="የዛሬ ገቢ" value={`${overview.todayRevenue.toLocaleString()} ብር`} change="Approved deposits today" accent="gold" />
      <StatCard icon={TicketPercent} label="ንቁ ፕሮሞ ኮዶች" value={overview.activePromoCodes.toLocaleString()} change={`${overview.totalPromoCodes.toLocaleString()} total codes`} accent="green" />
      <StatCard icon={Clock3} label="የሚጠባበቁ ጥያቄዎች" value={overview.pendingTransactions.toLocaleString()} change="Deposits and withdrawals" accent="rose" />
    </section>
    <section className="admin-main-grid">
      <article className="admin-panel admin-chart-panel">
        <div className="admin-panel-heading"><div><h2>የተጠቃሚ እንቅስቃሴ</h2><p>በዚህ ሳምንት የተመዘገቡ ፕሌየርስ</p></div><span className="admin-live-label">LIVE</span></div>
        <div className="admin-chart" aria-label="Weekly player signups chart"><div className="admin-chart-lines"><span /><span /><span /><span /></div><svg className="admin-chart-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points={`${chartPoints} 100,100 0,100`} /><polyline points={chartPoints} /></svg><div className="admin-chart-points">{chartValues.map((value, index) => <i key={`${chartRows[index].label}-${index}`} style={{ transform: `translateY(${100 - (value / chartMax) * 82 - 8}px)` }} />)}</div><div className="admin-chart-labels">{chartRows.map((row) => <span key={row.label}>{row.label}</span>)}</div></div>
      </article>
      <article className="admin-panel admin-actions-panel"><div className="admin-panel-heading"><div><h2>ፈጣን እርምጃዎች</h2><p>የተደጋጋሚ ስራዎች</p></div></div><button onClick={onBroadcast} className="admin-action-card"><span className="action-icon broadcast"><Megaphone size={20} /></span><span><strong>ብሮድካስት ላክ</strong><small>ለሁሉም ፕሌየርስ መልዕክት ላክ</small></span><ChevronRight size={17} /></button><button onClick={onPromo} className="admin-action-card"><span className="action-icon promo"><TicketPercent size={20} /></span><span><strong>ፕሮሞ ኮድ ፍጠር</strong><small>አዲስ ሽልማት ኮድ አዘጋጅ</small></span><ChevronRight size={17} /></button></article>
    </section>
    <section className="admin-main-grid bottom-grid">
      <article className="admin-panel"><div className="admin-panel-heading"><div><h2>የቅርብ ጊዜ እንቅስቃሴ</h2><p>ከDB የተገኙ የመጨረሻ ግብይቶች</p></div></div><div className="admin-activity-list">{overview.recentActivity.length ? overview.recentActivity.map((activity, index) => <div key={`${activity.created_at}-${index}`}><span className={`activity-avatar ${index % 3 === 0 ? "gold" : index % 3 === 1 ? "purple" : "green"}`}>{activity.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span><p><strong>{activity.name}</strong> {formatActivity(activity)}<small>{formatRelativeTime(activity.created_at)}</small></p><b className={activity.type === "withdrawal" ? "negative" : ""}>{["deposit", "bingo_prize", "card_refund", "bot_funding"].includes(activity.type) ? "+" : "-"}{Number(activity.amount).toLocaleString()} ብር</b></div>) : <p className="admin-empty-state">No activity yet</p>}</div></article>
      <article className="admin-panel admin-status-panel"><div className="admin-panel-heading"><div><h2>የስርዓት ሁኔታ</h2><p>የአገልግሎት ጤና</p></div><CircleCheck size={20} className="status-check" /></div><div className="system-status"><div><span /><p>Game server<strong>Operational</strong></p><time>Live</time></div><div><span /><p>Telegram bot<strong>Connected</strong></p><time>Live</time></div><div><span /><p>Database<strong>Operational</strong></p><time>Live</time></div></div></article>
    </section>
    <BonusSettings />
  </>;
}

function Broadcast({ imageUrl, imageName, imageData, overview, onImageChange, onRemoveImage, onSend }: { imageUrl: string; imageName: string; imageData: string; overview: AdminOverview; onImageChange: (event: ChangeEvent<HTMLInputElement>) => void; onRemoveImage: () => void; onSend: (message: string, audience: string, image: string) => Promise<void> }) {
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState("all");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!message.trim()) return; setError(""); try { await onSend(message, audience, imageData); setSent(true); } catch (submitError) { setSent(false); setError(submitError instanceof Error ? submitError.message : "Broadcast could not be sent"); } };
  return <div className="admin-section-page"><div className="admin-page-heading"><div><p className="admin-eyebrow">COMMUNICATION CENTER</p><h1>ብሮድካስት ላክ</h1><p className="admin-subtitle">ለTelegram bot ተጠቃሚዎች መልዕክት ያሰራጩ። ከምስል ጋር ወይም ያለምስል መላክ ይችላሉ።</p></div><div className="admin-bot-status"><span /><Bot size={18} /> Bot connected</div></div><div className="admin-composer-layout"><form className="admin-panel admin-composer" onSubmit={submit}><div className="admin-panel-heading"><div><h2>አዲስ መልዕክት</h2><p>የሚላከውን ይዘት እዚህ ያዘጋጁ</p></div><span className="admin-draft-badge">DRAFT</span></div><label>የሚደርሳቸው ተጠቃሚዎች<select value={audience} onChange={(event) => setAudience(event.target.value)}><option value="all">ሁሉም ፕሌየርስ · {overview.totalPlayers.toLocaleString()} users</option><option value="active">ንቁ ፕሌየርስ · {overview.activePlayers.toLocaleString()} users</option><option value="new">አዲስ ፕሌየርስ · {overview.newPlayers.toLocaleString()} users</option></select></label><label>መልዕክት<textarea value={message} onChange={(event) => { setMessage(event.target.value); setSent(false); setError(""); }} placeholder="ለተጠቃሚዎችዎ የሚላከውን መልዕክት ይጻፉ..." maxLength={1000} /><small>{message.length} / 1,000 characters</small></label><div className="admin-upload-label"><span>ምስል <em>አማራጭ</em></span>{imageUrl ? <div className="admin-uploaded-image"><img src={imageUrl} alt="Broadcast attachment preview" /><div><strong>{imageName}</strong><small>Ready to attach</small></div><button type="button" aria-label="Remove image" onClick={onRemoveImage}><X size={16} /></button></div> : <label className="admin-dropzone"><ImagePlus size={22} /><span><strong>ምስል ይጫኑ</strong><small>PNG, JPG or WEBP · max 5MB</small></span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={onImageChange} /></label>}</div>{sent && <div className="admin-success"><CircleCheck size={17} /> መልዕክቱ ተልኳል</div>}{error && <div className="admin-error"><X size={17} /> {error}</div>}<div className="admin-form-footer"><span><ShieldCheck size={15} /> Secure bot delivery</span><button type="submit" className="admin-primary-button"><Send size={16} /> ለ{audience === "all" ? "ሁሉም" : "ተመረጡ"} ተጠቃሚዎች ላክ</button></div></form><aside className="admin-panel admin-preview-panel"><div className="admin-panel-heading"><div><h2>ቅድመ እይታ</h2><p>በTelegram የሚታየው</p></div><span className="telegram-pill"><Bot size={13} /> TELEGRAM</span></div><div className="telegram-preview"><div className="telegram-preview-head"><span className="admin-brand-mark"><Bot size={15} /></span><strong>NEON BINGO <small>bot</small></strong></div>{imageUrl && <img src={imageUrl} alt="" />}{message ? <p>{message}</p> : <p className="placeholder">መልዕክትዎ እዚህ ይታያል...</p>}<time>just now</time></div><div className="preview-note"><Bell size={15} /><span>ሁሉም ተጠቃሚዎች ከNEON BINGO bot ማሳወቂያ ይደርሳቸዋል።</span></div></aside></div></div>;
}

function PromoCodes({ promos, onCreated }: { promos: PromoCode[]; onCreated: (promo: PromoCode) => Promise<void> }) {
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expiry, setExpiry] = useState("");
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!code || !amount) return; setError(""); try { await onCreated({ code: code.toUpperCase(), amount, uses: `0 / ${maxUses || "∞"}`, expires: expiry || "No expiry", active: true }); setCode(""); setAmount(""); setMaxUses(""); setExpiry(""); } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "Promo code could not be created"); } };
  return <div className="admin-section-page"><div className="admin-page-heading"><div><p className="admin-eyebrow">REWARD MANAGEMENT</p><h1>ፕሮሞ ኮዶች</h1><p className="admin-subtitle">ለፕሌየርስ የሚሰጡ የሽልማት ኮዶችን ይፍጠሩ እና ይቆጣጠሩ።</p></div><button className="admin-primary-button" onClick={() => document.getElementById("promo-code")?.focus()}><Plus size={17} /> አዲስ ፕሮሞ ኮድ</button></div><div className="promo-layout"><form className="admin-panel promo-form" onSubmit={submit}><div className="admin-panel-heading"><div><h2>ኮድ ፍጠር</h2><p>የፕሮሞ ኮዱን ዝርዝር ያስገቡ</p></div><TicketPercent size={21} className="panel-gold-icon" /></div><label>የፕሮሞ ኮድ<input id="promo-code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="ለምሳሌ: NEON100" /></label><div className="form-two-columns"><label>የሽልማት መጠን<input type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="100" /><small>ብር</small></label><label>ከፍተኛ አጠቃቀም<input type="number" min="1" value={maxUses} onChange={(event) => setMaxUses(event.target.value)} placeholder="100" /><small>uses</small></label></div><label>የሚያበቃበት ቀን<input type="date" value={expiry} onChange={(event) => setExpiry(event.target.value)} /></label>{error && <div className="admin-error"><X size={17} /> {error}</div>}<button className="admin-primary-button promo-submit" type="submit"><Plus size={16} /> ኮድ ፍጠር</button></form><div className="admin-panel promo-list-panel"><div className="admin-panel-heading"><div><h2>የተፈጠሩ ኮዶች</h2><p>12 active promo codes</p></div><button className="admin-text-button">ሁሉንም ይመልከቱ <ChevronRight size={15} /></button></div><div className="promo-table"><div className="promo-table-head"><span>CODE</span><span>REWARD</span><span>USAGE</span><span>STATUS</span></div>{promos.map((promo) => <div className="promo-row" key={promo.code}><strong>{promo.code}</strong><span>{promo.amount} ብር</span><span>{promo.uses}</span><b className={promo.active ? "active" : "expired"}>{promo.active ? "Active" : "Expired"}</b></div>)}</div></div></div></div>;
}

function Players({ overview }: { overview: AdminOverview }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active">("all");
  const [playerRows, setPlayerRows] = useState<Player[]>([]);
  useEffect(() => { const initData = window.Telegram?.WebApp?.initData || new URLSearchParams(window.location.hash.replace(/^#/, "")).get("tgWebAppData") || new URLSearchParams(window.location.search).get("tgWebAppData") || ""; fetch("/api/admin/players", { headers: { "x-telegram-init-data": initData, "x-admin-token": sessionStorage.getItem("neon-admin-token") || "" } }).then((response) => response.ok ? response.json() : null).then((data) => { if (!Array.isArray(data)) return; setPlayerRows(data.map((player) => ({ name: String(player.name), handle: player.handle ? `@${player.handle}` : "No username", status: player.status === "active" ? "active" : "idle", games: Number(player.games ?? 0), balance: Number(player.balance ?? 0).toLocaleString(), joined: new Date(player.joined).toLocaleDateString() }))); }).catch(() => undefined); }, []);
  const filteredPlayers = useMemo(() => playerRows.filter((player) => (filter === "all" || player.status === "active") && `${player.name} ${player.handle}`.toLowerCase().includes(query.toLowerCase())), [playerRows, query, filter]);
  return <div className="admin-section-page"><div className="admin-page-heading"><div><p className="admin-eyebrow">USER MANAGEMENT</p><h1>ፕሌየርስ</h1><p className="admin-subtitle">የተመዘገቡ ፕሌየርስን ይመልከቱ እና ያስተዳድሩ።</p></div><button className="admin-outline-button"><UploadCloud size={16} /> Export list</button></div><div className="admin-panel players-panel"><div className="players-toolbar"><div className="admin-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="በስም ወይም username ይፈልጉ..." /></div><div className="players-filters"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All players <span>{overview.totalPlayers.toLocaleString()}</span></button><button className={filter === "active" ? "active" : ""} onClick={() => setFilter("active")}>Active now <span>{overview.activePlayers.toLocaleString()}</span></button></div></div><div className="players-table"><div className="players-table-head"><span>PLAYER</span><span>STATUS</span><span>GAMES</span><span>BALANCE</span><span>JOINED</span><span /></div>{filteredPlayers.map((player) => <div className="player-row" key={player.handle}><div className="player-identity"><span>{player.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span><p><strong>{player.name}</strong><small>{player.handle}</small></p></div><span className={`player-status ${player.status}`}><i />{player.status === "active" ? "Active" : "Offline"}</span><b>{player.games}</b><strong>{player.balance} ብር</strong><time>{player.joined}</time><button aria-label={`Open ${player.name}`}><ChevronRight size={17} /></button></div>)}</div>{filteredPlayers.length === 0 && <div className="admin-empty-state"><UserRound size={25} /> No players found</div>}<div className="players-pagination"><span>Showing 1–{filteredPlayers.length} of 1,284 players</span><div><button disabled>Previous</button><button className="active">1</button><button>2</button><button>3</button><button>Next</button></div></div></div></div>;
}

function SimulationPanel({ headers }: { headers: Record<string, string> }) {
  const [status, setStatus] = useState<SimulationAdminStatus | null>(null);
  const [config, setConfig] = useState<SimulationConfig>({ playerCount: 5, initialBalance: 100, selectionDelayMs: 250, selectionSeconds: 12, callIntervalMs: 1000, releaseProbability: 0.2, remainThroughRound: true, seed: 1 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const configInitialized = useRef(false);
  const load = async () => {
    const response = await fetch("/api/admin/simulation", { headers });
    const body = await response.json().catch(() => null) as SimulationAdminStatus | { error?: string } | null;
    if (!response.ok) throw new Error(body && "error" in body ? body.error : "Simulation status unavailable");
    if (body && "enabled" in body) {
      setStatus(body);
      if (!configInitialized.current && body.defaults) { setConfig(body.defaults); configInitialized.current = true; }
    }
  };
  useEffect(() => { load().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Simulation status unavailable")); const timer = window.setInterval(() => load().catch(() => undefined), 1500); return () => window.clearInterval(timer); }, []);
  const update = <K extends keyof SimulationConfig>(key: K, value: SimulationConfig[K]) => setConfig((current) => ({ ...current, [key]: value }));
  const action = async (path: string, body?: unknown) => {
    setBusy(true); setError("");
    try {
      const response = await fetch(path, { method: "POST", headers, body: JSON.stringify(body ?? {}) });
      const result = await response.json().catch(() => ({} as { error?: string }));
      if (!response.ok) throw new Error(result.error || "Simulation request failed");
      await load();
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Simulation request failed"); }
    finally { setBusy(false); }
  };
  const run = status?.run;
  return <div className="admin-section-page"><div className="admin-page-heading"><div><p className="admin-eyebrow">STAGING ONLY</p><h1>Full-flow player simulator</h1><p className="admin-subtitle">Fake players use isolated wallets and the same card, game, release, call, and prize flow. Production data is never used.</p></div><div className={`admin-simulation-badge ${status?.enabled ? "enabled" : "disabled"}`}><span />{status?.enabled ? "Staging enabled" : "Disabled"}</div></div>{!status?.enabled ? <article className="admin-panel admin-simulation-warning"><ShieldCheck size={22} /><div><strong>Simulator is unavailable</strong><p>Set the staging-only simulation flag, database, and token on the staging service. This control is rejected outside staging.</p></div></article> : <><form className="admin-panel admin-simulation-form" onSubmit={(event) => { event.preventDefault(); void action("/api/admin/simulation/start", config); }}><div className="admin-panel-heading"><div><h2>Start a deterministic run</h2><p>Use a separate staging database and fake ETB balances.</p></div><span className="admin-draft-badge">QA</span></div><div className="admin-simulation-fields"><label>Players<input type="number" min="1" max="100" value={config.playerCount} onChange={(event) => update("playerCount", Number(event.target.value))} /></label><label>Fake wallet<input type="number" min="10" step="0.01" value={config.initialBalance} onChange={(event) => update("initialBalance", Number(event.target.value))} /></label><label>Selection seconds<input type="number" min="4" max="300" value={config.selectionSeconds} onChange={(event) => update("selectionSeconds", Number(event.target.value))} /></label><label>Call interval ms<input type="number" min="100" value={config.callIntervalMs} onChange={(event) => update("callIntervalMs", Number(event.target.value))} /></label><label>Release chance<input type="number" min="0" max="1" step="0.05" value={config.releaseProbability} onChange={(event) => update("releaseProbability", Number(event.target.value))} /></label><label>Seed<input type="number" value={config.seed} onChange={(event) => update("seed", Number(event.target.value))} /></label></div><label className="admin-simulation-checkbox"><input type="checkbox" checked={config.remainThroughRound} onChange={(event) => update("remainThroughRound", event.target.checked)} /> Keep simulated players connected through the round</label><div className="admin-simulation-actions"><button type="submit" className="admin-primary-button" disabled={busy || Boolean(run)}><Play size={15} /> Start run</button><button type="button" className="admin-outline-button" disabled={busy || !run} onClick={() => void action("/api/admin/simulation/stop", { runId: run?.id })}><Square size={15} /> Stop</button><button type="button" className="admin-outline-button danger" disabled={busy || !run} onClick={() => void action("/api/admin/simulation/clear", { runId: run?.id })}><Trash2 size={15} /> Clear run</button><button type="button" className="admin-outline-button" disabled={busy} onClick={() => void load()}><RefreshCw size={15} /> Refresh</button></div></form>{error && <div className="admin-error"><X size={16} /> {error}</div>}{run && <article className="admin-panel admin-simulation-status"><div className="admin-panel-heading"><div><h2>Run {run.id.slice(0, 8)}</h2><p>Started {new Date(run.createdAt).toLocaleString()} · {run.status}</p></div><span className="admin-live-label">{run.status.toUpperCase()}</span></div><div className="admin-simulation-metrics"><span><b>{run.playerCount}</b> players</span><span><b>{run.cardCount}</b> held cards</span><span><b>{run.config.initialBalance.toLocaleString()}</b> ETB seed</span></div><div className="admin-simulation-player-list">{run.players.map((player) => <div key={player.id}><span>{player.name}</span><b>{player.cardCount} cards</b><strong>{player.balance.toFixed(2)} ETB</strong></div>)}</div></article>}</>}</div>;
}

export default function Admin({ initialTab = "overview" }: { initialTab?: AdminTab }) {
  const [activeTab, setActiveTab] = useState<AdminTab>(initialTab);
  const [menuOpen, setMenuOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [imageData, setImageData] = useState("");
  const [imageName, setImageName] = useState("");
  const [overview, setOverview] = useState<AdminOverview>(emptyOverview);
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const initData = window.Telegram?.WebApp?.initData || new URLSearchParams(window.location.hash.replace(/^#/, "")).get("tgWebAppData") || new URLSearchParams(window.location.search).get("tgWebAppData") || "";
  const adminToken = sessionStorage.getItem("neon-admin-token") || "";
  const authHeaders = { "content-type": "application/json", "x-telegram-init-data": initData, "x-admin-token": adminToken };
  useEffect(() => {
    fetch("/api/admin/overview", { headers: authHeaders })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (data) setOverview(data as AdminOverview); })
      .catch(() => undefined);
    fetch("/api/admin/promo-codes", { headers: authHeaders })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (Array.isArray(data)) setPromos(data.map((promo: PromoApiRow) => formatPromo(promo))); })
      .catch(() => undefined);
  }, []);
  if (!adminToken && !initData) return <main className="admin-auth-required"><ShieldCheck size={30} /><h1>Admin access required</h1><p>እባክዎ ከዋናው አፕ ውስጥ 75ን 3 ጊዜ ታፕ አድርገው ይግቡ።</p><Link to="/" className="admin-primary-button">ወደ አፕ ተመለስ</Link></main>;
  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 5 * 1024 * 1024) return; setImageName(file.name); setImageUrl(URL.createObjectURL(file)); const reader = new FileReader(); reader.onload = () => setImageData(typeof reader.result === "string" ? reader.result : ""); reader.readAsDataURL(file); };
  const sendBroadcast = async (message: string, audience: string, image: string) => { const response = await fetch("/api/admin/broadcast", { method: "POST", headers: authHeaders, body: JSON.stringify({ message, audience, image }) }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || "Broadcast could not be sent"); };
  const selectTab = (tab: AdminTab) => setActiveTab(tab);
  const createPromo = async (promo: PromoCode) => { const [maxUsesText] = promo.uses.split("/").slice(1); const response = await fetch("/api/admin/promo-codes", { method: "POST", headers: authHeaders, body: JSON.stringify({ code: promo.code, amount: Number(promo.amount), maxUses: maxUsesText?.trim() === "∞" ? null : Number(maxUsesText?.trim()), expiresAt: promo.expires === "No expiry" ? null : promo.expires }) }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || "Promo code could not be created"); setPromos((current) => [formatPromo(body as PromoApiRow), ...current]); };
  return <div className="admin-app"><AdminSidebar activeTab={activeTab} onSelect={selectTab} open={menuOpen} onClose={() => setMenuOpen(false)} /><main className="admin-main"><header className="admin-topbar"><button className="admin-menu-button" aria-label="Open menu" onClick={() => setMenuOpen(true)}><Menu size={22} /></button><div className="admin-breadcrumb"><span>NEON BINGO</span><ChevronRight size={14} /><strong>{activeTab === "settings" ? "Bot Control / ቦት ቁጥጥር" : navItems.find((item) => item.id === activeTab)?.label}</strong></div><div className="admin-topbar-actions"><Link to="/" className="admin-view-site"><LayoutDashboard size={16} /> View player app</Link><button className="admin-icon-button" aria-label="Notifications"><Bell size={18} /></button><span className="admin-top-avatar">YA</span></div></header><div className="admin-content">{activeTab === "overview" && <Overview overview={overview} onBroadcast={() => setActiveTab("broadcast")} onPromo={() => setActiveTab("promos")} />}{activeTab === "broadcast" && <Broadcast imageUrl={imageUrl} imageName={imageName} imageData={imageData} overview={overview} onImageChange={handleImageChange} onRemoveImage={() => { setImageUrl(""); setImageData(""); setImageName(""); }} onSend={sendBroadcast} />}{activeTab === "promos" && <PromoCodes promos={promos} onCreated={createPromo} />}{activeTab === "players" && <Players overview={overview} />}{activeTab === "simulation" && <SimulationPanel headers={authHeaders} />}{(activeTab === "settings" || activeTab === "bots") && <BotSettingsPanel headers={authHeaders} />}</div></main></div>;
}
