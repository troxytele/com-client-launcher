//! Auto-optimise: looks at the PC (memory, processor, graphics card) and picks the memory for the game, turns on
//! the performance mods (Sodium, Lithium, FerriteCore, EntityCulling) and sets the video options to fit.

use anyhow::{anyhow, Result};
use serde::Serialize;
use std::path::Path;

use crate::paths::Paths;
use crate::store::{self, Profiles};

#[derive(Serialize, Clone, Debug)]
pub struct Plan {
    pub ram_total_mb: u32,
    pub cpu: String,
    pub cores: usize,
    pub gpu: String,
    /// "dedicated", "integrated" or "unknown"
    pub gpu_kind: String,
    /// "low", "medium" or "high"
    pub tier: String,
    /// Memory for the game.
    pub ram_mb: u32,
    /// What changes in the video settings (shown to you before applying).
    pub video: Vec<(String, String)>,
}

#[cfg(windows)]
fn gpus() -> Vec<String> {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }"])
        .creation_flags(0x0800_0000)
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect())
        .unwrap_or_default()
}

#[cfg(not(windows))]
fn gpus() -> Vec<String> {
    Vec::new()
}

fn is_dedicated(name: &str) -> bool {
    let n = name.to_lowercase();
    n.contains("geforce") || n.contains("rtx") || n.contains("gtx") || n.contains("quadro")
        || n.contains("radeon rx") || n.contains("radeon pro") || (n.contains("arc") && n.contains("intel") && !n.contains("graphics"))
        || (n.contains("radeon") && !n.contains("radeon(tm) graphics") && !n.contains("radeon graphics") && !n.contains("vega"))
}

fn is_virtual(name: &str) -> bool {
    let n = name.to_lowercase();
    n.contains("basic display") || n.contains("remote") || n.contains("virtual") || n.contains("parsec") || n.contains("meta")
}

/// Looks at the PC and works out the best settings (nothing changes yet).
pub fn scan() -> Plan {
    let mut s = sysinfo::System::new();
    s.refresh_memory();
    s.refresh_cpu_all();
    let ram_total_mb = (s.total_memory() / 1024 / 1024) as u32;
    let cores = s.cpus().len().max(1);
    let cpu = s.cpus().first().map(|c| c.brand().trim().to_string()).unwrap_or_default();

    let list: Vec<String> = gpus().into_iter().filter(|g| !is_virtual(g)).collect();
    let (gpu, gpu_kind) = match list.iter().find(|g| is_dedicated(g)) {
        Some(g) => (g.clone(), "dedicated"),
        None => match list.first() {
            Some(g) => (g.clone(), "integrated"),
            None => (String::new(), "unknown"),
        },
    };

    let tier = if gpu_kind == "dedicated" && ram_total_mb >= 15_000 && cores >= 6 {
        "high"
    } else if gpu_kind == "dedicated" || (ram_total_mb >= 11_000 && cores >= 6) {
        "medium"
    } else {
        "low"
    };
    let ram_mb = match ram_total_mb {
        t if t >= 30_000 => 6144,
        t if t >= 15_000 => 4096,
        t if t >= 11_000 => 3072,
        t if t >= 7_500 => 2560,
        _ => 2048,
    };
    let video: Vec<(&str, &str)> = match tier {
        "high" => vec![
            ("renderDistance", "16"), ("simulationDistance", "10"), ("graphicsMode", "1"), ("maxFps", "260"),
            ("enableVsync", "false"), ("entityShadows", "true"), ("particles", "0"), ("ao", "true"),
            ("biomeBlendRadius", "3"), ("renderClouds", "\"true\""), ("mipmapLevels", "4"), ("entityDistanceScaling", "1.0"),
        ],
        "medium" => vec![
            ("renderDistance", "12"), ("simulationDistance", "8"), ("graphicsMode", "1"), ("maxFps", "260"),
            ("enableVsync", "false"), ("entityShadows", "true"), ("particles", "0"), ("ao", "true"),
            ("biomeBlendRadius", "2"), ("renderClouds", "\"fast\""), ("mipmapLevels", "4"), ("entityDistanceScaling", "1.0"),
        ],
        _ => vec![
            ("renderDistance", "8"), ("simulationDistance", "6"), ("graphicsMode", "0"), ("maxFps", "260"),
            ("enableVsync", "false"), ("entityShadows", "false"), ("particles", "1"), ("ao", "false"),
            ("biomeBlendRadius", "0"), ("renderClouds", "\"false\""), ("mipmapLevels", "2"), ("entityDistanceScaling", "0.75"),
        ],
    };
    Plan {
        ram_total_mb,
        cpu,
        cores,
        gpu,
        gpu_kind: gpu_kind.into(),
        tier: tier.into(),
        ram_mb,
        video: video.into_iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
    }
}

/// options.txt: replaces these keys (adds the missing ones), keeps every other line.
fn write_options(file: &Path, values: &[(String, String)]) -> Result<()> {
    let text = std::fs::read_to_string(file).unwrap_or_default();
    let mut lines: Vec<String> = text.lines().map(String::from).collect();
    for (k, v) in values {
        let prefix = format!("{k}:");
        match lines.iter_mut().find(|l| l.starts_with(&prefix)) {
            Some(l) => *l = format!("{k}:{v}"),
            None => lines.push(format!("{k}:{v}")),
        }
    }
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(file, lines.join("\n") + "\n")?;
    Ok(())
}

/// Applies a plan to a profile: memory, performance mods and (if asked) the video settings.
pub fn apply(paths: &Paths, profile: &str, plan: &Plan, video: bool) -> Result<()> {
    let mut ps = Profiles::load(paths);
    let p = ps.list.iter_mut().find(|p| p.id == profile).ok_or_else(|| anyhow!("That profile doesn't exist"))?;
    p.ram_mb = plan.ram_mb.clamp(1024, store::total_ram_mb().max(2048));
    p.performance_mods = true;
    let dir = store::game_dir(paths, p);
    ps.save(paths)?;
    if video {
        write_options(&dir.join("options.txt"), &plan.video)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn options_merge() {
        let f = std::env::temp_dir().join(format!("cc-opt-{}.txt", uuid::Uuid::new_v4().simple()));
        std::fs::write(&f, "fov:0.5\nrenderDistance:32\n").unwrap();
        write_options(&f, &[("renderDistance".into(), "12".into()), ("maxFps".into(), "260".into())]).unwrap();
        let t = std::fs::read_to_string(&f).unwrap();
        assert!(t.contains("fov:0.5") && t.contains("renderDistance:12") && t.contains("maxFps:260") && !t.contains(":32"));
        let _ = std::fs::remove_file(f);
    }

    #[test]
    fn graphics_cards() {
        assert!(is_dedicated("NVIDIA GeForce RTX 3060"));
        assert!(is_dedicated("AMD Radeon RX 6700 XT"));
        assert!(!is_dedicated("Intel(R) UHD Graphics 620"));
        assert!(!is_dedicated("AMD Radeon(TM) Graphics"));
    }
}
