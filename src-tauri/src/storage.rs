//! The Storage page: how much space each profile (its worlds, mods, packs, screenshots, logs ...) and the shared
//! game files take, and cleaning up what isn't needed (old logs, crash reports, Minecraft versions no profile uses).

use crate::paths::Paths;
use crate::store::{self, Profiles};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone, Debug)]
pub struct Part {
    pub key: String,
    pub label: String,
    pub bytes: u64,
    /// a folder to open ("" when there's nothing to open)
    pub path: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct World {
    pub name: String,
    pub bytes: u64,
    pub path: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct ProfileUse {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub version: String,
    pub bytes: u64,
    pub path: String,
    pub parts: Vec<Part>,
    pub worlds: Vec<World>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Cleanup {
    /// "logs", "crash", "versions", "cache"
    pub key: String,
    pub label: String,
    pub detail: String,
    pub bytes: u64,
    pub files: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct Report {
    pub total: u64,
    pub profiles: Vec<ProfileUse>,
    pub shared: Vec<Part>,
    pub cleanups: Vec<Cleanup>,
    /// free space on the drive the launcher is on (0 when unknown)
    pub free: u64,
}

/// Size of a file or a whole folder (links are not followed).
pub fn size(p: &Path) -> u64 {
    let Ok(m) = std::fs::symlink_metadata(p) else { return 0 };
    if m.is_file() {
        return m.len();
    }
    if !m.is_dir() {
        return 0;
    }
    std::fs::read_dir(p).map(|rd| rd.flatten().map(|e| size(&e.path())).sum()).unwrap_or(0)
}

fn native(p: &Path) -> String {
    crate::paths::native(p)
}

/// Files in a game folder's logs folder that can go: everything except the log of the game that's running now.
fn old_logs(game: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(game.join("logs"))
        .map(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .filter(|p| p.is_file() && p.file_name().is_some_and(|n| n != "latest.log" && n != "debug.log"))
                .collect()
        })
        .unwrap_or_default()
}

fn crash_reports(game: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(game.join("crash-reports")).map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.is_file()).collect()).unwrap_or_default();
    // the JVM's own crash logs in the game folder too
    if let Ok(rd) = std::fs::read_dir(game) {
        v.extend(rd.flatten().map(|e| e.path()).filter(|p| {
            p.is_file() && p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("hs_err_pid") && n.ends_with(".log"))
        }));
    }
    v
}

/// The Minecraft versions (and Fabric versions for them) that a profile still uses.
fn used_versions(paths: &Paths) -> Vec<String> {
    let mut v: Vec<String> = Profiles::load(paths).list.iter().map(crate::config::profile_mc).collect();
    v.push(crate::config::MC_VERSION.to_string());
    v.sort();
    v.dedup();
    v
}

