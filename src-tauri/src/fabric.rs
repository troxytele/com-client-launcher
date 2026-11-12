//! Fabric Loader from Fabric's servers.

use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use std::path::PathBuf;

use crate::net::{self, Download};
use crate::paths::{maven_key, maven_path, Paths};
use crate::progress::Reporter;

const META: &str = "https://meta.fabricmc.net/v2";
/// Legacy Fabric (1.8.9 and other old versions): same format, its own server and maven.
const LEGACY_META: &str = "https://meta.legacyfabric.net/v2";

fn meta(mc: &str) -> &'static str {
    if crate::config::is_legacy(mc) { LEGACY_META } else { META }
}

pub struct Fabric {
    pub loader: String,
    pub main_class: String,
    pub libraries: Vec<(String, PathBuf)>,
    pub jvm_args: Vec<String>,
    pub game_args: Vec<String>,
}

/// Installs the newest stable Fabric Loader for this Minecraft version (or `pinned`).
pub async fn install(paths: &Paths, mc: &str, pinned: Option<&str>, rep: &Reporter) -> Result<Fabric> {
    rep.stage("Checking Fabric", 0, 0);
    let cache = paths.versions().join(format!("fabric-{mc}.json"));
    let profile: Value = match fetch_profile(mc, pinned).await {
        Ok(p) => {
            let _ = std::fs::create_dir_all(paths.versions());
            let _ = std::fs::write(&cache, serde_json::to_string(&p)?);
            p
        }
        Err(e) => {
            // offline: the last one we used
            let text = std::fs::read_to_string(&cache).map_err(|_| e)?;
            serde_json::from_str(&text)?
        }
    };
    let loader = profile["id"].as_str().unwrap_or_default().to_string();
    let main_class = profile["mainClass"].as_str().ok_or_else(|| anyhow!("Fabric sent no main class"))?.to_string();
    let mut files = Vec::new();
    let mut libraries = Vec::new();
    for lib in profile["libraries"].as_array().cloned().unwrap_or_default() {
        let name = lib["name"].as_str().unwrap_or_default();
        let Some(rel) = maven_path(name) else { continue };
        let fallback = if crate::config::is_legacy(mc) { "https://maven.legacyfabric.net/" } else { "https://maven.fabricmc.net/" };
        let base = lib["url"].as_str().unwrap_or(fallback);
        let base = if base.ends_with('/') { base.to_string() } else { format!("{base}/") };
        let path = paths.libraries().join(&rel);
        files.push(Download::new(format!("{base}{rel}"), &path, lib["sha1"].as_str().map(String::from), lib["size"].as_u64().unwrap_or(0)));
        libraries.push((maven_key(name), path));
    }
    net::fetch_all("Downloading Fabric", files, rep).await?;
    let strings = |v: &Value| -> Vec<String> {
        v.as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default()
    };
    Ok(Fabric {
        loader,
        main_class,
        libraries,
        jvm_args: strings(&profile["arguments"]["jvm"]),
        game_args: strings(&profile["arguments"]["game"]),
    })
}

async fn fetch_profile(mc: &str, pinned: Option<&str>) -> Result<Value> {
    let version = match pinned.filter(|p| !p.is_empty()) {
        Some(v) => v.to_string(),
        None => {
            let list: Value = net::get_json(&format!("{}/versions/loader/{mc}", meta(mc))).await.context("Couldn't reach Fabric")?;
            let arr = list.as_array().ok_or_else(|| anyhow!("Fabric doesn't support Minecraft {mc} yet"))?;
            arr.iter()
                .find(|e| e["loader"]["stable"].as_bool().unwrap_or(false))
                .or_else(|| arr.first())
                .and_then(|e| e["loader"]["version"].as_str())
                .ok_or_else(|| anyhow!("Fabric doesn't support Minecraft {mc} yet"))?
                .to_string()
        }
    };
    net::get_json(&format!("{}/versions/loader/{mc}/{version}/profile/json", meta(mc))).await
}
