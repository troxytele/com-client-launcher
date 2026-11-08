//! Skin library: your saved skins (in the launcher folder), switch the skin of the Minecraft account in one click.

use anyhow::{anyhow, bail, Context, Result};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

use crate::net::client;
use crate::paths::Paths;
use crate::store::{self, Accounts};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Saved {
    pub id: String,
    pub name: String,
    /// "classic" (Steve, 4 px arms) or "slim" (Alex, 3 px arms)
    pub variant: String,
    pub added: i64,
}

#[derive(Serialize, Deserialize, Default, Debug)]
struct Library {
    skins: Vec<Saved>,
    /// account uuid -> the saved skin it wears
    #[serde(default)]
    applied: std::collections::HashMap<String, String>,
    /// account uuid -> skin url we already imported (so "My skin" isn't added twice)
    #[serde(default)]
    imported: std::collections::HashMap<String, String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct SkinView {
    pub id: String,
    pub name: String,
    pub variant: String,
    /// data:image/png;base64,…
    pub data: String,
    pub active: bool,
}

fn dir(paths: &Paths) -> PathBuf {
    paths.root.join("skins")
}

fn load(paths: &Paths) -> Library {
    std::fs::read_to_string(dir(paths).join("skins.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save(paths: &Paths, lib: &Library) -> Result<()> {
    std::fs::create_dir_all(dir(paths))?;
    std::fs::write(dir(paths).join("skins.json"), serde_json::to_string_pretty(lib)?)?;
    Ok(())
}

fn data_url(png: &[u8]) -> String {
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png))
}

/// A Minecraft skin is a PNG of 64x64 (or the old 64x32).
fn check_png(png: &[u8]) -> Result<()> {
    if png.len() < 24 || &png[..8] != b"\x89PNG\r\n\x1a\n" {
        bail!("That isn't a PNG picture");
    }
    let w = u32::from_be_bytes([png[16], png[17], png[18], png[19]]);
    let h = u32::from_be_bytes([png[20], png[21], png[22], png[23]]);
    if !(w == 64 && (h == 64 || h == 32)) {
        bail!("A skin has to be 64x64 pixels (this one is {w}x{h})");
    }
    if png.len() > 200_000 {
        bail!("That skin file is too big");
    }
    Ok(())
}

fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..12].to_string()
}

fn add_png(paths: &Paths, lib: &mut Library, png: &[u8], name: &str, variant: &str) -> Result<Saved> {
    check_png(png)?;
    let s = Saved {
        id: new_id(),
        name: clean_name(name),
        variant: if variant == "slim" { "slim".into() } else { "classic".into() },
        added: crate::auth::now(),
    };
    std::fs::create_dir_all(dir(paths))?;
    std::fs::write(dir(paths).join(format!("{}.png", s.id)), png)?;
    lib.skins.insert(0, s.clone());
    Ok(s)
}

fn clean_name(n: &str) -> String {
    let n = n.trim();
    let n: String = n.chars().filter(|c| !c.is_control()).take(32).collect();
    if n.is_empty() {
        "Skin".into()
    } else {
        n
    }
}

/// All saved skins. The first time, the account's current skin is added as "My skin".
pub async fn list(paths: &Paths) -> Result<Vec<SkinView>> {
    let mut lib = load(paths);
    let accounts = Accounts::load(paths);
    let active = accounts.active.clone().unwrap_or_default();
    if let Some(acc) = accounts.list.iter().find(|a| a.uuid == active) {
        if !acc.skin_url.is_empty() && lib.imported.get(&acc.uuid) != Some(&acc.skin_url) {
            if let Ok(png) = download(&acc.skin_url).await {
                let variant = current_variant(&acc.mc_token).await.unwrap_or_else(|_| "classic".into());
                if let Ok(s) = add_png(paths, &mut lib, &png, &acc.name, &variant) {
                    lib.applied.insert(acc.uuid.clone(), s.id);
                }
                lib.imported.insert(acc.uuid.clone(), acc.skin_url.clone());
                save(paths, &lib)?;
            }
        }
    }
    let applied = lib.applied.get(&active).cloned().unwrap_or_default();
    Ok(lib
        .skins
        .iter()
        .filter_map(|s| {
            let png = std::fs::read(dir(paths).join(format!("{}.png", s.id))).ok()?;
            Some(SkinView { id: s.id.clone(), name: s.name.clone(), variant: s.variant.clone(), data: data_url(&png), active: s.id == applied })
        })
        .collect())
}

