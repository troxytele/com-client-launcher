//! Mods, resource packs and shaders from Modrinth: search, install (with required dependencies), updates.

use anyhow::{anyhow, Result};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::Path;

use crate::mods;
use crate::net::{self, Download};

const API: &str = "https://api.modrinth.com/v2";

#[derive(Serialize, Clone, Debug)]
pub struct Hit {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub icon: String,
    pub author: String,
    pub downloads: u64,
    pub follows: u64,
    pub categories: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct SearchResult {
    pub hits: Vec<Hit>,
    pub total: u64,
}

fn project_type(kind: &str) -> &'static str {
    match kind {
        "resourcepack" => "resourcepack",
        "shader" => "shader",
        _ => "mod",
    }
}

fn loaders(kind: &str) -> Vec<&'static str> {
    match kind {
        "resourcepack" => vec!["minecraft"],
        "shader" => vec!["iris", "optifine", "canvas"],
        _ => vec!["fabric"],
    }
}

/// sort: relevance | downloads | follows | newest | updated
pub async fn search(query: &str, kind: &str, mc: &str, sort: &str, offset: u32) -> Result<SearchResult> {
    let mut facets = vec![vec![format!("project_type:{}", project_type(kind))], vec![format!("versions:{mc}")]];
    if kind == "mod" {
        facets.push(vec!["categories:fabric".into()]);
    }
    let url = format!(
        "{API}/search?query={}&facets={}&index={}&offset={}&limit=24",
        urlencoding::encode(query),
        urlencoding::encode(&serde_json::to_string(&facets)?),
        if sort.is_empty() { "relevance" } else { sort },
        offset
    );
    let v: Value = net::get_json(&url).await?;
    let hits = v["hits"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|h| Hit {
            id: h["project_id"].as_str().unwrap_or_default().into(),
            slug: h["slug"].as_str().unwrap_or_default().into(),
            title: h["title"].as_str().unwrap_or_default().into(),
            description: h["description"].as_str().unwrap_or_default().into(),
            icon: h["icon_url"].as_str().unwrap_or_default().into(),
            author: h["author"].as_str().unwrap_or_default().into(),
            downloads: h["downloads"].as_u64().unwrap_or(0),
            follows: h["follows"].as_u64().unwrap_or(0),
            categories: h["display_categories"]
                .as_array()
                .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_default(),
        })
        .collect();
    Ok(SearchResult { hits, total: v["total_hits"].as_u64().unwrap_or(0) })
}

async fn best_version(project: &str, kind: &str, mc: &str) -> Result<Value> {
    let url = format!(
        "{API}/project/{}/version?game_versions={}&loaders={}",
        urlencoding::encode(project),
        urlencoding::encode(&json!([mc]).to_string()),
        urlencoding::encode(&json!(loaders(kind)).to_string())
    );
    let list: Value = net::get_json(&url).await?;
    let arr = list.as_array().cloned().unwrap_or_default();
    // newest release first, otherwise newest beta/alpha
    arr.iter()
        .find(|v| v["version_type"] == "release")
        .or_else(|| arr.first())
        .cloned()
        .ok_or_else(|| anyhow!("No version for Minecraft {mc}"))
}

fn primary_file(v: &Value) -> Option<Value> {
    let files = v["files"].as_array()?;
    files.iter().find(|f| f["primary"].as_bool().unwrap_or(false)).or_else(|| files.first()).cloned()
}

/// Installs a project (and the mods it needs). Returns the names of what was installed.
pub async fn install(project: &str, kind: &str, mc: &str, game_dir: &Path) -> Result<Vec<String>> {
    let mut done = HashSet::new();
    let mut names = Vec::new();
    let mut queue = vec![(project.to_string(), kind.to_string())];
    let have: HashSet<String> = mods::list(game_dir, "mod").into_iter().map(|m| m.id).collect();
    while let Some((p, k)) = queue.pop() {
        if !done.insert(p.clone()) || done.len() > 30 {
            continue;
        }
        let v = best_version(&p, &k, mc).await?;
        let f = primary_file(&v).ok_or_else(|| anyhow!("That version has no file"))?;
        let dir = mods::folder(game_dir, &k);
        let name = f["filename"].as_str().unwrap_or("download.jar").to_string();
        if name.contains('/') || name.contains('\\') || name.contains("..") {
            continue;
        }
        let d = Download::new(f["url"].as_str().unwrap_or_default(), dir.join(&name), f["hashes"]["sha1"].as_str().map(String::from),
            f["size"].as_u64().unwrap_or(0));
        net::fetch(&d, None).await?;
        names.push(name);
        if k == "mod" {
            for dep in v["dependencies"].as_array().cloned().unwrap_or_default() {
                if dep["dependency_type"] != "required" {
                    continue;
                }
                if let Some(pid) = dep["project_id"].as_str() {
                    // Fabric API is already loaded by the launcher
                    if pid == "P7dR8mSH" || have.contains(pid) {
                        continue;
                    }
                    queue.push((pid.to_string(), "mod".into()));
                }
            }
        }
    }
    Ok(names)
}

#[derive(Serialize, serde::Deserialize, Clone, Debug)]
pub struct Update {
    pub file: String,
    pub version: String,
    pub url: String,
    pub filename: String,
    pub sha1: String,
    pub size: u64,
}

/// Which installed files have a newer version on Modrinth.
pub async fn updates(game_dir: &Path, kind: &str, mc: &str) -> Result<Vec<Update>> {
    let items = mods::list(game_dir, kind);
    let hashes: Vec<&str> = items.iter().filter(|i| !i.sha1.is_empty()).map(|i| i.sha1.as_str()).collect();
    if hashes.is_empty() {
        return Ok(vec![]);
    }
    let body = json!({"hashes": hashes, "algorithm": "sha1", "loaders": loaders(kind), "game_versions": [mc]});
    let r = net::client().post(format!("{API}/version_files/update")).json(&body).send().await?;
    if !r.status().is_success() {
        return Ok(vec![]);
    }
    let map: Value = r.json().await?;
    let mut out = Vec::new();
    for item in items {
        let Some(v) = map.get(&item.sha1) else { continue };
        let Some(f) = primary_file(v) else { continue };
        let sha = f["hashes"]["sha1"].as_str().unwrap_or_default();
        if !sha.is_empty() && sha != item.sha1 {
            out.push(Update {
                file: item.file.clone(),
                version: v["version_number"].as_str().unwrap_or_default().into(),
                url: f["url"].as_str().unwrap_or_default().into(),
                filename: f["filename"].as_str().unwrap_or_default().into(),
                sha1: sha.into(),
                size: f["size"].as_u64().unwrap_or(0),
            });
        }
    }
    Ok(out)
}

/// Replaces the old file with the new version (keeps it disabled if it was).
pub async fn apply_update(game_dir: &Path, kind: &str, u: &Update) -> Result<()> {
    let dir = mods::folder(game_dir, kind);
    if u.filename.contains('/') || u.filename.contains('\\') || u.filename.contains("..") {
        return Err(anyhow!("bad file name"));
    }
    let disabled = u.file.ends_with(".disabled");
    let target = if disabled { format!("{}.disabled", u.filename) } else { u.filename.clone() };
    let d = Download::new(&u.url, dir.join(&target), Some(u.sha1.clone()), u.size);
    net::fetch(&d, None).await?;
    if target != u.file {
        let _ = mods::delete(game_dir, kind, &u.file);
    }
    Ok(())
}
