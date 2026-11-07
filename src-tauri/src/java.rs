//! The Java that Minecraft needs, from Mojang's own runtime downloads (players don't install Java).

use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use std::path::PathBuf;

use crate::net::{self, Download};
use crate::paths::Paths;
use crate::progress::Reporter;

const RUNTIMES: &str =
    "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";

fn platform() -> &'static str {
    if cfg!(windows) {
        if cfg!(target_arch = "aarch64") { "windows-arm64" } else if cfg!(target_arch = "x86") { "windows-x86" } else { "windows-x64" }
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") { "mac-os-arm64" } else { "mac-os" }
    } else {
        "linux"
    }
}

fn java_exe(home: &PathBuf) -> PathBuf {
    if cfg!(windows) {
        home.join("bin").join("javaw.exe")
    } else if cfg!(target_os = "macos") {
        home.join("jre.bundle").join("Contents").join("Home").join("bin").join("java")
    } else {
        home.join("bin").join("java")
    }
}

/// Makes sure the runtime `component` (e.g. "java-runtime-delta") is installed and returns its java(w) executable.
pub async fn ensure(paths: &Paths, component: &str, rep: &Reporter) -> Result<PathBuf> {
    let home = paths.runtime().join(component);
    let marker = home.join(".installed");
    rep.stage("Checking Java", 0, 0);
    let all: Result<Value> = net::get_json(RUNTIMES).await;
    let all = match all {
        Ok(v) => v,
        Err(e) => {
            // offline: use the installed one if it is there
            if marker.exists() && java_exe(&home).exists() {
                return Ok(java_exe(&home));
            }
            return Err(e).context("Couldn't get Java from Mojang");
        }
    };
    let entry = all[platform()][component]
        .as_array()
        .and_then(|a| a.first())
        .ok_or_else(|| anyhow!("Mojang has no Java '{component}' for this computer"))?;
    let manifest_url = entry["manifest"]["url"].as_str().unwrap_or_default();
    let manifest_sha = entry["manifest"]["sha1"].as_str().unwrap_or_default().to_string();
    if marker.exists() && std::fs::read_to_string(&marker).unwrap_or_default().trim() == manifest_sha && java_exe(&home).exists() {
        return Ok(java_exe(&home));
    }
    let manifest: Value = net::get_json(manifest_url).await?;
    let mut files = Vec::new();
    #[cfg(unix)]
    let mut links: Vec<(PathBuf, String)> = Vec::new();
    if let Some(map) = manifest["files"].as_object() {
        for (rel, f) in map {
            let path = home.join(rel);
            match f["type"].as_str() {
                Some("directory") => {
                    std::fs::create_dir_all(&path)?;
                }
                Some("file") => {
                    let raw = &f["downloads"]["raw"];
                    let mut d = Download::new(raw["url"].as_str().unwrap_or_default(), &path, raw["sha1"].as_str().map(String::from),
                        raw["size"].as_u64().unwrap_or(0));
                    d.executable = f["executable"].as_bool().unwrap_or(false);
                    files.push(d);
                }
                #[cfg(unix)]
                Some("link") => links.push((path, f["target"].as_str().unwrap_or_default().to_string())),
                _ => {}
            }
        }
    }
    net::fetch_all("Downloading Java", files, rep).await?;
    #[cfg(unix)]
    for (path, target) in links {
        let _ = std::fs::remove_file(&path);
        let _ = std::os::unix::fs::symlink(target, &path);
    }
    std::fs::write(&marker, manifest_sha)?;
    Ok(java_exe(&home))
}
