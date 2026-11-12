//! Vanilla Minecraft from Mojang: version file, game jar, libraries, assets, log config.

use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;

use crate::net::{self, Download};
use crate::paths::{os_name, Paths};
use crate::progress::Reporter;

const MANIFEST: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const RESOURCES: &str = "https://resources.download.minecraft.net";

/// The parsed version file plus where things went.
pub struct Vanilla {
    pub id: String,
    pub json: Value,
    pub client_jar: PathBuf,
    /// Library jars for the classpath, keyed by maven key (so Fabric can replace them).
    pub libraries: Vec<(String, PathBuf)>,
    pub assets_index: String,
    pub log_config: Option<(PathBuf, String)>,
}

/// Does a rules list allow this on our computer? (features: has_custom_resolution ...)
pub fn rules_allow(rules: Option<&Value>, features: &HashMap<&str, bool>) -> bool {
    let Some(rules) = rules.and_then(|r| r.as_array()) else { return true };
    let mut allowed = false;
    for rule in rules {
        let mut matches = true;
        if let Some(os) = rule.get("os") {
            if let Some(name) = os.get("name").and_then(|v| v.as_str()) {
                matches &= name == os_name();
            }
            if let Some(arch) = os.get("arch").and_then(|v| v.as_str()) {
                let ours = if cfg!(target_arch = "x86") { "x86" } else if cfg!(target_arch = "aarch64") { "arm64" } else { "x86_64" };
                matches &= arch == ours;
            }
        }
        if let Some(f) = rule.get("features").and_then(|v| v.as_object()) {
            for (k, v) in f {
                matches &= features.get(k.as_str()).copied().unwrap_or(false) == v.as_bool().unwrap_or(false);
            }
        }
        if matches {
            allowed = rule.get("action").and_then(|v| v.as_str()) == Some("allow");
        }
    }
    allowed
}

/// The version file of `id` (downloaded once, then kept; checked against Mojang's hash).
pub async fn version_json(paths: &Paths, id: &str) -> Result<Value> {
    let path = paths.versions().join(id).join(format!("{id}.json"));
    let manifest: Result<Value> = net::get_json(MANIFEST).await;
    match manifest {
        Ok(m) => {
            let entry = m["versions"]
                .as_array()
                .and_then(|v| v.iter().find(|e| e["id"] == id))
                .ok_or_else(|| anyhow!("Minecraft {id} isn't in Mojang's version list"))?;
            let d = Download::new(entry["url"].as_str().unwrap_or_default(), &path, entry["sha1"].as_str().map(String::from), 0);
            if !net::is_valid(&d) {
                net::fetch(&d, None).await?;
            }
        }
        Err(e) if !path.exists() => return Err(e).context("Couldn't reach Mojang to get Minecraft"),
        Err(_) => {} // offline but installed: use what we have
    }
    let text = std::fs::read_to_string(&path)?;
    Ok(serde_json::from_str(&text)?)
}

/// Downloads everything vanilla needs. Offline with everything already there works too.
pub async fn install(paths: &Paths, id: &str, rep: &Reporter) -> Result<Vanilla> {
    rep.stage("Checking Minecraft", 0, 0);
    let json = version_json(paths, id).await?;
    let features = HashMap::new();

    // game jar
    let client = &json["downloads"]["client"];
    let client_jar = paths.versions().join(id).join(format!("{id}.jar"));
    let mut files = vec![Download::new(
        client["url"].as_str().unwrap_or_default(),
        &client_jar,
        client["sha1"].as_str().map(String::from),
        client["size"].as_u64().unwrap_or(0),
    )];

    // libraries
    let mut libraries = Vec::new();
    for lib in json["libraries"].as_array().cloned().unwrap_or_default() {
        if !rules_allow(lib.get("rules"), &features) {
            continue;
        }
        let name = lib["name"].as_str().unwrap_or_default();
        if let Some(a) = lib["downloads"].get("artifact") {
            let path = paths.libraries().join(a["path"].as_str().unwrap_or_default());
            files.push(Download::new(a["url"].as_str().unwrap_or_default(), &path, a["sha1"].as_str().map(String::from),
                a["size"].as_u64().unwrap_or(0)));
            libraries.push((crate::paths::maven_key(name), path));
        }
        // old style natives (1.8.9's LWJGL 2; unpacked at launch)
        if let Some(cls) = lib.get("natives").and_then(|n| n.get(os_name())).and_then(|c| c.as_str()) {
            // old versions: "natives-windows", some with the bitness in it ("natives-windows-${arch}")
            let cls = cls.replace("${arch}", if cfg!(target_pointer_width = "32") { "32" } else { "64" });
            let cls = cls.as_str();
            if let Some(n) = lib["downloads"]["classifiers"].get(cls) {
                let path = paths.libraries().join(n["path"].as_str().unwrap_or_default());
                files.push(Download::new(n["url"].as_str().unwrap_or_default(), &path, n["sha1"].as_str().map(String::from),
                    n["size"].as_u64().unwrap_or(0)));
                libraries.push((format!("{}:{}", crate::paths::maven_key(name), cls), path));
            }
        }
    }

    // log config
    let mut log_config = None;
    if let Some(lc) = json["logging"]["client"].as_object() {
        let file = &lc["file"];
        let id_ = file["id"].as_str().unwrap_or("client.xml");
        let path = paths.assets().join("log_configs").join(id_);
        files.push(Download::new(file["url"].as_str().unwrap_or_default(), &path, file["sha1"].as_str().map(String::from),
            file["size"].as_u64().unwrap_or(0)));
        let arg = lc["argument"].as_str().unwrap_or("-Dlog4j.configurationFile=${path}").to_string();
        log_config = Some((path, arg));
    }
    net::fetch_all("Downloading Minecraft", files, rep).await?;

    // assets
    let ai = &json["assetIndex"];
    let assets_index = ai["id"].as_str().unwrap_or("legacy").to_string();
    let index_path = paths.assets().join("indexes").join(format!("{assets_index}.json"));
    let d = Download::new(ai["url"].as_str().unwrap_or_default(), &index_path, ai["sha1"].as_str().map(String::from), 0);
    if !net::is_valid(&d) {
        rep.stage("Downloading assets", 0, 0);
        net::fetch(&d, None).await?;
    }
    let index: Value = serde_json::from_str(&std::fs::read_to_string(&index_path)?)?;
    let mut assets = Vec::new();
    if let Some(objects) = index["objects"].as_object() {
        for obj in objects.values() {
            let hash = obj["hash"].as_str().unwrap_or_default();
            if hash.len() < 2 {
                continue;
            }
            let sub = &hash[..2];
            let mut d = Download::new(format!("{RESOURCES}/{sub}/{hash}"), paths.assets().join("objects").join(sub).join(hash), None,
                obj["size"].as_u64().unwrap_or(0));
            // checking the size is enough for ~4000 assets on every start; the hash is checked while downloading
            d.hash = net::Hash::None;
            assets.push((d, hash.to_string()));
        }
    }
    let assets: Vec<Download> = assets
        .into_iter()
        .map(|(mut d, h)| {
            if !d.path.exists() {
                d.hash = net::Hash::Sha1(h);
            }
            d
        })
        .collect();
    net::fetch_all("Downloading assets", assets, rep).await?;

    Ok(Vanilla { id: id.to_string(), json, client_jar, libraries, assets_index, log_config })
}
