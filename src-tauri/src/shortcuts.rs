//! Desktop shortcuts that start one profile straight away ("Com Client PvP"): a Windows .lnk to the launcher with
//! `--play <profile id>`, with the profile's own picture as its icon.

use anyhow::{bail, Context, Result};
use base64::Engine;
use std::path::{Path, PathBuf};

/// The profile id in the launcher's command line (`--play <id>`), if it was started from a shortcut.
pub fn play_arg<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    let mut it = args.into_iter();
    while let Some(a) = it.next() {
        if a == "--play" {
            return it.next().filter(|id| !id.is_empty());
        }
        if let Some(id) = a.strip_prefix("--play=") {
            return Some(id.to_string()).filter(|id| !id.is_empty());
        }
    }
    None
}

/// A file name Windows accepts, from the profile's name.
pub fn file_name(profile_name: &str) -> String {
    let clean: String = profile_name
        .chars()
        .map(|c| if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control() { ' ' } else { c })
        .collect();
    let clean = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    let clean = clean.trim_matches('.').trim();
    format!("{} - Com Client.lnk", if clean.is_empty() { "Profile" } else { clean })
}

/// Saves the profile's picture (a PNG, as base64 or a data: URL) as a Windows icon (.ico) and returns its path.
pub fn write_icon(dir: &Path, profile_id: &str, png: &str) -> Result<PathBuf> {
    let b64 = png.split_once("base64,").map(|(_, b)| b).unwrap_or(png);
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64.trim()).context("Bad picture")?;
    let img = image::load_from_memory(&bytes).context("Bad picture")?;
    let img = img.resize_exact(256, 256, image::imageops::FilterType::Nearest);
    std::fs::create_dir_all(dir)?;
    let safe_id: String = profile_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
    let path = dir.join(format!("{}.ico", if safe_id.is_empty() { "profile".into() } else { safe_id }));
    img.save_with_format(&path, image::ImageFormat::Ico)?;
    Ok(path)
}

/// Creates the shortcut on the desktop. Returns where it went.
pub fn create(profile_id: &str, profile_name: &str, icon: Option<&Path>) -> Result<PathBuf> {
    if cfg!(not(windows)) {
        bail!("Desktop shortcuts are only made on Windows");
    }
    let exe = std::env::current_exe().context("Can't find the launcher's own file")?;
    let name = file_name(profile_name);
    // everything goes in through environment variables, so names with quotes or $ can't break the script
    let script = r#"
$ErrorActionPreference = 'Stop'
$desktop = [Environment]::GetFolderPath('Desktop')
$path = Join-Path $desktop $env:CC_NAME
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($path)
$s.TargetPath = $env:CC_EXE
$s.Arguments = '--play ' + $env:CC_PROFILE
$s.WorkingDirectory = Split-Path $env:CC_EXE
$s.Description = 'Start ' + $env:CC_TITLE + ' in Com Client'
if ($env:CC_ICON) { $s.IconLocation = $env:CC_ICON + ',0' }
$s.Save()
Write-Output $path
"#;
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
        .env("CC_NAME", &name)
        .env("CC_EXE", &exe)
        .env("CC_PROFILE", profile_id)
        .env("CC_TITLE", profile_name)
        .env("CC_ICON", icon.map(|p| p.as_os_str().to_owned()).unwrap_or_default());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // no console window
    }
    let out = cmd.output().context("Couldn't start PowerShell to make the shortcut")?;
    if !out.status.success() {
        let e = String::from_utf8_lossy(&out.stderr);
        bail!("Couldn't make the shortcut: {}", e.lines().find(|l| !l.trim().is_empty()).unwrap_or("unknown error"));
    }
    Ok(PathBuf::from(String::from_utf8_lossy(&out.stdout).trim()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_profile_from_the_command_line() {
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(play_arg(a(&["launcher.exe", "--play", "p1234"])), Some("p1234".into()));
        assert_eq!(play_arg(a(&["launcher.exe", "--play=p9"])), Some("p9".into()));
        assert_eq!(play_arg(a(&["launcher.exe"])), None);
        assert_eq!(play_arg(a(&["launcher.exe", "--play"])), None);
    }

    #[test]
    fn safe_file_names() {
        assert_eq!(file_name("PvP 1.8.9"), "PvP 1.8.9 - Com Client.lnk");
        assert_eq!(file_name("a/b:c*?"), "a b c - Com Client.lnk");
        assert_eq!(file_name("  ..  "), "Profile - Com Client.lnk");
    }

    #[test]
    fn icon_from_a_png() {
        let dir = std::env::temp_dir().join(format!("cc-ico-{}", std::process::id()));
        let mut png = Vec::new();
        image::DynamicImage::new_rgba8(16, 16).write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).unwrap();
        let data = format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(&png));
        let p = write_icon(&dir, "p../x1", &data).unwrap();
        assert_eq!(p.file_name().unwrap(), "px1.ico");
        assert!(std::fs::read(&p).unwrap().starts_with(&[0, 0, 1, 0]));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
