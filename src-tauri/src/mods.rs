//! The player's own mods, resource packs and shader packs in a profile's game folder.

use anyhow::{bail, Result};
use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone, Debug)]
pub struct InstalledItem {
    pub file: String,
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub authors: String,
    /// data: URL of the icon inside the jar / zip
    pub icon: String,
    pub enabled: bool,
    pub size: u64,
    pub sha1: String,
    /// an unzipped pack (a folder) instead of a .zip
    pub folder: bool,
    /// why Minecraft won't load it ("" when it's fine)
    pub problem: String,
}

pub fn folder(game_dir: &Path, kind: &str) -> PathBuf {
    game_dir.join(match kind {
        "resourcepack" => "resourcepacks",
        "shader" => "shaderpacks",
        _ => "mods",
    })
}

fn read_entry(zip: &mut zip::ZipArchive<std::fs::File>, name: &str, max: u64) -> Option<Vec<u8>> {
    let mut f = zip.by_name(name).ok()?;
    if f.size() > max {
        return None;
    }
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    Some(buf)
}

fn data_url(bytes: &[u8]) -> String {
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Name, version, icon … from fabric.mod.json (mods) or pack.mcmeta/pack.png (packs).
pub fn inspect(path: &Path) -> (String, String, String, String, String, String) {
    let file_name = path.file_name().and_then(|s| s.to_str()).unwrap_or_default().to_string();
    let base = file_name.trim_end_matches(".disabled").trim_end_matches(".jar").trim_end_matches(".zip").to_string();
    let Ok(f) = std::fs::File::open(path) else { return (base.clone(), base, String::new(), String::new(), String::new(), String::new()) };
    let Ok(mut zip) = zip::ZipArchive::new(f) else { return (base.clone(), base, String::new(), String::new(), String::new(), String::new()) };
    if let Some(bytes) = read_entry(&mut zip, "fabric.mod.json", 1 << 20) {
        let text = String::from_utf8_lossy(&bytes).replace(['\n', '\r', '\t'], " ");
        if let Ok(v) = serde_json::from_str::<Value>(&text) {
            let authors = v["authors"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(String::from).or_else(|| x["name"].as_str().map(String::from)))
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            let icon_path = match &v["icon"] {
                Value::String(s) => s.clone(),
                Value::Object(m) => m.values().last().and_then(|x| x.as_str()).unwrap_or_default().to_string(),
                _ => String::new(),
            };
            let icon = if icon_path.is_empty() {
                String::new()
            } else {
                read_entry(&mut zip, icon_path.trim_start_matches('/'), 512 * 1024).map(|b| data_url(&b)).unwrap_or_default()
            };
            return (
                v["id"].as_str().unwrap_or(&base).to_string(),
                v["name"].as_str().unwrap_or(&base).to_string(),
                v["version"].as_str().unwrap_or_default().to_string(),
                v["description"].as_str().unwrap_or_default().to_string(),
                authors,
                icon,
            );
        }
    }
    // resource / shader pack
    let desc = read_entry(&mut zip, "pack.mcmeta", 64 * 1024)
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .map(|v| match &v["pack"]["description"] {
            Value::String(s) => s.clone(),
            other => other["text"].as_str().unwrap_or_default().to_string(),
        })
        .unwrap_or_default();
    let icon = read_entry(&mut zip, "pack.png", 512 * 1024).map(|b| data_url(&b)).unwrap_or_default();
    (base.clone(), base, String::new(), strip_codes(&desc), String::new(), icon)
}

/// An unzipped resource pack or shader pack: its name, description and icon from pack.mcmeta / pack.png, like a zip.
/// Also says when Minecraft won't see it (the usual mistake: unzipping into a folder inside another folder).
fn inspect_folder(dir: &Path, kind: &str) -> (String, String, String, String) {
    let name = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let base = name.trim_end_matches(".disabled").to_string();
    let is_pack = |d: &Path| if kind == "shader" { d.join("shaders").is_dir() } else { d.join("pack.mcmeta").is_file() };
    // the pack itself, or (when it was unzipped one level too deep) the only folder inside it
    let (root, problem) = if is_pack(dir) {
        (dir.to_path_buf(), String::new())
    } else {
        let inner: Vec<PathBuf> = std::fs::read_dir(dir).map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect()).unwrap_or_default();
        match inner.iter().find(|d| is_pack(d)) {
            Some(d) => (
                d.clone(),
                format!("The pack is one folder too deep: move what's inside \"{}\" up into \"{}\" (or use the zip), or Minecraft won't load it.",
                    d.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), base),
            ),
            None => (
                dir.to_path_buf(),
                if kind == "shader" { "No shaders folder inside: this isn't a shader pack.".into() } else { "No pack.mcmeta inside: this isn't a resource pack.".into() },
            ),
        }
    };
    let desc = std::fs::read(root.join("pack.mcmeta"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .map(|v| match &v["pack"]["description"] {
            Value::String(s) => s.clone(),
            other => other["text"].as_str().unwrap_or_default().to_string(),
        })
        .unwrap_or_default();
    let icon = std::fs::read(root.join("pack.png")).ok().filter(|b| b.len() <= 512 * 1024).map(|b| data_url(&b)).unwrap_or_default();
    (base, strip_codes(&desc), icon, problem)
}

/// The size of a whole folder (an unzipped pack).
fn dir_size(p: &Path) -> u64 {
    std::fs::read_dir(p)
        .map(|rd| rd.flatten().map(|e| {
            let q = e.path();
            if q.is_dir() { dir_size(&q) } else { e.metadata().map(|m| m.len()).unwrap_or(0) }
        }).sum())
        .unwrap_or(0)
}

fn strip_codes(s: &str) -> String {
    let mut out = String::new();
    let mut skip = false;
    for c in s.chars() {
        if skip {
            skip = false;
            continue;
        }
        if c == '§' {
            skip = true;
            continue;
        }
        out.push(c);
    }
    out
}

pub fn list(game_dir: &Path, kind: &str) -> Vec<InstalledItem> {
    let dir = folder(game_dir, kind);
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(&dir) else { return out };
    for e in rd.flatten() {
        let path = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        let lower = name.to_lowercase();
        let ok = match kind {
            "mod" => lower.ends_with(".jar") || lower.ends_with(".jar.disabled"),
            _ => lower.ends_with(".zip") || lower.ends_with(".zip.disabled") || path.is_dir(),
        };
        if !ok {
            continue;
        }
        let folder = path.is_dir();
        let mut problem = String::new();
        let (id, title, version, description, authors, icon) = if folder {
            let (base, desc, icon, p) = inspect_folder(&path, kind);
            problem = p;
            (base.clone(), base, String::new(), desc, String::new(), icon)
        } else {
            inspect(&path)
        };
        let size = if folder { dir_size(&path) } else { e.metadata().map(|m| m.len()).unwrap_or(0) };
        let sha1 = if path.is_file() { crate::net::sha1_file(&path).unwrap_or_default() } else { String::new() };
        out.push(InstalledItem { file: name.clone(), id, name: title, version, description, authors, icon, enabled: !lower.ends_with(".disabled"), size, sha1, folder, problem });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

fn safe(dir: &Path, file: &str) -> Result<PathBuf> {
    if file.contains('/') || file.contains('\\') || file.contains("..") {
        bail!("bad file name");
    }
    Ok(dir.join(file))
}

pub fn toggle(game_dir: &Path, kind: &str, file: &str) -> Result<String> {
    let dir = folder(game_dir, kind);
    let from = safe(&dir, file)?;
    let to = if let Some(stripped) = file.strip_suffix(".disabled") { stripped.to_string() } else { format!("{file}.disabled") };
    std::fs::rename(&from, dir.join(&to))?;
    Ok(to)
}

/// A pack unzipped one folder too deep ("Pack/Pack/pack.mcmeta"): moves the inner folder's contents up so Minecraft
/// sees it.
pub fn fix_nested(game_dir: &Path, kind: &str, file: &str) -> Result<()> {
    let outer = safe(&folder(game_dir, kind), file)?;
    if !outer.is_dir() {
        bail!("{file} isn't a folder");
    }
    let is_pack = |d: &Path| if kind == "shader" { d.join("shaders").is_dir() } else { d.join("pack.mcmeta").is_file() };
    if is_pack(&outer) {
        return Ok(());
    }
    let inner = std::fs::read_dir(&outer)?
        .flatten()
        .map(|e| e.path())
        .find(|p| p.is_dir() && is_pack(p))
        .ok_or_else(|| anyhow::anyhow!("No pack inside {file}"))?;
    // first check nothing would be overwritten, then move everything up
    let entries: Vec<PathBuf> = std::fs::read_dir(&inner)?.flatten().map(|e| e.path()).collect();
    for p in &entries {
        let to = outer.join(p.file_name().unwrap_or_default());
        if to.exists() && to != inner {
            bail!("Can't fix it by itself: \"{}\" is in both folders. Move the files by hand.", p.file_name().unwrap_or_default().to_string_lossy());
        }
    }
    // the inner folder may have the same name as a file inside it: move it aside first
    let tmp = outer.join(format!(".cc-fix-{}", std::process::id()));
    std::fs::rename(&inner, &tmp)?;
    for e in std::fs::read_dir(&tmp)?.flatten() {
        std::fs::rename(e.path(), outer.join(e.file_name()))?;
    }
    std::fs::remove_dir(&tmp)?;
    Ok(())
}

pub fn delete(game_dir: &Path, kind: &str, file: &str) -> Result<()> {
    let path = safe(&folder(game_dir, kind), file)?;
    if path.is_dir() {
        std::fs::remove_dir_all(path)?;
    } else {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

/// Mod ids in the player's (enabled) mods, so we don't load a second Fabric API.
pub fn mod_ids(game_dir: &Path) -> Vec<String> {
    list(game_dir, "mod").into_iter().filter(|m| m.enabled).map(|m| m.id).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folders_are_packs_too() {
        let game = std::env::temp_dir().join(format!("cc-packs-{}", std::process::id()));
        let rp = game.join("resourcepacks");
        // a normal unzipped pack, one unzipped a folder too deep, a folder that isn't a pack, and a zip
        std::fs::create_dir_all(rp.join("Faithful")).unwrap();
        std::fs::write(rp.join("Faithful").join("pack.mcmeta"), r#"{"pack":{"pack_format":46,"description":"§6Faithful 32x"}}"#).unwrap();
        std::fs::write(rp.join("Faithful").join("pack.png"), [137u8, 80, 78, 71]).unwrap();
        std::fs::create_dir_all(rp.join("Deep").join("Deep").join("assets")).unwrap();
        std::fs::write(rp.join("Deep").join("Deep").join("pack.mcmeta"), r#"{"pack":{"pack_format":46,"description":"deep"}}"#).unwrap();
        std::fs::write(rp.join("Deep").join("Deep").join("assets").join("a.png"), vec![0u8; 500]).unwrap();
        std::fs::create_dir_all(rp.join("Notes")).unwrap();
        std::fs::write(rp.join("x.zip"), b"not really a zip").unwrap();
        let list = list(&game, "resourcepack");
        let get = |n: &str| list.iter().find(|i| i.file == n).unwrap().clone();
        assert_eq!(list.len(), 4);
        let f = get("Faithful");
        assert!(f.folder && f.problem.is_empty() && f.description == "Faithful 32x" && f.icon.starts_with("data:image/png"));
        assert!(f.size > 0);
        let d = get("Deep");
        assert!(d.folder && d.problem.contains("too deep") && d.description == "deep");
        assert!(get("Notes").problem.contains("pack.mcmeta"));
        assert!(!get("x.zip").folder);
        // the fix moves it up, then it's a working pack
        fix_nested(&game, "resourcepack", "Deep").unwrap();
        assert!(rp.join("Deep").join("pack.mcmeta").is_file() && rp.join("Deep").join("assets").join("a.png").is_file());
        assert!(list_one(&game, "Deep").problem.is_empty());
        // turning a folder pack off and on works like a zip
        let off = toggle(&game, "resourcepack", "Faithful").unwrap();
        assert_eq!(off, "Faithful.disabled");
        assert!(!list_one(&game, "Faithful.disabled").enabled);
        let _ = std::fs::remove_dir_all(&game);
    }

    fn list_one(game: &Path, file: &str) -> InstalledItem {
        list(game, "resourcepack").into_iter().find(|i| i.file == file).unwrap()
    }
}
