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

// ------------------------------------------------------------------ "already checked" cache
//
// Hashing every library and asset (thousands of files, ~600 MB) on each Play is what made starting slow.
// A file whose hash was checked once is remembered with its size + modified time; while those stay the same
// it isn't read again. Any change (or a different expected hash) checks it properly.

type Seen = std::collections::HashMap<String, (u64, u128, String)>;

struct Checked {
    file: Option<PathBuf>,
    seen: Seen,
    dirty: bool,
}

fn checked() -> &'static std::sync::Mutex<Checked> {
    static C: OnceLock<std::sync::Mutex<Checked>> = OnceLock::new();
    C.get_or_init(|| std::sync::Mutex::new(Checked { file: None, seen: Seen::new(), dirty: false }))
}

/// Where the cache lives (called once at start).
pub fn init_checked(file: PathBuf) {
    let seen: Seen = std::fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    let mut c = checked().lock().unwrap();
    c.seen = seen;
    c.file = Some(file);
}

/// Writes the cache if something changed.
pub fn save_checked() {
    let (file, data) = {
        let mut c = checked().lock().unwrap();
        if !c.dirty {
            return;
        }
        c.dirty = false;
        (c.file.clone(), serde_json::to_vec(&c.seen).unwrap_or_default())
    };
    if let Some(f) = file {
        if let Some(p) = f.parent() {
            let _ = std::fs::create_dir_all(p);
        }
        let tmp = f.with_extension("tmp");
        if std::fs::write(&tmp, data).is_ok() {
            let _ = std::fs::rename(tmp, f);
        }
    }
}

fn stamp(meta: &std::fs::Metadata) -> u128 {
    meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_nanos()).unwrap_or(0)
}

fn remember(path: &Path, meta: &std::fs::Metadata, hash: &str) {
    let mut c = checked().lock().unwrap();
    c.seen.insert(path.to_string_lossy().to_string(), (meta.len(), stamp(meta), hash.to_ascii_lowercase()));
    c.dirty = true;
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
    let want = match &d.hash {
        Hash::None => return true,
        Hash::Sha1(s) | Hash::Sha256(s) => s.to_ascii_lowercase(),
    };
    {
        let c = checked().lock().unwrap();
        if let Some((len, at, h)) = c.seen.get(d.path.to_string_lossy().as_ref()) {
            if *len == meta.len() && *at == stamp(&meta) && *h == want {
                return true;
            }
        }
    }
    let ok = match &d.hash {
        Hash::Sha1(_) => sha1_file(&d.path).map(|h| h.eq_ignore_ascii_case(&want)).unwrap_or(false),
        Hash::Sha256(_) => sha256_file(&d.path).map(|h| h.eq_ignore_ascii_case(&want)).unwrap_or(false),
        Hash::None => true,
    };
    if ok {
        remember(&d.path, &meta, &want);
    }
    ok
}

/// Checks many files on all CPU cores; returns the ones that are missing or wrong.
pub fn missing_of(list: Vec<Download>) -> Vec<Download> {
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(2, 12);
    let chunk = list.len().div_ceil(threads).max(1);
    let out: Vec<Download> = std::thread::scope(|s| {
        let handles: Vec<_> = list.chunks(chunk).map(|part| s.spawn(move || part.iter().filter(|d| !is_valid(d)).cloned().collect::<Vec<_>>())).collect();
        handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    });
    save_checked();
    out
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
    let missing: Vec<Download> = tokio::task::spawn_blocking(move || missing_of(list))
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