pub fn add_file(paths: &Paths, file: &str, name: &str, variant: &str) -> Result<()> {
    let png = std::fs::read(file).context("Couldn't read that file")?;
    let mut lib = load(paths);
    let name = if name.trim().is_empty() {
        std::path::Path::new(file).file_stem().and_then(|s| s.to_str()).unwrap_or("Skin").to_string()
    } else {
        name.to_string()
    };
    add_png(paths, &mut lib, &png, &name, variant)?;
    save(paths, &lib)
}

/// Copies the skin of any Minecraft player by name.
pub async fn import_player(paths: &Paths, player: &str) -> Result<()> {
    let player = player.trim();
    let r = client().get(format!("https://api.mojang.com/users/profiles/minecraft/{}", urlencoding::encode(player))).send().await?;
    if !r.status().is_success() {
        bail!("There is no Minecraft player called \"{player}\"");
    }
    let p: Value = r.json().await?;
    let id = p["id"].as_str().ok_or_else(|| anyhow!("Unknown player"))?;
    let real_name = p["name"].as_str().unwrap_or(player).to_string();
    let prof: Value = client().get(format!("https://sessionserver.mojang.com/session/minecraft/profile/{id}")).send().await?.json().await?;
    let encoded = prof["properties"]
        .as_array()
        .and_then(|a| a.iter().find(|x| x["name"] == "textures"))
        .and_then(|x| x["value"].as_str())
        .ok_or_else(|| anyhow!("{real_name} has no skin"))?;
    let tex: Value = serde_json::from_slice(&base64::engine::general_purpose::STANDARD.decode(encoded)?)?;
    let skin = &tex["textures"]["SKIN"];
    let url = skin["url"].as_str().ok_or_else(|| anyhow!("{real_name} uses the default skin"))?;
    let variant = if skin["metadata"]["model"] == "slim" { "slim" } else { "classic" };
    let png = download(url).await?;
    let mut lib = load(paths);
    add_png(paths, &mut lib, &png, &real_name, variant)?;
    save(paths, &lib)
}

pub fn update(paths: &Paths, id: &str, name: &str, variant: &str) -> Result<()> {
    let mut lib = load(paths);
    let s = lib.skins.iter_mut().find(|s| s.id == id).ok_or_else(|| anyhow!("That skin is gone"))?;
    s.name = clean_name(name);
    s.variant = if variant == "slim" { "slim".into() } else { "classic".into() };
    save(paths, &lib)
}

pub fn delete(paths: &Paths, id: &str) -> Result<()> {
    let mut lib = load(paths);
    lib.skins.retain(|s| s.id != id);
    lib.applied.retain(|_, v| v != id);
    let _ = std::fs::remove_file(dir(paths).join(format!("{id}.png")));
    save(paths, &lib)
}