/// Folders in versions/ that no profile needs any more ("1.21.10", "fabric-loader-0.16.9-1.21.10" ...).
fn unused_versions(paths: &Paths) -> Vec<PathBuf> {
    let used = used_versions(paths);
    std::fs::read_dir(paths.versions())
        .map(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .filter(|p| {
                    let n = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                    !used.iter().any(|mc| n == *mc || n.ends_with(&format!("-{mc}")) || n.ends_with(&format!("_{mc}")))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn sum(list: &[PathBuf]) -> u64 {
    list.iter().map(|p| size(p)).sum()
}

fn free_space(p: &Path) -> u64 {
    use sysinfo::Disks;
    let disks = Disks::new_with_refreshed_list();
    let p = std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    disks
        .list()
        .iter()
        .filter(|d| p.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len())
        .map(|d| d.available_space())
        .unwrap_or(0)
}

pub fn report(paths: &Paths) -> Report {
    let profiles = Profiles::load(paths).list;
    let mut out = Vec::new();
    let mut all_logs = Vec::new();
    let mut all_crash = Vec::new();
    for p in &profiles {
        let game = store::game_dir(paths, p);
        let mut parts = Vec::new();
        let mut counted = 0u64;
        for (key, label, sub) in [
            ("worlds", "Worlds", "saves"),
            ("mods", "Mods", "mods"),
            ("resourcepacks", "Resource packs", "resourcepacks"),
            ("shaderpacks", "Shaders", "shaderpacks"),
            ("screenshots", "Screenshots", "screenshots"),
            ("replays", "Replays", "replay_recordings"),
            ("logs", "Logs", "logs"),
            ("crash", "Crash reports", "crash-reports"),
        ] {
            let dir = game.join(sub);
            let b = size(&dir);
            counted += b;
            if b > 0 {
                parts.push(Part { key: key.into(), label: label.into(), bytes: b, path: native(&dir) });
            }
        }
        let total = size(&game);
        if total > counted {
            parts.push(Part { key: "other".into(), label: "Settings and other files".into(), bytes: total - counted, path: native(&game) });
        }
        parts.sort_by(|a, b| b.bytes.cmp(&a.bytes));
        let mut worlds: Vec<World> = std::fs::read_dir(game.join("saves"))
            .map(|rd| {
                rd.flatten()
                    .map(|e| e.path())
                    .filter(|w| w.join("level.dat").is_file())
                    .map(|w| World { name: w.file_name().unwrap_or_default().to_string_lossy().to_string(), bytes: size(&w), path: native(&w) })
                    .collect()
            })
            .unwrap_or_default();
        worlds.sort_by(|a, b| b.bytes.cmp(&a.bytes));
        all_logs.extend(old_logs(&game));
        all_crash.extend(crash_reports(&game));
        out.push(ProfileUse {
            id: p.id.clone(),
            name: p.name.clone(),
            icon: p.icon.clone(),
            version: crate::config::profile_mc(p),
            bytes: total,
            path: native(&game),
            parts,
            worlds,
        });
    }
    out.sort_by(|a, b| b.bytes.cmp(&a.bytes));

    let shared: Vec<Part> = [
        ("versions", "Minecraft versions", paths.versions()),
        ("libraries", "Libraries", paths.libraries()),
        ("assets", "Sounds and languages", paths.assets()),
        ("runtime", "Java", paths.runtime()),
        ("client", "Com Client and Fabric API", paths.client()),
        ("cache", "Launcher cache", paths.root.join("cache")),
    ]
    .into_iter()
    .map(|(k, l, p)| Part { key: k.into(), label: l.into(), bytes: size(&p), path: native(&p) })
    .filter(|p| p.bytes > 0)
    .collect();

    let unused = unused_versions(paths);
    let cache_files = cache_junk(paths);
    let mut cleanups = vec![
        Cleanup {
            key: "logs".into(),
            label: "Old game logs".into(),
            detail: "Logs of earlier games in every profile (the newest one stays)".into(),
            bytes: sum(&all_logs),
            files: all_logs.len() as u64,
        },
        Cleanup {
            key: "crash".into(),
            label: "Crash reports".into(),
            detail: "Saved crash reports of every profile".into(),
            bytes: sum(&all_crash),
            files: all_crash.len() as u64,
        },
        Cleanup {
            key: "versions".into(),
            label: "Unused Minecraft versions".into(),
            detail: if unused.is_empty() {
                "Every downloaded version is used by a profile".into()
            } else {
                unused.iter().map(|p| p.file_name().unwrap_or_default().to_string_lossy().to_string()).collect::<Vec<_>>().join(", ")
            },
            bytes: sum(&unused),
            files: unused.len() as u64,
        },
        Cleanup {
            key: "cache".into(),
            label: "Launcher cache".into(),
            detail: "Downloaded pictures and lists (they come back when needed)".into(),
            bytes: sum(&cache_files),
            files: cache_files.len() as u64,
        },
    ];
    cleanups.retain(|c| c.bytes > 0 || c.key == "versions");
    let total = out.iter().map(|p| p.bytes).sum::<u64>() + shared.iter().map(|p| p.bytes).sum::<u64>();
    Report { total, profiles: out, shared, cleanups, free: free_space(&paths.root) }
}

/// Cache files that are safe to delete (not the list of checked files, which makes starting fast).
fn cache_junk(paths: &Paths) -> Vec<PathBuf> {
    std::fs::read_dir(paths.root.join("cache"))
        .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.file_name().is_some_and(|n| n != "checked.json")).collect())
        .unwrap_or_default()
}

/// Deletes one kind of clutter. Returns the bytes freed.
pub fn clean(paths: &Paths, key: &str) -> anyhow::Result<u64> {
    let list: Vec<PathBuf> = match key {
        "logs" => Profiles::load(paths).list.iter().flat_map(|p| old_logs(&store::game_dir(paths, p))).collect(),
        "crash" => Profiles::load(paths).list.iter().flat_map(|p| crash_reports(&store::game_dir(paths, p))).collect(),
        "versions" => unused_versions(paths),
        "cache" => cache_junk(paths),
        _ => anyhow::bail!("Unknown clean-up"),
    };
    let mut freed = 0;
    for p in list {
        let b = size(&p);
        let ok = if p.is_dir() { std::fs::remove_dir_all(&p).is_ok() } else { std::fs::remove_file(&p).is_ok() };
        if ok {
            freed += b;
        }
    }
    if key == "versions" {
        // the next start checks the files again instead of trusting the old list
        let _ = std::fs::remove_file(paths.root.join("cache").join("checked.json"));
    }
    Ok(freed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measures_and_cleans() {
        let root = std::env::temp_dir().join(format!("cc-storage-{}", std::process::id()));
        let paths = Paths::new(root.clone());
        let mut ps = Profiles::load(&paths);
        ps.save(&paths).unwrap();
        ps = Profiles::load(&paths);
        let p = ps.list[0].clone();
        let game = store::game_dir(&paths, &p);
        std::fs::create_dir_all(game.join("saves").join("World A")).unwrap();
        std::fs::write(game.join("saves").join("World A").join("level.dat"), vec![0u8; 1000]).unwrap();
        std::fs::create_dir_all(game.join("logs")).unwrap();
        std::fs::write(game.join("logs").join("latest.log"), vec![0u8; 10]).unwrap();
        std::fs::write(game.join("logs").join("2026-01-01-1.log.gz"), vec![0u8; 300]).unwrap();
        std::fs::create_dir_all(game.join("crash-reports")).unwrap();
        std::fs::write(game.join("crash-reports").join("crash.txt"), vec![0u8; 50]).unwrap();
        std::fs::write(game.join("hs_err_pid42.log"), vec![0u8; 20]).unwrap();
        std::fs::create_dir_all(paths.versions().join("1.20.1")).unwrap();
        std::fs::write(paths.versions().join("1.20.1").join("1.20.1.jar"), vec![0u8; 5000]).unwrap();
        std::fs::create_dir_all(paths.versions().join(crate::config::MC_VERSION)).unwrap();
        std::fs::write(paths.versions().join(crate::config::MC_VERSION).join("x.jar"), vec![0u8; 700]).unwrap();
        let fab = format!("fabric-loader-0.16.9-{}", crate::config::MC_VERSION);
        std::fs::create_dir_all(paths.versions().join(&fab)).unwrap();

        let r = report(&paths);
        let pu = &r.profiles[0];
        assert_eq!(pu.worlds.len(), 1);
        assert_eq!(pu.worlds[0].bytes, 1000);
        assert!(pu.parts.iter().any(|x| x.key == "worlds" && x.bytes == 1000));
        let c = |k: &str| r.cleanups.iter().find(|c| c.key == k).cloned().unwrap();
        assert_eq!(c("logs").bytes, 300);
        assert_eq!(c("crash").bytes, 70);
        assert_eq!(c("versions").bytes, 5000);
        assert!(c("versions").detail.contains("1.20.1"));

        assert_eq!(clean(&paths, "logs").unwrap(), 300);
        assert!(game.join("logs").join("latest.log").is_file(), "the newest log stays");
        assert_eq!(clean(&paths, "versions").unwrap(), 5000);
        assert!(paths.versions().join(crate::config::MC_VERSION).is_dir() && paths.versions().join(&fab).is_dir(), "used versions stay");
        assert_eq!(clean(&paths, "crash").unwrap(), 70);
        assert!(clean(&paths, "nope").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
