/**
 * Shared code between client and server
 * Useful to share types between client and server
 * and/or small pure JS functions that can be used on both client and server
 */

/**
 * Example response type for /api/demo
 */
export interface DemoResponse {
  message: string;
}

export type BingoGameType = "75";

export interface BotSettings {
  enabled: boolean;
  botCount: number;
}

export interface AdminBotAccount {
  id: number;
  name: string;
  handle: string;
  telegram_id: string | number;
  player_balance: number | string;
  main_balance: number | string;
  balance: number | string;
  games: number;
  card_count: number;
  joined: string;
}

export const BOT_ROSTER = [
  "Abel_01", "Nati_Dev", "Yoni_21", "Dagi_x", "Elias_M", "Heni_Pro", "Maki_Tech", "Yosi_Net", "Sami_Vibes", "Kaleab_99",
  "Aron_Design", "Miki_Official", "Dani_Code", "Beruk_Live", "Beni_Real", "Heli_Creations", "Liya_A", "Elsi_Style", "Makda_K", "Seli_Art",
  "Hani_M", "Tigi_Flow", "Mery_Studio", "Yeru_T", "Beti_G", "Addis_Lij", "Sheger_Boy", "Ye_Addis_Lij", "Ethio_Creative", "Habesh_Tech",
  "Gondar_Lij", "Wollo_Vibe", "Arba_Minch_Boy", "Hawassa_Life", "Bahr_Dar_Lij", "Abel_Mesgan", "Natnael_Eth", "Yonas_Dev", "Dagmawi_M", "Elias_Addis",
  "Henok_T", "Matewos_K", "Yoseph_Design", "Samuel_A", "Kaleb_Pro", "Aron_Visuals", "Mikael_Ops", "Daniel_Web", "Beruk_A", "Eliyad_X",
] as const;

export interface SimulationConfig {
  playerCount: number;
  initialBalance: number;
  selectionDelayMs: number;
  selectionSeconds: number;
  callIntervalMs: number;
  releaseProbability: number;
  remainThroughRound: boolean;
  seed: number;
}

export interface SimulationPlayerStatus {
  id: number;
  name: string;
  balance: number;
  cardCount: number;
}

export interface SimulationRunStatus {
  id: string;
  status: "running" | "stopped" | "completed";
  config: SimulationConfig;
  playerCount: number;
  cardCount: number;
  createdAt: string;
  stoppedAt: string | null;
  players: SimulationPlayerStatus[];
}

export interface SimulationAdminStatus {
  enabled: boolean;
  defaults: SimulationConfig;
  run: SimulationRunStatus | null;
}

export interface BingoWinner {
  userId: number;
  displayName: string;
  cardNumber: number;
  rows: number[];
  prizeAmount: number;
}

export type WalletBalanceType = "player" | "main";

export interface WalletProfile {
  id: number;
  telegram_id: string | number;
  username: string | null;
  display_name: string;
  phone?: string | null;
  player_balance: number | string;
  main_balance: number | string;
  balance: number | string;
  card_count: number;
}

export interface WalletTransaction {
  id: number;
  type: string;
  amount: number | string;
  balance_type: WalletBalanceType;
  status: string;
  external_reference?: string | null;
  created_at: string;
}

export interface WalletResponse {
  profile: WalletProfile;
  transactions: WalletTransaction[];
  depositReceiver: string | null;
}
