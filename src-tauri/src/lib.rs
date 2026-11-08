//! Com Client Launcher: the commands the window calls.

pub mod auth;
pub mod client;
pub mod config;
pub mod cosmetics;
pub mod discord;
pub mod gallery;
pub mod fabric;
pub mod java;
pub mod launch;
pub mod minecraft;
pub mod modpacks;
pub mod modrinth;
pub mod mods;
pub mod optimise;
pub mod net;
pub mod paths;
pub mod profiles;
pub mod progress;
pub mod skins;
pub mod crashes;
pub mod import;
pub mod social;
pub mod store;

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

use paths::Paths;
use progress::{Progress, Reporter};
use store::{AccountView, Accounts, Profile, Profiles, Settings};

pub struct AppState {
    paths: Paths,
    busy: AtomicBool,
    kill: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    running: AtomicBool,
    /// The last lines of the game log (the logs window shows them when it opens late).
    log: Mutex<std::collections::VecDeque<String>>,
    /// The game that is running now.
    game: Mutex<Option<GameInfo>>,
}

#[derive(Serialize, Clone, Debug)]
struct GameInfo {
    pid: u32,
    profile: String,
    account: String,
    started: i64,
}

const LOG_KEEP: usize = 8000;

fn push_log(app: &AppHandle, line: &str) {
    let st = app.state::<AppState>();
    let mut l = st.log.lock().unwrap();
    if l.len() >= LOG_KEEP {
        l.pop_front();
    }
    l.push_back(line.to_string());
}

type Res<T> = Result<T, String>;

fn err(e: anyhow::Error) -> String {
    format!("{e:#}")
}

// ------------------------------------------------------------------ info

#[derive(Serialize)]
struct Info {
    version: String,
    mc_version: String,
    data_dir: String,
    total_ram: u32,
    accounts: Vec<AccountView>,
    settings: Settings,
    profiles: Vec<Profile>,
    client: client::Installed,
    running: bool,
    client_repo_set: bool,
}

#[tauri::command]
fn crash_list(state: State<'_, AppState>) -> Vec<crashes::CrashFile> {
    crashes::list(&state.paths)
}

#[tauri::command]
fn crash_read(state: State<'_, AppState>, path: String) -> Res<String> {
    crashes::read(&state.paths, &path).map_err(err)
}

#[tauri::command]
async fn import_scan(state: State<'_, AppState>) -> Res<Vec<import::Source>> {
    let root = state.paths.root.clone();
    tokio::task::spawn_blocking(move || import::scan(&root)).await.map_err(|e| e.to_string())
}

#[derive(Clone, serde::Serialize)]
struct ImportProgress {
    done: u64,
    total: u64,
    name: String,
}

