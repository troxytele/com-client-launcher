//! Other launchers' instances (Minecraft Launcher, Modrinth App, Prism, CurseForge, Lunar, NoRisk ...):
//! copy their settings, keybinds and server list into a profile, or bring a whole instance over as a new profile
//! (with its packs, shaders, worlds, and its mods when they are Fabric mods for the launcher's Minecraft version).

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
    /// resource packs in its resourcepacks folder, and their size in bytes
    pub packs: usize,
    pub packs_bytes: u64,
    /// Minecraft version and mod loader when we can tell ("" when not)
    pub version: String,
    pub loader: String,
    pub mods: usize,
    /// its mods would run in Com Client (Fabric, the launcher's Minecraft version)
    pub mods_ok: bool,
    pub shaders: usize,
    pub worlds: usize,
    pub worlds_bytes: u64,
}

fn count_dir(p: &Path, f: impl Fn(&Path) -> bool) -> usize {
    std::fs::read_dir(p).map(|rd| rd.flatten().filter(|e| f(&e.path())).count()).unwrap_or(0)
}

fn jars(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir.join("mods"))
        .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("jar"))).collect())
        .unwrap_or_default()
}

/// A mod jar's fabric.mod.json (None for non-Fabric jars).
fn fabric_meta(jar: &Path) -> Option<serde_json::Value> {
    use std::io::Read;
    let mut z = zip::ZipArchive::new(std::fs::File::open(jar).ok()?).ok()?;
    let mut e = z.by_name("fabric.mod.json").ok()?;
    let mut t = String::new();
    e.read_to_string(&mut t).ok()?;
    serde_json::from_str(&t).ok()
}

/// Minecraft version and loader of an instance: from the launcher's own instance file when there is one, otherwise
/// guessed from its mods.
fn detect(dir: &Path) -> (String, String) {
    let read = |p: PathBuf| std::fs::read_to_string(p).ok().and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());
    let parent = dir.parent().unwrap_or(dir).to_path_buf();
    // Prism / MultiMC: mmc-pack.json next to the .minecraft folder
    if let Some(v) = read(parent.join("mmc-pack.json")) {
        let comps = v["components"].as_array().cloned().unwrap_or_default();
        let ver = comps.iter().find(|c| c["uid"] == "net.minecraft").and_then(|c| c["version"].as_str()).unwrap_or_default();
        let loader = comps.iter().find_map(|c| match c["uid"].as_str()? {
            "net.fabricmc.fabric-loader" => Some("Fabric"),
            "org.quiltmc.quilt-loader" => Some("Quilt"),
            "net.minecraftforge" => Some("Forge"),
            "net.neoforged" => Some("NeoForge"),
            _ => None,
        });
        return (ver.to_string(), loader.unwrap_or("Vanilla").to_string());
    }
    // CurseForge: minecraftinstance.json in the instance folder
    if let Some(v) = read(dir.join("minecraftinstance.json")) {
        let ver = v["gameVersion"].as_str().unwrap_or_default().to_string();
        let name = v["baseModLoader"]["name"].as_str().unwrap_or_default().to_lowercase();
        let loader = if name.starts_with("fabric") { "Fabric" } else if name.starts_with("neoforge") { "NeoForge" } else if name.starts_with("forge") { "Forge" } else if name.starts_with("quilt") { "Quilt" } else { "Vanilla" };
        return (ver, loader.to_string());
    }
    // Modrinth App (older versions): profile.json in the profile folder
    if let Some(v) = read(dir.join("profile.json")) {
        let m = &v["metadata"];
        if let Some(ver) = m["game_version"].as_str() {
            let l = m["loader"].as_str().unwrap_or("vanilla");
            let loader = match l { "fabric" => "Fabric", "quilt" => "Quilt", "forge" => "Forge", "neoforge" => "NeoForge", _ => "Vanilla" };
            return (ver.to_string(), loader.to_string());
        }
    }
    // otherwise: what the mods say
    let list = jars(dir);
    if list.is_empty() {
        return (String::new(), String::new());
    }
    let mut fabric = 0;
    let mut fits = 0;
    for j in list.iter().take(120) {
        if let Some(meta) = fabric_meta(j) {
            fabric += 1;
            let mc = meta["depends"]["minecraft"].to_string();
            if mc.contains(crate::config::MC_VERSION) {
                fits += 1;
            }
        }
    }
    if fabric == 0 {
        return (String::new(), "Not Fabric".into());
    }
    (if fits * 2 >= fabric.min(10) && fits > 0 { crate::config::MC_VERSION.into() } else { String::new() }, "Fabric".into())
}

