// Everything the window asks the launcher core (Rust) to do.
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export type Account = { uuid: string; name: string; skin_url: string; active: boolean };

export type Settings = {
  after_launch: "hide" | "keep" | "close";
  discord_rpc: boolean;
  custom_client_jar: string;
  active_profile: string;
  open_logs: boolean;
};

export type Profile = {
  id: string;
  name: string;
  game_dir: string;
  ram_mb: number;
  java_args: string;
  width: number;
  height: number;
  fullscreen: boolean;
  created: number;
  last_played: number;
  replay_mod: boolean;
  performance_mods: boolean;
  version: string;
  icon: string;
  servers: PinnedServer[];
  playtime_secs: number;
  sessions: Session[];
};

export type PinnedServer = { name: string; address: string };
export type Session = { start: number; secs: number; server: string };

export type CrashFile = { path: string; name: string; profile: string; kind: "crash" | "jvm" | "log"; modified: number; size: number };

export type ImportSource = {
  launcher: string;
  name: string;
  dir: string;
  modified: number;
  servers: boolean;
  keybinds: number;
  packs: number;
  packs_bytes: number;
};
export type ImportProgress = { done: number; total: number; name: string };

export type Info = {
  version: string;
  mc_version: string;
  data_dir: string;
  total_ram: number;
  accounts: Account[];
  settings: Settings;
  profiles: Profile[];
  client: { client_version: string; client_file: string; fabric_api_version: string; fabric_api_file: string };
  running: boolean;
  client_repo_set: boolean;
};

export type Progress = { stage: string; done: number; total: number };
export type GameExit = { code: number | null; crashed: boolean; killed: boolean; crash_report: string | null };
export type DeviceCode = { user_code: string; device_code: string; verification_uri: string; interval: number; expires_in: number };
export type NewsItem = { title: string; body: string; date: string; tag: string; url: string };
export type Friend = { uuid: string; name: string; username: string; online: boolean; activity: string; server: string; last_seen: number; level: number };
export type Social = { friends: Friend[]; requests: number; level: number; title: string; username: string; unread: number };
export type Kind = "mod" | "resourcepack" | "shader" | "modpack";
export type Installed = {
  file: string; id: string; name: string; version: string; description: string; authors: string; icon: string;
  enabled: boolean; size: number; sha1: string;
};
export type Hit = { id: string; slug: string; title: string; description: string; icon: string; author: string; downloads: number; follows: number; categories: string[] };
export type SearchResult = { hits: Hit[]; total: number };
export type Update = { file: string; version: string; url: string; filename: string; sha1: string; size: number };

export type Shot = { path: string; name: string; profile: string; profile_name: string; modified: number; size: number };
export type Replay = Shot & { duration_ms: number; server: string; mc_version: string };

export type CosmeticItem = { id: string; name: string };
export type Catalog = { capes: CosmeticItem[]; wings: CosmeticItem[]; halos: CosmeticItem[]; hats: CosmeticItem[]; auras: CosmeticItem[] };
/** Same fields as the mod's config. auraColor -1 = rainbow. */
export type Look = { cape: string; wings: string; halo: string; haloColor: number; hat: string; hatColor: number; aura: string; auraColor: number };

export type OptimisePlan = {
  ram_total_mb: number; cpu: string; cores: number; gpu: string; gpu_kind: "dedicated" | "integrated" | "unknown";
  tier: "low" | "medium" | "high"; ram_mb: number; video: [string, string][];
};

/** /state on the Com Client server. */
export type ServerFriend = {
  uuid: string; name: string; username: string; online: boolean; activity: string | null; server: string | null;
  last_seen: number; level: number;
};
export type ServerState = {
  friends: ServerFriend[];
  incoming: { uuid: string; name: string; created: number }[];
  outgoing: { uuid: string; name: string; created: number }[];
};
export type ChatSummary = {
  uuid: string; name: string; username: string; unread: number; at: number; request: boolean;
  last: { text: string; at: number; mine: boolean } | null;
};
export type ChatMessage = { id: string; from: string; text: string; at: number };
export type Chat = { uuid: string; name: string; username: string; friend: boolean; request: boolean; pending: boolean; declined: boolean; messages: ChatMessage[]; other_read: number };

export type Skin = { id: string; name: string; variant: "classic" | "slim"; data: string; active: boolean };
export type CurrentSkin = { data: string; variant: "classic" | "slim"; name: string };

