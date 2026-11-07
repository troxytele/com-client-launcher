//! Everything you may want to change in one place.

/// The Minecraft version Com Client is made for.
pub const MC_VERSION: &str = "1.21.11";

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
