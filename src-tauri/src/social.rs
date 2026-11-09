//! Friends from the Com Client backend (same login as the mod: a Mojang "join server" check).

use anyhow::{anyhow, bail, Result};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Mutex;

use crate::config::API_URL;
use crate::net::client;
use crate::store::Account;

static TOKEN: Mutex<Option<(String, String)>> = Mutex::new(None); // (uuid, token)

/// Only one login at a time: Mojang keeps a single pending "join" per player, so two logins at once (or the game
/// logging in at the same moment) make the server's check fail for all but the last one.
static LOGIN: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn cached(acc: &Account) -> Option<String> {
    TOKEN.lock().unwrap().clone().filter(|(u, _)| *u == acc.uuid).map(|(_, t)| t)
}

/// A fresh token. `stale` is the token that was just refused (if any), so a login another request finished
/// meanwhile is reused instead of starting a second one.
async fn login(acc: &Account, stale: Option<&str>) -> Result<String> {
    let _guard = LOGIN.lock().await;
    if let Some(t) = cached(acc).filter(|t| Some(t.as_str()) != stale) {
        return Ok(t);
    }
    let mut last = anyhow!("Com Client login failed");
    for attempt in 0..3 {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(1500 * attempt)).await;
        }
        match login_once(acc).await {
            Ok(token) => {
                *TOKEN.lock().unwrap() = Some((acc.uuid.clone(), token.clone()));
                return Ok(token);
            }
            Err(e) => last = e,
        }
    }
    Err(last)
}

async fn login_once(acc: &Account) -> Result<String> {
    let r: Value = client().post(format!("{API_URL}/auth/challenge")).json(&json!({"name": acc.name})).send().await?.json().await?;
    let server_id = r["serverId"].as_str().ok_or_else(|| anyhow!("Com Client server unreachable"))?;
    let join = client()
        .post("https://sessionserver.mojang.com/session/minecraft/join")
        .json(&json!({"accessToken": acc.mc_token, "selectedProfile": acc.uuid.replace('-', ""), "serverId": server_id}))
        .send()
        .await?;
    if join.status().as_u16() == 401 || join.status().as_u16() == 403 {
        bail!("Your Minecraft sign-in expired: open Accounts and sign in again");
    }
    if !join.status().is_success() {
        bail!("Mojang session check failed ({})", join.status());
    }
    let v: Value = client()
        .post(format!("{API_URL}/auth/verify"))
        .json(&json!({"name": acc.name, "serverId": server_id}))
        .send()
        .await?
        .json()
        .await
        .unwrap_or(Value::Null);
    match v["token"].as_str() {
        Some(t) => Ok(t.to_string()),
        None => bail!("Com Client login failed: {}", v["detail"].as_str().unwrap_or("no answer from the server")),
    }
}

async fn get(acc: &Account, path: &str) -> Result<Value> {
    let token = match cached(acc) {
        Some(t) => t,
        None => login(acc, None).await?,
    };
    let mut r = client().get(format!("{API_URL}{path}")).bearer_auth(&token).send().await?;
    if r.status().as_u16() == 401 {
        let token = login(acc, Some(&token)).await?;
        r = client().get(format!("{API_URL}{path}")).bearer_auth(&token).send().await?;
    }
    if !r.status().is_success() {
        bail!("Com Client server answered {}", r.status());
    }
    Ok(r.json().await?)
}

/// Paths the window may call on the Com Client server (friends, chats, cosmetics), signed in as you.
const ALLOWED: &[&str] = &["/state", "/chats", "/friends/", "/cosmetics", "/profile/me", "/shop", "/ref/claim", "/gifts", "/advent"];

fn check(path: &str) -> Result<()> {
    if path.contains("..") || !ALLOWED.iter().any(|p| path.starts_with(p)) {
        bail!("Not allowed: {path}");
    }
    Ok(())
}

/// GET or POST on the Com Client server as you. Errors carry the server's own message ("detail").
pub async fn request(acc: &Account, method: &str, path: &str, body: Option<Value>) -> Result<Value> {
    check(path)?;
    let mut token = match cached(acc) {
        Some(t) => t,
        None => login(acc, None).await?,
    };
    let send = |token: String| {
        let url = format!("{API_URL}{path}");
        let b = body.clone();
        async move {
            let req = if method == "POST" {
                client().post(url).json(&b.unwrap_or_else(|| json!({})))
            } else {
                client().get(url)
            };
            req.bearer_auth(token).send().await
        }
    };
    let mut r = send(token.clone()).await?;
    if r.status().as_u16() == 401 {
        token = login(acc, Some(&token)).await?;
        r = send(token).await?;
    }
    let status = r.status();
    let v: Value = r.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let detail = v["detail"].as_str().map(String::from).unwrap_or_else(|| format!("Com Client server answered {status}"));
        bail!(detail);
    }
    Ok(v)
}

#[derive(Serialize, Clone, Debug)]
pub struct Friend {
    pub uuid: String,
    pub name: String,
    pub username: String,
    pub online: bool,
    pub activity: String,
    pub server: String,
    pub last_seen: i64,
    pub level: i64,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct Social {
    pub friends: Vec<Friend>,
    pub requests: usize,
    pub level: i64,
    pub title: String,
    pub username: String,
    pub unread: i64,
}

pub async fn load(acc: &Account) -> Result<Social> {
    let state = get(acc, "/state").await?;
    let mut friends: Vec<Friend> = state["friends"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|f| Friend {
            uuid: f["uuid"].as_str().unwrap_or_default().into(),
            name: f["name"].as_str().unwrap_or_default().into(),
            username: f["username"].as_str().unwrap_or_default().into(),
            online: f["online"].as_bool().unwrap_or(false),
            activity: f["activity"].as_str().unwrap_or_default().into(),
            server: f["server"].as_str().unwrap_or_default().into(),
            last_seen: f["last_seen"].as_i64().unwrap_or(0),
            level: f["level"].as_i64().unwrap_or(1),
        })
        .collect();
    friends.sort_by(|a, b| b.online.cmp(&a.online).then(b.last_seen.cmp(&a.last_seen)));
    let mut out = Social { friends, requests: state["incoming"].as_array().map(|a| a.len()).unwrap_or(0), ..Default::default() };
    if let Ok(p) = get(acc, "/profile/me").await {
        out.level = p["level"].as_i64().unwrap_or(1);
        out.title = p["title"].as_str().unwrap_or_default().into();
        out.username = p["username"].as_str().unwrap_or_default().into();
    }
    if let Ok(c) = get(acc, "/chats/unread").await {
        out.unread = c["unread"].as_i64().unwrap_or(0) + c["requests"].as_i64().unwrap_or(0);
    }
    Ok(out)
}