#[tauri::command]
async fn import_instance(app: AppHandle, state: State<'_, AppState>, source: String, name: String, parts: import::Parts) -> Res<String> {
    let paths = state.paths.clone();
    tokio::task::spawn_blocking(move || {
        let last = std::sync::Mutex::new(std::time::Instant::now() - std::time::Duration::from_secs(1));
        import::instance_to_profile(&paths, std::path::Path::new(&source), &name, parts, &|d, t, what| {
            let mut l = last.lock().unwrap();
            if d >= t || l.elapsed().as_millis() >= 50 {
                *l = std::time::Instant::now();
                let _ = app.emit("import-progress", ImportProgress { done: d, total: t, name: what.to_string() });
            }
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(err)
}

#[tauri::command]
async fn import_apply(
    app: AppHandle,
    state: State<'_, AppState>,
    source: String,
    profile: String,
    settings: bool,
    keybinds: bool,
    servers: bool,
    packs: bool,
) -> Res<String> {
    let p = Profiles::load(&state.paths).get(&profile);
    let target = store::game_dir(&state.paths, &p);
    tokio::task::spawn_blocking(move || -> anyhow::Result<String> {
        let mut done = Vec::new();
        let first = import::apply(&source, &target, settings, keybinds, servers)?;
        if !first.is_empty() {
            done.push(first.trim_start_matches("Imported ").to_string());
        }
        if packs {
            let last = std::sync::Mutex::new(std::time::Instant::now() - std::time::Duration::from_secs(1));
            let n = import::copy_packs(std::path::Path::new(&source), &target, &|d, t, name| {
                // at most ~20 updates a second
                let mut l = last.lock().unwrap();
                if d >= t || l.elapsed().as_millis() >= 50 {
                    *l = std::time::Instant::now();
                    let _ = app.emit("import-progress", ImportProgress { done: d, total: t, name: name.to_string() });
                }
            })?;
            done.push(format!("{n} resource pack{}", if n == 1 { "" } else { "s" }));
        }
        if done.is_empty() {
            anyhow::bail!("Nothing to import");
        }
        Ok(format!("Imported {}", done.join(", ")))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(err)
}

#[tauri::command]
fn get_info(state: State<'_, AppState>) -> Info {
    let p = &state.paths;
    Info {
        version: env!("CARGO_PKG_VERSION").into(),
        mc_version: config::MC_VERSION.into(),
        data_dir: paths::native(&p.root),
        total_ram: store::total_ram_mb(),
        accounts: Accounts::load(p).views(),
        settings: Settings::load(p),
        profiles: Profiles::load(p).list,
        client: client::installed(p),
        running: state.running.load(Ordering::SeqCst),
        client_repo_set: !config::CLIENT_REPO.starts_with("YOUR_GITHUB_NAME"),
    }
}

// ------------------------------------------------------------------ accounts

/// Opens Microsoft's sign-in page in a small window and catches the code when it finishes.
#[tauri::command]
async fn login_microsoft(app: AppHandle, state: State<'_, AppState>) -> Res<Vec<AccountView>> {
    if let Some(w) = app.get_webview_window("mslogin") {
        let _ = w.destroy();
    }
    let pkce = auth::browser_start();
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let tx = Arc::new(Mutex::new(Some(tx)));
    let tx_nav = tx.clone();
    let url: tauri::Url = pkce.url.parse().map_err(|e: url::ParseError| e.to_string())?;
    let window = WebviewWindowBuilder::new(&app, "mslogin", WebviewUrl::External(url))
        .title("Sign in with Microsoft")
        .inner_size(500.0, 680.0)
        .center()
        .incognito(true) // never logged in already, so you can add a second account
        .on_navigation(move |u| {
            if let Some(res) = auth::code_from_redirect(u) {
                if let Some(tx) = tx_nav.lock().unwrap().take() {
                    let _ = tx.send(res.map_err(|e| e.to_string()));
                }
                return false;
            }
            true
        })
        .build()
        .map_err(|e| e.to_string())?;
    let tx_close = tx.clone();
    window.on_window_event(move |e| {
        if let tauri::WindowEvent::Destroyed = e {
            if let Some(tx) = tx_close.lock().unwrap().take() {
                let _ = tx.send(Err("Sign-in window closed".into()));
            }
        }
    });
    let code = rx.await.map_err(|_| "Sign-in window closed".to_string())?;
    if let Some(w) = app.get_webview_window("mslogin") {
        let _ = w.destroy();
    }
    let code = code?;
    let ms = auth::browser_finish(&code, &pkce.verifier).await.map_err(err)?;
    let mc = auth::minecraft(&ms).await.map_err(err)?;
    let mut accounts = Accounts::load(&state.paths);
    accounts.upsert(&ms, &mc);
    accounts.save(&state.paths).map_err(err)?;
    Ok(accounts.views())
}

#[tauri::command]
async fn device_start() -> Res<auth::DeviceCode> {
    auth::device_start().await.map_err(err)
}

#[tauri::command]
async fn device_poll(state: State<'_, AppState>, device_code: String) -> Res<Option<Vec<AccountView>>> {
    let Some(ms) = auth::device_poll(&device_code).await.map_err(err)? else { return Ok(None) };
    let mc = auth::minecraft(&ms).await.map_err(err)?;
    let mut accounts = Accounts::load(&state.paths);
    accounts.upsert(&ms, &mc);
    accounts.save(&state.paths).map_err(err)?;
    Ok(Some(accounts.views()))
}

#[tauri::command]
fn select_account(state: State<'_, AppState>, uuid: String) -> Res<Vec<AccountView>> {
    let mut a = Accounts::load(&state.paths);
    if a.list.iter().any(|x| x.uuid == uuid) {
        a.active = Some(uuid);
        a.save(&state.paths).map_err(err)?;
    }
    Ok(a.views())
}

#[tauri::command]
fn remove_account(state: State<'_, AppState>, uuid: String) -> Res<Vec<AccountView>> {
    let mut a = Accounts::load(&state.paths);
    a.list.retain(|x| x.uuid != uuid);
    if a.active.as_deref() == Some(uuid.as_str()) {
        a.active = a.list.first().map(|x| x.uuid.clone());
    }
    a.save(&state.paths).map_err(err)?;
    Ok(a.views())
}

// ------------------------------------------------------------------ settings + profiles

#[tauri::command]
fn save_settings(app: AppHandle, state: State<'_, AppState>, settings: Settings) -> Res<()> {
    settings.save(&state.paths).map_err(err)?;
    if settings.discord_rpc {
        start_discord(&state.paths);
        if !state.running.load(Ordering::SeqCst) {
            discord::set("In the launcher", &format!("Minecraft {}", config::MC_VERSION));
        }
    } else {
        discord::clear();
    }
    let _ = app.emit("settings-changed", ());
    Ok(())
}

#[tauri::command]
fn save_profile(state: State<'_, AppState>, mut profile: Profile) -> Res<Vec<Profile>> {
    let mut ps = Profiles::load(&state.paths);
    if profile.id.trim().is_empty() {
        profile.id = format!("p{}", &uuid::Uuid::new_v4().simple().to_string()[..8]);
        profile.created = auth::now();
    }
    profile.ram_mb = profile.ram_mb.clamp(1024, store::total_ram_mb().max(2048));
    match ps.list.iter_mut().find(|p| p.id == profile.id) {
        Some(p) => {
            // play time is only written by the launcher itself (the window may hold an old copy)
            profile.playtime_secs = p.playtime_secs;
            profile.sessions = std::mem::take(&mut p.sessions);
            profile.last_played = p.last_played;
            *p = profile
        }
        None => ps.list.push(profile),
    }
    ps.save(&state.paths).map_err(err)?;
    Ok(ps.list)
}

#[tauri::command]
fn delete_profile(state: State<'_, AppState>, id: String) -> Res<Vec<Profile>> {
    let mut ps = Profiles::load(&state.paths);
    if ps.list.len() <= 1 {
        return Err("You need at least one profile".into());
    }
    ps.list.retain(|p| p.id != id);
    ps.save(&state.paths).map_err(err)?;
    let mut s = Settings::load(&state.paths);
    if s.active_profile == id {
        s.active_profile = ps.list[0].id.clone();
        s.save(&state.paths).map_err(err)?;
    }
    Ok(ps.list)
}

#[tauri::command]
async fn icon_names(state: State<'_, AppState>) -> Res<Vec<String>> {
    let jar = profiles::client_jar(&state.paths, config::MC_VERSION).await.map_err(err)?;
    profiles::icon_names(&jar).map_err(err)
}

#[tauri::command]
async fn icons(state: State<'_, AppState>, names: Vec<String>) -> Res<std::collections::HashMap<String, String>> {
    let jar = profiles::client_jar(&state.paths, config::MC_VERSION).await.map_err(err)?;
    profiles::icons(&jar, &names).map_err(err)
}

#[tauri::command]
fn icon_upload(file: String) -> Res<String> {
    profiles::upload_icon(std::path::Path::new(&file)).map_err(err)
}

#[tauri::command]
fn profile_duplicate(state: State<'_, AppState>, id: String) -> Res<Vec<Profile>> {
    profiles::duplicate(&state.paths, &id).map_err(err)
}

#[tauri::command]
fn profile_export(state: State<'_, AppState>, id: String, dest: String) -> Res<()> {
    profiles::export(&state.paths, &id, std::path::Path::new(&dest)).map_err(err)
}

#[tauri::command]
fn profile_import(state: State<'_, AppState>, file: String) -> Res<Vec<Profile>> {
    profiles::import(&state.paths, std::path::Path::new(&file)).map_err(err)
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn set_tray_tip(app: &AppHandle, tip: &str) {
    if let Some(t) = app.tray_by_id("main") {
        let _ = t.set_tooltip(Some(tip));
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let open = MenuItem::with_id(app, "open", "Open launcher", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit launcher", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut b = TrayIconBuilder::with_id("main").tooltip("Com Client Launcher").menu(&menu).show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        b = b.icon(icon.clone());
    }
    b.on_menu_event(|app, e| match e.id.as_ref() {
        "open" => show_main(app),
        "quit" => app.exit(0),
        _ => {}
    })
    .on_tray_icon_event(|tray, e| {
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
            show_main(tray.app_handle());
        }
    })
    .build(app)?;
    Ok(())
}

// ------------------------------------------------------------------ launching

#[derive(Serialize, Clone)]
struct GameExit {
    code: Option<i32>,
    crashed: bool,
    killed: bool,
    crash_report: Option<String>,
}

/// Starts the game. `profile` = a profile other than the selected one, `replay` = open this recording right away.
#[tauri::command]
async fn launch(app: AppHandle, state: State<'_, AppState>, server: Option<String>, profile: Option<String>, replay: Option<String>) -> Res<()> {
    if state.running.load(Ordering::SeqCst) {
        return Err("The game is already running".into());
    }
    if let Some(r) = replay.as_deref() {
        if !gallery::allowed(&state.paths, std::path::Path::new(r)) {
            return Err("That replay isn't in a profile's replay_recordings folder".into());
        }
    }
    if state.busy.swap(true, Ordering::SeqCst) {
        return Err("Already starting".into());
    }
    let result = prepare_and_start(&app, &state, server, profile, replay).await;
    state.busy.store(false, Ordering::SeqCst);
    result.map_err(err)
}

/// One file check / download at a time (the background check and Play use the same files).
fn files_lock() -> &'static tokio::sync::Mutex<()> {
    static L: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();
    L.get_or_init(|| tokio::sync::Mutex::new(()))
}

/// Started by the window a few seconds after the launcher opens: checks and downloads Minecraft, Java, Fabric and
/// Com Client in the background, so pressing Play later starts the game right away. Quiet: errors are ignored
/// (Play shows them properly).
#[tauri::command]
async fn prewarm(state: State<'_, AppState>) -> Res<bool> {
    if state.running.load(Ordering::SeqCst) || state.busy.load(Ordering::SeqCst) {
        return Ok(false);
    }
    let Ok(_files) = files_lock().try_lock() else { return Ok(false) };
    let paths = state.paths.clone();
    let settings = Settings::load(&paths);
    let profile = Profiles::load(&paths).get(&settings.active_profile);
    let rep = Reporter::new(|_p: Progress| {});
    let work = async {
        let vanilla = minecraft::install(&paths, config::MC_VERSION, &rep).await?;
        let component = vanilla.json["javaVersion"]["component"].as_str().unwrap_or("java-runtime-delta").to_string();
        java::ensure(&paths, &component, &rep).await?;
        fabric::install(&paths, config::MC_VERSION, None, &rep).await?;
        client::ensure(&paths, config::MC_VERSION, Some(&settings.custom_client_jar), profile.replay_mod, profile.performance_mods, &rep).await?;
        anyhow::Ok(())
    };
    let ok = work.await.is_ok();
    net::save_checked();
    Ok(ok)
}

async fn prepare_and_start(app: &AppHandle, state: &AppState, server: Option<String>, profile_id: Option<String>, replay: Option<String>) -> anyhow::Result<()> {
    let paths = state.paths.clone();
    let settings = Settings::load(&paths);
    let mut profiles = Profiles::load(&paths);
    let mut profile = profiles.get(profile_id.as_deref().unwrap_or(&settings.active_profile));
    if replay.is_some() {
        profile.replay_mod = true; // watching a replay needs ReplayMod
    }
    let game_dir = store::game_dir(&paths, &profile);
    let app_ = app.clone();
    let rep = Reporter::new(move |p: Progress| {
        let _ = app_.emit("progress", p);
    });

    rep.stage("Signing in", 0, 0);
    let account = store::fresh_account(&paths).await?;
    // if the background check is still going, wait for it (it's checking the same files), then this is quick
    let _files = files_lock().lock().await;
    let vanilla = minecraft::install(&paths, config::MC_VERSION, &rep).await?;
    let component = vanilla.json["javaVersion"]["component"].as_str().unwrap_or("java-runtime-delta").to_string();
    let java = java::ensure(&paths, &component, &rep).await?;
    let fabric = fabric::install(&paths, config::MC_VERSION, None, &rep).await?;
    let jars = client::ensure(&paths, config::MC_VERSION, Some(&settings.custom_client_jar), profile.replay_mod, profile.performance_mods, &rep).await?;
    drop(_files);
    // don't load a second copy of something the player put in their own mods folder
    let theirs = mods::mod_ids(&game_dir);
    let mut extra_mods = Vec::new();
    for jar in jars {
        let (id, ..) = mods::inspect(&jar);
        if !theirs.contains(&id) {
            extra_mods.push(jar);
        }
    }

    rep.stage("Starting Minecraft", 0, 0);
    let plan = launch::Plan { java, vanilla, fabric, extra_mods, game_dir: game_dir.clone(), profile: profile.clone(), account, join: server.clone(), replay };
    let app_log = app.clone();
    state.log.lock().unwrap().clear();
    let mut child = launch::spawn(&paths, &plan, move |line| {
        push_log(&app_log, &line);
        let _ = app_log.emit("game-log", line);
    })?;
    let started = auth::now();
    *state.game.lock().unwrap() = Some(GameInfo {
        pid: child.id().unwrap_or(0),
        profile: profile.name.clone(),
        account: plan.account.name.clone(),
        started,
    });
    state.running.store(true, Ordering::SeqCst);
    if settings.open_logs {
        let _ = open_logs(app);
    }
    let _ = app.emit("game-started", ());
    set_tray_tip(app, &format!("Com Client: playing {}", profile.name));
    discord::clear(); // the mod shows its own Rich Presence in game

    if let Some(p) = profiles.list.iter_mut().find(|p| p.id == profile.id) {
        p.last_played = started;
    }
    let _ = profiles.save(&paths);

    if let Some(w) = app.get_webview_window("main") {
        match settings.after_launch.as_str() {
            "hide" => {
                let _ = w.hide();
            }
            "close" => {
                // the game keeps running on its own
                std::mem::forget(child);
                app.exit(0);
                return Ok(());
            }
            _ => {}
        }
    }

    let (kill_tx, kill_rx) = tokio::sync::oneshot::channel::<()>();
    *state.kill.lock().unwrap() = Some(kill_tx);
    let app2 = app.clone();
    tokio::spawn(async move {
        let mut killed = false;
        let status = tokio::select! {
            s = child.wait() => s.ok(),
            _ = kill_rx => {
                killed = true;
                let _ = child.kill().await;
                child.wait().await.ok()
            }
        };
        let code = status.and_then(|s| s.code());
        let crashed = !killed && code.map(|c| c != 0).unwrap_or(false);
        let report = if crashed { launch::crash_report(&game_dir, started - 5).map(|p| paths::native(&p)) } else { None };
        let st = app2.state::<AppState>();
        let secs = (auth::now() - started).max(0) as u64;
        Profiles::record(&st.paths, &profile.id, started, secs, server.as_deref().unwrap_or_default());
        set_tray_tip(&app2, "Com Client Launcher");
        st.running.store(false, Ordering::SeqCst);
        *st.kill.lock().unwrap() = None;
        *st.game.lock().unwrap() = None;
        if let Some(w) = app2.get_webview_window("main") {
            let _ = w.show();
            let _ = w.unminimize();
            if crashed {
                let _ = w.set_focus();
            }
        }
        discord::set("In the launcher", &format!("Minecraft {}", config::MC_VERSION));
        let _ = app2.emit("game-exit", GameExit { code, crashed, killed, crash_report: report });
    });
    Ok(())
}

#[tauri::command]
fn kill_game(state: State<'_, AppState>) {
    if let Some(tx) = state.kill.lock().unwrap().take() {
        let _ = tx.send(());
    }
}

/// Re-checks every file next time (and throws away broken assets now).
#[tauri::command]
async fn repair(state: State<'_, AppState>) -> Res<u32> {
    let paths = state.paths.clone();
    tokio::task::spawn_blocking(move || {
        let mut removed = 0u32;
        if let Ok(rd) = std::fs::read_dir(paths.runtime()) {
            for e in rd.flatten() {
                let _ = std::fs::remove_file(e.path().join(".installed"));
            }
        }
        let _ = std::fs::remove_file(paths.client().join("installed.json"));
        let objects = paths.assets().join("objects");
        if let Ok(rd) = std::fs::read_dir(&objects) {
            for sub in rd.flatten() {
                if let Ok(files) = std::fs::read_dir(sub.path()) {
                    for f in files.flatten() {
                        let name = f.file_name().to_string_lossy().to_string();
                        if net::sha1_file(&f.path()).map(|h| h != name).unwrap_or(true) {
                            let _ = std::fs::remove_file(f.path());
                            removed += 1;
                        }
                    }
                }
            }
        }
        removed
    })
    .await
    .map_err(|e| e.to_string())
}

// ------------------------------------------------------------------ news, friends

#[tauri::command]
async fn news(state: State<'_, AppState>) -> Res<Vec<client::NewsItem>> {
    Ok(client::news(&state.paths).await)
}

#[tauri::command]
async fn social(state: State<'_, AppState>) -> Res<social::Social> {
    let acc = store::fresh_account(&state.paths).await.map_err(err)?;
    social::load(&acc).await.map_err(err)
}

// ------------------------------------------------------------------ mods

fn active_game_dir(paths: &Paths) -> std::path::PathBuf {
    let s = Settings::load(paths);
    store::game_dir(paths, &Profiles::load(paths).get(&s.active_profile))
}

#[tauri::command]
async fn mods_list(state: State<'_, AppState>, kind: String) -> Res<Vec<mods::InstalledItem>> {
    let dir = active_game_dir(&state.paths);
    tokio::task::spawn_blocking(move || mods::list(&dir, &kind)).await.map_err(|e| e.to_string())
}

#[tauri::command]
fn mod_toggle(state: State<'_, AppState>, kind: String, file: String) -> Res<String> {
    mods::toggle(&active_game_dir(&state.paths), &kind, &file).map_err(err)
}

#[tauri::command]
fn mod_delete(state: State<'_, AppState>, kind: String, file: String) -> Res<()> {
    mods::delete(&active_game_dir(&state.paths), &kind, &file).map_err(err)
}

#[tauri::command]
async fn mods_updates(state: State<'_, AppState>, kind: String) -> Res<Vec<modrinth::Update>> {
    modrinth::updates(&active_game_dir(&state.paths), &kind, config::MC_VERSION).await.map_err(err)
}

#[tauri::command]
async fn mod_update(state: State<'_, AppState>, kind: String, update: modrinth::Update) -> Res<()> {
    modrinth::apply_update(&active_game_dir(&state.paths), &kind, &update).await.map_err(err)
}

#[tauri::command]
async fn modrinth_search(query: String, kind: String, sort: String, offset: u32) -> Res<modrinth::SearchResult> {
    modrinth::search(&query, &kind, config::MC_VERSION, &sort, offset).await.map_err(err)
}

#[tauri::command]
async fn modrinth_install(state: State<'_, AppState>, project: String, kind: String) -> Res<Vec<String>> {
    let dir = active_game_dir(&state.paths);
    std::fs::create_dir_all(mods::folder(&dir, &kind)).map_err(|e| e.to_string())?;
    modrinth::install(&project, &kind, config::MC_VERSION, &dir).await.map_err(err)
}

/// Opens a folder in Explorer: game, mods, resourcepacks, shaderpacks, screenshots, logs, crash, launcher.
#[tauri::command]
fn open_folder(app: AppHandle, state: State<'_, AppState>, which: String) -> Res<()> {
    let game = active_game_dir(&state.paths);
    let path = match which.as_str() {
        "launcher" => state.paths.root.clone(),
        "game" => game,
        "crash" => game.join("crash-reports"),
        other if other.starts_with("profile:") => store::game_dir(&state.paths, &Profiles::load(&state.paths).get(&other[8..])),
        other => game.join(other),
    };
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    app.opener().open_path(paths::native(&path), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_file(app: AppHandle, path: String) -> Res<()> {
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

// ------------------------------------------------------------------ skins

#[tauri::command]
async fn skins_list(state: State<'_, AppState>) -> Res<Vec<skins::SkinView>> {
    skins::list(&state.paths).await.map_err(err)
}

#[tauri::command]
fn skin_add(state: State<'_, AppState>, file: String, name: String, variant: String) -> Res<()> {
    skins::add_file(&state.paths, &file, &name, &variant).map_err(err)
}

#[tauri::command]
async fn skin_import(state: State<'_, AppState>, player: String) -> Res<()> {
    skins::import_player(&state.paths, &player).await.map_err(err)
}

#[tauri::command]
fn skin_update(state: State<'_, AppState>, id: String, name: String, variant: String) -> Res<()> {
    skins::update(&state.paths, &id, &name, &variant).map_err(err)
}

#[tauri::command]
fn skin_delete(state: State<'_, AppState>, id: String) -> Res<()> {
    skins::delete(&state.paths, &id).map_err(err)
}

#[tauri::command]
async fn skin_apply(state: State<'_, AppState>, id: String) -> Res<Vec<AccountView>> {
    skins::apply(&state.paths, &id).await.map_err(err)?;
    Ok(Accounts::load(&state.paths).views())
}

#[tauri::command]
async fn skin_current(state: State<'_, AppState>) -> Res<skins::Current> {
    skins::current(&state.paths).await.map_err(err)
}

// ------------------------------------------------------------------ gallery (screenshots, replays)

#[tauri::command]
async fn shots_list(state: State<'_, AppState>) -> Res<Vec<gallery::Shot>> {
    let paths = state.paths.clone();
    tokio::task::spawn_blocking(move || gallery::screenshots(&paths)).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn replays_list(state: State<'_, AppState>) -> Res<Vec<gallery::Replay>> {
    let paths = state.paths.clone();
    tokio::task::spawn_blocking(move || gallery::replays(&paths)).await.map_err(|e| e.to_string())
}

#[tauri::command]
fn gallery_delete(state: State<'_, AppState>, path: String) -> Res<()> {
    gallery::delete(&state.paths, &path).map_err(err)
}

#[tauri::command]
async fn shot_copy(state: State<'_, AppState>, path: String) -> Res<()> {
    let paths = state.paths.clone();
    tokio::task::spawn_blocking(move || gallery::copy_image(&paths, &path)).await.map_err(|e| e.to_string())?.map_err(err)
}

#[tauri::command]
async fn shot_share(state: State<'_, AppState>, path: String) -> Res<()> {
    let paths = state.paths.clone();
    tokio::task::spawn_blocking(move || gallery::share(&paths, &path)).await.map_err(|e| e.to_string())?.map_err(err)
}

// ------------------------------------------------------------------ friends + chat (Com Client server)

#[tauri::command]
async fn server_get(state: State<'_, AppState>, path: String) -> Res<serde_json::Value> {
    let acc = store::fresh_account(&state.paths).await.map_err(err)?;
    social::request(&acc, "GET", &path, None).await.map_err(err)
}

#[tauri::command]
async fn server_post(state: State<'_, AppState>, path: String, body: Option<serde_json::Value>) -> Res<serde_json::Value> {
    let acc = store::fresh_account(&state.paths).await.map_err(err)?;
    social::request(&acc, "POST", &path, body).await.map_err(err)
}

// ------------------------------------------------------------------ cosmetics

#[tauri::command]
async fn cosmetics_catalog(state: State<'_, AppState>) -> Res<cosmetics::Catalog> {
    Ok(cosmetics::catalog(&state.paths).await)
}

#[tauri::command]
async fn cosmetic_texture(state: State<'_, AppState>, kind: String, id: String) -> Res<String> {
    cosmetics::texture(&state.paths, &kind, &id).await.map_err(err)
}

#[tauri::command]
async fn cosmetics_get(state: State<'_, AppState>) -> Res<cosmetics::Look> {
    let acc = store::fresh_account(&state.paths).await.map_err(err)?;
    Ok(cosmetics::get(&state.paths, &acc).await)
}

#[tauri::command]
async fn cosmetics_save(state: State<'_, AppState>, look: cosmetics::Look) -> Res<()> {
    let acc = store::fresh_account(&state.paths).await.map_err(err)?;
    cosmetics::save(&state.paths, &acc, &look).await.map_err(err)
}

// ------------------------------------------------------------------ modpacks + auto-optimise

#[tauri::command]
fn pack_inspect(file: String) -> Res<modpacks::Inspect> {
    modpacks::inspect(std::path::Path::new(&file)).map_err(err)
}

#[tauri::command]
async fn modpack_lookup(input: String) -> Res<modpacks::Project> {
    modpacks::lookup(&input).await.map_err(err)
}

#[tauri::command]
async fn modpack_install_file(app: AppHandle, state: State<'_, AppState>, file: String) -> Res<String> {
    if state.busy.swap(true, Ordering::SeqCst) {
        return Err("Wait until the launcher has finished what it's doing".into());
    }
    let app_ = app.clone();
    let rep = Reporter::new(move |p: Progress| {
        let _ = app_.emit("modpack-progress", p);
    });
    let res = modpacks::install_file(&state.paths, std::path::Path::new(&file), "Modpack", "", &rep).await;
    state.busy.store(false, Ordering::SeqCst);
    res.map_err(err)
}

#[tauri::command]
async fn modpack_install(app: AppHandle, state: State<'_, AppState>, project: String, title: String, icon: String) -> Res<String> {
    if state.busy.swap(true, Ordering::SeqCst) {
        return Err("Wait until the launcher has finished what it's doing".into());
    }
    let app_ = app.clone();
    let rep = Reporter::new(move |p: Progress| {
        let _ = app_.emit("modpack-progress", p);
    });
    let res = modpacks::install(&state.paths, &project, &title, &icon, &rep).await;
    state.busy.store(false, Ordering::SeqCst);
    res.map_err(err)
}

#[tauri::command]
async fn optimise_scan() -> Res<optimise::Plan> {
    tokio::task::spawn_blocking(optimise::scan).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn optimise_apply(state: State<'_, AppState>, profile: String, video: bool) -> Res<Vec<Profile>> {
    let paths = state.paths.clone();
    tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<Profile>> {
        let plan = optimise::scan();
        optimise::apply(&paths, &profile, &plan, video)?;
        Ok(Profiles::load(&paths).list)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(err)
}

/// Pictures for the Gallery page: ccimg://localhost/<file path>, only from a profile's screenshots folder.
fn image_protocol(app: &AppHandle, uri_path: &str) -> tauri::http::Response<Vec<u8>> {
    let raw = uri_path.trim_start_matches('/');
    let path = urlencoding::decode(raw).map(|s| s.into_owned()).unwrap_or_default();
    let file = std::path::PathBuf::from(&path);
    let state = app.state::<AppState>();
    let body = if gallery::allowed(&state.paths, &file) { std::fs::read(&file).ok() } else { None };
    match body {
        Some(bytes) => {
            let lower = path.to_lowercase();
            let mime = if lower.ends_with(".png") { "image/png" } else { "image/jpeg" };
            tauri::http::Response::builder()
                .header("Content-Type", mime)
                .header("Cache-Control", "max-age=3600")
                .header("Access-Control-Allow-Origin", "*")
                .body(bytes)
                .unwrap_or_default()
        }
        None => tauri::http::Response::builder().status(404).body(Vec::new()).unwrap_or_default(),
    }
}

// ------------------------------------------------------------------ logs window

/// Opens the logs window (or brings it to the front).
fn open_logs(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("logs") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(app, "logs", WebviewUrl::App("index.html".into()))
        .title("Com Client Logs")
        .inner_size(980.0, 600.0)
        .min_inner_size(680.0, 420.0)
        .decorations(false)
        .initialization_script("window.__CC_WINDOW = 'logs';")
        .build()?;
    Ok(())
}

#[tauri::command]
fn open_logs_window(app: AppHandle) -> Res<()> {
    open_logs(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn log_backlog(state: State<'_, AppState>) -> Vec<String> {
    state.log.lock().unwrap().iter().cloned().collect()
}

#[tauri::command]
fn log_clear(state: State<'_, AppState>) {
    state.log.lock().unwrap().clear();
}

#[derive(Serialize)]
struct GameStats {
    running: bool,
    pid: u32,
    profile: String,
    account: String,
    started: i64,
    ram_mb: u64,
    cpu: f32,
}

/// The running game's memory and CPU (measured between two calls, so call it every second or two).
#[tauri::command]
fn game_stats(state: State<'_, AppState>) -> GameStats {
    static SYS: std::sync::OnceLock<Mutex<sysinfo::System>> = std::sync::OnceLock::new();
    let game = state.game.lock().unwrap().clone();
    let Some(g) = game else {
        return GameStats { running: false, pid: 0, profile: String::new(), account: String::new(), started: 0, ram_mb: 0, cpu: 0.0 };
    };
    let mut sys = SYS.get_or_init(|| Mutex::new(sysinfo::System::new())).lock().unwrap();
    let pid = sysinfo::Pid::from_u32(g.pid);
    sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1) as f32;
    let (ram_mb, cpu) = sys.process(pid).map(|p| (p.memory() / 1024 / 1024, p.cpu_usage() / cores)).unwrap_or((0, 0.0));
    GameStats { running: true, pid: g.pid, profile: g.profile, account: g.account, started: g.started, ram_mb, cpu }
}

/// Uploads the log to mclo.gs (hides your name and IP there) and returns the link.
#[tauri::command]
async fn upload_log(text: String) -> Res<String> {
    let r = net::client()
        .post("https://api.mclo.gs/1/log")
        .form(&[("content", text)])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let v: serde_json::Value = r.json().await.map_err(|e| e.to_string())?;
    if v["success"].as_bool() == Some(true) {
        Ok(v["url"].as_str().unwrap_or_default().to_string())
    } else {
        Err(v["error"].as_str().unwrap_or("mclo.gs didn't take the log").to_string())
    }
}

// ------------------------------------------------------------------ setup

fn start_discord(paths: &Paths) {
    let mut id = config::DISCORD_APP_ID.to_string();
    if id.is_empty() {
        // same application as the mod's Rich Presence
        let cfg = active_game_dir(paths).join("config").join("comclient").join("client.json");
        if let Some(v) = std::fs::read_to_string(cfg).ok().and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok()) {
            id = v["discordAppId"].as_str().unwrap_or_default().to_string();
        }
    }
    discord::start(id);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol("ccimg", |ctx, req| image_protocol(ctx.app_handle(), req.uri().path()))
        .setup(|app| {
            let root = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("ComClientLauncher"));
            let paths = Paths::new(root);
            net::init_checked(paths.root.join("cache").join("checked.json"));
            if Settings::load(&paths).discord_rpc {
                start_discord(&paths);
                discord::set("In the launcher", &format!("Minecraft {}", config::MC_VERSION));
            }
            if let Err(e) = build_tray(app) {
                eprintln!("tray: {e}");
            }
            app.manage(AppState {
                paths,
                busy: AtomicBool::new(false),
                kill: Mutex::new(None),
                running: AtomicBool::new(false),
                log: Mutex::new(std::collections::VecDeque::new()),
                game: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            prewarm,
            get_info,
            login_microsoft,
            device_start,
            device_poll,
            select_account,
            remove_account,
            save_settings,
            save_profile,
            delete_profile,
            launch,
            kill_game,
            repair,
            news,
            social,
            mods_list,
            mod_toggle,
            mod_delete,
            mods_updates,
            mod_update,
            modrinth_search,
            modrinth_install,
            open_folder,
            open_file,
            skins_list,
            skin_add,
            skin_import,
            skin_update,
            skin_delete,
            skin_apply,
            skin_current,
            crash_list,
            crash_read,
            import_scan,
            import_apply,
            import_instance,
            icon_names,
            icons,
            icon_upload,
            profile_duplicate,
            profile_export,
            profile_import,
            shots_list,
            replays_list,
            gallery_delete,
            shot_copy,
            shot_share,
            server_get,
            server_post,
            cosmetics_catalog,
            cosmetic_texture,
            cosmetics_get,
            cosmetics_save,
            modpack_install,
            modpack_install_file,
            modpack_lookup,
            pack_inspect,
            optimise_scan,
            optimise_apply,
            open_logs_window,
            log_backlog,
            log_clear,
            game_stats,
            upload_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running Com Client Launcher");
}
