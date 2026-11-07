//! HTTP + verified downloads (hash checks, retries, parallel batches, progress).

use anyhow::{anyhow, bail, Context, Result};
use futures::StreamExt;
use serde::de::DeserializeOwned;
use sha1::{Digest, Sha1};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::io::AsyncWriteExt;

use crate::progress::Reporter;

pub fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(crate::config::user_agent())
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(300))
            .pool_max_idle_per_host(16)
            .build()
            .expect("http client")
    })
}

pub async fn get_json<T: DeserializeOwned>(url: &str) -> Result<T> {
    let r = client().get(url).send().await.with_context(|| format!("Couldn't reach {}", host(url)))?;
    if !r.status().is_success() {
        bail!("{} answered {}", host(url), r.status());
    }
    Ok(r.json::<T>().await.with_context(|| format!("Bad answer from {}", host(url)))?)
}

pub fn host(url: &str) -> String {
    url::Url::parse(url).ok().and_then(|u| u.host_str().map(|s| s.to_string())).unwrap_or_else(|| url.to_string())
}

/// Which hash a file is checked against.
#[derive(Clone, Debug)]
pub enum Hash {
    None,
    Sha1(String),
    Sha256(String),
}

/// One file to download.
#[derive(Clone, Debug)]
pub struct Download {
    pub url: String,
    pub path: PathBuf,
    pub hash: Hash,
    pub size: u64,
    pub executable: bool,
}

impl Download {
    pub fn new(url: impl Into<String>, path: impl Into<PathBuf>, sha1: Option<String>, size: u64) -> Self {
        Download { url: url.into(), path: path.into(), hash: sha1.map(Hash::Sha1).unwrap_or(Hash::None), size, executable: false }
    }
}

pub fn sha1_file(path: &Path) -> Result<String> {
    let data = std::fs::read(path)?;
    let mut h = Sha1::new();
    h.update(&data);
    Ok(hex::encode(h.finalize()))
}

pub fn sha256_file(path: &Path) -> Result<String> {
    use sha2::Sha256;
    let data = std::fs::read(path)?;
    let mut h = Sha256::new();
    h.update(&data);
    Ok(hex::encode(h.finalize()))
}

/// Is the file there and correct? (No hash: correct size, or just present.)
pub fn is_valid(d: &Download) -> bool {
    let Ok(meta) = std::fs::metadata(&d.path) else { return false };
    if !meta.is_file() {
        return false;
    }
    if d.size > 0 && meta.len() != d.size {
        return false;
    }
    match &d.hash {
        Hash::None => true,
        Hash::Sha1(s) => sha1_file(&d.path).map(|h| h.eq_ignore_ascii_case(s)).unwrap_or(false),
        Hash::Sha256(s) => sha256_file(&d.path).map(|h| h.eq_ignore_ascii_case(s)).unwrap_or(false),
    }
}

/// Downloads one file to a temporary name, checks it, then moves it into place. Retries 3 times.
pub async fn fetch(d: &Download, bytes_done: Option<&AtomicU64>) -> Result<()> {
    let mut last = None;
    for attempt in 0..3 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(600 * attempt)).await;
        }
        match fetch_once(d, bytes_done).await {
            Ok(()) => return Ok(()),
            Err(e) => last = Some(e),
        }
    }
    Err(last.unwrap_or_else(|| anyhow!("download failed")))
        .with_context(|| format!("Couldn't download {}", d.path.file_name().and_then(|s| s.to_str()).unwrap_or("a file")))
}

async fn fetch_once(d: &Download, bytes_done: Option<&AtomicU64>) -> Result<()> {
    if let Some(parent) = d.path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let tmp = d.path.with_extension(format!("part{}", rand::random::<u16>()));
    let res = async {
        let r = client().get(&d.url).send().await?;
        if !r.status().is_success() {
            bail!("{} answered {}", host(&d.url), r.status());
        }
        let mut file = tokio::fs::File::create(&tmp).await?;
        let mut stream = r.bytes_stream();
        let mut sha1 = Sha1::new();
        let mut sha256 = <sha2::Sha256 as sha2::Digest>::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            match d.hash {
                Hash::Sha1(_) => sha1.update(&chunk),
                Hash::Sha256(_) => sha2::Digest::update(&mut sha256, &chunk),
                Hash::None => {}
            }
            file.write_all(&chunk).await?;
            if let Some(b) = bytes_done {
                b.fetch_add(chunk.len() as u64, Ordering::Relaxed);
            }
        }
        file.flush().await?;
        drop(file);
        let ok = match &d.hash {
            Hash::Sha1(s) => hex::encode(sha1.finalize()).eq_ignore_ascii_case(s),
            Hash::Sha256(s) => hex::encode(sha2::Digest::finalize(sha256)).eq_ignore_ascii_case(s),
            Hash::None => true,
        };
        if !ok {
            bail!("the downloaded file was damaged");
        }
        #[cfg(unix)]
        if d.executable {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755));
        }
        let _ = tokio::fs::remove_file(&d.path).await;
        tokio::fs::rename(&tmp, &d.path).await?;
        Ok(())
    }
    .await;
    if res.is_err() {
        let _ = tokio::fs::remove_file(&tmp).await;
    }
    res
}

/// Checks all files, downloads the missing / broken ones (16 at a time) and reports progress in bytes.
pub async fn fetch_all(stage: &str, list: Vec<Download>, rep: &Reporter) -> Result<()> {
    rep.stage(stage, 0, 0);
    // checking thousands of files: do it on the blocking pool
    let missing: Vec<Download> = tokio::task::spawn_blocking(move || list.into_iter().filter(|d| !is_valid(d)).collect())
        .await
        .map_err(|e| anyhow!(e))?;
    if missing.is_empty() {
        return Ok(());
    }
    let total: u64 = missing.iter().map(|d| d.size.max(1)).sum();
    let done = Arc::new(AtomicU64::new(0));
    let count = missing.len();
    rep.stage(stage, 0, total);
    let ticker = {
        let done = done.clone();
        let rep = rep.clone();
        let stage = stage.to_string();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(120)).await;
                rep.stage(&stage, done.load(Ordering::Relaxed).min(total), total);
            }
        })
    };
    let results: Vec<Result<()>> = futures::stream::iter(missing.into_iter().map(|d| {
        let done = done.clone();
        async move { fetch(&d, Some(&done)).await }
    }))
    .buffer_unordered(16)
    .collect()
    .await;
    ticker.abort();
    let failed: Vec<String> = results.into_iter().filter_map(|r| r.err().map(|e| format!("{e:#}"))).collect();
    if !failed.is_empty() {
        bail!("{} of {} files failed. First error: {}", failed.len(), count, failed[0]);
    }
    rep.stage(stage, total, total);
    Ok(())
}
