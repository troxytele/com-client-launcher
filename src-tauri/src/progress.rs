//! Progress of installing / launching, sent to the window.

use serde::Serialize;
use std::sync::Arc;

#[derive(Clone, Serialize, Debug)]
pub struct Progress {
    /// What is happening ("Downloading libraries" ...).
    pub stage: String,
    pub done: u64,
    pub total: u64,
}

/// Something that hands progress to the UI (or nowhere, in tests).
#[derive(Clone)]
pub struct Reporter(Arc<dyn Fn(Progress) + Send + Sync>);

impl Reporter {
    pub fn new(f: impl Fn(Progress) + Send + Sync + 'static) -> Self {
        Reporter(Arc::new(f))
    }

    pub fn none() -> Self {
        Reporter(Arc::new(|_| {}))
    }

    pub fn stage(&self, stage: &str, done: u64, total: u64) {
        (self.0)(Progress { stage: stage.to_string(), done, total });
    }
}
