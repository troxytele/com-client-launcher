//! Checks a profile's own mods before the game starts: mods that need another mod that isn't there, the same mod
//! twice, mods made for a different Minecraft version, and mods for another loader (Forge). Each problem comes with a
//! fix the launcher can do in one click (install the missing mod from Modrinth, or switch a mod off).

use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::Read;
use std::path::Path;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Problem {
    /// "missing", "duplicate", "version", "loader"
    pub kind: String,
    /// what's wrong, in plain words
    pub text: String,
    /// the fix: "install" (target = the Modrinth project / mod id) or "disable" (target = the jar's file name)
    pub fix: String,
    pub target: String,
    /// the button's label
    pub fix_label: String,
}

#[derive(Debug, Clone)]
struct ModMeta {
    file: String,
    id: String,
    name: String,
    version: String,
    provides: Vec<String>,
    depends: BTreeMap<String, Value>,
    modified: u64,
}

fn read_entry<R: Read + std::io::Seek>(z: &mut zip::ZipArchive<R>, name: &str) -> Option<Vec<u8>> {
    let mut e = z.by_name(name).ok()?;
    if e.size() > 8 << 20 {
        return None;
    }
    let mut b = Vec::new();
    e.read_to_end(&mut b).ok()?;
    Some(b)
}

fn parse_meta(bytes: &[u8]) -> Option<Value> {
    // some mods put comments or a BOM in fabric.mod.json
    let t = String::from_utf8_lossy(bytes);
    let t = t.trim_start_matches('\u{feff}');
    serde_json::from_str(t).ok()
}

fn strings(v: &Value) -> Vec<String> {
    match v {
        Value::Array(a) => a.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
        Value::String(s) => vec![s.clone()],
        _ => vec![],
    }
}

/// The ids a jar brings: its own, what it "provides", and the mods bundled inside it (one level, like Fabric does).
fn bundled_ids<R: Read + std::io::Seek>(z: &mut zip::ZipArchive<R>, meta: &Value, out: &mut Vec<String>) {
    for j in meta["jars"].as_array().into_iter().flatten() {
        let Some(path) = j["file"].as_str() else { continue };
        let Some(bytes) = read_entry(z, path) else { continue };
        let Ok(mut inner) = zip::ZipArchive::new(std::io::Cursor::new(bytes)) else { continue };
        if let Some(m) = read_entry(&mut inner, "fabric.mod.json").and_then(|b| parse_meta(&b)) {
            if let Some(id) = m["id"].as_str() {
                out.push(id.to_string());
            }
            out.extend(strings(&m["provides"]));
        }
    }
}

enum Jar {
    Fabric(ModMeta),
    /// a Forge / NeoForge / Quilt-only mod: (loader, its name)
    Other(String, String),
    Unknown,
}

fn read_jar(path: &Path) -> Jar {
    let file = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let Ok(f) = std::fs::File::open(path) else { return Jar::Unknown };
    let Ok(mut z) = zip::ZipArchive::new(f) else { return Jar::Unknown };
    if let Some(meta) = read_entry(&mut z, "fabric.mod.json").and_then(|b| parse_meta(&b)) {
        let id = meta["id"].as_str().unwrap_or_default().to_string();
        let mut provides = strings(&meta["provides"]);
        bundled_ids(&mut z, &meta, &mut provides);
        let depends = meta["depends"].as_object().map(|o| o.iter().map(|(k, v)| (k.clone(), v.clone())).collect()).unwrap_or_default();
        let modified = std::fs::metadata(path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        return Jar::Fabric(ModMeta {
            file,
            name: meta["name"].as_str().filter(|s| !s.is_empty()).unwrap_or(&id).to_string(),
            version: meta["version"].as_str().unwrap_or_default().to_string(),
            id,
            provides,
            depends,
            modified,
        });
    }
    let name = file.trim_end_matches(".jar").to_string();
    if z.by_name("META-INF/neoforge.mods.toml").is_ok() {
        return Jar::Other("NeoForge".into(), name);
    }
    if z.by_name("META-INF/mods.toml").is_ok() || z.by_name("mcmod.info").is_ok() {
        return Jar::Other("Forge".into(), name);
    }
    if z.by_name("quilt.mod.json").is_ok() {
        return Jar::Other("Quilt".into(), name);
    }
    Jar::Unknown
}

// ---------------------------------------------------------------- version ranges (Fabric's version predicates)

/// The numbers of a version ("1.21.11-pre1" -> [1, 21, 11]).
fn nums(v: &str) -> Option<Vec<u64>> {
    let core = v.trim().trim_start_matches('v').split(['-', '+']).next()?;
    if core.is_empty() {
        return None;
    }
    core.split('.').map(|p| p.parse::<u64>().ok()).collect()
}

fn cmp(a: &[u64], b: &[u64]) -> std::cmp::Ordering {
    let n = a.len().max(b.len());
    for i in 0..n {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x.cmp(&y);
        }
    }
    std::cmp::Ordering::Equal
}

