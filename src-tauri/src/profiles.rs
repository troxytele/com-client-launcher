//! Profile extras: block/item icons from the game jar, duplicate, export and import.

use anyhow::{anyhow, Context, Result};
use base64::Engine;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::net::{self, Download};
use crate::paths::Paths;
use crate::store::{self, Profile, Profiles};

/// The vanilla game jar (downloaded on its own if the game was never started).
pub async fn client_jar(paths: &Paths, id: &str) -> Result<PathBuf> {
    let jar = paths.versions().join(id).join(format!("{id}.jar"));
    if jar.exists() {
        return Ok(jar);
    }
    let json = crate::minecraft::version_json(paths, id).await?;
    let c = &json["downloads"]["client"];
    let d = Download::new(c["url"].as_str().unwrap_or_default(), &jar, c["sha1"].as_str().map(String::from), c["size"].as_u64().unwrap_or(0));
    net::fetch(&d, None).await?;
    Ok(jar)
}

/// Every "item:name" / "block:name" texture in the game, sorted (items first).
pub fn icon_names(jar: &Path) -> Result<Vec<String>> {
    let zip = zip::ZipArchive::new(std::fs::File::open(jar)?)?;
    let mut out: Vec<String> = Vec::new();
    for name in zip.file_names() {
        for (prefix, kind) in [("assets/minecraft/textures/item/", "item"), ("assets/minecraft/textures/block/", "block")] {
            if let Some(rest) = name.strip_prefix(prefix) {
                if let Some(n) = rest.strip_suffix(".png") {
                    if !n.contains('/') {
                        out.push(format!("{kind}:{n}"));
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| (a.starts_with("block:"), a).cmp(&(b.starts_with("block:"), b)));
    Ok(out)
}

/// "item:apple" -> data:image/png;base64,... for each name that exists.
pub fn icons(jar: &Path, names: &[String]) -> Result<HashMap<String, String>> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(jar)?)?;
    let mut out = HashMap::new();
    for n in names.iter().take(400) {
        let Some((kind, name)) = n.split_once(':') else { continue };
        if !(kind == "item" || kind == "block") || name.contains(['/', '\\', '.']) {
            continue;
        }
        let Ok(mut f) = zip.by_name(&format!("assets/minecraft/textures/{kind}/{name}.png")) else { continue };
        let mut buf = Vec::new();
        if f.read_to_end(&mut buf).is_ok() {
            out.insert(n.clone(), format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(&buf)));
        }
    }
    Ok(out)
}

/// A picture the player picked, as a data URL (kept small).
pub fn upload_icon(file: &Path) -> Result<String> {
    let bytes = std::fs::read(file)?;
    if bytes.len() > 1_500_000 {
        return Err(anyhow!("That picture is too big (max 1.5 MB)"));
    }
    let mime = match file.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        _ => return Err(anyhow!("Pick a PNG, JPG, GIF or WebP picture")),
    };
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes)))
}

/// What goes into a copy / export (worlds, logs and screenshots stay behind).
const KEEP: &[&str] = &["options.txt", "servers.dat", "config", "mods", "resourcepacks", "shaderpacks", "optionsof.txt", "optionsshaders.txt"];

fn copy_dir(from: &Path, to: &Path) -> Result<()> {
    if from.is_file() {
        if let Some(p) = to.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::copy(from, to)?;
        return Ok(());
    }
    std::fs::create_dir_all(to)?;
    for e in std::fs::read_dir(from)? {
        let e = e?;
        copy_dir(&e.path(), &to.join(e.file_name()))?;
    }
    Ok(())
}

fn new_id() -> String {
    format!("p{}", &uuid::Uuid::new_v4().simple().to_string()[..8])
}

fn fresh(mut p: Profile, name: String) -> Profile {
    p.id = new_id();
    p.name = name;
    p.game_dir = String::new();
    p.created = crate::auth::now();
    p.last_played = 0;
    p.playtime_secs = 0;
    p.sessions.clear();
    p
}

pub fn duplicate(paths: &Paths, id: &str) -> Result<Vec<Profile>> {
    let mut ps = Profiles::load(paths);
    let src = ps.list.iter().find(|p| p.id == id).cloned().ok_or_else(|| anyhow!("That profile doesn't exist"))?;
    let from = store::game_dir(paths, &src);
    let copy = fresh(src.clone(), format!("{} copy", src.name));
    let to = store::game_dir(paths, &copy);
    for k in KEEP {
        let f = from.join(k);
        if f.exists() {
            copy_dir(&f, &to.join(k)).with_context(|| format!("Couldn't copy {k}"))?;
        }
    }
    ps.list.push(copy);
    ps.save(paths)?;
    Ok(ps.list)
}

