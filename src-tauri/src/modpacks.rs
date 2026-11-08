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
    let id = install_file(paths, &pack, title, icon_url, rep).await;
    let _ = std::fs::remove_file(&pack);
    id
}

/// Installs a .mrpack file (downloaded, or one the player picked) as a new profile. Returns the new profile's id.
pub async fn install_file(paths: &Paths, pack: &Path, title: &str, icon_url: &str, rep: &Reporter) -> Result<String> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(pack)?).context("The modpack file is broken")?;
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
    Ok(id)
}

/// What a file the player wants to import is, before importing it.
#[derive(serde::Serialize, Default)]
pub struct Inspect {
    /// "mrpack" (Modrinth modpack) or "ccprofile" (a Com Client profile export)
    pub kind: String,
    pub name: String,
    pub version: String,
    pub minecraft: String,
    pub loader: String,
    pub mods: usize,
    pub files: usize,
    pub size: u64,
    pub icon: String,
    /// why it can't be imported (wrong Minecraft version, not Fabric ...), empty when it can
    pub problem: String,
}

pub fn inspect(file: &Path) -> Result<Inspect> {
    let size = std::fs::metadata(file).context("Can't find that file")?.len();
    let mut zip = zip::ZipArchive::new(std::fs::File::open(file)?).map_err(|_| anyhow!("That isn't a modpack or a Com Client profile"))?;
    let read = |zip: &mut zip::ZipArchive<std::fs::File>, name: &str| -> Option<String> {
        let mut e = zip.by_name(name).ok()?;
        let mut t = String::new();
        e.read_to_string(&mut t).ok()?;
        Some(t)
    };
    if let Some(t) = read(&mut zip, "modrinth.index.json") {
        let index: Value = serde_json::from_str(&t).context("The modpack file is broken")?;
        let deps = &index["dependencies"];
        let mc = deps["minecraft"].as_str().unwrap_or_default().to_string();
        let loader = if deps.get("fabric-loader").is_some() {
            "Fabric"
        } else if deps.get("quilt-loader").is_some() {
            "Quilt"
        } else if deps.get("neoforge").is_some() {
            "NeoForge"
        } else if deps.get("forge").is_some() {
            "Forge"
        } else {
            ""
        };
        let files = index["files"].as_array().cloned().unwrap_or_default();
        let mods = files.iter().filter(|f| f["path"].as_str().is_some_and(|p| p.starts_with("mods/"))).count();
        let problem = if loader != "Fabric" && !loader.is_empty() {
            format!("This modpack is for {loader}, Com Client runs on Fabric")
        } else if !mc.is_empty() && mc != config::MC_VERSION {
            format!("This modpack is for Minecraft {mc}, the launcher plays {}", config::MC_VERSION)
        } else {
            String::new()
        };
        return Ok(Inspect {
            kind: "mrpack".into(),
            name: index["name"].as_str().unwrap_or("Modpack").to_string(),
            version: index["versionId"].as_str().unwrap_or_default().to_string(),
            minecraft: mc,
            loader: loader.to_string(),
            mods,
            files: files.len(),
            size,
            icon: String::new(),
            problem,
        });
    }
    if let Some(t) = read(&mut zip, "profile.json") {
        let p: Profile = serde_json::from_str(&t).context("That Com Client profile is broken")?;
        let mut mods = 0;
        let mut files = 0;
        for i in 0..zip.len() {
            if let Ok(e) = zip.by_index(i) {
                if e.is_file() && e.name().starts_with("files/") {
                    files += 1;
                    if e.name().starts_with("files/mods/") && e.name().ends_with(".jar") {
                        mods += 1;
                    }
                }
            }
        }
        return Ok(Inspect {
            kind: "ccprofile".into(),
            name: p.name.clone(),
            version: String::new(),
            minecraft: config::MC_VERSION.into(),
            loader: "Fabric".into(),
            mods,
            files,
            size,
            icon: p.icon.clone(),
            problem: String::new(),
        });
    }
    bail!("That isn't a modpack (.mrpack) or a Com Client profile (.ccprofile)")
}

