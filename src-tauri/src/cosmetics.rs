//! Cosmetics shop + locker: the catalogue (same as the mod's Locker), textures for the 3D preview, and equipping
//! (saved on the Com Client server so others see it, and in every profile's Com Client config so the game agrees).

use anyhow::{anyhow, bail, Result};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::Read;

use crate::client;
use crate::paths::Paths;
use crate::social;
use crate::store::{self, Account, Profiles};

/// Ids and names, in the order the mod's Locker shows them.
const WINGS: &[(&str, &str)] = &[
    ("heaven", "Heaven"), ("purple", "Purple"), ("dragon", "Dragon"), ("devil", "Devil"), ("blue_dragon", "Blue Dragon"),
    ("frost", "Frost"), ("candy_cane", "Candy Cane"), ("snowflake", "Snowflake"), ("golden", "Golden"), ("celestial", "Celestial"),
    ("seraph", "Seraph"), ("void", "Void"), ("phoenix", "Phoenix"), ("monarch", "Monarch"), ("morpho", "Morpho"),
    ("pixie", "Pixie"), ("bat", "Bat"), ("emerald", "Emerald Drake"),
];
const HALOS: &[(&str, &str)] = &[("ring", "Glowing ring"), ("double", "Double ring"), ("crown", "Spiked crown"), ("orbit", "Orbit sparks"), ("wreath", "Holly wreath")];
const HATS: &[(&str, &str)] = &[("crown", "Crown"), ("cat_ears", "Cat ears"), ("dog_ears", "Dog ears"), ("santa", "Santa hat"), ("antlers", "Reindeer antlers"),
    ("bunny_hat", "Bunny hat"), ("axolotl_hat", "Axolotl hat"), ("frog_hat", "Frog hat")];
const AURAS: &[(&str, &str)] = &[("sparkles", "Orbit sparkles"), ("embers", "Rising embers"), ("helix", "Helix"), ("snow", "Snowfall"),
    ("trail_stars", "Star trail"), ("trail_petals", "Petal trail"), ("trail_snow", "Snow trail"), ("trail_hearts", "Heart trail"), ("trail_cape", "Cape trail")];
const PETS: &[(&str, &str)] = &[
    ("bee", "Bee"), ("ender_dragon", "Mini Ender Dragon"), ("allay", "Allay"), ("bat", "Bat"), ("parrot", "Parrot"), ("fox", "Fox"),
    ("cat", "Cat"), ("frog", "Frog"), ("axolotl", "Axolotl"), ("chicken", "Chicken"), ("slime", "Slime"),
    ("goat", "Goat"), ("lamb", "Lamb"), ("pumpkin_cat", "Pumpkin Cat"), ("koala", "Koala"), ("duck", "Duck"), ("penguin", "Penguin"),
];
const NAMETAGS: &[(&str, &str)] = &[
    ("fire", "Fire"), ("ocean", "Ocean"), ("gold", "Gold"), ("toxic", "Toxic"), ("candy", "Candy"), ("galaxy", "Galaxy"), ("rainbow", "Rainbow"),
];
/// Name icons: a little picture after your name (the Christmas ones come from the advent calendar).
const ICONS: &[(&str, &str)] = &[
    ("tree", "Christmas tree"), ("snowman", "Snowman"), ("present", "Present"), ("candy_cane", "Candy cane"),
    ("gingerbread", "Gingerbread"), ("bell", "Bell"), ("xmas_star", "Christmas star"), ("santa_hat", "Santa hat"),
    ("snowflake", "Snowflake"), ("reindeer", "Reindeer"), ("heart", "Heart"), ("crown", "Crown"), ("fire", "Fire"),
    ("diamond", "Diamond"), ("lightning", "Lightning"), ("music", "Music note"), ("skull", "Skull"), ("sparkle", "Sparkle"),
    // animated
    ("heartbeat", "Beating heart"), ("flame", "Living flame"), ("twinkle", "Twinkling star"), ("bolt", "Flashing bolt"), ("orb", "Rainbow orb"), ("ghost", "Ghost"),
];
/// Com Client's capes (bundled in the mod, many animated), in the mod's Locker order. No official Minecraft capes.
const CUSTOM_CAPES: &[(&str, &str)] = &[
    ("cc_northpole", "North Pole"), ("cc_snowfall", "Snowfall"), ("cc_lights", "Christmas Lights"), ("cc_candy_cane", "Candy Cane"),
    ("cc_frostbite", "Frostbite"), ("cc_prism", "Prism"),
    ("cc_rose_red", "Red Rose"), ("cc_rose_white", "White Rose"), ("cc_sun", "Sun"), ("cc_moon", "Moon"),
    ("cc_heart_left", "Heart (left half)"), ("cc_heart_right", "Heart (right half)"), ("cc_yin", "Yin"), ("cc_yang", "Yang"),
    ("cc_mono_black", "Mono Black"), ("cc_mono_white", "Mono White"), ("cc_gg", "GG"),
    ("cc_aurora", "Aurora"), ("cc_galaxy", "Galaxy"), ("cc_nebula", "Nebula"), ("cc_lava", "Lava"),
    ("cc_rainbow", "Rainbow Flow"), ("cc_storm", "Thunderstorm"), ("cc_waves", "Waves"),
    ("cc_fireflies", "Fireflies"), ("cc_hearts", "Hearts"),
    ("cc_sunset", "Sunset"), ("cc_sakura", "Sakura"),
    ("cc_honeycomb", "Honeycomb"), ("cc_mint", "Mint"),
];

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
    pub pets: Vec<Item>,
    pub nametags: Vec<Item>,
    pub icons: Vec<Item>,
}