fn add_dir(zip: &mut zip::ZipWriter<std::fs::File>, base: &Path, path: &Path) -> Result<()> {
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let rel = path.strip_prefix(base)?.to_string_lossy().replace('\\', "/");
    if path.is_dir() {
        for e in std::fs::read_dir(path)? {
            add_dir(zip, base, &e?.path())?;
        }
    } else {
        zip.start_file(format!("files/{rel}"), opts)?;
        let mut f = std::fs::File::open(path)?;
        std::io::copy(&mut f, zip)?;
    }
    Ok(())
}

/// A .ccprofile file: profile.json + the profile's settings, mods and packs.
pub fn export(paths: &Paths, id: &str, dest: &Path) -> Result<()> {
    let p = Profiles::load(paths).list.into_iter().find(|p| p.id == id).ok_or_else(|| anyhow!("That profile doesn't exist"))?;
    let dir = store::game_dir(paths, &p);
    let mut zip = zip::ZipWriter::new(std::fs::File::create(dest)?);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut meta = p.clone();
    meta.game_dir = String::new();
    meta.sessions.clear();
    zip.start_file("profile.json", opts)?;
    zip.write_all(serde_json::to_string_pretty(&meta)?.as_bytes())?;
    for k in KEEP {
        let f = dir.join(k);
        if f.exists() {
            add_dir(&mut zip, &dir, &f)?;
        }
    }
    zip.finish()?;
    Ok(())
}

pub fn import(paths: &Paths, file: &Path) -> Result<Vec<Profile>> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(file)?).context("That isn't a Com Client profile file")?;
    let meta: Profile = {
        let mut f = zip.by_name("profile.json").map_err(|_| anyhow!("That isn't a Com Client profile file"))?;
        let mut t = String::new();
        f.read_to_string(&mut t)?;
        serde_json::from_str(&t)?
    };
    let name = meta.name.clone();
    let mut p = fresh(meta, name);
    p.ram_mb = p.ram_mb.clamp(1024, store::total_ram_mb().max(2048));
    let dir = store::game_dir(paths, &p);
    for i in 0..zip.len() {
        let mut f = zip.by_index(i)?;
        let Some(rel) = f.enclosed_name() else { continue };
        let Ok(rel) = rel.strip_prefix("files") else { continue };
        if f.is_dir() || rel.as_os_str().is_empty() {
            continue;
        }
        let out = dir.join(rel);
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut w = std::fs::File::create(&out)?;
        std::io::copy(&mut f, &mut w)?;
    }
    let mut ps = Profiles::load(paths);
    ps.list.push(p);
    ps.save(paths)?;
    Ok(ps.list)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_then_import() {
        let root = std::env::temp_dir().join(format!("cc-prof-{}", uuid::Uuid::new_v4().simple()));
        let paths = Paths::new(root.clone());
        let ps = Profiles::load(&paths);
        ps.save(&paths).unwrap();
        let dir = store::game_dir(&paths, &ps.list[0]);
        std::fs::create_dir_all(dir.join("config/comclient")).unwrap();
        std::fs::write(dir.join("options.txt"), "fov:90").unwrap();
        std::fs::write(dir.join("config/comclient/client.json"), "{}").unwrap();
        std::fs::create_dir_all(dir.join("saves/w")).unwrap();
        let file = root.join("x.ccprofile");
        export(&paths, "default", &file).unwrap();
        let list = import(&paths, &file).unwrap();
        assert_eq!(list.len(), 2);
        let d2 = store::game_dir(&paths, &list[1]);
        assert_eq!(std::fs::read_to_string(d2.join("options.txt")).unwrap(), "fov:90");
        assert!(d2.join("config/comclient/client.json").exists());
        assert!(!d2.join("saves").exists());
        let list = duplicate(&paths, &list[1].id).unwrap();
        assert_eq!(list.len(), 3);
        assert!(store::game_dir(&paths, &list[2]).join("options.txt").exists());
        let _ = std::fs::remove_dir_all(root);
    }
}
