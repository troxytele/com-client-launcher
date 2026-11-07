//! Cosmetics shop + locker: the catalogue (same as the mod's Locker), textures for the 3D preview, and equipping
//! (saved on the Com Client server so others see it, and in every profile's Com Client config so the game agrees).

use anyhow::{anyhow, bail, Result};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::Read;

use crate::client;
use crate::net;
use crate::paths::Paths;
use crate::social;
use crate::store::{self, Account, Profiles};

/// Official capes that are always listed (the rest comes from MineSkin's catalogue, like in the mod).
const BUILT_IN_    ("Migrator", "2340c0e03dd24a11b15a8b33c2a7e9e32abb2051b2481d0ba7defd635ca7a933"),
    ("Vanilla", "f9a76537647989f9a0b6d001e320dac591c359e9e61a31f4ce11c88f207f0ad4"),
    ("15th Anniversary", "cd9d82ab17fd92022dbd4a86cde4c382a7540e117fae7b9a2853658505a80625"),
    ("Follower's", "569b7f2a1d00d26f30efe3f9ab9ac817b1e6d35f4f3cfb0324ef2d328223d350"),
    ("MineCon 2011", "953cac8b779fe41383e675ee2b86071a71658f2180f56fbce8aa315ea70e2ed6"),
    ("MineCon 2012", "a2e8d97ec79100e90a75d369d1b3ba81273c4f82bc1b737e934eed4a854be1b6"),
    ("MineCon 2013", "153b1a0dfcbae953cdeb6f2c2bf6bf79943239b1372780da44bcbb29273131da"),
    ("MineCon 2015", "b0cc08840700447322d953a02b965f1d65a13a603bf64b17c803c21446fe1635"),
    ("MineCon 2016", "e7dfea16dc83c97df01a12fabbd1216359c0cd0ea42f9999b6e97c584963e980"),
    ("Mojang (Classic)", "8f120319222a9f4a104e2f5cb97b2cda93199a2ee9e1585cb8d09d6f687cb761"),
    ("Mojang", "9e507afc56359978a3eb3e32367042b853cddd0995d17d0da995662913fb00f7"),
    ("Mojang Studios", "5786fe99be377dfb6858859f926c4dbc995751e91cee373468c5fbf4865e7151"),
    ("Realms MapMaker", "17912790ff164b93196f08ba71d0e62129304776d0f347334f8a6eae509f8a56"),
    ("Translator", "1bf91499701404e21bd46b0191d63239a4ef76ebde88d27e4d430ac211df681e"),
    ("Translator (Chinese)", "2262fb1d24912209490586ecae98aca8500df3eff91f2a07da37ee524e7e3cb6"),
    ("Translator (Japanese)", "ca29f5dd9e94fb1748203b92e36b66fda80750c87ebc18d6eafdb0e28cc1d05f"),
    ("Mojira Moderator", "ae677f7d98ac70a533713518416df4452fe5700365c09cf45d0d156ea9396551"),
    ("Cobalt", "ca35c56efe71ed290385f4ab5346a1826b546a54d519e6a3ff01efa01acce81"),
    ("Scrolls", "3efadf6510961830f9fcc077f19b4daf286d502b5f5aafbd807c7bbffcaca245"),
    ("Turtle", "5048ea61566353397247d2b7d946034de926b997d5e66c86483dfb1e031aee95"),
    ("Prismarine", "d8f8d13a1adf9636a16c31d47f3ecc9bb8d8533108aa5ad2a01b13b1a0c55eac"),
    ("Birthday", "2056f2eebd759cce93460907186ef44e9192954ae12b227d817eb4b55627a7fc"),
    ("Valentine", "6a7cf0eb5cfe7e7c508b364e32916dfd28d164e7bf6d92c6ea7811b82451e760"),
    ("Bacon", "fd14214cd8073059e93d9c626260f5df85e5a959181537119df56cadaf5002cc"),
    ("dB", "bcfbe84c6542a4a5c213c1cacf8979b5e913dcb4ad783a8b80e3c4a7d5c8bdac"),
    ("Document", "23917a9b79ac95602bba0027c2d3b4a67f22ca537e8c984400c48f8056c904eb"),
    ("Oxeye", "7706b5f5fc90329691e59277dcc66ba20572219fa8e5da472afd5235fad12cc8"),
    ("Millionth Customer", "70efffaf86fe5bc089608d3cb297d3e276b9eb7a8f9f2fe6659c23a2d8b18edf"),
    ("JulianClark", "23ec737f18bfe4b547c95935fc297dd767bb84ee55bfd855144d279ac9bfd9fe"),
    ("MrMessiah", "2e002d5e1758e79ba51d08d92a0f3a95119f2f435ae7704916507b6c565a7da8"): &[(&str, &str)] = &[
    ("Migrator", "2340c0e03dd24a11b15a8b33c2a7e9e32abb2051b2481d0ba7defd635ca7a933"),
    ("Vanilla", "f9a76537647989f9a0b6d001e320dac591c359e9e61a31f4ce11c88f207f0ad4"),
    ("15th Anniversary", "cd9d82ab17fd92022dbd4a86cde4c382a7540e117fae7b9a2853658505a80625"),
    ("Follower's", "569b7f2a1d00d26f30efe3f9ab9ac817b1e6d35f4f3cfb0324ef2d328223d350"),
    ("MineCon 2011", "953cac8b779fe41383e675ee2b86071a71658f2180f56fbce8aa315ea70e2ed6"),
    ("MineCon 2012", "a2e8d97ec79100e90a75d369d1b3ba81273c4f82bc1b737e934eed4a854be1b6"),
    ("MineCon 2013", "153b1a0dfcbae953cdeb6f2c2bf6bf79943239b1372780da44bcbb29273131da"),
    ("MineCon 2015", "b0cc08840700447322d953a02b965f1d65a13a603bf64b17c803c21446fe1635"),
    ("MineCon 2016", "e7dfea16dc83c97df01a12fabbd1216359c0cd0ea42f9999b6e97c584963e980"),
    ("Mojang (Classic)", "8f120319222a9f4a104e2f5cb97b2cda93199a2ee9e1585cb8d09d6f687cb761"),
    ("Mojang", "9e507afc56359978a3eb3e32367042b853cddd0995d17d0da995662913fb00f7"),
    ("Mojang Studios", "5786fe99be377dfb6858859f926c4dbc995751e91cee373468c5fbf4865e7151"),
    ("Realms MapMaker", "17912790ff164b93196f08ba71d0e62129304776d0f347334f8a6eae509f8a56"),
    ("Translator", "1bf91499701404e21bd46b0191d63239a4ef76ebde88d27e4d430ac211df681e"),
    ("Translator (Chinese)", "2262fb1d24912209490586ecae98aca8500df3eff91f2a07da37ee524e7e3cb6"),
    ("Translator (Japanese)", "ca29f5dd9e94fb1748203b92e36b66fda80750c87ebc18d6eafdb0e28cc1d05f"),
    ("Mojira Moderator", "ae677f7d98ac70a533713518416df4452fe5700365c09cf45d0d156ea9396551"),
    ("Cobalt", "ca35c56efe71ed290385f4ab5346a1826b546a54d519e6a3ff01efa01acce81"),
    ("Scrolls", "3efadf6510961830f9fcc077f19b4daf286d502b5f5aafbd807c7bbffcaca245"),
    ("Turtle", "5048ea61566353397247d2b7d946034de926b997d5e66c86483dfb1e031aee95"),
    ("Prismarine", "d8f8d13a1adf9636a16c31d47f3ecc9bb8d8533108aa5ad2a01b13b1a0c55eac"),
    ("Birthday", "2056f2eebd759cce93460907186ef44e9192954ae12b227d817eb4b55627a7fc"),
    ("Valentine", "6a7cf0eb5cfe7e7c508b364e32916dfd28d164e7bf6d92c6ea7811b82451e760"),
    ("Bacon", "fd14214cd8073059e93d9c626260f5df85e5a959181537119df56cadaf5002cc"),
    ("dB", "bcfbe84c6542a4a5c213c1cacf8979b5e913dcb4ad783a8b80e3c4a7d5c8bdac"),
    ("Document", "23917a9b79ac95602bba0027c2d3b4a67f22ca537e8c984400c48f8056c904eb"),
    ("Oxeye", "7706b5f5fc90329691e59277dcc66ba20572219fa8e5da472afd5235fad12cc8"),
    ("Millionth Customer", "70efffaf86fe5bc089608d3cb297d3e276b9eb7a8f9f2fe6659c23a2d8b18edf"),
    ("JulianClark", "23ec737f18bfe4b547c95935fc297dd767bb84ee55bfd855144d279ac9bfd9fe"),
    ("MrMessiah", "2e002d5e1758e79ba51d08d92a0f3a95119f2f435ae7704916507b6c565a7da8")
];

