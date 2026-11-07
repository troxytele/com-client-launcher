//! Where the launcher keeps its files (all under one folder in AppData).

use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct Paths {
    pub root: PathBuf,
}

impl Paths {
    pub fn new(root: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&root);
        Paths { root }
    }

    pub fn versions(&self) -> PathBuf {
        self.root.join("versions")
    }
    pub fn libraries(&self) -> PathBuf {
        self.root.join("libraries")
    }
    pub fn assets(&self) -> PathBuf {
        self.root.join("assets")
    }
    pub fn runtime(&self) -> PathBuf {
        self.root.join("runtime")
    }
    /// Com Client + Fabric API live here (not in the mods folder, so nobody removes them by accident).
    pub fn client(&self) -> PathBuf {
        self.root.join("client")
    }
    pub fn profiles(&self) -> PathBuf {
        self.root.join("profiles")
    }
    pub fn file(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }
}

/// a/b/c -> a\b\c on Windows.
pub fn native(p: &Path) -> String {
    p.to_string_lossy().to_string()
}

pub fn os_name() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    }
}

pub fn classpath_separator() -> &'static str {
    if cfg!(windows) {
        ";"
    } else {
        ":"
    }
}

/// Maven "group:artifact:version[:classifier]" -> "group/path/artifact/version/artifact-version[-classifier].jar"
pub fn maven_path(name: &str) -> Option<String> {
    let mut ext = "jar";
    let mut name = name;
    if let Some((n, e)) = name.split_once('@') {
        name = n;
        ext = e;
    }
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() < 3 {
        return None;
    }
    let (group, artifact, version) = (parts[0], parts[1], parts[2]);
    let file = match parts.get(3) {
        Some(classifier) => format!("{artifact}-{version}-{classifier}.{ext}"),
        None => format!("{artifact}-{version}.{ext}"),
    };
    Some(format!("{}/{}/{}/{}", group.replace('.', "/"), artifact, version, file))
}

/// "group:artifact[:classifier]" without the version, to spot the same library twice.
pub fn maven_key(name: &str) -> String {
    let parts: Vec<&str> = name.split('@').next().unwrap_or(name).split(':').collect();
    match parts.len() {
        0..=2 => name.to_string(),
        3 => format!("{}:{}", parts[0], parts[1]),
        _ => format!("{}:{}:{}", parts[0], parts[1], parts[3]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maven() {
        assert_eq!(maven_path("net.fabricmc:fabric-loader:0.16.9").unwrap(), "net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar");
        assert_eq!(maven_path("org.lwjgl:lwjgl:3.3.3:natives-windows").unwrap(), "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar");
        assert_eq!(maven_key("org.ow2.asm:asm:9.6"), "org.ow2.asm:asm");
        assert_eq!(maven_key("org.lwjgl:lwjgl:3.3.3:natives-windows"), "org.lwjgl:lwjgl:natives-windows");
    }
}