fn items(list: &[(&str, &str)]) -> Vec<Item> {
    list.iter().map(|(id, name)| Item { id: id.to_string(), name: name.to_string() }).collect()
}

/// Everything you can wear.
pub async fn catalog(_paths: &Paths) -> Catalog {
    Catalog {
        capes: items(CUSTOM_CAPES),
        wings: items(WINGS),
        halos: items(HALOS),
        hats: items(HATS),
        auras: items(AURAS),
        pets: items(PETS),
        nametags: items(NAMETAGS),
        icons: items(ICONS),
    }
}

fn data_url(bytes: &[u8]) -> String {
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// A texture for the 3D preview as a data: URL. kind = "cape" or "wings" (design id), read from the installed
/// Com Client jar. (The window has its own copies of all of them; this is for designs newer than the launcher.)
pub async fn texture(paths: &Paths, kind: &str, id: &str) -> Result<String> {
    match kind {
        "cape" => {
            if !CUSTOM_CAPES.iter().any(|(c, _)| *c == id) {
                bail!("Unknown cape");
            }
            jar_file(paths, &format!("assets/comclient/textures/capes/{}.png", &id[3..]))
        }
        "wings" => {
            if !WINGS.iter().any(|(w, _)| *w == id) {
                bail!("Unknown wings");
            }
            jar_file(paths, &format!("assets/comclient/textures/cosmetics/wings/{id}.png"))
        }
        _ => bail!("Unknown kind"),
    }
}

/// A file from the installed Com Client jar, as a data: URL.
fn jar_file(paths: &Paths, name: &str) -> Result<String> {
    let inst = client::installed(paths);
    let jar = paths.client().join(&inst.client_file);
    if inst.client_file.is_empty() || !jar.is_file() {
        bail!("Press Play once so Com Client is downloaded, then it shows here");
    }
    let mut zip = zip::ZipArchive::new(std::fs::File::open(jar)?)?;
    let mut f = zip.by_name(name).map_err(|_| anyhow!("This Com Client version doesn't have it yet"))?;
    let mut bytes = Vec::new();
    f.read_to_end(&mut bytes)?;
    Ok(data_url(&bytes))
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
    pub pet: String,
    pub pet_left: bool,
    pub nametag: String,
    pub icon: String,
    /// a name over the pet, its colour (-1 own colours, -2 rainbow, else a tint) and "others see a plain name tag"
    pub pet_name: String,
    pub pet_color: i64,
    pub plain_tag: bool,
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
            pet: "none".into(),
            pet_left: false,
            nametag: "none".into(),
            icon: "none".into(),
            pet_name: String::new(),
            pet_color: -1,
            plain_tag: false,
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
    if !valid(&l.cape, CUSTOM_CAPES) {
        l.cape = "none".into(); // an official Minecraft cape from before: those are gone
    }
    l.wings = st("wings", "none");
    l.halo = st("halo", "none");
    l.hat = st("hat", "none");
    l.aura = st("aura", "none");
    l.pet = st("pet", "none");
    l.nametag = st("nametag", "none");
    l.icon = st("icon", "none");
    l.pet_left = cfg["petLeft"].as_bool().unwrap_or(false);
    l.pet_name = st("petName", "");
    l.pet_color = cfg["petColor"].as_i64().unwrap_or(-1);
    l.plain_tag = cfg["plainTag"].as_bool().unwrap_or(false);
    l.halo_color = cfg["haloColor"].as_i64().unwrap_or(l.halo_color);
    l.hat_color = cfg["hatColor"].as_i64().unwrap_or(l.hat_color);
    l.aura_color = if cfg["auraRainbow"].as_bool().unwrap_or(false) { -1 } else { cfg["auraColor"].as_i64().unwrap_or(l.aura_color) };
    l
}

/// Wears it: tells the server (everyone with Com Client sees it) and writes it into every profile's Com Client
/// config, so the game wears the same thing next time it starts.
pub async fn save(paths: &Paths, acc: &Account, look: &Look) -> Result<Look> {
    if !valid(&look.cape, CUSTOM_CAPES) || !valid(&look.wings, WINGS) || !valid(&look.halo, HALOS)
        || !valid(&look.hat, HATS) || !valid(&look.aura, AURAS) || !valid(&look.pet, PETS) || !valid(&look.nametag, NAMETAGS)
        || !valid(&look.icon, ICONS)
    {
        bail!("Unknown cosmetic");
    }
    let body = serde_json::to_value(look)?;
    // the server takes off anything you haven't unlocked, so wear what it kept
    let v = social::request(acc, "POST", "/cosmetics", Some(body)).await?;
    let look = &serde_json::from_value::<Look>(v).unwrap_or_else(|_| look.clone());
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
        o.insert("pet".into(), json!(look.pet));
        o.insert("petLeft".into(), json!(look.pet_left));
        o.insert("nametag".into(), json!(look.nametag));
        o.insert("icon".into(), json!(look.icon));
        o.insert("petName".into(), json!(look.pet_name));
        o.insert("petColor".into(), json!(look.pet_color));
        o.insert("plainTag".into(), json!(look.plain_tag));
        o.insert("auraRainbow".into(), json!(look.aura_color == -1));
        if look.aura_color != -1 {
            o.insert("auraColor".into(), json!(look.aura_color & 0xFFFFFF));
        }
        if let Some(parent) = file.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&file, serde_json::to_string_pretty(&cfg)?);
    }
    Ok(look.clone())
}