export const api = {
  info: () => invoke<Info>("get_info"),
  login: () => invoke<Account[]>("login_microsoft"),
  deviceStart: () => invoke<DeviceCode>("device_start"),
  devicePoll: (deviceCode: string) => invoke<Account[] | null>("device_poll", { deviceCode }),
  selectAccount: (uuid: string) => invoke<Account[]>("select_account", { uuid }),
  removeAccount: (uuid: string) => invoke<Account[]>("remove_account", { uuid }),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  saveProfile: (profile: Profile) => invoke<Profile[]>("save_profile", { profile }),
  deleteProfile: (id: string) => invoke<Profile[]>("delete_profile", { id }),
  launch: (server?: string, profile?: string, replay?: string) =>
    invoke<void>("launch", { server: server ?? null, profile: profile ?? null, replay: replay ?? null }),
  shots: () => invoke<Shot[]>("shots_list"),
  replays: () => invoke<Replay[]>("replays_list"),
  galleryDelete: (path: string) => invoke<void>("gallery_delete", { path }),
  shotCopy: (path: string) => invoke<void>("shot_copy", { path }),
  shotShare: (path: string) => invoke<void>("shot_share", { path }),
  serverGet: <T,>(path: string) => invoke<T>("server_get", { path }),
  serverPost: <T,>(path: string, body?: unknown) => invoke<T>("server_post", { path, body: body ?? null }),
  catalog: () => invoke<Catalog>("cosmetics_catalog"),
  cosmeticTexture: (kind: "cape" | "wings", id: string) => invoke<string>("cosmetic_texture", { kind, id }),
  lookGet: () => invoke<Look>("cosmetics_get"),
  lookSave: (look: Look) => invoke<void>("cosmetics_save", { look }),
  modpackInstall: (project: string, title: string, icon: string) => invoke<string>("modpack_install", { project, title, icon }),
  openLogsWindow: () => invoke<void>("open_logs_window"),
  optimiseScan: () => invoke<OptimisePlan>("optimise_scan"),
  optimiseApply: (profile: string, video: boolean) => invoke<Profile[]>("optimise_apply", { profile, video }),
  iconNames: () => invoke<string[]>("icon_names"),
  icons: (names: string[]) => invoke<Record<string, string>>("icons", { names }),
  iconUpload: (file: string) => invoke<string>("icon_upload", { file }),
  profileDuplicate: (id: string) => invoke<Profile[]>("profile_duplicate", { id }),
  profileExport: (id: string, dest: string) => invoke<void>("profile_export", { id, dest }),
  profileImport: (file: string) => invoke<Profile[]>("profile_import", { file }),
  prewarm: () => invoke<boolean>("prewarm"),
  kill: () => invoke<void>("kill_game"),
  repair: () => invoke<number>("repair"),
  news: () => invoke<NewsItem[]>("news"),
  social: () => invoke<Social>("social"),
  modsList: (kind: Kind) => invoke<Installed[]>("mods_list", { kind }),
  modToggle: (kind: Kind, file: string) => invoke<string>("mod_toggle", { kind, file }),
  modDelete: (kind: Kind, file: string) => invoke<void>("mod_delete", { kind, file }),
  modsUpdates: (kind: Kind) => invoke<Update[]>("mods_updates", { kind }),
  modUpdate: (kind: Kind, update: Update) => invoke<void>("mod_update", { kind, update }),
  search: (query: string, kind: Kind, sort: string, offset: number) =>
    invoke<SearchResult>("modrinth_search", { query, kind, sort, offset }),
  install: (project: string, kind: Kind) => invoke<string[]>("modrinth_install", { project, kind }),
  openFolder: (which: string) => invoke<void>("open_folder", { which }),
  openFile: (path: string) => invoke<void>("open_file", { path }),
  skins: () => invoke<Skin[]>("skins_list"),
  skinAdd: (file: string, name: string, variant: string) => invoke<void>("skin_add", { file, name, variant }),
  skinImport: (player: string) => invoke<void>("skin_import", { player }),
  skinUpdate: (id: string, name: string, variant: string) => invoke<void>("skin_update", { id, name, variant }),
  skinDelete: (id: string) => invoke<void>("skin_delete", { id }),
  skinApply: (id: string) => invoke<Account[]>("skin_apply", { id }),
  skinCurrent: () => invoke<CurrentSkin>("skin_current"),
  crashes: () => invoke<CrashFile[]>("crash_list"),
  crashRead: (path: string) => invoke<string>("crash_read", { path }),
  importScan: () => invoke<ImportSource[]>("import_scan"),
  importApply: (source: string, profile: string, settings: boolean, keybinds: boolean, servers: boolean, packs: boolean) =>
    invoke<string>("import_apply", { source, profile, settings, keybinds, servers, packs }),
};

export const on = {
  progress: (f: (p: Progress) => void): Promise<UnlistenFn> => listen<Progress>("progress", (e) => f(e.payload)),
  log: (f: (line: string) => void): Promise<UnlistenFn> => listen<string>("game-log", (e) => f(e.payload)),
  started: (f: () => void): Promise<UnlistenFn> => listen("game-started", () => f()),
  exit: (f: (e: GameExit) => void): Promise<UnlistenFn> => listen<GameExit>("game-exit", (e) => f(e.payload)),
  modpackProgress: (f: (p: Progress) => void): Promise<UnlistenFn> => listen<Progress>("modpack-progress", (e) => f(e.payload)),
};

/** Errors from Rust come as plain strings. */
export function msg(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + "k";
  return String(n);
}

export function fmtBytes(n: number): string {
  if (n >= 1 << 30) return (n / (1 << 30)).toFixed(1) + " GB";
  if (n >= 1 << 20) return (n / (1 << 20)).toFixed(1) + " MB";
  if (n >= 1 << 10) return Math.round(n / (1 << 10)) + " KB";
  return n + " B";
}

export function ago(unix: number): string {
  if (!unix) return "never";
  const s = Math.max(0, Date.now() / 1000 - unix);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  return Math.floor(s / 86400) + " d ago";
}

/** 3725 -> "1 h 2 min" */
export function fmtTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h >= 100) return `${h} h`;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min`;
  return secs > 0 ? "< 1 min" : "0 min";
}
