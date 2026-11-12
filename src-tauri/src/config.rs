//! Everything you may want to change in one place.

/// The Minecraft version Com Client is made for.
pub const MC_VERSION: &str = "1.21.11";

/// Older versions a profile can use. They run on Legacy Fabric (legacyfabric.net) with Legacy Fabric API, and Java 8
/// from Mojang. Com Client for them comes from a release asset with the version in its name (e.g. com-client-1.8.9.jar);
/// until there is one, the profile starts without it.
pub const LEGACY_VERSIONS: &[&str] = &["1.8.9"];

/// Every version a profile can pick.
pub fn supported(mc: &str) -> bool {
    mc == MC_VERSION || LEGACY_VERSIONS.contains(&mc)
}

pub fn is_legacy(mc: &str) -> bool {
    LEGACY_VERSIONS.contains(&mc)
}

/// The Modrinth loader names of a version's mods. Old-version mods are tagged "legacy-fabric", older uploads plain
/// "fabric" (with the old game version, so the version filter keeps out modern mods).
pub fn mod_loaders(mc: &str) -> Vec<&'static str> {
    if is_legacy(mc) { vec!["legacy-fabric", "fabric"] } else { vec!["fabric"] }
}

/// The Minecraft version a profile runs (an unknown or empty one = the main version).
pub fn profile_mc(p: &crate::store::Profile) -> String {
    if supported(p.version.trim()) { p.version.trim().to_string() } else { MC_VERSION.to_string() }
}

/// GitHub repo of the Com Client MOD. The launcher installs the .jar of its newest release
/// (push a tag like `v0.2.0` there and the GitHub Action builds and publishes it).
/// Replace YOUR_GITHUB_NAME with your GitHub user name.
pub const CLIENT_REPO: &str = "troxytele/com-client-releases";

/// GitHub repo of this LAUNCHER (its releases are the launcher updates, news.json is read from it).
pub const LAUNCHER_REPO: &str = "troxytele/com-client-launcher";

/// The Com Client backend (friends, profiles).
pub const API_URL: &str = "https://com-client.onrender.com";

/// Microsoft sign-in. These are public Microsoft client IDs (the same ones the mod uses). Once you have your own
/// approved Azure app, put its ID in BROWSER_CLIENT_ID.
pub const BROWSER_CLIENT_ID: &str = "00000000402b5328";
pub const BROWSER_SCOPE: &str = "XboxLive.signin offline_access";
pub const BROWSER_REDIRECT: &str = "https://login.live.com/oauth20_desktop.srf";
pub const DEVICE_CLIENT_ID: &str = "00000000441cc96b";
pub const DEVICE_SCOPE: &str = "service::user.auth.xboxlive.com::MBI_SSL";

/// Discord application for the launcher's Rich Presence. Empty = use the discordAppId from the mod's
/// config/comclient/client.json (if there is one), otherwise no Rich Presence.
pub const DISCORD_APP_ID: &str = "1568597886856462417"; // same Discord application as the mod

pub const LAUNCHER_NAME: &str = "ComClientLauncher";

pub fn user_agent() -> String {
    format!("{}/{}", LAUNCHER_NAME, env!("CARGO_PKG_VERSION"))
}
