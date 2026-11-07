//! Friends from the Com Client backend (same login as the mod: a Mojang "join server" check).

use anyhow::{anyhow, bail, Result};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Mutex;

use crate::config::API_URL;
use crate::net::client;
use crate::store::Account;

static TOKEN: Mutex<Option<(String, String)>> = Mutex::new(None); // (uuid, token)

async fn login(acc: &Account) -> Result<String> {
    let r: Value = client().post(format!("{API_URL}/auth/challenge")).json(&json!({"name": acc.name})).send().await?.json().await?;
    let server_id = r["serverId"].as_str().ok_or_else(|| anyhow!("Com Client server unreachable"))?;
    let join = client()
        .post("https://sessionserver.mojang.com/session/minecraft/join")
        .json(&json!({"accessToken": acc.mc_token, "selectedProfile": acc.uuid.replace('-', ""), "serverId": server_id}))
        .send()
        .await?;
    if !join.status().is_success() {
        bail!("Mojang session check failed ({})", join.status());
    }
    let v: Value = client()
        .post(format!("{API_URL}/auth/verify"))
        .json(&json!({"name": acc.name, "serverId": server_id}))
        .send()
        .await?
        .json()
        .await?;
    let token = v["token"].as_str().ok_or_else(|| anyhow!("Com Client login failed"))?.to_string();
    *TOKEN.lock().unwrap() = Some((acc.uuid.clone(), token.clone()));
    Ok(token)
}

async fn get(acc: &Account, path: &str) -> Result<Value> {
    let cached = TOKEN.lock().unwrap().clone().filter(|(u, _)| *u == acc.uuid).map(|(_, t)| t);
    let token = match cached {
        Some(t) => t,
        None => login(acc).await?,
    };
    let mut r = client().get(format!("{API_URL}{path}")).bearer_auth(&token).send().await?;
    if r.status().as_u16() == 401 {
        let token = login(acc).await?;
        r = client().get(format!("{API_URL}{path}")).bearer_auth(&token).send().await?;
    }
    if !r.status().is_success() {
        bail!("Com Client server answered {}", r.status());
    }
    Ok(r.json().await?)
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
