//! Crash reports and logs of all profiles, for the Crashes page (the analysis itself happens in the UI).

use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::paths::Paths;
use crate::store::{self, Profiles};

#[derive(Serialize, Clone, Debug)]
pub struct CrashFile {
    pub path: String,
    pub name: String,
    pub profile: String,
    /// "crash" (crash-reports/), "jvm" (hs_err_pid*.log: Java itself crashed) or "log" (logs/latest.log).
    pub kind: String,
    pub modified: i64,
    pub size: u64,
}

fn modified(p: &Path) -> i64 {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn push(out: &mut Vec<CrashFile>, p: PathBuf, profile: &str, kind: &str) {
    let size = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
    out.push(CrashFile {
        name: p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        path: p.to_string_lossy().to_string(),
        profile: profile.to_string(),
        kind: kind.to_string(),
        modified: modified(&p),
        size,
    });
}

/// Newest first, at most 60.
pub fn list(paths: &Paths) -> Vec<CrashFile> {
    let mut out = Vec::new();
    for prof in Profiles::load(paths).list {
        let dir = store::game_dir(paths, &prof);
        if let Ok(rd) = std::fs::read_dir(dir.join("crash-reports")) {
            for e in rd.flatten() {
                if e.path().extension().is_some_and(|x| x == "txt") {
                    push(&mut out, e.path(), &prof.name, "crash");
                }
            }
        }
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().to_string();
                if n.starts_with("hs_err_pid") && n.ends_with(".log") {
                    push(&mut out, e.path(), &prof.name, "jvm");
                }
            }
        }
        let latest = dir.join("logs").join("latest.log");
        if latest.is_file() {
            push(&mut out, latest, &prof.name, "log");
        }
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out.truncate(60);
    out
}

/// A crash file's text (only files `list` would show; the last 1.5 MB of big logs).
pub fn read(paths: &Paths, path: &str) -> anyhow::Result<String> {
    if !list(paths).iter().any(|c| c.path == path) {
        anyhow::bail!("That file isn't one of the crash reports");
    }
    let bytes = std::fs::read(path)?;
    const MAX: usize = 1_500_000;
    let slice = if bytes.len() > MAX { &bytes[bytes.len() - MAX..] } else { &bytes[..] };
    Ok(String::from_utf8_lossy(slice).to_string())
}