/// Size of a file or a whole folder.
fn size_of(p: &Path) -> u64 {
    if p.is_file() {
        return std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
    }
    std::fs::read_dir(p).map(|rd| rd.flatten().map(|e| size_of(&e.path())).sum()).unwrap_or(0)
}

/// The packs (zip files and unpacked folders) in a game folder.
fn packs_in(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir.join("resourcepacks"))
        .map(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .filter(|p| p.is_dir() || p.extension().is_some_and(|x| x.eq_ignore_ascii_case("zip")))
                .collect()
        })
        .unwrap_or_default()
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

/// A folder that is a game folder even before Minecraft wrote its options.txt (an instance that was never started
/// yet, or a launcher that keeps its settings elsewhere): it has mods, worlds or packs, or its launcher's instance file.
fn looks_like_game_dir(d: &Path) -> bool {
    d.join("options.txt").is_file()
        || d.join("mods").is_dir()
        || d.join("saves").is_dir()
        || d.join("resourcepacks").is_dir()
        || d.join("minecraftinstance.json").is_file()
        || d.join("profile.json").is_file()
        || d.parent().is_some_and(|p| p.join("mmc-pack.json").is_file())
}

/// Every folder below `root` (up to `depth` levels) that has an options.txt (or, with `loose`, that looks like an
/// instance: launchers that keep one folder per instance, where a new one has no options.txt yet).
fn find(root: &Path, depth: usize, loose: bool, out: &mut Vec<PathBuf>) {
    if !root.is_dir() || out.len() > 120 {
        return;
    }
    if root.join("options.txt").is_file() || (loose && looks_like_game_dir(root)) {
        out.push(root.to_path_buf());
        if loose {
            return; // an instance's own subfolders are not instances
        }
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
                find(&p, depth - 1, loose, out);
            }
        }
    }
}

/// The game folder inside a folder someone picked: the folder itself, or its ".minecraft" / "minecraft" folder
/// (Prism, MultiMC and the Minecraft Launcher's installs keep it one level down).
pub fn game_dir_of(dir: &Path) -> Option<PathBuf> {
    for d in [dir.join(".minecraft"), dir.join("minecraft"), dir.to_path_buf()] {
        if d.is_dir() && looks_like_game_dir(&d) {
            return Some(d);
        }
    }
    None
}

/// Which launcher a folder belongs to, from where it is (for a folder someone picked).
fn launcher_of(dir: &Path) -> &'static str {
    let s = dir.to_string_lossy().to_lowercase().replace('\\', "/");
    if dir.parent().is_some_and(|p| p.join("mmc-pack.json").is_file()) || s.contains("prismlauncher") {
        "Prism Launcher"
    } else if dir.join("minecraftinstance.json").is_file() || s.contains("curseforge") {
        "CurseForge"
    } else if s.contains("modrinth") {
        "Modrinth App"
    } else if s.contains("lunarclient") {
        "Lunar Client"
    } else if s.contains("multimc") {
        "MultiMC"
    } else if s.contains("atlauncher") {
        "ATLauncher"
    } else if s.contains("gdlauncher") {
        "GDLauncher"
    } else if s.contains("technic") {
        "Technic"
    } else if s.contains("feather") {
        "Feather"
    } else if s.contains("norisk") {
        "NoRisk Client"
    } else if dir.join("launcher_profiles.json").is_file() {
        "Minecraft Launcher"
    } else {
        "Folder"
    }
}

