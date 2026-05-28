//! One [`RunnerBridge`] per managed runner, keyed by [`RunnerId`].
//!
//! The pool spawns and tracks runner processes; the bridge registry
//! tracks the live JSON-RPC attachment to each one. Splitting these two
//! roles cleanly means a runner can be in the pool but transiently
//! disconnected (e.g. while the boot task waits for the socket to
//! accept), without the rest of the app having to thread a "maybe-
//! connected" `Option` through every call site.
//!
//! Bridge mutation is internally synchronised via `tokio::Mutex` so
//! attach/detach races (two concurrent boot tasks for the same id, a
//! disconnect during attach, …) resolve deterministically.

use parking_lot::Mutex as ParkingMutex;
use std::collections::HashMap;
use std::sync::Arc;

use crate::pool::RunnerId;
use crate::runner_bridge::RunnerBridge;

#[derive(Clone, Default)]
pub struct BridgeRegistry {
    inner: Arc<ParkingMutex<HashMap<RunnerId, RunnerBridge>>>,
}

impl BridgeRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Stash a connected bridge against a runner id. Overwrites any
    /// existing entry — callers that need exclusive attach semantics
    /// should consult [`Self::contains`] first.
    pub fn insert(&self, id: RunnerId, bridge: RunnerBridge) {
        self.inner.lock().insert(id, bridge);
    }

    /// Drop a bridge by id. Returns the bridge so the caller can
    /// observe its shutdown (e.g. `bridge.is_closed()` after a small
    /// pause) — most callers just discard the returned value.
    pub fn remove(&self, id: &RunnerId) -> Option<RunnerBridge> {
        self.inner.lock().remove(id)
    }

    pub fn get(&self, id: &RunnerId) -> Option<RunnerBridge> {
        self.inner.lock().get(id).cloned()
    }

    pub fn contains(&self, id: &RunnerId) -> bool {
        self.inner.lock().contains_key(id)
    }

    pub fn ids(&self) -> Vec<RunnerId> {
        self.inner.lock().keys().cloned().collect()
    }

    pub fn len(&self) -> usize {
        self.inner.lock().len()
    }

    pub fn is_empty(&self) -> bool {
        self.inner.lock().is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runner_bridge::RunnerBridge;
    use crate::transport::mock::PairedTransport;
    use serde_json::json;
    use std::time::Duration;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    async fn make_bridge() -> RunnerBridge {
        let (transport, server) = PairedTransport::paired();
        tokio::spawn(async move {
            let (read, mut write) = tokio::io::split(server);
            let mut lines = BufReader::new(read).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let frame: serde_json::Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let id = frame["id"].as_u64().unwrap_or(0);
                let response = json!({
                    "id": id,
                    "result": {
                        "sessionId": "sess-test",
                        "protocolVersion": crate::runner_bridge::RUNNER_PROTOCOL_VERSION,
                        "info": {}
                    }
                });
                let mut bytes = serde_json::to_vec(&response).unwrap();
                bytes.push(b'\n');
                let _ = write.write_all(&bytes).await;
            }
        });
        let (bridge, _rx) = tokio::time::timeout(
            Duration::from_secs(3),
            RunnerBridge::connect(Arc::new(transport), "test"),
        )
        .await
        .expect("connect deadline")
        .expect("connect");
        bridge
    }

    #[tokio::test]
    async fn insert_then_get_round_trips() {
        let reg = BridgeRegistry::new();
        let id = RunnerId::new();
        let bridge = make_bridge().await;
        reg.insert(id.clone(), bridge);
        assert!(reg.get(&id).is_some());
        assert_eq!(reg.len(), 1);
        assert!(reg.contains(&id));
    }

    #[tokio::test]
    async fn remove_evicts_the_entry() {
        let reg = BridgeRegistry::new();
        let id = RunnerId::new();
        let bridge = make_bridge().await;
        reg.insert(id.clone(), bridge);
        let removed = reg.remove(&id);
        assert!(removed.is_some());
        assert!(!reg.contains(&id));
        assert!(reg.is_empty());
    }

    #[tokio::test]
    async fn ids_lists_every_attachment() {
        let reg = BridgeRegistry::new();
        let id1 = RunnerId::new();
        let id2 = RunnerId::new();
        reg.insert(id1.clone(), make_bridge().await);
        reg.insert(id2.clone(), make_bridge().await);
        let ids: std::collections::HashSet<_> = reg.ids().into_iter().collect();
        assert!(ids.contains(&id1));
        assert!(ids.contains(&id2));
    }

    #[tokio::test]
    async fn registry_clones_share_state() {
        let reg = BridgeRegistry::new();
        let cloned = reg.clone();
        let id = RunnerId::new();
        cloned.insert(id.clone(), make_bridge().await);
        // The original sees the insert via the shared Arc inside.
        assert!(reg.contains(&id));
    }
}