/// Ids and names, in the order the mod's Locker shows them.
const WINGS: &[(&str, &str)] = &[("heaven", "Heaven"), ("purple", "Purple"), ("dragon", "Dragon"), ("devil", "Devil"), ("blue_dragon", "Blue Dragon")];
const HALOS: &[(&str, &str)] = &[("ring", "Glowing ring"), ("double", "Double ring"), ("crown", "Spiked crown"), ("orbit", "Orbit sparks")];
const HATS: &[(&str, &str)] = &[("crown", "Crown"), ("cat_ears", "Cat ears"), ("dog_ears", "Dog ears")];
const AURAS: &[(&str, &str)] = &[("sparkles", "Orbit sparkles"), ("embers", "Rising embers"), ("helix", "Helix")];

#[derive(Serialize, Clone, Debug)]
pub struct Item {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct Catalog {
    pub capes: Vec<Item>,
    pub wings: Vec<Item>,
    pub halos: Vec<Item>,
    pub hats: Vec<Item>,
    pub auras: Vec<Item>,
}

fn items(list: &[(&str, &str)]) -> Vec<Item> {
    list.iter().map(|(id, name)| Item { id: id.to_string(), name: name.to_string() }).collect()
}

fn is_hash(h: &str) -> bool {
    (60..=64).contains(&h.len()) && h.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

/// Everything you can wear. The cape list is cached for a day (MineSkin knows every cape that exists).
pub async fn catalog(paths: &Paths) -> Catalog {
    let mut capes: Vec<Item> = items(BUILT_IN_    ("Migrator", "2340c0e03dd24a11b15a8b33c2a7e9e32abb2051b2481d0ba7defd635ca7a933"),
    ("Vanilla", "f9a76537647989f9a0b6d001e320dac591c359e9e61a31f4ce11c88f207f0ad4"),
    ("15th Anniversary", "cd9d82ab17fd92022dbd4a86cde4c382a7540e117fae7b9a2853658505a80625"),
    ("Follower's", "569b7f2a1d00d26f30efe3f9ab9ac817b1e6d35f4f3cfb0324ef2d328223d350"),
    ("MineCon 2011", "953cac8b779fe41383e675ee2b86071a71658f2180f56fbce8aa315ea70e2ed6"),
    ("MineCon 2012", "a2e8d97ec79100e90a75d369d1b3ba81273c4f82bc1b737e934eed4a854be1b6"),
    ("MineCon 2013", "153b1a0dfcbae953cdeb6f2c2bf6bf79943239b1372780da44bcbb29273131da"),
    ("MineCon 2015", "b0cc08840700447322d953a02b965f1d65a13a603bf64b17c803c21446fe1635"),
    ("MineCon 2016", "e7dfea16dc83c97df01a12fabbd1216359c0cd0ea42f9999b6e97c584963e980"),
    ("Mojang (Classic)", "8f120319222a9f4a104e2f5cb97b2cda93199a2ee9e1585cb8d09d6f687cb761"),
    ("Mojang", "9e507afc56359978a3eb3e32367042b853cddd0995d17d0da995662913fb00f7"),
    ("Mojang Studios", "5786fe99be377dfb6858859f926c4dbc995751e91cee373468c5fbf4865e7151"),
    ("Realms MapMaker", "17912790ff164b93196f08ba71d0e62129304776d0f347334f8a6eae509f8a56"),
    ("Translator", "1bf91499701404e21bd46b0191d63239a4ef76ebde88d27e4d430ac211df681e"),
    ("Translator (Chinese)", "2262fb1d24912209490586ecae98aca8500df3eff91f2a07da37ee524e7e3cb6"),
    ("Translator (Japanese)", "ca29f5dd9e94fb1748203b92e36b66fda80750c87ebc18d6eafdb0e28cc1d05f"),
    ("Mojira Moderator", "ae677f7d98ac70a533713518416df4452fe5700365c09cf45d0d156ea9396551"),
    ("Cobalt", "ca35c56efe71ed290385f4ab5346a1826b546a54d519e6a3ff01efa01acce81"),
    ("Scrolls", "3efadf6510961830f9fcc077f19b4daf286d502b5f5aafbd807c7bbffcaca245"),
    ("Turtle", "5048ea61566353397247d2b7d946034de926b997d5e66c86483dfb1e031aee95"),
    ("Prismarine", "d8f8d13a1adf9636a16c31d47f3ecc9bb8d8533108aa5ad2a01b13b1a0c55eac"),
    ("Birthday", "2056f2eebd759cce93460907186ef44e9192954ae12b227d817eb4b55627a7fc"),
    ("Valentine", "6a7cf0eb5cfe7e7c508b364e32916dfd28d164e7bf6d92c6ea7811b82451e760"),
    ("Bacon", "fd14214cd8073059e93d9c626260f5df85e5a959181537119df56cadaf5002cc"),
    ("dB", "bcfbe84c6542a4a5c213c1cacf8979b5e913dcb4ad783a8b80e3c4a7d5c8bdac"),
    ("Document", "23917a9b79ac95602bba0027c2d3b4a67f22ca537e8c984400c48f8056c904eb"),
    ("Oxeye", "7706b5f5fc90329691e59277dcc66ba20572219fa8e5da472afd5235fad12cc8"),
    ("Millionth Customer", "70efffaf86fe5bc089608d3cb297d3e276b9eb7a8f9f2fe6659c23a2d8b18edf"),
    ("JulianClark", "23ec737f18bfe4b547c95935fc297dd767bb84ee55bfd855144d279ac9bfd9fe"),
    ("MrMessiah", "2e002d5e1758e79ba51d08d92a0f3a95119f2f435ae7704916507b6c565a7da8"));
    let cache = paths.root.join("cache").join("capes.json");
    let fresh = std::fs::metadata(&cache)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|m| m.elapsed().ok())
        .map(|age| age.as_secs() < 86_400)
        .unwrap_or(false);
    let mut list: Option<Value> = if fresh { std::fs::read_to_string(&cache).ok().and_then(|t| serde_json::from_str(&t).ok()) } else { None };
    if list.is_none() {
        if let Ok(v) = net::get_json::<Value>("https://api.mineskin.org/v2/capes").await {
            let _ = std::fs::create_dir_all(cache.parent().unwrap());
            let _ = std::fs::write(&cache, v.to_string());
            list = Some(v);
        } else {
            list = std::fs::read_to_string(&cache).ok().and_then(|t| serde_json::from_str(&t).ok());
        }
    }
    for c in list.as_ref().and_then(|v| v["capes"].as_array()).cloned().unwrap_or_default() {
        let url = c["url"].as_str().unwrap_or_default();
        let hash = url.rsplit('/').next().unwrap_or_default().to_ascii_lowercase();
        if !is_hash(&hash) || capes.iter().any(|x| x.id == hash) {
            continue;
        }
        let name = c["alias"].as_str().unwrap_or("Cape").replace(" Cape", "").trim().to_string();
        capes.push(Item { id: hash, name });
    }
    capes.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Catalog { capes, wings: items(WINGS), halos: items(HALOS), hats: items(HATS), auras: items(AURAS) }
}

fn data_url(bytes: &[u8]) -> String {
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// A texture for the 3D preview as a data: URL. kind = "cape" (id = Mojang texture hash) or "wings" (design id,
/// read from the installed Com Client jar).
pub async fn texture(paths: &Paths, kind: &str, id: &str) -> Result<String> {
    match kind {
        "cape" => {
            if !is_hash(id) {
                bail!("Unknown cape");
            }
            let file = paths.root.join("cache").join("capes").join(format!("{id}.png"));
            if !file.is_file() {
                let d = net::Download::new(format!("https://textures.minecraft.net/texture/{id}"), file.clone(), None, 0);
                net::fetch(&d, None).await?;
            }
            Ok(data_url(&std::fs::read(file)?))
        }
        "wings" => {
            if !WINGS.iter().any(|(w, _)| *w == id) {
                bail!("Unknown wings");
            }
            let inst = client::installed(paths);
            let jar = paths.client().join(&inst.client_file);
            if inst.client_file.is_empty() || !jar.is_file() {
                bail!("Press Play once so Com Client is downloaded, then the wings show here");
            }
            let mut zip = zip::ZipArchive::new(std::fs::File::open(jar)?)?;
            let mut f = zip
                .by_name(&format!("assets/comclient/textures/cosmetics/wings/{id}.png"))
                .map_err(|_| anyhow!("This Com Client version doesn't have those wings"))?;
            let mut bytes = Vec::new();
            f.read_to_end(&mut bytes)?;
            Ok(data_url(&bytes))
        }
        _ => bail!("Unknown kind"),
    }
}

/// What you wear (same fields as the mod's config). auraColor -1 = rainbow.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Look {
    pub cape: String,
    pub wings: String,
    pub halo: String,
    pub halo_color: i64,
    pub hat: String,
    pub hat_color: i64,
    pub aura: String,
    pub aura_color: i64,
}

impl Default for Look {
    fn default() -> Self {
        Look {
            cape: "none".into(),
            wings: "none".into(),
            halo: "none".into(),
            halo_color: 0xFFE07A,
            hat: "none".into(),
            hat_color: 0xEDEDED,
            aura: "none".into(),
            aura_color: 0xA77BFF,
        }
    }
}

fn valid(id: &str, list: &[(&str, &str)]) -> bool {
    id == "none" || list.iter().any(|(x, _)| *x == id)
}

/// Your look: from the server, otherwise from the selected profile's Com Client config.
pub async fn get(paths: &Paths, acc: &Account) -> Look {
    if let Ok(v) = social::request(acc, "GET", &format!("/cosmetics?uuids={}", acc.uuid), None).await {
        if let Some(c) = v["cosmetics"].get(&acc.uuid).or_else(|| v["cosmetics"].as_object().and_then(|o| o.values().next())) {
            if let Ok(l) = serde_json::from_value::<Look>(c.clone()) {
                return l;
            }
        }
        return Look::default();
    }
    let s = store::Settings::load(paths);
    let dir = store::game_dir(paths, &Profiles::load(paths).get(&s.active_profile));
    let cfg: Value = std::fs::read_to_string(dir.join("config/comclient/client.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(Value::Null);
    let mut l = Look::default();
    let st = |k: &str, d: &str| cfg[k].as_str().unwrap_or(d).to_string();
    l.cape = st("cape", "none");
    l.wings = st("wings", "none");
    l.halo = st("halo", "none");
    l.hat = st("hat", "none");
    l.aura = st("aura", "none");
    l.halo_color = cfg["haloColor"].as_i64().unwrap_or(l.halo_color);
    l.hat_color = cfg["hatColor"].as_i64().unwrap_or(l.hat_color);
    l.aura_color = if cfg["auraRainbow"].as_bool().unwrap_or(false) { -1 } else { cfg["auraColor"].as_i64().unwrap_or(l.aura_color) };
    l
}

/// Wears it: tells the server (everyone with Com Client sees it) and writes it into every profile's Com Client
/// config, so the game wears the same thing next time it starts.
pub async fn save(paths: &Paths, acc: &Account, look: &Look) -> Result<()> {
    if !(look.cape == "none" || is_hash(&look.cape)) || !valid(&look.wings, WINGS) || !valid(&look.halo, HALOS)
        || !valid(&look.hat, HATS) || !valid(&look.aura, AURAS)
    {
        bail!("Unknown cosmetic");
    }
    let body = serde_json::to_value(look)?;
    social::request(acc, "POST", "/cosmetics", Some(body)).await?;
    for p in Profiles::load(paths).list {
        let file = store::game_dir(paths, &p).join("config").join("comclient").join("client.json");
        let mut cfg: Value = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_else(|| json!({}));
        if !cfg.is_object() {
            cfg = json!({});
        }
        let o = cfg.as_object_mut().unwrap();
        o.insert("cape".into(), json!(look.cape));
        o.insert("wings".into(), json!(look.wings));
        o.insert("halo".into(), json!(look.halo));
        o.insert("haloColor".into(), json!(look.halo_color & 0xFFFFFF));
        o.insert("hat".into(), json!(look.hat));
        o.insert("hatColor".into(), json!(look.hat_color & 0xFFFFFF));
        o.insert("aura".into(), json!(look.aura));
        o.insert("auraRainbow".into(), json!(look.aura_color == -1));
        if look.aura_color != -1 {
            o.insert("auraColor".into(), json!(look.aura_color & 0xFFFFFF));
        }
        if let Some(parent) = file.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&file, serde_json::to_string_pretty(&cfg)?);
    }
    Ok(())
}