/// One comparator ("1.21.x", ">=1.21", "~1.21.1", "^1.20", "1.21.11"). None = can't tell (counted as fine).
fn one(pred: &str, have: &[u64]) -> Option<bool> {
    use std::cmp::Ordering::*;
    let p = pred.trim();
    if p.is_empty() || p == "*" {
        return Some(true);
    }
    for (op, f) in [(">=", &[Greater, Equal][..]), ("<=", &[Less, Equal][..]), (">", &[Greater][..]), ("<", &[Less][..])] {
        if let Some(rest) = p.strip_prefix(op) {
            let want = nums(rest)?;
            return Some(f.contains(&cmp(have, &want)));
        }
    }
    if let Some(rest) = p.strip_prefix('~') {
        let want = nums(rest)?;
        let mut upper = want.clone();
        if upper.len() >= 2 {
            upper.truncate(2);
            upper[1] += 1;
        } else {
            upper[0] += 1;
        }
        return Some(cmp(have, &want) != Less && cmp(have, &upper) == Less);
    }
    if let Some(rest) = p.strip_prefix('^') {
        let want = nums(rest)?;
        let upper = vec![want[0] + 1];
        return Some(cmp(have, &want) != Less && cmp(have, &upper) == Less);
    }
    let p = p.trim_start_matches('=');
    if p.contains('x') || p.contains('X') || p.contains('*') {
        // "1.21.x": everything with that start
        let fixed: Vec<&str> = p.split('.').take_while(|s| !matches!(*s, "x" | "X" | "*")).collect();
        let want: Option<Vec<u64>> = fixed.iter().map(|s| s.parse().ok()).collect();
        let want = want?;
        return Some(have.len() >= want.len() && have[..want.len()] == want[..]);
    }
    let want = nums(p)?;
    Some(cmp(have, &want) == Equal)
}

/// A Fabric dependency value (a string with comparators that all have to match, or a list where one has to)
/// against a version. Anything it can't read counts as fine, so a strange range never blocks the game.
pub fn version_fits(dep: &Value, version: &str) -> bool {
    let Some(have) = nums(version) else { return true };
    let check = |s: &str| -> bool { s.split_whitespace().all(|part| one(part, &have).unwrap_or(true)) };
    match dep {
        Value::String(s) => check(s),
        Value::Array(a) => a.is_empty() || a.iter().filter_map(|x| x.as_str()).any(check),
        _ => true,
    }
}

// ---------------------------------------------------------------- the check

/// What the launcher puts in by itself (Com Client, Fabric API and its parts, the speed mods, ReplayMod).
fn builtin(id: &str, perf: bool, replay: bool) -> bool {
    matches!(id, "minecraft" | "java" | "fabricloader" | "fabric" | "fabric-api" | "fabric-api-base" | "comclient" | "legacy-fabric-api" | "mixinextras")
        || id.starts_with("fabric-")
        || id.starts_with("legacy-fabric-")
        || (perf && matches!(id, "sodium" | "lithium" | "ferritecore" | "entityculling"))
        || (replay && id == "replaymod")
}

