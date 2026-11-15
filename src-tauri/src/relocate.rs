//! Moves the launcher's files from the old folder in AppData ("net.comclient.launcher", named after the app's id)
//! to "comclient", which people can find and recognise. Runs at every start until the old folder is gone: a file
//! that is still open (a game that kept running through the update) stays behind and moves on a later start.

use std::path::{Path, PathBuf};

/// The folder the launcher uses: `%APPDATA%\comclient`, next to the old one.
pub fn new_root(old_root: &Path) -> PathBuf {
    old_root.parent().map(|p| p.join("comclient")).unwrap_or_else(|| old_root.to_path_buf())
}

/// Moves everything from `old` into `new` and returns the folder to use. The first move is all or nothing: when
/// Windows won't move the whole folder (a game from before the update is still running), the old folder is used
/// for now and the move happens on a later start. If `new` exists already, whole folders and files that aren't in
/// `new` move over (never half a world), and clashes stay in `old`.
pub fn migrate(old: &Path, new: &Path) -> PathBuf {
    if old == new || !old.exists() {
        return new.to_path_buf();
    }
    if !new.exists() {
        if std::fs::rename(old, new).is_err() {
            return old.to_path_buf();
        }
        after_move(old, new);
        return new.to_path_buf();
    }
    merge(old, new);
    after_move(old, new);
    remove_empty(old);
    new.to_path_buf()
}

/// Moves `src`'s entries into `dst` one whole file or folder at a time; folders in both are merged inside.
fn merge(src: &Path, dst: &Path) {
    let Ok(rd) = std::fs::read_dir(src) else { return };
    for e in rd.flatten() {
        let from = e.path();
        let to = dst.join(e.file_name());
        if !to.exists() {
            let _ = std::fs::rename(&from, &to);
        } else if from.is_dir() && to.is_dir() {
            merge(&from, &to);
        }
    }
}

/// Removes `dir` and the empty folders inside it (nothing that still holds a file).
fn remove_empty(dir: &Path) -> bool {
    let Ok(rd) = std::fs::read_dir(dir) else { return false };
    let mut empty = true;
    for e in rd.flatten() {
        let p = e.path();
        if !(p.is_dir() && remove_empty(&p)) {
            empty = false;
        }
    }
    empty && std::fs::remove_dir(dir).is_ok()
}

/// The saved lists that hold full paths (a profile's own game folder, a custom client jar ...) now point into the
/// new folder; the list of checked downloads is made again; desktop shortcuts get their icons back.
fn after_move(old: &Path, new: &Path) {
    let (o, n) = (old.to_string_lossy().to_string(), new.to_string_lossy().to_string());
    // in JSON a Windows path has doubled backslashes
    let esc = |s: &str| serde_json::to_string(s).map(|q| q[1..q.len() - 1].to_string()).unwrap_or_default();
    let (oe, ne) = (esc(&o), esc(&n));
    if let Ok(rd) = std::fs::read_dir(new) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().is_some_and(|x| x == "json") {
                if let Ok(t) = std::fs::read_to_string(&p) {
                    if t.contains(&oe) {
                        let _ = std::fs::write(&p, t.replace(&oe, &ne));
                    }
                }
            }
        }
    }
    let _ = std::fs::remove_file(new.join("cache").join("checked.json"));
    fix_shortcut_icons(&o, &n);
}

/// Desktop shortcuts made by the launcher use a picture from its folder: point them at the new one.
fn fix_shortcut_icons(old: &str, new: &str) {
    if cfg!(not(windows)) {
        return;
    }
    let script = r#"
$desktop = [Environment]::GetFolderPath('Desktop')
$sh = New-Object -ComObject WScript.Shell
Get-ChildItem -Path $desktop -Filter '*.lnk' -ErrorAction SilentlyContinue | ForEach-Object {
  try {
    $s = $sh.CreateShortcut($_.FullName)
    if ($s.IconLocation -and $s.IconLocation.StartsWith($env:CC_OLD, [StringComparison]::OrdinalIgnoreCase)) {
      $s.IconLocation = $env:CC_NEW + $s.IconLocation.Substring($env:CC_OLD.Length)
      $s.Save()
    }
  } catch {}
}
"#;
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]).env("CC_OLD", old).env("CC_NEW", new);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // no console window
    }
    let _ = cmd.output();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("cc-reloc-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn moves_everything_and_fixes_paths() {
        let base = tmp("all");
        let old = base.join("net.comclient.launcher");
        std::fs::create_dir_all(old.join("profiles").join("p1")).unwrap();
        std::fs::write(old.join("profiles").join("p1").join("options.txt"), "x").unwrap();
        let mut o = serde_json::to_string(&old.join("client").join("my.jar").to_string_lossy().to_string()).unwrap();
        o = format!(r#"{{"custom_client_jar":{o}}}"#);
        std::fs::write(old.join("settings.json"), &o).unwrap();
        let new = new_root(&old);
        assert_eq!(new, base.join("comclient"));
        assert_eq!(migrate(&old, &new), new);
        assert!(!old.exists(), "the old folder is gone");
        assert!(new.join("profiles").join("p1").join("options.txt").is_file());
        let s = std::fs::read_to_string(new.join("settings.json")).unwrap();
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["custom_client_jar"].as_str().unwrap(), new.join("client").join("my.jar").to_string_lossy());
        // a second start: nothing to do
        assert_eq!(migrate(&old, &new), new);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn merges_into_an_existing_folder() {
        let base = tmp("merge");
        let old = base.join("net.comclient.launcher");
        let new = base.join("comclient");
        std::fs::create_dir_all(old.join("profiles").join("a")).unwrap();
        std::fs::write(old.join("profiles").join("a").join("f.txt"), "old").unwrap();
        std::fs::write(old.join("keep.txt"), "old").unwrap();
        std::fs::create_dir_all(new.join("profiles")).unwrap();
        std::fs::write(new.join("keep.txt"), "new").unwrap();
        assert_eq!(migrate(&old, &new), new);
        assert_eq!(std::fs::read_to_string(new.join("profiles").join("a").join("f.txt")).unwrap(), "old");
        assert_eq!(std::fs::read_to_string(new.join("keep.txt")).unwrap(), "new", "a clash keeps the new file");
        assert!(old.join("keep.txt").is_file(), "the clashing old file stays");
        let _ = std::fs::remove_dir_all(&base);
    }
}
