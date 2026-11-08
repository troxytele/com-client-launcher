//! Saved data: accounts, settings and profiles (JSON files in the launcher folder).

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

use crate::auth::{self, McLogin, MsTokens};
use crate::paths::Paths;

fn load<T: for<'de> Deserialize<'de> + Default>(paths: &Paths, name: &str) -> T {
    std::fs::read_to_string(paths.file(name)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save<T: Serialize>(paths: &Paths, name: &str, v: &T) -> Result<()> {
    let path = paths.file(name);
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(v)?)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

// ------------------------------------------------------------------ accounts

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Account {
    pub uuid: String,
    pub name: String,
    pub flow: String,
    pub refresh_token: String,
    #[serde(default)]
    pub mc_token: String,
    #[serde(default)]
    pub mc_expires: i64,
    #[serde(default)]
    pub skin_url: String,
    #[serde(default)]
    pub xuid: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Accounts {
    pub active: Option<String>,
    pub list: Vec<Account>,
}

/// What the window may see (no tokens).
#[derive(Serialize, Clone, Debug)]
pub struct AccountView {
    pub uuid: String,
    pub name: String,
    pub skin_url: String,
    pub active: bool,
}

impl Accounts {
    pub fn load(paths: &Paths) -> Self {
        load(paths, "accounts.json")
    }
    pub fn save(&self, paths: &Paths) -> Result<()> {
        save(paths, "accounts.json", self)
    }
    pub fn views(&self) -> Vec<AccountView> {
        self.list
            .iter()
            .map(|a| AccountView {
                uuid: a.uuid.clone(),
                name: a.name.clone(),
                skin_url: a.skin_url.clone(),
                active: self.active.as_deref() == Some(a.uuid.as_str()),
            })
            .collect()
    }
    pub fn upsert(&mut self, ms: &MsTokens, mc: &McLogin) {
        let acc = Account {
            uuid: mc.uuid.clone(),
            name: mc.name.clone(),
            flow: ms.flow.clone(),
            refresh_token: ms.refresh.clone(),
            mc_token: mc.token.clone(),
            mc_expires: mc.expires_at,
            skin_url: mc.skin_url.clone(),
            xuid: mc.xuid.clone(),
        };
        self.list.retain(|a| a.uuid != acc.uuid);
        self.list.push(acc);
        self.active = Some(mc.uuid.clone());
    }
}

/// The active account with a Minecraft token that is valid for at least 10 more minutes (refreshes if needed).
pub async fn fresh_account(paths: &Paths) -> Result<Account> {
    let mut accounts = Accounts::load(paths);
    let uuid = accounts.active.clone().ok_or_else(|| anyhow!("Add a Microsoft account first"))?;
    let acc = accounts.list.iter().find(|a| a.uuid == uuid).cloned().ok_or_else(|| anyhow!("Add a Microsoft account first"))?;
    if !acc.mc_token.is_empty() && acc.mc_expires > auth::now() + 600 {
        return Ok(acc);
    }
    let ms = auth::refresh(&acc.flow, &acc.refresh_token).await?;
    let mc = auth::minecraft(&ms).await?;
    accounts.upsert(&ms, &mc);
    accounts.save(paths)?;
    accounts.list.into_iter().find(|a| a.uuid == mc.uuid).ok_or_else(|| anyhow!("account vanished"))
}

// ------------------------------------------------------------------ settings + profiles

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Settings {
    /// "hide" (back when the game closes), "keep" or "close".
    pub after_launch: String,
    pub discord_rpc: bool,
    /// Developer: start this jar instead of the GitHub release.
    pub custom_client_jar: String,
    pub active_profile: String,
    /// Open the logs window while the game starts and runs.
    pub open_logs: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            after_launch: "hide".into(),
            discord_rpc: true,
            custom_client_jar: String::new(),
            active_profile: "default".into(),
            open_logs: false,
        }
    }
}

impl Settings {
    pub fn load(paths: &Paths) -> Self {
        load(paths, "settings.json")
    }
    pub fn save(&self, paths: &Paths) -> Result<()> {
        save(paths, "settings.json", self)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Profile {
    pub id: String,
    pub name: String,
    /// Empty = the launcher's own folder for this profile.
    pub game_dir: String,
    pub ram_mb: u32,
    pub java_args: String,
    pub width: u32,
    pub height: u32,
    pub fullscreen: bool,
    pub created: i64,
    pub last_played: i64,
    /// Load ReplayMod (record and watch replays), kept hidden like Fabric API.
    pub replay_mod: bool,
    /// Sodium, Lithium, FerriteCore and EntityCulling for more FPS (hidden like Fabric API).
    pub performance_mods: bool,
    /// Minecraft version of this profile.
    pub version: String,
    /// "item:diamond_sword", "block:grass_block", a data: URL (uploaded picture) or empty.
    pub icon: String,
    /// Servers pinned to the launch bar (one click starts and joins).
    pub servers: Vec<PinnedServer>,
    pub playtime_secs: u64,
    /// Newest first, at most 30.
    pub sessions: Vec<Session>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct PinnedServer {
    pub name: String,
    pub address: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Session {
    pub start: i64,
    pub secs: u64,
    pub server: String,
}

impl Default for Profile {
    fn default() -> Self {
        Profile {
            id: "default".into(),
            name: "Com Client".into(),
            game_dir: String::new(),
            ram_mb: default_ram(),
            java_args: String::new(),
            width: 1280,
            height: 720,
            fullscreen: false,
            created: auth::now(),
            last_played: 0,
            replay_mod: false,
            performance_mods: true,
            version: crate::config::MC_VERSION.into(),
            icon: "block:grass_block".into(),
            servers: Vec::new(),
            playtime_secs: 0,
            sessions: Vec::new(),
        }
    }
}

/// 4 GB, less on small computers.
pub fn default_ram() -> u32 {
    let total = total_ram_mb();
    if total >= 12_000 {
        4096
    } else if total >= 8_000 {
        3072
    } else {
        2048
    }
}

pub fn total_ram_mb() -> u32 {
    let mut s = sysinfo::System::new();
    s.refresh_memory();
    (s.total_memory() / 1024 / 1024) as u32
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Profiles {
    pub list: Vec<Profile>,
}

impl Profiles {
    pub fn load(paths: &Paths) -> Self {
        let mut p: Profiles = load(paths, "profiles.json");
        if p.list.is_empty() {
            p.list.push(Profile::default());
        }
        p
    }
    pub fn save(&self, paths: &Paths) -> Result<()> {
        save(paths, "profiles.json", self)
    }
    /// Adds the time of one game session to a profile.
    pub fn record(paths: &Paths, id: &str, start: i64, secs: u64, server: &str) {
        let _ = PlayLog::load(paths); // copies the old sessions in first (once), so this one isn't counted twice
        let mut ps = Profiles::load(paths);
        if let Some(p) = ps.list.iter_mut().find(|p| p.id == id) {
            p.playtime_secs += secs;
            p.sessions.insert(0, Session { start, secs, server: server.to_string() });
            p.sessions.truncate(30);
            let _ = ps.save(paths);
        }
        PlayLog::add(paths, id, start, secs);
    }
    pub fn get(&self, id: &str) -> Profile {
        self.list.iter().find(|p| p.id == id).cloned().unwrap_or_else(|| self.list[0].clone())
    }
}

/// Every game session for the play time graphs (days and weeks), all profiles, newest last. Kept separately from
/// the profiles so it can grow (up to 5000 sessions, years of playing).
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct PlayLog {
    pub sessions: Vec<LogEntry>,
    /// The old per-profile session lists were copied in once.
    pub seeded: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct LogEntry {
    pub profile: String,
    pub start: i64,
    pub secs: u64,
}

impl PlayLog {
    pub fn load(paths: &Paths) -> Self {
        let mut log: PlayLog = load(paths, "playlog.json");
        if !log.seeded {
            // first start with the tracker: take what the profiles remember (their last 30 sessions each)
            for p in Profiles::load(paths).list {
                for s in p.sessions {
                    log.sessions.push(LogEntry { profile: p.id.clone(), start: s.start, secs: s.secs });
                }
            }
            log.sessions.sort_by_key(|e| e.start);
            log.seeded = true;
            let _ = save(paths, "playlog.json", &log);
        }
        log
    }

    pub fn add(paths: &Paths, profile: &str, start: i64, secs: u64) {
        let mut log = PlayLog::load(paths);
        log.sessions.push(LogEntry { profile: profile.to_string(), start, secs });
        let n = log.sessions.len();
        if n > 5000 {
            log.sessions.drain(0..n - 5000);
        }
        let _ = save(paths, "playlog.json", &log);
    }
}

pub fn game_dir(paths: &Paths, p: &Profile) -> std::path::PathBuf {
    if p.game_dir.trim().is_empty() {
        paths.profiles().join(&p.id)
    } else {
        std::path::PathBuf::from(p.game_dir.trim())
    }
}