/// Every problem with the enabled mods in this game folder, for Minecraft `mc`.
pub fn check(game_dir: &Path, mc: &str, perf: bool, replay: bool) -> Vec<Problem> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(game_dir.join("mods")) else { return out };
    let mut mods: Vec<ModMeta> = Vec::new();
    for e in rd.flatten() {
        let p = e.path();
        if !p.extension().is_some_and(|x| x.eq_ignore_ascii_case("jar")) {
            continue; // switched off (.jar.disabled) or not a mod
        }
        match read_jar(&p) {
            Jar::Fabric(m) => mods.push(m),
            Jar::Other(loader, name) => out.push(Problem {
                kind: "loader".into(),
                text: format!("{name} is a {loader} mod: it doesn't work with Fabric and stops the game from starting."),
                fix: "disable".into(),
                target: p.file_name().unwrap_or_default().to_string_lossy().to_string(),
                fix_label: "Switch it off".into(),
            }),
            Jar::Unknown => {}
        }
    }
    mods.sort_by(|a, b| a.file.cmp(&b.file));

    // the same mod twice: keep the newest file, switch the others off
    let mut by_id: HashMap<&str, Vec<&ModMeta>> = HashMap::new();
    for m in &mods {
        if !m.id.is_empty() {
            by_id.entry(m.id.as_str()).or_default().push(m);
        }
    }
    let mut dup_off: HashSet<String> = HashSet::new();
    let mut ids: Vec<&&str> = by_id.keys().collect();
    ids.sort();
    for id in ids {
        let list = &by_id[*id];
        if list.len() < 2 {
            continue;
        }
        let keep = list
            .iter()
            .max_by(|a, b| match (nums(&a.version), nums(&b.version)) {
                (Some(x), Some(y)) if cmp(&x, &y) != std::cmp::Ordering::Equal => cmp(&x, &y),
                _ => a.modified.cmp(&b.modified),
            })
            .unwrap();
        for m in list.iter().filter(|m| m.file != keep.file) {
            dup_off.insert(m.file.clone());
            out.push(Problem {
                kind: "duplicate".into(),
                text: format!("{} is in your mods twice ({} and {}): two copies stop the game.", m.name, m.file, keep.file),
                fix: "disable".into(),
                target: m.file.clone(),
                fix_label: format!("Switch off {}", if m.version.is_empty() { m.file.clone() } else { format!("version {}", m.version) }),
            });
        }
    }
    // a mod Com Client already brings: two copies again
    for m in &mods {
        if (m.id == "fabric-api" || m.id == "comclient" || m.id == "legacy-fabric-api") && !dup_off.contains(&m.file) {
            dup_off.insert(m.file.clone());
            out.push(Problem {
                kind: "duplicate".into(),
                text: format!("{} is built into Com Client already: your copy in the mods folder isn't needed.", m.name),
                fix: "disable".into(),
                target: m.file.clone(),
                fix_label: "Switch it off".into(),
            });
        }
    }

    let active: Vec<&ModMeta> = mods.iter().filter(|m| !dup_off.contains(&m.file)).collect();
    let mut have: HashSet<String> = HashSet::new();
    for m in &active {
        have.insert(m.id.clone());
        have.extend(m.provides.iter().cloned());
    }

    // made for another Minecraft version
    let mut wrong: HashSet<String> = HashSet::new();
    for m in &active {
        if let Some(dep) = m.depends.get("minecraft") {
            if !version_fits(dep, mc) {
                wrong.insert(m.file.clone());
                let wants = match dep {
                    Value::String(s) => s.clone(),
                    other => strings(other).join(" or "),
                };
                out.push(Problem {
                    kind: "version".into(),
                    text: format!("{} is made for Minecraft {} — this profile is {}.", m.name, wants.trim(), mc),
                    fix: "disable".into(),
                    target: m.file.clone(),
                    fix_label: "Switch it off".into(),
                });
            }
        }
    }

    // needs a mod that isn't there (one entry per missing mod, naming who needs it)
    let mut missing: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for m in &active {
        if wrong.contains(&m.file) {
            continue; // switching it off is the fix anyway
        }
        for dep in m.depends.keys() {
            if builtin(dep, perf, replay) || have.contains(dep) {
                continue;
            }
            missing.entry(dep.clone()).or_default().push(m.name.clone());
        }
    }
    for (dep, who) in missing {
        let names = if who.len() > 2 { format!("{}, {} and {} more", who[0], who[1], who.len() - 2) } else { who.join(" and ") };
        out.push(Problem {
            kind: "missing".into(),
            text: format!("{names} need{} the mod \"{dep}\", which isn't installed.", if who.len() == 1 { "s" } else { "" }),
            fix: "install".into(),
            target: dep.clone(),
            fix_label: format!("Install {dep}"),
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Write;

    #[test]
    fn version_ranges() {
        let ok = |d: Value, v: &str| version_fits(&d, v);
        assert!(ok(json!("1.21.11"), "1.21.11"));
        assert!(!ok(json!("1.21.10"), "1.21.11"));
        assert!(ok(json!(">=1.21.9 <1.22"), "1.21.11"));
        assert!(!ok(json!(">=1.21 <1.21.5"), "1.21.11"));
        assert!(ok(json!("~1.21.4"), "1.21.11"));
        assert!(!ok(json!("~1.20.4"), "1.21.11"));
        assert!(ok(json!("1.21.x"), "1.21.11"));
        assert!(!ok(json!("1.20.x"), "1.21.11"));
        assert!(ok(json!(["1.20.6", "1.21.11"]), "1.21.11"));
        assert!(!ok(json!(["1.20.6", "1.21.1"]), "1.21.11"));
        assert!(ok(json!("*"), "1.8.9"));
        assert!(ok(json!("1.8.9"), "1.8.9"));
        assert!(!ok(json!(">=1.21"), "1.8.9"));
        assert!(ok(json!("something odd"), "1.21.11"), "unreadable ranges never block");
    }

    fn jar(dir: &Path, file: &str, meta: Value, nested: Option<(&str, Value)>) {
        let mut z = zip::ZipWriter::new(std::fs::File::create(dir.join(file)).unwrap());
        let o = zip::write::SimpleFileOptions::default();
        let mut meta = meta;
        if let Some((path, inner)) = nested {
            let mut buf = Vec::new();
            {
                let mut iz = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
                iz.start_file("fabric.mod.json", o).unwrap();
                iz.write_all(inner.to_string().as_bytes()).unwrap();
                iz.finish().unwrap();
            }
            z.start_file(path, o).unwrap();
            z.write_all(&buf).unwrap();
            meta["jars"] = json!([{ "file": path }]);
        }
        z.start_file("fabric.mod.json", o).unwrap();
        z.write_all(meta.to_string().as_bytes()).unwrap();
        z.finish().unwrap();
    }

    #[test]
    fn finds_the_problems() {
        let game = std::env::temp_dir().join(format!("cc-modcheck-{}", std::process::id()));
        let mods = game.join("mods");
        std::fs::create_dir_all(&mods).unwrap();
        // fine: needs Fabric API (built in) and Cloth Config (bundled inside it)
        jar(&mods, "fine.jar", json!({"id":"fine","name":"Fine Mod","version":"1.0","depends":{"minecraft":"~1.21.11","fabric-api":"*","cloth-config":">=15"}}),
            Some(("META-INF/jars/cloth.jar", json!({"id":"cloth-config","version":"15.0"}))));
        // needs a mod that isn't there
        jar(&mods, "needy.jar", json!({"id":"needy","name":"Needy","version":"2.0","depends":{"minecraft":"1.21.x","yacl":">=3"}}), None);
        // twice
        jar(&mods, "twice-1.0.jar", json!({"id":"twice","name":"Twice","version":"1.0"}), None);
        jar(&mods, "twice-1.2.jar", json!({"id":"twice","name":"Twice","version":"1.2"}), None);
        // wrong version
        jar(&mods, "old.jar", json!({"id":"old","name":"Old Mod","version":"1","depends":{"minecraft":"1.20.1","needs-nothing-here":"*"}}), None);
        // Fabric API again
        jar(&mods, "fabric-api-0.1.jar", json!({"id":"fabric-api","name":"Fabric API","version":"0.1"}), None);
        // Forge
        {
            let mut z = zip::ZipWriter::new(std::fs::File::create(mods.join("forgey.jar")).unwrap());
            z.start_file("META-INF/mods.toml", zip::write::SimpleFileOptions::default()).unwrap();
            z.write_all(b"modLoader=\"javafml\"").unwrap();
            z.finish().unwrap();
        }
        // switched off: ignored
        std::fs::write(mods.join("off.jar.disabled"), b"x").unwrap();

        let p = check(&game, "1.21.11", true, false);
        let has = |kind: &str, target: &str| p.iter().any(|x| x.kind == kind && x.target == target);
        assert!(has("missing", "yacl"), "{p:#?}");
        assert!(has("duplicate", "twice-1.0.jar"));
        assert!(!has("duplicate", "twice-1.2.jar"));
        assert!(has("version", "old.jar"));
        assert!(!p.iter().any(|x| x.target == "needs-nothing-here"), "a wrong-version mod's own needs aren't asked for");
        assert!(has("duplicate", "fabric-api-0.1.jar"));
        assert!(has("loader", "forgey.jar"));
        assert!(!p.iter().any(|x| x.target == "cloth-config" || x.target == "fabric-api" && x.kind == "missing"));
        assert_eq!(p.len(), 5, "{p:#?}");
        // nothing wrong with no mods at all
        assert!(check(&game.join("none"), "1.21.11", true, false).is_empty());
        let _ = std::fs::remove_dir_all(&game);
    }
}
