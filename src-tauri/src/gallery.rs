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

/// Every Com Client clip (the Clips module's videos, .avi) of every profile, newest first. Same fields as a screenshot.
pub fn clips(paths: &Paths) -> Vec<Shot> {
    let mut out = Vec::new();
    for (id, name, dir) in folders(paths, "comclient/clips") {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let path = e.path();
            if ext(&path) != "avi" {
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
        .chain(folders(paths, "comclient/clips"))
        .any(|(_, _, dir)| dir.canonicalize().map(|d| file.starts_with(d)).unwrap_or(false))
}

/// Saves an edited screenshot (a PNG from the editor) next to the original as "<name>-edited.png" (or -edited-2 ...),
/// so the original stays. Returns the new file's path.
pub fn save_edited(paths: &Paths, original: &str, png_b64: &str) -> Result<String> {
    use base64::Engine;
    let orig = PathBuf::from(original);
    if !allowed(paths, &orig) {
        bail!("That file isn't in a screenshots folder");
    }
    let b64 = png_b64.split_once("base64,").map(|(_, b)| b).unwrap_or(png_b64);
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64.trim())?;
    // it has to be a real picture (and not something else saved into the screenshots folder)
    let img = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png).map_err(|_| anyhow::anyhow!("The edited picture is broken"))?;
    if img.width() == 0 || img.height() == 0 || img.width() > 16384 || img.height() > 16384 {
        bail!("The edited picture is broken");
    }
    let dir = orig.parent().ok_or_else(|| anyhow::anyhow!("No folder"))?;
    let stem = orig.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "screenshot".into());
    let stem = stem.split("-edited").next().unwrap_or(&stem).to_string();
    let mut n = 1;
    let out = loop {
        let name = if n == 1 { format!("{stem}-edited.png") } else { format!("{stem}-edited-{n}.png") };
        let p = dir.join(name);
        if !p.exists() {
            break p;
        }
        n += 1;
    };
    std::fs::write(&out, &bytes)?;
    Ok(native(&out))
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
        // an edit is saved next to it, the original stays
        let mut png = Vec::new();
        image::DynamicImage::new_rgba8(4, 3).write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).unwrap();
        use base64::Engine;
        let b = base64::engine::general_purpose::STANDARD.encode(&png);
        std::fs::write(dir.join("screenshots/a.png"), &png).unwrap();
        let e1 = save_edited(&paths, &shots[0].path, &format!("data:image/png;base64,{b}")).unwrap();
        let e2 = save_edited(&paths, &e1, &b).unwrap();
        assert!(e1.ends_with("a-edited.png") && e2.ends_with("a-edited-2.png"), "{e1} {e2}");
        assert!(save_edited(&paths, &shots[0].path, "bm90IGEgcGljdHVyZQ==").is_err());
        assert!(save_edited(&paths, &native(&dir.join("options.txt")), &b).is_err());
        assert_eq!(screenshots(&paths).len(), 3);
        delete(&paths, &e1).unwrap();
        delete(&paths, &e2).unwrap();
        delete(&paths, &shots[0].path).unwrap();
        assert!(screenshots(&paths).is_empty());
        let _ = std::fs::remove_dir_all(root);
    }
}

/// A screenshot made small enough to share as a link: at most 1920x1080, JPEG, under 1.15 MB.
pub fn link_jpeg(paths: &Paths, path: &str) -> Result<Vec<u8>> {
    if !allowed(paths, Path::new(path)) {
        bail!("That file isn't in a screenshots folder");
    }
    let img = image::open(path).map_err(|e| anyhow::anyhow!("Couldn't read the picture ({e})"))?;
    let mut img = img.to_rgb8();
    if img.width() > 1920 || img.height() > 1080 {
        let s = (1920.0 / img.width() as f64).min(1080.0 / img.height() as f64);
        let (w, h) = (((img.width() as f64 * s).round() as u32).max(1), ((img.height() as f64 * s).round() as u32).max(1));
        img = image::imageops::resize(&img, w, h, image::imageops::FilterType::Triangle);
    }
    let encode = |img: &image::RgbImage, q: u8| -> Result<Vec<u8>> {
        let mut out = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, q).encode_image(img)?;
        Ok(out)
    };
    for q in [90u8, 82, 72, 60, 45] {
        let jpg = encode(&img, q)?;
        if jpg.len() <= 1_150_000 {
            return Ok(jpg);
        }
    }
    let small = image::imageops::resize(&img, img.width() * 2 / 3, img.height() * 2 / 3, image::imageops::FilterType::Triangle);
    encode(&small, 70)
}