/// What's in one game folder.
fn source_for(launcher: &str, d: &Path) -> Source {
    let opts = d.join("options.txt");
    let text = std::fs::read_to_string(&opts).unwrap_or_default();
    // instance name: the folder above ".minecraft"/"minecraft", else the folder itself
    let named = if matches!(d.file_name().and_then(|n| n.to_str()), Some(".minecraft") | Some("minecraft")) && launcher != "Minecraft Launcher" {
        d.parent().unwrap_or(d)
    } else {
        d
    };
    let packs = packs_in(d);
    let (version, loader) = detect(d);
    let mods = jars(d).len();
    let saves = d.join("saves");
    let worlds = count_dir(&saves, |p| p.join("level.dat").is_file());
    Source {
        mods_ok: mods > 0 && loader == "Fabric" && version == crate::config::MC_VERSION,
        version,
        loader,
        mods,
        shaders: count_dir(&d.join("shaderpacks"), |p| p.is_dir() || p.extension().is_some_and(|x| x.eq_ignore_ascii_case("zip"))),
        worlds,
        worlds_bytes: if worlds > 0 { size_of(&saves) } else { 0 },
        packs: packs.len(),
        packs_bytes: packs.iter().map(|p| size_of(p)).sum(),
        launcher: launcher.to_string(),
        name: named.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| launcher.to_string()),
        dir: d.to_string_lossy().to_string(),
        modified: if opts.is_file() { modified(&opts) } else { modified(d) },
        servers: d.join("servers.dat").is_file(),
        keybinds: text.lines().filter(|l| l.starts_with("key_")).count(),
    }
}

/// A folder someone picked or typed in: its game folder, as an import source.
pub fn source_from_folder(dir: &Path) -> anyhow::Result<Source> {
    let dir = PathBuf::from(dir.to_string_lossy().trim().trim_matches('"'));
    if dir.is_file() {
        // options.txt (or any file in the game folder) picked instead of the folder
        if let Some(p) = dir.parent() {
            return source_from_folder(p);
        }
    }
    if !dir.is_dir() {
        anyhow::bail!("Can't find the folder {}", dir.display());
    }
    if std::fs::read_dir(&dir).is_err() {
        anyhow::bail!("Windows doesn't let the launcher read {} (it may be open in another program, or need admin rights). Close that launcher and try again.", dir.display());
    }
    let d = game_dir_of(&dir).ok_or_else(|| anyhow::anyhow!("No Minecraft game folder in {} (no options.txt, mods, saves or resource packs).", dir.display()))?;
    Ok(source_for(launcher_of(&d), &d))
}

/// Game folders the Minecraft Launcher's installations use when they're set to their own folder.
fn launcher_install_dirs(mc: &Path) -> Vec<PathBuf> {
    let Ok(t) = std::fs::read_to_string(mc.join("launcher_profiles.json")) else { return vec![] };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) else { return vec![] };
    v["profiles"]
        .as_object()
        .map(|o| o.values().filter_map(|p| p["gameDir"].as_str()).map(PathBuf::from).filter(|p| p.is_dir()).collect())
        .unwrap_or_default()
}

/// Prism / PolyMC keep instances where their settings say (InstanceDir), relative to their data folder.
fn instance_dir_from_cfg(data: &Path, cfg: &str) -> Option<PathBuf> {
    let t = std::fs::read_to_string(data.join(cfg)).ok()?;
    let v = t.lines().find_map(|l| l.strip_prefix("InstanceDir="))?.trim();
    if v.is_empty() {
        return None;
    }
    let p = PathBuf::from(v);
    Some(if p.is_absolute() { p } else { data.join(p) })
}

