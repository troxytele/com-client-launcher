//! Discord Rich Presence for the launcher ("In the launcher" / "Playing Com Client").

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::mpsc::{channel, Sender};
use std::sync::OnceLock;

enum Msg {
    Set(String, String),
    Clear,
}

static TX: OnceLock<Sender<Msg>> = OnceLock::new();

/// Starts the Rich Presence thread (no-op without an application id).
pub fn start(app_id: String) {
    if app_id.trim().is_empty() || TX.get().is_some() {
        return;
    }
    let (tx, rx) = channel::<Msg>();
    let _ = TX.set(tx);
    std::thread::spawn(move || {
        let started = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
        let mut client: Option<DiscordIpcClient> = None;
        for msg in rx {
            if client.is_none() {
                if let Ok(mut c) = DiscordIpcClient::new(app_id.trim()) {
                    if c.connect().is_ok() {
                        client = Some(c);
                    }
                }
            }
            let Some(c) = client.as_mut() else { continue };
            let ok = match &msg {
                Msg::Set(details, state) => c
                    .set_activity(
                        activity::Activity::new()
                            .details(details)
                            .state(state)
                            .timestamps(activity::Timestamps::new().start(started))
                            .assets(activity::Assets::new().large_image("logo").large_text("Com Client")),
                    )
                    .is_ok(),
                Msg::Clear => c.clear_activity().is_ok(),
            };
            if !ok {
                let _ = c.close();
                client = None; // Discord restarted: reconnect next time
            }
        }
    });
}

pub fn set(details: &str, state: &str) {
    if let Some(tx) = TX.get() {
        let _ = tx.send(Msg::Set(details.to_string(), state.to_string()));
    }
}

pub fn clear() {
    if let Some(tx) = TX.get() {
        let _ = tx.send(Msg::Clear);
    }
}
