//! Com Client itself (+ Fabric API): newest release from GitHub, kept in the launcher's own folder and handed to
//! Fabric with -Dfabric.addMods, so it is never in the player's mods folder.

use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

use crate::config;
use crate::net::{self, Download, Hash};
use crate::paths::Paths;
use crate::progress::Reporter;

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
pub struct Installed {
    pub client_version: String,
    pub client_file: String,
    pub fabric_api_version: String,
    pub fabric_api_file: String,
    #[serde(default)]
    pub replay_file: String,
    /// Optional hidden mods: Modrinth project -> file name of the copy we have.
    #[serde(default)]
    pub extra: std::collections::HashMap<String, String>,
}

fn installed_path(paths: &Paths) -> PathBuf {
    paths.client().join("installed.json")
}

pub fn installed(paths: &Paths) -> Installed {
    std::fs::read_to_string(installed_path(paths)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save(paths: &Paths, i: &Installed) {
    let _ = std::fs::create_dir_all(paths.client());
    let _ = std::fs::write(installed_path(paths), serde_json::to_string_pretty(i).unwrap_or_default());
}

/// The jars to load. `custom` = a test jar picked in the settings (instead of the GitHub release).
pub async fn ensure(paths: &Paths, mc: &str, custom: Option<&str>, replay: bool, perf: bool, rep: &Reporter) -> Result<Vec<PathBuf>> {
    rep.stage("Updating Com Client", 0, 0);
    let mut state = installed(paths);
    let mut jars = Vec::new();

    // Com Client
    if let Some(c) = custom.filter(|c| !c.trim().is_empty()) {
        let p = PathBuf::from(c.trim());
        if !p.is_file() {
            bail!("The test jar from the settings doesn't exist: {}", p.display());
        }
        jars.push(p);
    } else {
        match latest_client().await {
            Ok((tag, name, url, hash, size)) => {
                let path = paths.client().join(&name);
                let d = Download { url, path: path.clone(), hash, size, executable: false };
                if state.client_version != tag || !net::is_valid(&d) {
                    rep.stage(&format!("Downloading Com Client {tag}"), 0, 0);
                    net::fetch(&d, None).await?;
                    if !state.client_file.is_empty() && state.client_file != name {
                        let _ = std::fs::remove_file(paths.client().join(&state.client_file));
                    }
                    state.client_version = tag;
                    state.client_file = name;
                    save(paths, &state);
                }
                jars.push(path);
            }
            Err(e) => {
                // offline / GitHub down: start with the one we have
                let have = paths.client().join(&state.client_file);
                if state.client_file.is_empty() || !have.is_file() {
                    return Err(e);
                }
                jars.push(have);
            }
        }
    }

    // Fabric API
    match latest_modrinth("fabric-api", mc).await {
        Ok((version, name, url, sha1, size)) => {
            let path = paths.client().join(&name);
            let d = Download::new(url, &path, Some(sha1), size);
            if !net::is_valid(&d) {
                rep.stage("Downloading Fabric API", 0, 0);
                net::fetch(&d, None).await?;
                if !state.fabric_api_file.is_empty() && state.fabric_api_file != name {
                    let _ = std::fs::remove_file(paths.client().join(&state.fabric_api_file));
                }
            }
            state.fabric_api_version = version;
            state.fabric_api_file = name;
            save(paths, &state);
            jars.push(path);
        }
        Err(e) => {
            let have = paths.client().join(&state.fabric_api_file);
            if state.fabric_api_file.is_empty() || !have.is_file() {
                return Err(e);
            }
            jars.push(have);
        }
    }

    // optional hidden mods (per profile). A problem here never stops the game from starting.
    let mut wanted: Vec<(&str, &str)> = Vec::new();
    if replay {
        wanted.push(("replaymod", "ReplayMod"));
    }
    if perf {
        wanted.extend([("sodium", "Sodium"), ("lithium", "Lithium"), ("ferrite-core", "FerriteCore"), ("entityculling", "EntityCulling")]);
    }
    for (slug, title) in wanted {
        if let Some(p) = optional(paths, &mut state, slug, title, mc, rep).await {
            jars.push(p);
        }
    }
    save(paths, &state);
    Ok(jars)
}

/// Newest copy of an optional Modrinth mod, or the one we have when offline. None = not available for this version.
async fn optional(paths: &Paths, state: &mut Installed, slug: &str, title: &str, mc: &str, rep: &Reporter) -> Option<PathBuf> {
    let have = state.extra.get(slug).cloned().unwrap_or_default();
    match latest_modrinth(slug, mc).await {
        Ok((_, name, url, sha1, size)) => {
            let path = paths.client().join(&name);
            let d = Download::new(url, &path, Some(sha1), size);
            if !net::is_valid(&d) {
                rep.stage(&format!("Downloading {title}"), 0, 0);
                if net::fetch(&d, None).await.is_err() {
                    let old = paths.client().join(&have);
                    return (!have.is_empty() && old.is_file()).then_some(old);
                }
            }
            if !have.is_empty() && have != name {
                let _ = std::fs::remove_file(paths.client().join(&have));
            }
            state.extra.insert(slug.to_string(), name);
            Some(path)
        }
        Err(_) => {
            let old = paths.client().join(&have);
            (!have.is_empty() && old.is_file()).then_some(old)
        }
    }
}

/// (tag, file name, url, hash, size) of the .jar in the newest GitHub release of the mod.
async fn latest_client() -> Result<(String, String, String, Hash, u64)> {
    if config::CLIENT_REPO.starts_with("YOUR_GITHUB_NAME") {
        bail!("Com Client isn't published yet. Put your GitHub name into src-tauri/src/config.rs, or pick a test jar in Settings → Developer.");
    }
    let url = format!("https://api.github.com/repos/{}/releases/latest", config::CLIENT_REPO);
    let r = net::client().get(&url).header("Accept", "application/vnd.github+json").send().await?;
    if r.status().as_u16() == 404 {
        bail!("There is no Com Client release on GitHub yet (github.com/{} must be a public repo with a release that has the .jar).", config::CLIENT_REPO);
    }
    if !r.status().is_success() {
        bail!("GitHub answered {}", r.status());
    }
    let rel: Value = r.json().await?;
    let tag = rel["tag_name"].as_str().unwrap_or("?").to_string();
    let asset = rel["assets"]
        .as_array()
        .and_then(|a| {
            a.iter().find(|x| {
                let n = x["name"].as_str().unwrap_or_default();
                n.ends_with(".jar") && !n.contains("-sources") && !n.contains("-dev")
            })
        })
        .ok_or_else(|| anyhow!("The newest Com Client release ({tag}) has no .jar"))?;
    let name = asset["name"].as_str().unwrap_or("com-client.jar").to_string();
    let hash = asset["digest"]
        .as_str()
        .and_then(|d| d.strip_prefix("sha256:"))
        .map(|h| Hash::Sha256(h.to_string()))
        .unwrap_or(Hash::None);
    Ok((tag, name, asset["browser_download_url"].as_str().unwrap_or_default().to_string(), hash, asset["size"].as_u64().unwrap_or(0)))
}

/// (version, file name, url, sha1, size) of the newest Fabric build of a Modrinth project for this Minecraft version.
async fn latest_modrinth(project: &str, mc: &str) -> Result<(String, String, String, String, u64)> {
    let url = format!(
        "https://api.modrinth.com/v2/project/{project}/version?game_versions={}&loaders={}",
        urlencoding::encode(&format!("[\"{mc}\"]")),
        urlencoding::encode("[\"fabric\"]")
    );
    let versions: Value = net::get_json(&url).await?;
    let v = versions.as_array().and_then(|a| a.first()).ok_or_else(|| anyhow!("No {project} for Minecraft {mc} yet"))?;
    let files = v["files"].as_array().cloned().unwrap_or_default();
    let f = files
        .iter()
        .find(|f| f["primary"].as_bool().unwrap_or(false))
        .or_else(|| files.first())
        .ok_or_else(|| anyhow!("{project} has no file"))?;
    Ok((
        v["version_number"].as_str().unwrap_or_default().to_string(),
        f["filename"].as_str().unwrap_or("fabric-api.jar").to_string(),
        f["url"].as_str().unwrap_or_default().to_string(),
        f["hashes"]["sha1"].as_str().unwrap_or_default().to_string(),
        f["size"].as_u64().unwrap_or(0),
    ))
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct NewsItem {
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub tag: String,
    #[serde(default)]
    pub url: String,
}

/// news.json from the launcher repo (cached for offline starts).
pub async fn news(paths: &Paths) -> Vec<NewsItem> {
    let cache = paths.file("news.json");
    if !config::LAUNCHER_REPO.starts_with("YOUR_GITHUB_NAME") {
        let url = format!("https://raw.githubusercontent.com/{}/main/news.json", config::LAUNCHER_REPO);
        if let Ok(v) = net::get_json::<Vec<NewsItem>>(&url).await {
            let _ = std::fs::write(&cache, serde_json::to_string(&v).unwrap_or_default());
            return v;
        }
    }
    if let Some(v) = std::fs::read_to_string(&cache).ok().and_then(|t| serde_json::from_str(&t).ok()) {
        return v;
    }
    vec![NewsItem {
        title: "Welcome to Com Client".into(),
        body: "Press Play: the launcher installs Minecraft, Fabric and Com Client for you and keeps them up to date.".into(),
        date: String::new(),
        tag: "Launcher".into(),
        url: String::new(),
    }]
}
