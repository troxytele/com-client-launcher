//! Microsoft → Xbox Live → Minecraft sign-in (same flows as the mod's account switcher).

use anyhow::{anyhow, bail, Result};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

use crate::config::*;
use crate::net::client;

const LIVE_CONNECT: &str = "https://login.live.com/oauth20_connect.srf";
const LIVE_TOKEN: &str = "https://login.live.com/oauth20_token.srf";
const MS_AUTHORIZE: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
const MS_TOKEN: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const XBL_AUTH: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_AUTH: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE: &str = "https://api.minecraftservices.com/minecraft/profile";

pub const FLOW_BROWSER: &str = "browser";
pub const FLOW_DEVICE: &str = "device";

#[derive(Clone, Debug)]
pub struct MsTokens {
    pub access: String,
    pub refresh: String,
    pub flow: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct McLogin {
    pub uuid: String,
    pub name: String,
    pub token: String,
    pub expires_at: i64,
    pub skin_url: String,
    pub xuid: String,
}

async fn post_form(url: &str, form: &[(&str, &str)]) -> Result<(u16, Value)> {
    let r = client().post(url).form(form).send().await.map_err(|_| anyhow!("Couldn't reach Microsoft"))?;
    let status = r.status().as_u16();
    let v = r.json::<Value>().await.unwrap_or(Value::Null);
    Ok((status, v))
}

async fn post_json(url: &str, body: &Value) -> Result<(u16, Value)> {
    let r = client()
        .post(url)
        .header("Accept", "application/json")
        .json(body)
        .send()
        .await
        .map_err(|_| anyhow!("Couldn't reach {}", crate::net::host(url)))?;
    let status = r.status().as_u16();
    let v = r.json::<Value>().await.unwrap_or(Value::Null);
    Ok((status, v))
}

// ------------------------------------------------------------------ browser (sign-in window)

pub struct Pkce {
    pub verifier: String,
    pub url: String,
}

pub fn browser_start() -> Pkce {
    let bytes: [u8; 32] = rand::random();
    let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let verifier = b64.encode(bytes);
    let challenge = b64.encode(Sha256::digest(verifier.as_bytes()));
    let url = format!(
        "{MS_AUTHORIZE}?client_id={}&response_type=code&redirect_uri={}&scope={}&code_challenge={}&code_challenge_method=S256&prompt=select_account",
        BROWSER_CLIENT_ID,
        urlencoding::encode(BROWSER_REDIRECT),
        urlencoding::encode(BROWSER_SCOPE),
        challenge
    );
    Pkce { verifier, url }
}

/// The code from the address the sign-in window lands on (…/oauth20_desktop.srf?code=…).
pub fn code_from_redirect(url: &url::Url) -> Option<Result<String>> {
    if !url.as_str().starts_with(BROWSER_REDIRECT) {
        return None;
    }
    let q: HashMap<String, String> = url.query_pairs().into_owned().collect();
    if let Some(code) = q.get("code") {
        return Some(Ok(code.clone()));
    }
    if let Some(err) = q.get("error") {
        let desc = q.get("error_description").cloned().unwrap_or_else(|| err.clone());
        if err == "access_denied" {
            return Some(Err(anyhow!("Sign-in was cancelled")));
        }
        return Some(Err(anyhow!("Microsoft: {desc}")));
    }
    None
}

pub async fn browser_finish(code: &str, verifier: &str) -> Result<MsTokens> {
    let (status, v) = post_form(
        MS_TOKEN,
        &[
            ("grant_type", "authorization_code"),
            ("client_id", BROWSER_CLIENT_ID),
            ("code", code),
            ("redirect_uri", BROWSER_REDIRECT),
            ("code_verifier", verifier),
            ("scope", BROWSER_SCOPE),
        ],
    )
    .await?;
    let access = v["access_token"].as_str().ok_or_else(|| anyhow!("Microsoft didn't accept the sign-in ({status})"))?;
    Ok(MsTokens { access: access.into(), refresh: v["refresh_token"].as_str().unwrap_or_default().into(), flow: FLOW_BROWSER.into() })
}

// ------------------------------------------------------------------ device code ("enter this code on microsoft.com/link")

#[derive(Clone, Debug, Serialize)]
pub struct DeviceCode {
    pub user_code: String,
    pub device_code: String,
    pub verification_uri: String,
    pub interval: u64,
    pub expires_in: u64,
}

pub async fn device_start() -> Result<DeviceCode> {
    let (status, v) =
        post_form(LIVE_CONNECT, &[("client_id", DEVICE_CLIENT_ID), ("scope", DEVICE_SCOPE), ("response_type", "device_code")]).await?;
    let device_code = v["device_code"].as_str().ok_or_else(|| anyhow!("Microsoft refused the request ({status})"))?;
    Ok(DeviceCode {
        user_code: v["user_code"].as_str().unwrap_or_default().into(),
        device_code: device_code.into(),
        verification_uri: v["verification_uri"].as_str().unwrap_or("https://www.microsoft.com/link").into(),
        interval: v["interval"].as_u64().unwrap_or(5),
        expires_in: v["expires_in"].as_u64().unwrap_or(900),
    })
}

/// None while the player hasn't finished signing in.
pub async fn device_poll(device_code: &str) -> Result<Option<MsTokens>> {
    let (_, v) = post_form(
        LIVE_TOKEN,
        &[("client_id", DEVICE_CLIENT_ID), ("device_code", device_code), ("grant_type", "urn:ietf:params:oauth:grant-type:device_code")],
    )
    .await?;
    if let Some(a) = v["access_token"].as_str() {
        return Ok(Some(MsTokens { access: a.into(), refresh: v["refresh_token"].as_str().unwrap_or_default().into(), flow: FLOW_DEVICE.into() }));
    }
    match v["error"].as_str().unwrap_or("") {
        "authorization_pending" | "slow_down" => Ok(None),
        "expired_token" => bail!("The code expired. Try again."),
        "authorization_declined" | "access_denied" => bail!("Sign-in was cancelled."),
        e => bail!("Microsoft sign-in failed: {e}"),
    }
}

pub async fn refresh(flow: &str, refresh_token: &str) -> Result<MsTokens> {
    let device = flow == FLOW_DEVICE;
    let (_, v) = post_form(
        if device { LIVE_TOKEN } else { MS_TOKEN },
        &[
            ("client_id", if device { DEVICE_CLIENT_ID } else { BROWSER_CLIENT_ID }),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("scope", if device { DEVICE_SCOPE } else { BROWSER_SCOPE }),
        ],
    )
    .await?;
    let access = v["access_token"].as_str().ok_or_else(|| anyhow!("This account's sign-in expired. Remove it and add it again."))?;
    Ok(MsTokens {
        access: access.into(),
        refresh: v["refresh_token"].as_str().unwrap_or(refresh_token).into(),
        flow: flow.into(),
    })
}

// ------------------------------------------------------------------ Xbox + Minecraft

pub async fn minecraft(ms: &MsTokens) -> Result<McLogin> {
    let prefixes: &[&str] = if ms.flow == FLOW_DEVICE { &["t=", "d=", ""] } else { &["d=", "t="] };
    let mut xbl = None;
    let mut last = 0;
    for p in prefixes {
        let body = json!({
            "Properties": {"AuthMethod": "RPS", "SiteName": "user.auth.xboxlive.com", "RpsTicket": format!("{p}{}", ms.access)},
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT"
        });
        let (status, v) = post_json(XBL_AUTH, &body).await?;
        last = status;
        if (200..300).contains(&status) {
            xbl = Some(v);
            break;
        }
    }
    let xbl = xbl.ok_or_else(|| anyhow!("Xbox Live sign-in failed ({last})"))?;
    let xbl_token = xbl["Token"].as_str().unwrap_or_default();
    let uhs = xbl["DisplayClaims"]["xui"][0]["uhs"].as_str().unwrap_or_default();

    let (status, xsts) = post_json(
        XSTS_AUTH,
        &json!({"Properties": {"SandboxId": "RETAIL", "UserTokens": [xbl_token]}, "RelyingParty": "rp://api.minecraftservices.com/", "TokenType": "JWT"}),
    )
    .await?;
    if !(200..300).contains(&status) {
        let xerr = xsts["XErr"].as_u64().map(|x| x.to_string()).unwrap_or_default();
        bail!(match xerr.as_str() {
            "2148916233" => "This Microsoft account has no Xbox profile yet. Sign in on minecraft.net once.".to_string(),
            "2148916235" => "Xbox Live isn't available in your country.".to_string(),
            "2148916238" => "Child account: it has to be added to a Microsoft family first.".to_string(),
            _ => format!("Xbox (XSTS) sign-in failed ({status})"),
        });
    }
    let (status, mc) = post_json(
        MC_LOGIN,
        &json!({"identityToken": format!("XBL3.0 x={uhs};{}", xsts["Token"].as_str().unwrap_or_default())}),
    )
    .await?;
    let token = mc["access_token"].as_str().ok_or_else(|| anyhow!("Minecraft login failed ({status})"))?.to_string();
    let expires_at = now() + mc["expires_in"].as_i64().unwrap_or(86400);

    let r = client().get(MC_PROFILE).bearer_auth(&token).send().await.map_err(|_| anyhow!("Couldn't reach Minecraft"))?;
    if r.status().as_u16() == 404 {
        bail!("This Microsoft account doesn't own Minecraft Java Edition.");
    }
    if !r.status().is_success() {
        bail!("Couldn't read the Minecraft profile ({})", r.status());
    }
    let p: Value = r.json().await?;
    let skin_url = p["skins"]
        .as_array()
        .and_then(|s| s.iter().find(|x| x["state"] == "ACTIVE").or_else(|| s.first()))
        .and_then(|s| s["url"].as_str())
        .unwrap_or_default()
        .replace("http://", "https://");
    Ok(McLogin {
        uuid: dashed(p["id"].as_str().unwrap_or_default()),
        name: p["name"].as_str().unwrap_or_default().into(),
        token,
        expires_at,
        skin_url,
        xuid: xsts["DisplayClaims"]["xui"][0]["xid"].as_str().unwrap_or_default().into(),
    })
}

pub fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

pub fn dashed(id: &str) -> String {
    let s = id.replace('-', "");
    if s.len() != 32 {
        return id.to_string();
    }
    format!("{}-{}-{}-{}-{}", &s[0..8], &s[8..12], &s[12..16], &s[16..20], &s[20..32])
}