/// A Modrinth modpack from a link ("https://modrinth.com/modpack/fabulously-optimized"), its slug or id.
#[derive(serde::Serialize)]
pub struct Project {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub icon: String,
    pub downloads: u64,
    /// newest version that fits, empty when none does
    pub version: String,
    pub problem: String,
}

pub async fn lookup(input: &str) -> Result<Project> {
    let input = input.trim().trim_end_matches('/');
    let slug = if let Ok(u) = url::Url::parse(input) {
        if !u.host_str().is_some_and(|h| h == "modrinth.com" || h.ends_with(".modrinth.com")) {
            bail!("Paste a link from modrinth.com");
        }
        let parts: Vec<&str> = u.path_segments().map(|s| s.collect()).unwrap_or_default();
        let at = parts.iter().position(|p| matches!(*p, "modpack" | "project" | "mod")).map(|i| i + 1).unwrap_or(0);
        parts.get(at).copied().unwrap_or_default().to_string()
    } else {
        input.to_string()
    };
    if slug.is_empty() || !slug.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        bail!("That doesn't look like a Modrinth modpack link");
    }
    let v: Value = net::get_json(&format!("https://api.modrinth.com/v2/project/{slug}")).await.map_err(|_| anyhow!("No Modrinth project called \"{slug}\""))?;
    if v["project_type"].as_str() != Some("modpack") {
        bail!("\"{}\" is a {}, not a modpack: install it under Mods", v["title"].as_str().unwrap_or(&slug), v["project_type"].as_str().unwrap_or("project"));
    }
    let id = v["id"].as_str().unwrap_or_default().to_string();
    let (version, problem) = match modrinth::best_version(&id, "modpack", config::MC_VERSION).await {
        Ok(ver) => (ver["version_number"].as_str().unwrap_or_default().to_string(), String::new()),
        Err(_) => (String::new(), format!("This modpack has no Fabric version for Minecraft {}", config::MC_VERSION)),
    };
    Ok(Project {
        id,
        slug: v["slug"].as_str().unwrap_or_default().to_string(),
        title: v["title"].as_str().unwrap_or_default().to_string(),
        description: v["description"].as_str().unwrap_or_default().to_string(),
        icon: v["icon_url"].as_str().unwrap_or_default().to_string(),
        downloads: v["downloads"].as_u64().unwrap_or(0),
        version,
        problem,
    })
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

    #[test]
    fn inspects_a_modpack() {
        use std::io::Write;
        let dir = std::env::temp_dir().join(format!("cc-mp-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let make = |name: &str, mc: &str, loader: &str| {
            let f = dir.join(name);
            let mut z = zip::ZipWriter::new(std::fs::File::create(&f).unwrap());
            z.start_file("modrinth.index.json", zip::write::SimpleFileOptions::default()).unwrap();
            let idx = serde_json::json!({"name": "Test Pack", "versionId": "1.2", "dependencies": {"minecraft": mc, loader: "1"},
                "files": [{"path": "mods/a.jar"}, {"path": "mods/b.jar"}, {"path": "config/x.txt"}]});
            z.write_all(idx.to_string().as_bytes()).unwrap();
            z.finish().unwrap();
            f
        };
        let ok = inspect(&make("a.mrpack", config::MC_VERSION, "fabric-loader")).unwrap();
        assert_eq!((ok.kind.as_str(), ok.mods, ok.files, ok.problem.as_str()), ("mrpack", 2, 3, ""));
        assert!(inspect(&make("b.mrpack", "1.20.1", "fabric-loader")).unwrap().problem.contains("1.20.1"));
        assert!(inspect(&make("c.mrpack", config::MC_VERSION, "forge")).unwrap().problem.contains("Forge"));
        std::fs::write(dir.join("d.txt"), "hi").unwrap();
        assert!(inspect(&dir.join("d.txt")).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
