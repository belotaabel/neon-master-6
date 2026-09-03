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
  "Abel", "Nati_21", "Yoni", "Dagi_99", "Elias_7", "Heni", "Maki_12", "Yosi", "Sami_01", "Kaleab",
  "Aron_88", "Miki", "Dani_55", "Beruk", "Beni_10", "Kirubel_Pro", "Ermias_Tech", "Biniyam_Net", "Dawit_Vibes", "Solomon_Design",
  "Tewodros_Official", "Nathan_Code", "Samuel_Live", "Surafel_Real", "Kaleb_Ops", "Abebe_Visuals", "Bruk_Web", "Ezra_Studio", "Robel_Flow", "Aman_Zone",
  "Gideon_Hub", "Nahom_Pulse", "Eyyob_Core", "Mikiyas_Lab", "Yared_Craft", "Fikru_Prime", "Haile_Base", "Getachew_Link", "Taye_Cast", "Tilahun_Sync",
  "Tadesse_Drive", "Worku_Wave", "Yared_90", "Kassahun_33", "Tewodros_44", "Mulugeta_77", "Fikru_05", "Getachew_50", "Tilahun_18", "Worku_11",
  "Henok", "Mena_14", "Melaku", "Binyam_80", "Ashenafi_3", "Bisrat", "Nebiyu_07", "Tsegaye", "Eyob_23", "Fitsum",
  "Yonatan_99", "Amsalu", "Bezawit_4", "Tafese", "Fisseha_19", "Girma", "Tadesse_08", "Mussie", "Kidus_12", "Amanuel",
  "Sintayehu_77", "Mulugeta", "Gashaw_22", "Kassa", "Belay_04", "Alemu", "Getu_31", "Luel", "Yafet_88", "Mebrahtu",
  "Desta_15", "Wondwossen", "Hailu_02", "Andualem", "Tewelde_66", "Gedion", "Kifle_91", "Temesgen", "Meles_03", "Tekle",
  "Derese_55", "Solomon", "Kaleb_09", "Zerihun", "Lemma_71", "Endale", "Kassaye_13", "Asefa", "Mengistu_40", "Bekele",
  "Admasu_06", "Workneh", "Biruk_85", "Sisay", "Fikre_17", "Seyoum", "Bedilu_25", "Gashu", "Assefa_60", "Kebede",
  "Haile_34", "Getahun", "Mekonnen_02", "Desalegn", "Genet_19", "Alemayehu", "Taye_83", "Tizazu", "Nega_11", "Molla",
  "Demissie_95", "Bogale", "Ayalew_07", "Tesfaye", "Aklilu_30", "Gideon", "Samuel_88", "Yohannes", "Elias_12", "Amanuel_05",
  "Dawit", "Kirubel_77", "Nathanael", "Robel_43", "Ermias", "Surafel_29", "Kaleb", "Sami_91", "Dani", "Miki_16",
  "Heni", "Dagi_82", "Yoni", "Nati_04", "Abel", "Biniyam_37", "Solomon_68", "Abebe", "Worku_15", "Getachew",
  "Tadesse_50", "Tilahun", "Fikru_22", "Yared", "Kassahun_89", "Mulugeta", "Tewodros_01", "Hailu", "Girma_73", "Andualem",
  "Endale_10", "Sisay", "Mengistu_64", "Bekele", "Zerihun_35", "Tesfaye", "Meles_98", "Kebede", "Desalegn_12", "Tekle",
  "Alemayehu_03", "Genet", "Asefa_47", "Molla", "Demissie_81", "Ayalew", "Aklilu_14", "Admasu", "Workneh_26", "Biruk",
  "Fikre_52", "Gashu", "Bedilu_09", "Assefa", "Mekonnen_66", "Desalegn_31", "Taye", "Tizazu_08", "Nega", "Bogale_45",
  "Amsalu", "Gashaw_84", "Belay", "Luel_07", "Desta", "Wondwossen_93", "Gedion", "Temesgen_11", "Derese", "Kassaye_62",
  "Desalegn_70", "Worku", "Getu_24", "Mebrahtu", "Kifle_05", "Mussie_38", "Sintayehu",
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
