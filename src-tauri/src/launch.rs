//! Puts everything together and starts the game.

use anyhow::{Context, Result};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

use crate::config;
use crate::fabric::Fabric;
use crate::minecraft::{rules_allow, Vanilla};
use crate::paths::{classpath_separator, native, Paths};
use crate::store::{Account, Profile};

pub struct Plan {
    pub java: PathBuf,
    pub vanilla: Vanilla,
    pub fabric: Fabric,
    pub extra_mods: Vec<PathBuf>,
    pub game_dir: PathBuf,
    pub profile: Profile,
    pub account: Account,
}

/// The full java command line (also shown in the logs for debugging, with the token hidden).
pub fn arguments(paths: &Paths, plan: &Plan) -> Vec<String> {
    let v = &plan.vanilla.json;
    let sep = classpath_separator();

    // classpath: vanilla libraries, Fabric's replace the same ones (e.g. ASM), then the game jar
    let mut libs: Vec<(String, PathBuf)> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    for (key, path) in plan.vanilla.libraries.iter().chain(plan.fabric.libraries.iter()) {
        if let Some(&i) = index.get(key) {
            libs[i] = (key.clone(), path.clone());
        } else {
            index.insert(key.clone(), libs.len());
            libs.push((key.clone(), path.clone()));
        }
    }
    let mut cp: Vec<String> = libs.iter().map(|(_, p)| native(p)).collect();
    cp.push(native(&plan.vanilla.client_jar));
    let classpath = cp.join(sep);

    let natives = paths.versions().join(&plan.vanilla.id).join("natives");
    let _ = std::fs::create_dir_all(&natives);
    let p = &plan.profile;
    let mut vars: HashMap<&str, String> = HashMap::new();
    vars.insert("auth_player_name", plan.account.name.clone());
    vars.insert("version_name", plan.vanilla.id.clone());
    vars.insert("game_directory", native(&plan.game_dir));
    vars.insert("assets_root", native(&paths.assets()));
    vars.insert("assets_index_name", plan.vanilla.assets_index.clone());
    vars.insert("auth_uuid", plan.account.uuid.replace('-', ""));
    vars.insert("auth_access_token", plan.account.mc_token.clone());
    vars.insert("clientid", config::BROWSER_CLIENT_ID.to_string());
    vars.insert("auth_xuid", if plan.account.xuid.is_empty() { "0".into() } else { plan.account.xuid.clone() });
    vars.insert("user_type", "msa".into());
    vars.insert("version_type", "Com Client".into());
    vars.insert("natives_directory", native(&natives));
    vars.insert("launcher_name", config::LAUNCHER_NAME.into());
    vars.insert("launcher_version", env!("CARGO_PKG_VERSION").into());
    vars.insert("classpath", classpath);
    vars.insert("classpath_separator", sep.into());
    vars.insert("library_directory", native(&paths.libraries()));
    vars.insert("resolution_width", p.width.to_string());
    vars.insert("resolution_height", p.height.to_string());
    vars.insert("user_properties", "{}".into());

    let mut features = HashMap::new();
    features.insert("has_custom_resolution", !p.fullscreen && p.width > 0 && p.height > 0);

    let fill = |s: &str| -> String {
        let mut out = s.to_string();
        for (k, v) in &vars {
            out = out.replace(&format!("${{{k}}}"), v);
        }
        out
    };
    let collect = |list: &Value, out: &mut Vec<String>| {
        for a in list.as_array().cloned().unwrap_or_default() {
            match &a {
                Value::String(s) => out.push(fill(s)),
                Value::Object(_) => {
                    if rules_allow(a.get("rules"), &features) {
                        match &a["value"] {
                            Value::String(s) => out.push(fill(s)),
                            Value::Array(arr) => out.extend(arr.iter().filter_map(|x| x.as_str()).map(|s| fill(s))),
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }
    };

    let mut args = Vec::new();
    // memory first, then the player's own arguments (they may override the defaults)
    args.push(format!("-Xmx{}M", p.ram_mb.max(512)));
    // the whole heap up front: no stutters while Java grows it
    args.push(format!("-Xms{}M", p.ram_mb.max(512)));
    args.extend(
        ["-XX:+UnlockExperimentalVMOptions", "-XX:+UseG1GC", "-XX:G1NewSizePercent=20", "-XX:G1ReservePercent=20",
         "-XX:MaxGCPauseMillis=50", "-XX:G1HeapRegionSize=32M", "-XX:+ParallelRefProcEnabled", "-XX:+DisableExplicitGC"]
            .iter()
            .map(|s| s.to_string()),
    );
    args.extend(split_args(&p.java_args));
    collect(&v["arguments"]["jvm"], &mut args);
    args.extend(plan.fabric.jvm_args.iter().map(|s| fill(s)));
    if let Some((path, arg)) = &plan.vanilla.log_config {
        args.push(arg.replace("${path}", &native(path)));
    }
    if !plan.extra_mods.is_empty() {
        let list: Vec<String> = plan.extra_mods.iter().map(|p| native(p)).collect();
        args.push(format!("-Dfabric.addMods={}", list.join(sep)));
    }
    args.push(plan.fabric.main_class.clone());
    collect(&v["arguments"]["game"], &mut args);
    args.extend(plan.fabric.game_args.iter().map(|s| fill(s)));
    if p.fullscreen {
        args.push("--fullscreen".into());
    }
    args
}

/// "a b \"c d\"" -> [a, b, c d]
pub fn split_args(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote = false;
    for c in s.chars() {
        match c {
            '"' => quote = !quote,
            c if c.is_whitespace() && !quote => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
            c => cur.push(c),
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// Starts the game. Every log line goes to `on_line`.
pub fn spawn(paths: &Paths, plan: &Plan, on_line: impl Fn(String) + Send + Sync + 'static) -> Result<Child> {
    std::fs::create_dir_all(&plan.game_dir)?;
    let args = arguments(paths, plan);
    let shown: Vec<String> = args
        .iter()
        .map(|a| if !plan.account.mc_token.is_empty() && a.contains(&plan.account.mc_token) { "<token hidden>".to_string() } else { a.clone() })
        .collect();
    on_line(format!("[Launcher] {} {}", native(&plan.java), shown.join(" ")));
    let mut cmd = Command::new(&plan.java);
    cmd.args(&args).current_dir(&plan.game_dir).stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
    #[cfg(windows)]
    {
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().with_context(|| format!("Couldn't start Java ({})", native(&plan.java)))?;
    let on_line = std::sync::Arc::new(on_line);
    if let Some(out) = child.stdout.take() {
        let f = on_line.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(out).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                f(l);
            }
        });
    }
    if let Some(err) = child.stderr.take() {
        let f = on_line.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                f(l);
            }
        });
    }
    Ok(child)
}

/// The newest crash report written after `since` (unix seconds).
pub fn crash_report(game_dir: &std::path::Path, since: i64) -> Option<PathBuf> {
    let dir = game_dir.join("crash-reports");
    let mut best: Option<(i64, PathBuf)> = None;
    for e in std::fs::read_dir(dir).ok()?.flatten() {
        let t = e
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        if t >= since && best.as_ref().map(|(bt, _)| t > *bt).unwrap_or(true) {
            best = Some((t, e.path()));
        }
    }
    best.map(|(_, p)| p)
}

#[cfg(test)]
mod tests {
    use super::split_args;
    #[test]
    fn split() {
        assert_eq!(split_args("-Da=1  \"-Db=x y\""), vec!["-Da=1", "-Db=x y"]);
    }
}

#[cfg(test)]
mod plan_tests {
    use super::*;
    use crate::fabric::Fabric;
    use crate::minecraft::Vanilla;
    use crate::store::{Account, Profile};

    #[test]
    fn builds_a_command_line() {
        let json: Value = serde_json::from_str(r#"{
          "arguments": {
            "game": ["--username", "${auth_player_name}", "--version", "${version_name}", "--gameDir", "${game_directory}",
                     "--assetsDir", "${assets_root}", "--assetIndex", "${assets_index_name}", "--uuid", "${auth_uuid}",
                     "--accessToken", "${auth_access_token}", "--clientId", "${clientid}", "--xuid", "${auth_xuid}",
                     "--userType", "${user_type}", "--versionType", "${version_type}",
                     {"rules": [{"action": "allow", "features": {"is_demo_user": true}}], "value": "--demo"},
                     {"rules": [{"action": "allow", "features": {"has_custom_resolution": true}}],
                      "value": ["--width", "${resolution_width}", "--height", "${resolution_height}"]}],
            "jvm": [{"rules": [{"action": "allow", "os": {"name": "osx"}}], "value": ["-XstartOnFirstThread"]},
                    "-Djava.library.path=${natives_directory}", "-Dminecraft.launcher.brand=${launcher_name}",
                    "-cp", "${classpath}"]
          }
        }"#).unwrap();
        let paths = Paths::new(std::env::temp_dir().join("cc-launch-test"));
        let plan = Plan {
            java: PathBuf::from("java"),
            vanilla: Vanilla {
                id: "1.21.11".into(),
                json,
                client_jar: PathBuf::from("/x/client.jar"),
                libraries: vec![("org.ow2.asm:asm".into(), PathBuf::from("/x/asm-9.6.jar")), ("a:b".into(), PathBuf::from("/x/b.jar"))],
                assets_index: "26".into(),
                log_config: Some((PathBuf::from("/x/log.xml"), "-Dlog4j.configurationFile=${path}".into())),
            },
            fabric: Fabric {
                loader: "fabric-loader-0.17.0-1.21.11".into(),
                main_class: "net.fabricmc.loader.impl.launch.knot.KnotClient".into(),
                libraries: vec![("org.ow2.asm:asm".into(), PathBuf::from("/x/asm-9.8.jar"))],
                jvm_args: vec!["-DFabricMcEmu= net.minecraft.client.main.Main ".into()],
                game_args: vec![],
            },
            extra_mods: vec![PathBuf::from("/x/com.jar"), PathBuf::from("/x/fapi.jar")],
            game_dir: PathBuf::from("/g"),
            profile: Profile { ram_mb: 4096, java_args: "-Dfoo=1".into(), ..Default::default() },
            account: Account { uuid: "11111111-2222-3333-4444-555555555555".into(), name: "Steve".into(), flow: "browser".into(),
                refresh_token: String::new(), mc_token: "TOKEN".into(), mc_expires: 0, skin_url: String::new(), xuid: "77".into() },
        };
        let a = arguments(&paths, &plan);
        let s = a.join(" ");
        println!("{s}");
        assert!(a.contains(&"-Xmx4096M".to_string()));
        assert!(a.contains(&"-Dfoo=1".to_string()));
        assert!(!s.contains("XstartOnFirstThread") || cfg!(target_os = "macos"));
        let cp = &a[a.iter().position(|x| x == "-cp").unwrap() + 1];
        assert!(cp.contains("asm-9.8.jar") && !cp.contains("asm-9.6.jar") && cp.ends_with("client.jar"));
        assert!(s.contains("-Dfabric.addMods=/x/com.jar"));
        assert!(s.contains("--width 1280 --height 720") && !s.contains("--demo"));
        assert!(s.contains("--uuid 11111111222233334444555555555555") && s.contains("--accessToken TOKEN") && s.contains("--xuid 77"));
        let main = a.iter().position(|x| x == "net.fabricmc.loader.impl.launch.knot.KnotClient").unwrap();
        assert!(a.iter().position(|x| x == "--username").unwrap() > main && a.iter().position(|x| x == "-cp").unwrap() < main);
        assert!(!s.contains("${"));
    }
}
