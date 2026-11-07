//! Modrinth modpacks (.mrpack): one click installs the whole pack as a new profile.
//!
//! A .mrpack is a zip with modrinth.index.json (the files to download, with hashes) and an overrides folder (configs,
//! resource packs ... copied as they are). Only Fabric packs for the launcher's Minecraft version are offered.

use anyhow::{anyhow, bail, Context, Result};
use base64::Engine;
use serde_json::Value;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use crate::config;
use crate::modrinth;
use crate::net::{self, Download, Hash};
use crate::paths::Paths;
use crate::progress::Reporter;
use crate::store::{self, Profile, Profiles};

/// Hosts a modpack may download from (the .mrpack format only allows these).
const HOSTS: &[&str] = &["cdn.modrinth.com", "github.com", "raw.githubusercontent.com", "gitlab.com"];

/// A path inside the game folder that can't climb out of it ("mods/x.jar" yes, "../x" or "C:\\x" no).
fn safe_rel(p: &str) -> Option<PathBuf> {
    let path = Path::new(p);
    if p.is_empty() || path.is_absolute() || p.contains(':') {
        return None;
    }
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::Normal(x) => out.push(x),
            Component::CurDir => {}
            _ => return None,
        }
    }
    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}

fn host_ok(url: &str) -> bool {
    url::Url::parse(url).ok().and_then(|u| u.host_str().map(|h| HOSTS.contains(&h))).unwrap_or(false) && url.starts_with("https://")
}

/// Installs a modpack as a new profile. Returns the new profile's id.
pub async fn install(paths: &Paths, project: &str, title: &str, icon_url: &str, rep: &Reporter) -> Result<String> {
    rep.stage("Finding the newest version", 0, 0);
    let v = modrinth::best_version(project, "modpack", config::MC_VERSION)
        .await
        .map_err(|_| anyhow!("This modpack has no Fabric version for Minecraft {}", config::MC_VERSION))?;
    let f = modrinth::primary_file(&v).ok_or_else(|| anyhow!("That modpack version has no file"))?;
    let url = f["url"].as_str().unwrap_or_default().to_string();
    let pack = paths.root.join("cache").join("modpacks").join(format!("{project}.mrpack"));
    rep.stage("Downloading the modpack", 0, 0);
    net::fetch(&Download::new(url, pack.clone(), f["hashes"]["sha1"].as_str().map(String::from), f["size"].as_u64().unwrap_or(0)), None).await?;

    let mut zip = zip::ZipArchive::new(std::fs::File::open(&pack)?).context("The modpack file is broken")?;
    let index: Value = {
        let mut e = zip.by_name("modrinth.index.json").map_err(|_| anyhow!("That isn't a Modrinth modpack"))?;
        let mut t = String::new();
        e.read_to_string(&mut t)?;
        serde_json::from_str(&t)?
    };
    let mc = index["dependencies"]["minecraft"].as_str().unwrap_or_default();
    if !mc.is_empty() && mc != config::MC_VERSION {
        bail!("This modpack is for Minecraft {mc}, the launcher plays {}", config::MC_VERSION);
    }
    if index["dependencies"].get("forge").is_some() || index["dependencies"].get("neoforge").is_some() || index["dependencies"].get("quilt-loader").is_some() {
        bail!("This modpack isn't for Fabric");
    }

    // the new profile
    let mut p = Profile::default();
    p.id = format!("p{}", &uuid::Uuid::new_v4().simple().to_string()[..8]);
    p.name = {
        let n = index["name"].as_str().filter(|s| !s.trim().is_empty()).unwrap_or(title).trim().to_string();
        let ver = index["versionId"].as_str().unwrap_or_default();
        if ver.is_empty() { n } else { format!("{n} {ver}") }
    };
    p.created = crate::auth::now();
    p.performance_mods = false; // the pack brings its own
    p.ram_mb = p.ram_mb.max(4096).min(store::total_ram_mb().saturating_sub(2048).max(2048));
    if let Some(icon) = icon(icon_url).await {
        p.icon = icon;
    }
    let dir = store::game_dir(paths, &p);
    std::fs::create_dir_all(&dir)?;

    // its files
    let mut list = Vec::new();
    for file in index["files"].as_array().cloned().unwrap_or_default() {
        if file["env"]["client"].as_str() == Some("unsupported") {
            continue;
        }
        let Some(rel) = file["path"].as_str().and_then(safe_rel) else { continue };
        let Some(url) = file["downloads"].as_array().and_then(|d| d.iter().filter_map(|u| u.as_str()).find(|u| host_ok(u))) else { continue };
        let hash = match (file["hashes"]["sha1"].as_str(), file["hashes"]["sha512"].as_str()) {
            (Some(s), _) => Hash::Sha1(s.to_string()),
            _ => Hash::None,
        };
        list.push(Download { url: url.to_string(), path: dir.join(rel), hash, size: file["fileSize"].as_u64().unwrap_or(0), executable: false });
    }
    let count = list.len();
    net::fetch_all(&format!("Downloading {count} mods and files"), list, rep).await?;

    // overrides (configs, packs, ...): client-overrides win over overrides
    rep.stage("Copying the pack's settings", 0, 0);
    for prefix in ["overrides/", "client-overrides/"] {
        for i in 0..zip.len() {
            let mut e = zip.by_index(i)?;
            let name = e.name().to_string();
            let Some(rest) = name.strip_prefix(prefix) else { continue };
            if e.is_dir() {
                continue;
            }
            let Some(rel) = safe_rel(rest) else { continue };
            let out = dir.join(rel);
            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut w = std::fs::File::create(&out)?;
            std::io::copy(&mut e, &mut w)?;
        }
    }

    let mut ps = Profiles::load(paths);
    let id = p.id.clone();
    ps.list.push(p);
    ps.save(paths)?;
    let _ = std::fs::remove_file(&pack);
    Ok(id)
}

/// The modpack's icon as a data: URL (profiles show it), if it loads.
async fn icon(url: &str) -> Option<String> {
    if !url.starts_with("https://") {
        return None;
    }
    let r = net::client().get(url).send().await.ok()?;
    if !r.status().is_success() {
        return None;
    }
    let mime = r.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("image/png").to_string();
    if !mime.starts_with("image/") {
        return None;
    }
    let bytes = r.bytes().await.ok()?;
    if bytes.len() > 400_000 {
        return None;
    }
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paths_stay_inside() {
        assert_eq!(safe_rel("mods/a.jar").unwrap(), PathBuf::from("mods").join("a.jar"));
        assert!(safe_rel("../a").is_none());
        assert!(safe_rel("/etc/x").is_none());
        assert!(safe_rel("C:\\x").is_none());
        assert!(safe_rel("mods/../../x").is_none());
        assert!(host_ok("https://cdn.modrinth.com/data/x.jar"));
        assert!(!host_ok("https://evil.example/x.jar"));
    }
}
