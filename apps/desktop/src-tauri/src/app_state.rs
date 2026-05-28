//! Composition root. Holds Arc<dyn _> capability handles for the running app.

use std::sync::Arc;
use tokio::sync::Mutex;

use moxxy_desktop_core::desks::{json_store::JsonDeskStore, DeskStore};
use moxxy_desktop_core::runner_bridge::RunnerBridge;
use moxxy_desktop_core::sidecar::Sidecar;
use moxxy_desktop_core::transport::RunnerTransport;
#[cfg(not(test))]
use moxxy_desktop_core::transport::unix::UnixTransport;

#[derive(Clone)]
pub struct AppState {
    pub desks: Arc<dyn DeskStore>,
    pub sidecar: Arc<dyn Sidecar>,
    pub transport: Arc<dyn RunnerTransport>,
    /// Set once the primary runner is up and the bridge has attached.
    /// Wrapped in `Mutex<Option<…>>` so the boot task can install it
    /// from a background task while commands stay non-blocking.
    pub bridge: Arc<Mutex<Option<RunnerBridge>>>,
}

impl AppState {
    #[cfg(not(test))]
    pub fn production<R: tauri::Runtime>(
        _app: &tauri::AppHandle<R>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        use moxxy_desktop_core::sidecar::node::{NodeSidecar, NodeSidecarConfig};

        let home = dirs::home_dir().ok_or("home dir unavailable")?;
        let moxxy_dir = home.join(".moxxy");

        let desks = Arc::new(JsonDeskStore::at(moxxy_dir.join("desks.json")));

        let cli_entry = std::env::var("MOXXY_CLI_ENTRY")
            .unwrap_or_else(|_| "/usr/local/bin/moxxy-cli/bin.js".to_string());
        let sidecar = Arc::new(NodeSidecar::new(NodeSidecarConfig {
            cli_entry,
            ..Default::default()
        }));

        let transport: Arc<dyn RunnerTransport> = Arc::new(UnixTransport::default_path()?);

        Ok(Self {
            desks,
            sidecar,
            transport,
            bridge: Arc::new(Mutex::new(None)),
        })
    }

    #[cfg(test)]
    pub fn production<R: tauri::Runtime>(
        _app: &tauri::AppHandle<R>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        Err("AppState::production is not available in test builds".into())
    }

    pub fn for_testing(
        desks: Arc<dyn DeskStore>,
        sidecar: Arc<dyn Sidecar>,
        transport: Arc<dyn RunnerTransport>,
    ) -> Self {
        Self {
            desks,
            sidecar,
            transport,
            bridge: Arc::new(Mutex::new(None)),
        }
    }

    /// True once the runner bridge has attached. UI uses this to decide
    /// whether to render the chat composer (vs the "starting runner" state).
    pub async fn has_bridge(&self) -> bool {
        self.bridge.lock().await.is_some()
    }
}
