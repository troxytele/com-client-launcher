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
        let (id, title, version, description, authors, icon) =
            if path.is_dir() { (name.clone(), name.clone(), String::new(), String::new(), String::new(), String::new()) } else { inspect(&path) };
        let size = e.metadata().map(|m| m.len()).unwrap_or(0);
        let sha1 = if path.is_file() { crate::net::sha1_file(&path).unwrap_or_default() } else { String::new() };
        out.push(InstalledItem { file: name.clone(), id, name: title, version, description, authors, icon, enabled: !lower.ends_with(".disabled"), size, sha1 });
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
