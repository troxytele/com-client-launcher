# Com Client Launcher

The launcher for Com Client: Microsoft login with several accounts, installs Minecraft 1.21.11 + Fabric + Java by itself,
keeps Com Client and Fabric API up to date (loaded from the launcher's own folder, never in your mods folder),
a Play page (news banner with your 3D player, launch bar with profile switcher), a Skins tab (skin library, wear a skin with one click),
a Crashes page (crash report viewer + analyzer that explains the cause), importing settings / keybinds / servers from other launchers,
optional ReplayMod per profile, colour themes,
profiles, a Modrinth browser for mods / resource packs / shaders with updates, friends from the Com Client server, news,
logs + crash help, Discord Rich Presence and automatic launcher updates.

Built with **Tauri 2**: Rust does the work (`src-tauri/src`), the window is React + TypeScript (`src`).
**You don't need Rust or Node.js on your PC**: GitHub builds the Windows installer for you.

---

## One-time setup (about 15 minutes)

### 1. Two GitHub repositories (both **public**)

| Repo | What goes in | Releases are... |
|---|---|---|
| `com-client` | the mod (`E:\Minecraft Mods\Com Client`, without this `launcher` folder) | Com Client versions (.jar) |
| `com-client-launcher` | everything in this `launcher` folder | launcher versions (setup .exe + update info) |

Public, because the launcher downloads releases without logging in. Tip: move this `launcher` folder out of the mod
folder first (e.g. to `E:\Coding\Com Client Launcher`); it works anywhere.

### 2. Put your GitHub name in two places

* `src-tauri/src/config.rs` → `CLIENT_REPO` and `LAUNCHER_REPO`: replace `YOUR_GITHUB_NAME`.
* `src-tauri/tauri.conf.json` → `plugins.updater.endpoints`: replace `YOUR_GITHUB_NAME`.

### 3. The update key (makes sure only YOU can push launcher updates)

The folder `updater-key/` holds `comclient-updater.key` (**private**, never upload it, it is in `.gitignore`) and its
public half, which is already in `tauri.conf.json`.

In the `com-client-launcher` repo on GitHub: **Settings → Secrets and variables → Actions → New repository secret**

* Name: `TAURI_SIGNING_PRIVATE_KEY`
* Value: the whole content of `updater-key/comclient-updater.key` (open it with Notepad, copy everything)

Keep a backup of that key somewhere safe. Without it you can't publish updates that existing launchers accept.

### 4. The mod release workflow

Copy `mod-workflow/release.yml` into the mod project as `.github/workflows/release.yml` and push it to `com-client`.

---

## Publishing

**A new Com Client version** (the mod):
GitHub → `com-client` → Releases → *Draft a new release* → tag e.g. `v0.2.0` → *Publish*.
GitHub builds the mod and attaches the jar. Every launcher installs it the next time someone presses Play.

**A new launcher version**:
1. Raise `version` in `src-tauri/tauri.conf.json` and `package.json` (e.g. `0.1.0` → `0.1.1`).
2. Push.
3. GitHub → `com-client-launcher` → Actions → **Release launcher** → *Run workflow*.

After ~10 minutes the release has `Com Client_0.1.1_x64-setup.exe` (give this to players) and `latest.json`.
Open launchers update themselves the next time they start.

**News** on the home screen: edit `news.json` in the launcher repo (title, body, date, tag, url) and push. No new
version needed.

---

## Testing a mod build before releasing it

Launcher → Settings → Developer → **Test jar** → pick `build/libs/com-client-x.y.z.jar`. The launcher starts that jar
instead of the GitHub release. Clear it to go back.

## Where things are

* Launcher data: `%APPDATA%\net.comclient.launcher` (game files, Java, accounts, profiles). Settings → Launcher folder.
* Each profile's game folder (worlds, mods, options): `...\profiles\<profile>` unless you pick your own.
* Skin library: `...\skins` (the PNGs + `skins.json`). Wearing a skin uploads it to your Minecraft account.
* Com Client + Fabric API: `...\client` (added with `-Dfabric.addMods`, so they never show in the mods folder).
  If a player puts their own Fabric API into the mods folder, the launcher doesn't load a second one.

## Microsoft login

The launcher uses the same public Microsoft client IDs as the mod's account switcher (`config.rs`). Once you have your
own approved Azure app, put its ID into `BROWSER_CLIENT_ID`.
"Add Microsoft account" opens Microsoft's sign-in page in a small window (always a fresh session, so you can add
several accounts); "Sign in with a code instead" uses microsoft.com/link.

## Discord Rich Presence

Uses the Discord application ID from the mod's `config/comclient/client.json` (`discordAppId`), or put one into
`DISCORD_APP_ID` in `config.rs`. Upload an image called `logo` to that Discord application (Rich Presence → Art Assets).
While the game runs the launcher clears its own presence, so the mod's shows.

## Developing on a PC (optional)

Needs Node.js 22 and Rust (plus the "Desktop development with C++" build tools on Windows):
`npm install` then `npm run tauri dev`.
