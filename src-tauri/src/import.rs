//! Import game settings (options.txt: video settings, sensitivity, keybinds ...) and the server list from other
//! launchers' instances into a Com Client profile. Never mods.

use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone, Debug)]
pub struct Source {
    /// "Minecraft Launcher", "Modrinth App", "Prism Launcher", "CurseForge", "Lunar Client", "NoRisk Client" ...
    pub launcher: String,
    pub name: String,
    /// The game folder (where options.txt is).
    pub dir: String,
    pub modified: i64,
    pub servers: bool,
    pub keybinds: usize,
}

fn home() -> PathBuf {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from).unwrap_or_default()
}

fn appdata() -> PathBuf {
    std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| home().join(".config"))
}

fn modified(p: &Path) -> i64 {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Every folder below `root` (up to `depth` levels) that has an options.txt.
fn find(root: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if !root.is_dir() || out.len() > 80 {
        return;
    }
    if root.join("options.txt").is_file() {
        out.push(root.to_path_buf());
    }
    if depth == 0 {
        return;
    }
    if let Ok(rd) = std::fs::read_dir(root) {
        for e in rd.flatten() {
            let p = e.path();
            let n = e.file_name().to_string_lossy().to_lowercase();
            // big folders that never hold an instance
            if p.is_dir() && !matches!(n.as_str(), "mods" | "saves" | "assets" | "libraries" | "versions" | "logs" | "crash-reports"
                | "resourcepacks" | "shaderpacks" | "screenshots" | "cache" | "natives" | "jre" | "java" | "runtime")
            {
                find(&p, depth - 1, out);
            }
        }
    }
}

pub fn scan(own_root: &Path) -> Vec<Source> {
    let ad = appdata();
    let h = home();
    let roots: Vec<(&str, PathBuf, usize)> = vec![
        ("Minecraft Launcher", ad.join(".minecraft"), 0),
        ("Modrinth App", ad.join("ModrinthApp").join("profiles"), 1),
        ("Modrinth App", ad.join("com.modrinth.theseus").join("profiles"), 1),
        ("Prism Launcher", ad.join("PrismLauncher").join("instances"), 2),
        ("MultiMC", h.join("MultiMC").join("instances"), 2),
        ("CurseForge", h.join("curseforge").join("minecraft").join("Instances"), 1),
        ("Lunar Client", h.join(".lunarclient"), 4),
        ("NoRisk Client", ad.join("norisk"), 5),
        ("Feather", ad.join(".feather"), 4),
        ("Badlion", ad.join("Badlion Client"), 3),
        ("ATLauncher", ad.join("ATLauncher").join("instances"), 1),
        ("GDLauncher", ad.join("gdlauncher_carbon").join("data").join("instances"), 3),
    ];
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for (launcher, root, depth) in roots {
        let mut dirs = Vec::new();
        find(&root, depth, &mut dirs);
        for d in dirs {
            if d.starts_with(own_root) || !seen.insert(d.clone()) {
                continue;
            }
            let opts = d.join("options.txt");
            let text = std::fs::read_to_string(&opts).unwrap_or_default();
            // instance name: the folder above ".minecraft"/"minecraft", else the folder itself
            let named = if matches!(d.file_name().and_then(|n| n.to_str()), Some(".minecraft") | Some("minecraft")) && launcher != "Minecraft Launcher" {
                d.parent().unwrap_or(&d)
            } else {
                &d
            };
            out.push(Source {
                launcher: launcher.to_string(),
                name: named.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| launcher.to_string()),
                dir: d.to_string_lossy().to_string(),
                modified: modified(&opts),
                servers: d.join("servers.dat").is_file(),
                keybinds: text.lines().filter(|l| l.starts_with("key_")).count(),
            });
        }
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out
}

/// Settings that point at things only the other instance has: never copied.
fn skip(key: &str) -> bool {
    matches!(key, "version" | "resourcePacks" | "incompatibleResourcePacks" | "lastServer" | "tutorialStep" | "joinedFirstServer"
        | "skipMultiplayerWarning" | "onboardAccessibility")
}

/// Copies the chosen parts into `target` (the profile's game folder). Returns what was done.
pub fn apply(source: &str, target: &Path, settings: bool, keybinds: bool, servers: bool) -> anyhow::Result<String> {
    let src = PathBuf::from(source);
    let src_opts = std::fs::read_to_string(src.join("options.txt")).map_err(|_| anyhow::anyhow!("No options.txt in {}", src.display()))?;
    std::fs::create_dir_all(target)?;
    let target_opts = target.join("options.txt");
    let mut lines: Vec<(String, String)> = std::fs::read_to_string(&target_opts)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| l.split_once(':').map(|(k, v)| (k.to_string(), v.to_string())))
        .collect();
    let mut changed = 0;
    if settings || keybinds {
        for l in src_opts.lines() {
            let Some((k, v)) = l.split_once(':') else { continue };
            let is_key = k.starts_with("key_");
            if skip(k) || (is_key && !keybinds) || (!is_key && !settings) {
                continue;
            }
            match lines.iter_mut().find(|(kk, _)| kk == k) {
                Some(slot) => slot.1 = v.to_string(),
                None => lines.push((k.to_string(), v.to_string())),
            }
            changed += 1;
        }
        if target_opts.is_file() {
            let _ = std::fs::copy(&target_opts, target.join("options.txt.before-import"));
        }
        let text: String = lines.iter().map(|(k, v)| format!("{k}:{v}\n")).collect();
        std::fs::write(&target_opts, text)?;
    }
    let mut done = vec![];
    if changed > 0 {
        done.push(format!("{changed} settings"));
    }
    if servers && src.join("servers.dat").is_file() {
        if target.join("servers.dat").is_file() {
            let _ = std::fs::copy(target.join("servers.dat"), target.join("servers.dat.before-import"));
        }
        std::fs::copy(src.join("servers.dat"), target.join("servers.dat"))?;
        done.push("the server list".into());
    }
    if done.is_empty() {
        anyhow::bail!("Nothing to import");
    }
    Ok(format!("Imported {}", done.join(" and ")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_only_what_was_picked() {
        let base = std::env::temp_dir().join(format!("cc-import-{}", std::process::id()));
        let src = base.join("src");
        let dst = base.join("dst");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::create_dir_all(&dst).unwrap();
        std::fs::write(src.join("options.txt"), "version:3955\nrenderDistance:16\nmouseSensitivity:0.3\nkey_key.jump:key.keyboard.v\nresourcePacks:[\"file/x.zip\"]\n").unwrap();
        std::fs::write(src.join("servers.dat"), b"srv").unwrap();
        std::fs::write(dst.join("options.txt"), "version:4000\nrenderDistance:8\nkey_key.jump:key.keyboard.space\nfov:0.5\n").unwrap();

        // keybinds only
        let r = apply(src.to_str().unwrap(), &dst, false, true, false).unwrap();
        assert_eq!(r, "Imported 1 settings");
        let t = std::fs::read_to_string(dst.join("options.txt")).unwrap();
        assert!(t.contains("key_key.jump:key.keyboard.v"));
        assert!(t.contains("renderDistance:8")); // untouched
        assert!(t.contains("version:4000"));

        // settings + servers; version and resource packs are never copied, other lines stay
        let r = apply(src.to_str().unwrap(), &dst, true, false, true).unwrap();
        assert_eq!(r, "Imported 2 settings and the server list");
        let t = std::fs::read_to_string(dst.join("options.txt")).unwrap();
        assert!(t.contains("renderDistance:16") && t.contains("mouseSensitivity:0.3") && t.contains("fov:0.5"));
        assert!(t.contains("version:4000") && !t.contains("resourcePacks"));
        assert_eq!(std::fs::read(dst.join("servers.dat")).unwrap(), b"srv");
        assert!(dst.join("options.txt.before-import").is_file());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn finds_instances() {
        let base = std::env::temp_dir().join(format!("cc-scan-{}", std::process::id()));
        let inst = base.join("instances").join("PvP").join(".minecraft");
        std::fs::create_dir_all(inst.join("mods")).unwrap();
        std::fs::write(inst.join("options.txt"), "key_key.attack:key.mouse.left\n").unwrap();
        let mut out = Vec::new();
        find(&base.join("instances"), 2, &mut out);
        assert_eq!(out, vec![inst]);
        let _ = std::fs::remove_dir_all(&base);
    }
}
