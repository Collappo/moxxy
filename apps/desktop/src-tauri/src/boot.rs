//! Startup orchestration. Spawns a background task that:
//!
//!   1. Boots the sidecar (`moxxy serve`).
//!   2. Polls the transport until the runner socket accepts a connection
//!      — or gives up after a timeout if the sidecar never came up.
//!   3. Connects the [`RunnerBridge`], stashes it in `AppState`, and
//!      pumps the bridge's broadcast events out as Tauri events.
//!
//! All of this lives off the main thread so the window opens immediately
//! and shows a "starting runner…" state while connect is in flight.
//! Failures emit a `runner.error` event the UI can surface.

use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Runtime};

use moxxy_desktop_core::runner_bridge::{BridgeEvent, RunnerBridge};
use moxxy_desktop_core::transport::{is_runner_up, RunnerTransport};

use crate::app_state::AppState;

/// Names of the Tauri events the UI listens to. Stable wire contract; do
/// not rename without coordinating with the TS hooks.
pub mod events {
    pub const SIDECAR_STATUS: &str = "sidecar.status";
    pub const RUNNER_READY: &str = "runner.ready";
    pub const RUNNER_EVENT: &str = "runner.event";
    pub const RUNNER_TURN_COMPLETE: &str = "runner.turn.complete";
    pub const RUNNER_INFO_CHANGED: &str = "runner.info.changed";
    pub const RUNNER_LAGGED: &str = "runner.lagged";
    pub const RUNNER_ERROR: &str = "runner.error";
}

/// Maximum time we'll wait for the runner socket to become connectable
/// before we give up and emit `runner.error`. The actual runner usually
/// binds in <500ms.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const POLL_INTERVAL: Duration = Duration::from_millis(120);

/// Spawn the boot task. Call once from `setup()` after `AppState` is
/// managed. Returns immediately; the work happens in the background.
pub fn spawn<R: Runtime>(app: AppHandle<R>, state: AppState) {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = run(app.clone(), state).await {
            tracing::warn!(error = %e, "boot task failed");
            let _ = app.emit(events::RUNNER_ERROR, e.to_string());
        }
    });
}

async fn run<R: Runtime>(app: AppHandle<R>, state: AppState) -> Result<(), BootError> {
    // 1. Start the sidecar.
    state
        .sidecar
        .start()
        .await
        .map_err(|e| BootError::Sidecar(e.to_string()))?;
    let _ = app.emit(events::SIDECAR_STATUS, state.sidecar.status());

    // 2. Wait until the runner socket accepts connections.
    let transport: Arc<dyn RunnerTransport> = Arc::clone(&state.transport);
    let deadline = tokio::time::Instant::now() + CONNECT_TIMEOUT;
    loop {
        if is_runner_up(transport.as_ref()).await {
            break;
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(BootError::Timeout);
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }

    // 3. Connect the bridge. The initial receiver predates attach so the
    // runner's history replay lands on us, not the floor.
    let (bridge, mut events_rx) = RunnerBridge::connect(transport, "desktop")
        .await
        .map_err(|e| BootError::Connect(e.to_string()))?;

    {
        let mut slot = state.bridge.lock().await;
        *slot = Some(bridge);
    }
    let _ = app.emit(events::RUNNER_READY, true);

    // 4. Pump events. Stays alive until either the broadcast channel
    // closes (bridge dropped) or the recv loop is cancelled (app exit).
    while let Ok(event) = events_rx.recv().await {
        match event {
            BridgeEvent::Event { event } => {
                let _ = app.emit(events::RUNNER_EVENT, event);
            }
            BridgeEvent::TurnComplete { turn_id, error } => {
                let _ = app.emit(
                    events::RUNNER_TURN_COMPLETE,
                    serde_json::json!({ "turnId": turn_id, "error": error }),
                );
            }
            BridgeEvent::InfoChanged { info } => {
                let _ = app.emit(events::RUNNER_INFO_CHANGED, info);
            }
            BridgeEvent::Lagged { count } => {
                let _ = app.emit(events::RUNNER_LAGGED, count);
            }
        }
    }

    Ok(())
}

#[derive(Debug, thiserror::Error)]
enum BootError {
    #[error("sidecar failed to start: {0}")]
    Sidecar(String),
    #[error("runner did not accept connections within the boot timeout")]
    Timeout,
    #[error("attach failed: {0}")]
    Connect(String),
}