/// Puts the saved skin on the active Minecraft account (works right away, also in the game after rejoining).
pub async fn apply(paths: &Paths, id: &str) -> Result<()> {
    let lib = load(paths);
    let s = lib.skins.iter().find(|s| s.id == id).cloned().ok_or_else(|| anyhow!("That skin is gone"))?;
    let png = std::fs::read(dir(paths).join(format!("{id}.png")))?;
    let acc = store::fresh_account(paths).await?;
    let form = reqwest::multipart::Form::new()
        .text("variant", s.variant.clone())
        .part("file", reqwest::multipart::Part::bytes(png).file_name("skin.png").mime_str("image/png")?);
    let r = client()
        .post("https://api.minecraftservices.com/minecraft/profile/skins")
        .bearer_auth(&acc.mc_token)
        .multipart(form)
        .send()
        .await
        .map_err(|_| anyhow!("Couldn't reach Minecraft"))?;
    match r.status().as_u16() {
        200..=299 => {}
        429 => bail!("Minecraft only allows a few skin changes per minute. Try again in a moment."),
        401 => bail!("Your sign-in expired. Remove the account and add it again."),
        s => bail!("Minecraft refused the skin ({s})"),
    }
    let v: Value = r.json().await.unwrap_or(Value::Null);
    let url = v["skins"]
        .as_array()
        .and_then(|a| a.iter().find(|x| x["state"] == "ACTIVE"))
        .and_then(|x| x["url"].as_str())
        .unwrap_or_default()
        .replace("http://", "https://");
    // remember it on the account (faces in the launcher) and in the library
    let mut accounts = Accounts::load(paths);
    if let Some(a) = accounts.list.iter_mut().find(|a| a.uuid == acc.uuid) {
        if !url.is_empty() {
            a.skin_url = url.clone();
        }
    }
    accounts.save(paths)?;
    let mut lib = load(paths);
    lib.applied.insert(acc.uuid.clone(), id.to_string());
    if !url.is_empty() {
        lib.imported.insert(acc.uuid.clone(), url);
    }
    save(paths, &lib)
}

/// The active account's skin as a data URL + its model (for the 3D model on the Play page).
#[derive(Serialize, Clone, Debug, Default)]
pub struct Current {
    pub data: String,
    pub variant: String,
    pub name: String,
}

pub async fn current(paths: &Paths) -> Result<Current> {
    let accounts = Accounts::load(paths);
    let Some(acc) = accounts.list.iter().find(|a| Some(&a.uuid) == accounts.active.as_ref()).cloned() else {
        // not signed in: show Steve
        return Ok(steve(paths, String::new()).await);
    };
    let lib = load(paths);
    // the skin we applied (instant, no download), else the account's skin from Mojang
    if let Some(id) = lib.applied.get(&acc.uuid) {
        if let (Some(s), Ok(png)) = (lib.skins.iter().find(|s| &s.id == id), std::fs::read(dir(paths).join(format!("{id}.png")))) {
            return Ok(Current { data: data_url(&png), variant: s.variant.clone(), name: acc.name });
        }
    }
    if acc.skin_url.is_empty() {
        return Ok(steve(paths, acc.name).await);
    }
    let png = download(&acc.skin_url).await?;
    let variant = current_variant(&acc.mc_token).await.unwrap_or_else(|_| "classic".into());
    Ok(Current { data: data_url(&png), variant, name: acc.name })
}

/// Minecraft's default skin, Steve, from Mojang (downloaded once, then kept next to the skin library).
const STEVE_URL: &str = "https://textures.minecraft.net/texture/1a4af718455d4aab528e7a61f86fa25e6a369d1768dcb13f7df319a713eb810b";

async fn steve(paths: &Paths, name: String) -> Current {
    let file = dir(paths).join("steve.png");
    let png = match std::fs::read(&file) {
        Ok(png) if !png.is_empty() => Some(png),
        _ => match download(STEVE_URL).await {
            Ok(png) => {
                let _ = std::fs::create_dir_all(dir(paths));
                let _ = std::fs::write(&file, &png);
                Some(png)
            }
            Err(_) => None, // offline: the 3D model shows no skin rather than failing
        },
    };
    Current { data: png.map(|p| data_url(&p)).unwrap_or_default(), variant: "classic".into(), name }
}

async fn current_variant(token: &str) -> Result<String> {
    if token.is_empty() {
        bail!("no token");
    }
    let v: Value = client().get("https://api.minecraftservices.com/minecraft/profile").bearer_auth(token).send().await?.json().await?;
    let slim = v["skins"]
        .as_array()
        .and_then(|a| a.iter().find(|x| x["state"] == "ACTIVE"))
        .map(|x| x["variant"].as_str().unwrap_or("").eq_ignore_ascii_case("slim"))
        .unwrap_or(false);
    Ok(if slim { "slim" } else { "classic" }.into())
}

async fn download(url: &str) -> Result<Vec<u8>> {
    let r = client().get(url.replace("http://", "https://")).send().await?;
    if !r.status().is_success() {
        bail!("Couldn't download the skin ({})", r.status());
    }
    Ok(r.bytes().await?.to_vec())
}
