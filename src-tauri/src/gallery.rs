//! Gallery: screenshots and ReplayMod recordings from every profile, in one place.
//!
//! The window shows the pictures through the "ccimg" protocol (see lib.rs), which only serves files from a
//! profile's screenshots folder.

use anyhow::{bail, Result};
use serde::Serialize;
use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::paths::{native, Paths};
use crate::store::{self, Profiles};

#[derive(Serialize, Clone, Debug)]
pub struct Shot {
    pub path: String,
    pub name: String,
    pub profile: String,
    pub profile_name: String,
    pub modified: i64,
    pub size: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct Replay {
    pub path: String,
    pub name: String,
    pub profile: String,
    pub profile_name: String,
    pub modified: i64,
    pub size: u64,
    /// Length of the recording in milliseconds (0 = unknown).
    pub duration_ms: u64,
    /// Server it was recorded on (empty = singleplayer / unknown).
    pub server: String,
    pub mc_version: String,
}

/// (profile id, profile name, folder) for one sub folder of every profile, each folder once.
fn folders(paths: &Paths, sub: &str) -> Vec<(String, String, PathBuf)> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for p in Profiles::load(paths).list {
        let dir = store::game_dir(paths, &p).join(sub);
        let key = dir.canonicalize().unwrap_or_else(|_| dir.clone());
        if seen.insert(key) {
            out.push((p.id.clone(), p.name.clone(), dir));
        }
    }
    out
}

fn modified(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn ext(p: &Path) -> String {
    p.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase()
}

/// Every screenshot of every profile, newest first.
pub fn screenshots(paths: &Paths) -> Vec<Shot> {
    let mut out = Vec::new();
    for (id, name, dir) in folders(paths, "screenshots") {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let path = e.path();
            if !matches!(ext(&path).as_str(), "png" | "jpg" | "jpeg") {
                continue;
            }
            let Ok(meta) = e.metadata() else { continue };
            if !meta.is_file() {
                continue;
            }
            out.push(Shot {
                path: native(&path),
                name: e.file_name().to_string_lossy().to_string(),
                profile: id.clone(),
                profile_name: name.clone(),
                modified: modified(&meta),
                size: meta.len(),
            });
        }
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out
}

/// Every ReplayMod recording (.mcpr) of every profile, newest first.
pub fn replays(paths: &Paths) -> Vec<Replay> {
    let mut out = Vec::new();
    for (id, name, dir) in folders(paths, "replay_recordings") {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let path = e.path();
            if ext(&path) != "mcpr" {
                continue;
            }
            let Ok(meta) = e.metadata() else { continue };
            if !meta.is_file() {
                continue;
            }
            let info = replay_meta(&path).unwrap_or(serde_json::Value::Null);
            out.push(Replay {
                path: native(&path),
                name: path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(),
                profile: id.clone(),
                profile_name: name.clone(),
                modified: modified(&meta),
                size: meta.len(),
                duration_ms: info["duration"].as_u64().unwrap_or(0),
                server: info["serverName"].as_str().unwrap_or_default().to_string(),
                mc_version: info["mcversion"].as_str().unwrap_or_default().to_string(),
            });
        }
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out
}

/// metaData.json inside a replay file (it is a zip).
fn replay_meta(path: &Path) -> Option<serde_json::Value> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(path).ok()?).ok()?;
    let f = zip.by_name("metaData.json").ok()?;
    let mut t = String::new();
    f.take(64 * 1024).read_to_string(&mut t).ok()?;
    serde_json::from_str(&t).ok()
}

/// Is this file inside one of the profiles' screenshots or replay folders? (Everything the window asks to show,
/// copy or delete is checked against this.)
pub fn allowed(paths: &Paths, path: &Path) -> bool {
    let Ok(file) = path.canonicalize() else { return false };
    folders(paths, "screenshots")
        .into_iter()
        .chain(folders(paths, "replay_recordings"))
        .any(|(_, _, dir)| dir.canonicalize().map(|d| file.starts_with(d)).unwrap_or(false))
}

pub fn delete(paths: &Paths, path: &str) -> Result<()> {
    let p = PathBuf::from(path);
    if !allowed(paths, &p) {
        bail!("That file isn't in a screenshots or replays folder");
    }
    std::fs::remove_file(&p)?;
    // ReplayMod keeps a cache folder next to a recording it has opened
    let cache = PathBuf::from(format!("{path}.cache"));
    if cache.is_dir() {
        let _ = std::fs::remove_dir_all(cache);
    }
    Ok(())
}

#[cfg(windows)]
fn powershell(script: &str, file: &str) -> Result<()> {
    use std::os::windows::process::CommandExt;
    let out = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-STA", "-Command", script])
        .env("CC_FILE", file) // the path goes in as a variable: no quoting problems
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output()?;
    if !out.status.success() {
        bail!("Windows said: {}", String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(())
}

/// Puts the picture itself on the clipboard (paste it into Discord, Paint, ...).
pub fn copy_image(paths: &Paths, path: &str) -> Result<()> {
    if !allowed(paths, Path::new(path)) {
        bail!("That file isn't in a screenshots folder");
    }
    #[cfg(windows)]
    {
        powershell(
            "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; \
             $i = [System.Drawing.Image]::FromFile($env:CC_FILE); [System.Windows.Forms.Clipboard]::SetImage($i); $i.Dispose()",
            path,
        )
    }
    #[cfg(not(windows))]
    {
        bail!("Copying pictures only works on Windows")
    }
}

/// Sharing: the file goes on the clipboard (Ctrl+V in Discord or a chat attaches it) and Explorer shows it, ready
/// to drag somewhere.
pub fn share(paths: &Paths, path: &str) -> Result<()> {
    if !allowed(paths, Path::new(path)) {
        bail!("That file isn't in a screenshots or replays folder");
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        powershell("Set-Clipboard -Path $env:CC_FILE", path)?;
        let _ = std::process::Command::new("explorer").raw_arg(format!("/select,\"{path}\"")).spawn();
        Ok(())
    }
    #[cfg(not(windows))]
    {
        bail!("Sharing only works on Windows")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_and_guards_files() {
        let root = std::env::temp_dir().join(format!("cc-gal-{}", uuid::Uuid::new_v4().simple()));
        let paths = Paths::new(root.clone());
        let ps = Profiles::load(&paths);
        ps.save(&paths).unwrap();
        let dir = store::game_dir(&paths, &ps.list[0]);
        std::fs::create_dir_all(dir.join("screenshots")).unwrap();
        std::fs::write(dir.join("screenshots/a.png"), b"x").unwrap();
        std::fs::write(dir.join("screenshots/notes.txt"), b"x").unwrap();
        std::fs::write(dir.join("options.txt"), b"x").unwrap();
        let shots = screenshots(&paths);
        assert_eq!(shots.len(), 1);
        assert!(allowed(&paths, Path::new(&shots[0].path)));
        assert!(!allowed(&paths, &dir.join("options.txt")));
        assert!(delete(&paths, &native(&dir.join("options.txt"))).is_err());
        delete(&paths, &shots[0].path).unwrap();
        assert!(screenshots(&paths).is_empty());
        let _ = std::fs::remove_dir_all(root);
    }
}