pub fn scan(own_root: &Path) -> Vec<Source> {
    let ad = appdata();
    let h = home();
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(|| h.join("AppData").join("Local"));
    let docs = h.join("Documents");
    let onedrive_docs = std::env::var_os("OneDrive").map(|o| PathBuf::from(o).join("Documents"));
    // (launcher, folder, how deep to look, loose = one folder per instance, which may not have an options.txt yet)
    let mut roots: Vec<(&str, PathBuf, usize, bool)> = vec![
        ("Minecraft Launcher", ad.join(".minecraft"), 0, false),
        ("Minecraft Launcher", local.join("Packages").join("Microsoft.4297127D64EC6_8wekyb3d8bbwe").join("LocalCache").join("Roaming").join(".minecraft"), 0, false),
        ("Modrinth App", ad.join("ModrinthApp").join("profiles"), 1, true),
        ("Modrinth App", ad.join("com.modrinth.theseus").join("profiles"), 1, true),
        ("Prism Launcher", ad.join("PrismLauncher").join("instances"), 2, true),
        ("PolyMC", ad.join("PolyMC").join("instances"), 2, true),
        ("MultiMC", h.join("MultiMC").join("instances"), 2, true),
        ("CurseForge", h.join("curseforge").join("minecraft").join("Instances"), 1, true),
        ("CurseForge", docs.join("Curseforge").join("Minecraft").join("Instances"), 1, true),
        ("CurseForge", docs.join("Twitch").join("Minecraft").join("Instances"), 1, true),
        ("Lunar Client", h.join(".lunarclient"), 4, false),
        ("NoRisk Client", ad.join("norisk"), 5, false),
        ("Feather", ad.join(".feather"), 4, false),
        ("Badlion", ad.join("Badlion Client"), 3, false),
        ("ATLauncher", ad.join("ATLauncher").join("instances"), 1, true),
        ("GDLauncher", ad.join("gdlauncher_carbon").join("data").join("instances"), 3, true),
        ("GDLauncher", ad.join("gdlauncher_next").join("instances"), 1, true),
        ("Technic", ad.join(".technic").join("modpacks"), 1, true),
        ("LabyMod", ad.join(".minecraft").join("labymod-neo"), 3, false),
    ];
    if let Some(od) = onedrive_docs {
        roots.push(("CurseForge", od.join("Curseforge").join("Minecraft").join("Instances"), 1, true));
    }
    // Prism / PolyMC with their instances moved somewhere else
    for (name, data, cfg) in [("Prism Launcher", ad.join("PrismLauncher"), "prismlauncher.cfg"), ("PolyMC", ad.join("PolyMC"), "polymc.cfg")] {
        if let Some(dir) = instance_dir_from_cfg(&data, cfg) {
            roots.push((name, dir, 2, true));
        }
    }
    // Minecraft Launcher installations with their own game folder
    for d in launcher_install_dirs(&ad.join(".minecraft")) {
        roots.push(("Minecraft Launcher", d, 0, true));
    }
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for (launcher, root, depth, loose) in roots {
        let mut dirs = Vec::new();
        find(&root, depth, loose, &mut dirs);
        for d in dirs {
            // the same folder spelled differently (case, a link) only once
            let key = std::fs::canonicalize(&d).unwrap_or_else(|_| d.clone()).to_string_lossy().to_lowercase();
            if d.starts_with(own_root) || !seen.insert(key) {
                continue;
            }
            // Prism / MultiMC: the instance folder itself holds ".minecraft"; use that
            let d = if loose { game_dir_of(&d).unwrap_or(d) } else { d };
            out.push(source_for(launcher, &d));
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

/// Copies one file or folder, counting bytes for the progress bar.
fn copy_counted(from: &Path, to: &Path, done: &mut u64, total: u64, name: &str, progress: &dyn Fn(u64, u64, &str)) -> std::io::Result<()> {
    if from.is_dir() {
        std::fs::create_dir_all(to)?;
        for e in std::fs::read_dir(from)?.flatten() {
            copy_counted(&e.path(), &to.join(e.file_name()), done, total, name, progress)?;
        }
        return Ok(());
    }
    use std::io::{Read, Write};
    let mut r = std::fs::File::open(from)?;
    let mut w = std::fs::File::create(to)?;
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = r.read(&mut buf)?;
        if n == 0 {
            break;
        }
        w.write_all(&buf[..n])?;
        *done += n as u64;
        progress(*done, total, name);
    }
    Ok(())
}

/// Copies the other instance's resource packs (skips ones that are already there). Returns how many were copied.
pub fn copy_packs(source: &Path, target: &Path, progress: &dyn Fn(u64, u64, &str)) -> anyhow::Result<usize> {
    let dest = target.join("resourcepacks");
    std::fs::create_dir_all(&dest)?;
    let todo: Vec<PathBuf> = packs_in(source)
        .into_iter()
        .filter(|p| {
            let there = dest.join(p.file_name().unwrap_or_default());
            !(there.exists() && size_of(&there) == size_of(p))
        })
        .collect();
    let total: u64 = todo.iter().map(|p| size_of(p)).sum::<u64>().max(1);
    let mut done = 0u64;
    progress(0, total, "");
    for p in &todo {
        let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        copy_counted(p, &dest.join(&name), &mut done, total, &name, progress)?;
    }
    progress(total, total, "");
    Ok(todo.len())
}

/// Copies the chosen parts into `target` (the profile's game folder). Returns what was done.
pub fn apply(source: &str, target: &Path, settings: bool, keybinds: bool, servers: bool) -> anyhow::Result<String> {
    let src = PathBuf::from(source);
    if !settings && !keybinds && !servers {
        return Ok(String::new());
    }
    // an instance that was never started has no options.txt yet: then there are no settings or keybinds to bring
    let src_opts = std::fs::read_to_string(src.join("options.txt")).unwrap_or_default();
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

/// What to bring over when an instance becomes a new profile.
#[derive(serde::Deserialize, Clone, Copy)]
pub struct Parts {
    pub settings: bool,
    pub keybinds: bool,
    pub servers: bool,
    pub packs: bool,
    pub shaders: bool,
    pub worlds: bool,
    pub mods: bool,
}

/// Mods Com Client brings itself: never copied (two copies of the same mod stop the game).
const OWN_MODS: &[&str] = &["fabric-api", "fabric", "comclient", "replaymod", "fabricloader", "java", "minecraft"];
/// Speed mods the launcher can add: when the instance brings its own, the profile uses those instead.
const SPEED_MODS: &[&str] = &["sodium", "lithium", "ferritecore", "entityculling"];

/// Makes a new profile out of another launcher's instance. Returns the new profile's id.
pub fn instance_to_profile(paths: &crate::paths::Paths, source: &Path, name: &str, parts: Parts, progress: &dyn Fn(u64, u64, &str))
    -> anyhow::Result<String> {
    use crate::store::{self, Profile, Profiles};
    if !looks_like_game_dir(source) {
        anyhow::bail!("That folder isn't a Minecraft instance");
    }
    let mut p = Profile::default();
    p.id = format!("p{}", &uuid::Uuid::new_v4().simple().to_string()[..8]);
    p.name = name.trim().chars().take(40).collect::<String>();
    if p.name.is_empty() {
        p.name = "Imported".into();
    }
    p.created = crate::auth::now();
    let dir = store::game_dir(paths, &p);
    std::fs::create_dir_all(&dir)?;

    // settings and the server list
    if parts.settings || parts.keybinds || parts.servers {
        let _ = apply(&source.to_string_lossy(), &dir, parts.settings, parts.keybinds, parts.servers);
    }
    // the folders, all counted for one progress bar
    let mut todo: Vec<(PathBuf, PathBuf, &str)> = Vec::new();
    if parts.packs {
        for f in packs_in(source) {
            todo.push((f.clone(), dir.join("resourcepacks").join(f.file_name().unwrap_or_default()), "resource packs"));
        }
    }
    if parts.shaders && source.join("shaderpacks").is_dir() {
        todo.push((source.join("shaderpacks"), dir.join("shaderpacks"), "shader packs"));
    }
    if parts.worlds && source.join("saves").is_dir() {
        todo.push((source.join("saves"), dir.join("saves"), "worlds"));
    }
    if parts.mods {
        for j in jars(source) {
            let id = fabric_meta(&j).and_then(|m| m["id"].as_str().map(String::from)).unwrap_or_default();
            if OWN_MODS.contains(&id.as_str()) {
                continue;
            }
            if SPEED_MODS.contains(&id.as_str()) {
                p.performance_mods = false;
            }
            todo.push((j.clone(), dir.join("mods").join(j.file_name().unwrap_or_default()), "mods"));
        }
        if source.join("config").is_dir() {
            todo.push((source.join("config"), dir.join("config"), "mod settings"));
        }
    }
    let total: u64 = todo.iter().map(|(f, _, _)| size_of(f)).sum();
    let mut done = 0u64;
    for (from, to, what) in &todo {
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)?;
        }
        copy_counted(from, to, &mut done, total.max(1), what, progress)?;
    }

    let mut ps = Profiles::load(paths);
    let id = p.id.clone();
    ps.list.push(p);
    ps.save(paths)?;
    Ok(id)
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
    fn copies_packs_with_progress() {
        let base = std::env::temp_dir().join(format!("cc-packs-{}", std::process::id()));
        let src = base.join("src");
        let dst = base.join("dst");
        std::fs::create_dir_all(src.join("resourcepacks").join("Folder Pack").join("assets")).unwrap();
        std::fs::write(src.join("resourcepacks").join("a.zip"), vec![1u8; 3000]).unwrap();
        std::fs::write(src.join("resourcepacks").join("Folder Pack").join("assets").join("x.png"), vec![2u8; 1000]).unwrap();
        std::fs::write(src.join("resourcepacks").join("notes.txt"), b"skip me").unwrap();
        let seen = std::sync::Mutex::new(Vec::new());
        let n = copy_packs(&src, &dst, &|d, t, _| seen.lock().unwrap().push((d, t))).unwrap();
        assert_eq!(n, 2);
        assert_eq!(std::fs::read(dst.join("resourcepacks").join("a.zip")).unwrap().len(), 3000);
        assert!(dst.join("resourcepacks").join("Folder Pack").join("assets").join("x.png").is_file());
        assert!(!dst.join("resourcepacks").join("notes.txt").exists());
        assert_eq!(*seen.lock().unwrap().last().unwrap(), (4000, 4000));
        // second time: nothing left to copy
        assert_eq!(copy_packs(&src, &dst, &|_, _, _| {}).unwrap(), 0);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn finds_instances() {
        let base = std::env::temp_dir().join(format!("cc-scan-{}", std::process::id()));
        let inst = base.join("instances").join("PvP").join(".minecraft");
        std::fs::create_dir_all(inst.join("mods")).unwrap();
        std::fs::write(inst.join("options.txt"), "key_key.attack:key.mouse.left\n").unwrap();
        let mut out = Vec::new();
        find(&base.join("instances"), 2, false, &mut out);
        assert_eq!(out, vec![inst.clone()]);
        // an instance that was never started (no options.txt yet) is found too, in a launcher with instance folders
        let fresh = base.join("instances").join("New").join(".minecraft");
        std::fs::create_dir_all(fresh.join("mods")).unwrap();
        let mut out = Vec::new();
        find(&base.join("instances"), 2, true, &mut out);
        let found: Vec<PathBuf> = out.iter().map(|d| game_dir_of(d).unwrap_or(d.clone())).collect();
        assert!(found.contains(&inst) && found.contains(&fresh), "{found:?}");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn a_picked_folder_becomes_a_source() {
        let base = std::env::temp_dir().join(format!("cc-pick-{}", std::process::id()));
        let mc = base.join("My Instance").join(".minecraft");
        std::fs::create_dir_all(mc.join("resourcepacks")).unwrap();
        std::fs::write(mc.join("options.txt"), "key_key.jump:key.keyboard.v\nfov:0.5\n").unwrap();
        // the instance folder, its .minecraft folder or options.txt itself: all lead to the game folder
        for pick in [base.join("My Instance"), mc.clone(), mc.join("options.txt")] {
            let src = source_from_folder(&pick).unwrap();
            assert_eq!(PathBuf::from(&src.dir), mc);
            assert_eq!(src.name, "My Instance");
            assert_eq!(src.keybinds, 1);
        }
        assert!(source_from_folder(&base.join("nope")).is_err());
        // a folder given to the modpack reader is a clear message, not "os error 5"
        let e = crate::modpacks::inspect(&base).err().expect("a folder isn't a pack").to_string();
        assert!(e.contains("folder"), "{e}");
        // settings from an instance without options.txt: nothing to copy, but no error for the server list part
        let empty = base.join("Empty").join(".minecraft");
        std::fs::create_dir_all(empty.join("mods")).unwrap();
        assert!(apply(&empty.to_string_lossy(), &base.join("target"), true, true, false).is_err()); // "Nothing to import"
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn whole_instance_becomes_a_profile() {
        use std::io::Write;
        let root = std::env::temp_dir().join(format!("cc-inst-{}", uuid::Uuid::new_v4().simple()));
        let inst = root.join("Prism").join("My Pack");
        let mc = inst.join(".minecraft");
        std::fs::create_dir_all(mc.join("mods")).unwrap();
        std::fs::create_dir_all(mc.join("saves").join("World").join("region")).unwrap();
        std::fs::write(mc.join("saves").join("World").join("level.dat"), b"x").unwrap();
        std::fs::write(mc.join("options.txt"), "renderDistance:20\nkey_key.jump:key.keyboard.v\n").unwrap();
        std::fs::write(inst.join("mmc-pack.json"), format!(r#"{{"components":[{{"uid":"net.minecraft","version":"{}"}},{{"uid":"net.fabricmc.fabric-loader","version":"0.16"}}]}}"#, crate::config::MC_VERSION)).unwrap();
        for (file, id) in [("sodium.jar", "sodium"), ("fabric-api.jar", "fabric-api"), ("cool.jar", "coolmod")] {
            let mut z = zip::ZipWriter::new(std::fs::File::create(mc.join("mods").join(file)).unwrap());
            z.start_file("fabric.mod.json", zip::write::SimpleFileOptions::default()).unwrap();
            z.write_all(format!(r#"{{"id":"{id}","depends":{{"minecraft":"~{}"}}}}"#, crate::config::MC_VERSION).as_bytes()).unwrap();
            z.finish().unwrap();
        }
        let (v, l) = detect(&mc);
        assert_eq!((v.as_str(), l.as_str()), (crate::config::MC_VERSION, "Fabric"));
        let paths = crate::paths::Paths::new(root.join("launcher"));
        crate::store::Profiles::load(&paths).save(&paths).unwrap();
        let all = Parts { settings: true, keybinds: true, servers: true, packs: true, shaders: true, worlds: true, mods: true };
        let id = instance_to_profile(&paths, &mc, "My Pack", all, &|_, _, _| {}).unwrap();
        let p = crate::store::Profiles::load(&paths).get(&id);
        let dir = crate::store::game_dir(&paths, &p);
        assert!(dir.join("mods").join("sodium.jar").is_file());
        assert!(dir.join("mods").join("cool.jar").is_file());
        assert!(!dir.join("mods").join("fabric-api.jar").exists());
        assert!(dir.join("saves").join("World").join("level.dat").is_file());
        assert!(std::fs::read_to_string(dir.join("options.txt")).unwrap().contains("renderDistance:20"));
        assert!(!p.performance_mods);
        let _ = std::fs::remove_dir_all(&root);
    }
}
