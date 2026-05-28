//! Pool of supervised moxxy runners. The desktop runs one **primary**
//! runner that owns the background daemons (scheduler, webhooks) and
//! zero-or-more **ephemeral** runners — one per parallel-session window.
//!
//! Each ephemeral runner is exactly the same `moxxy serve` binary, just
//! pointed at a unique unix socket (`MOXXY_RUNNER_SOCKET` env var) and
//! launched with `--except scheduler,webhooks` so the daemons stay
//! singleton on the primary.
//!
//! The pool keeps the trait surface narrow on purpose: spawn / kill /
//! list / get. Higher-level concerns — connecting the bridge, fanning
//! events to a specific window — sit above this in the app crate.

use async_trait::async_trait;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::sidecar::node::{NodeSidecar, NodeSidecarConfig};
use crate::sidecar::{Sidecar, SidecarStatus};
use crate::transport::unix::UnixTransport;
use crate::transport::RunnerTransport;

/// Opaque, URL-safe runner identifier. UUIDv4 under the hood so two
/// concurrent spawns can't collide, but we never expose that — callers
/// just compare ids for equality.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RunnerId(String);

impl RunnerId {
    pub fn new() -> Self {
        Self(Uuid::new_v4().to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for RunnerId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for RunnerId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// What kind of runner this is. Affects argv + socket path resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunnerKind {
    /// Owns the daemons (scheduler poller, webhooks listener) on the
    /// canonical socket path. Exactly one per app instance.
    Primary,
    /// One per parallel-session window. Spawned with
    /// `--except scheduler,webhooks` so daemons stay singleton.
    Ephemeral,
}

/// Snapshot of a single managed runner. Cheap to clone — the underlying
/// `Sidecar` and `RunnerTransport` are themselves trait objects behind
/// `Arc`s, so cloning the handle doesn't fork them.
#[derive(Clone)]
pub struct RunnerHandle {
    pub id: RunnerId,
    pub kind: RunnerKind,
    pub socket: String,
    pub sidecar: Arc<dyn Sidecar>,
    pub transport: Arc<dyn RunnerTransport>,
}

impl RunnerHandle {
    pub fn status(&self) -> SidecarStatus {
        self.sidecar.status()
    }
}

impl std::fmt::Debug for RunnerHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RunnerHandle")
            .field("id", &self.id)
            .field("kind", &self.kind)
            .field("socket", &self.socket)
            .field("status", &self.status())
            .finish()
    }
}

#[async_trait]
pub trait RunnerPool: Send + Sync + 'static {
    /// Spawn a runner of `kind`. Returns immediately; the sidecar has
    /// been told to start but the caller is responsible for waiting on
    /// readiness via the transport.
    async fn spawn(&self, kind: RunnerKind) -> AppResult<RunnerHandle>;

    /// Stop and remove a runner. Idempotent — calling on an already-
    /// killed id returns `Ok(())`.
    async fn kill(&self, id: &RunnerId) -> AppResult<()>;

    /// Snapshot of all currently tracked runners.
    fn list(&self) -> Vec<RunnerHandle>;

    /// Fetch a single runner by id, if it's tracked.
    fn get(&self, id: &RunnerId) -> Option<RunnerHandle>;
}

/// Configuration for [`NodeRunnerPool`]. Keep this small — anything
/// derived from the user environment lives outside (the composition
/// root in `app_state.rs` builds it).
#[derive(Debug, Clone)]
pub struct NodeRunnerPoolConfig {
    /// Node binary on PATH (or absolute). Inherited by every spawn.
    pub node_bin: String,
    /// Path to the bundled `moxxy` CLI entry. Inherited.
    pub cli_entry: String,
    /// Default cwd for both primary and ephemeral. Per-runner cwd
    /// override lands in a later phase.
    pub cwd: Option<PathBuf>,
    /// The socket the **primary** binds to. Mirrors the runner's own
    /// default in `packages/runner/src/socket-path.ts`.
    pub primary_socket: String,
    /// Directory under which ephemeral sockets are laid out. Each
    /// ephemeral runner gets `<dir>/serve-<id>.sock`.
    pub ephemeral_dir: PathBuf,
}

#[derive(Default)]
struct PoolState {
    runners: HashMap<RunnerId, RunnerHandle>,
}

/// Spawns moxxy runners as child Node processes, supervises them via
/// [`NodeSidecar`], and exposes them through [`RunnerPool`].
///
/// Test-friendly: the production code only ever interacts with the pool
/// through the trait. Tests inject [`mock::MockRunnerPool`] instead so
/// they don't need a real Node binary.
#[derive(Clone)]
pub struct NodeRunnerPool {
    cfg: NodeRunnerPoolConfig,
    state: Arc<Mutex<PoolState>>,
}

impl NodeRunnerPool {
    pub fn new(cfg: NodeRunnerPoolConfig) -> Self {
        Self {
            cfg,
            state: Arc::new(Mutex::new(PoolState::default())),
        }
    }

    fn build_sidecar(
        &self,
        kind: RunnerKind,
        socket: &str,
    ) -> NodeSidecar {
        let mut extra_args = Vec::new();
        if kind == RunnerKind::Ephemeral {
            // Singleton daemons stay on the primary; ephemerals exist
            // only to expose a parallel Session over a separate socket.
            extra_args.push("--except".to_string());
            extra_args.push("scheduler,webhooks".to_string());
        }
        let env = vec![("MOXXY_RUNNER_SOCKET".to_string(), socket.to_string())];
        NodeSidecar::new(NodeSidecarConfig {
            node_bin: self.cfg.node_bin.clone(),
            cli_entry: self.cfg.cli_entry.clone(),
            extra_args,
            cwd: self.cfg.cwd.clone(),
            env,
        })
    }

    fn socket_for(&self, kind: RunnerKind, id: &RunnerId) -> String {
        match kind {
            RunnerKind::Primary => self.cfg.primary_socket.clone(),
            RunnerKind::Ephemeral => self
                .cfg
                .ephemeral_dir
                .join(format!("serve-{}.sock", id))
                .to_string_lossy()
                .into_owned(),
        }
    }
}

#[async_trait]
impl RunnerPool for NodeRunnerPool {
    async fn spawn(&self, kind: RunnerKind) -> AppResult<RunnerHandle> {
        // Refuse a second Primary up front — keeps the daemon scope
        // singleton-by-construction rather than singleton-by-convention.
        if kind == RunnerKind::Primary {
            let existing = self
                .state
                .lock()
                .runners
                .values()
                .any(|h| h.kind == RunnerKind::Primary);
            if existing {
                return Err(AppError::SidecarStart(
                    "a primary runner already exists in this pool".into(),
                ));
            }
        }

        let id = RunnerId::new();
        let socket = self.socket_for(kind, &id);
        let sidecar = Arc::new(self.build_sidecar(kind, &socket)) as Arc<dyn Sidecar>;
        let transport: Arc<dyn RunnerTransport> =
            Arc::new(UnixTransport::with_path(socket.clone()));

        sidecar.start().await?;

        let handle = RunnerHandle {
            id: id.clone(),
            kind,
            socket,
            sidecar,
            transport,
        };
        self.state.lock().runners.insert(id, handle.clone());
        Ok(handle)
    }

    async fn kill(&self, id: &RunnerId) -> AppResult<()> {
        let handle = self.state.lock().runners.remove(id);
        if let Some(h) = handle {
            h.sidecar.stop().await?;
        }
        Ok(())
    }

    fn list(&self) -> Vec<RunnerHandle> {
        self.state.lock().runners.values().cloned().collect()
    }

    fn get(&self, id: &RunnerId) -> Option<RunnerHandle> {
        self.state.lock().runners.get(id).cloned()
    }
}

/// In-memory pool for tests. Backed by `MockSidecar`s + paired in-memory
/// transports so unit tests never touch a real process or socket.
pub mod mock {
    use super::*;
    use crate::sidecar::mock::MockSidecar;
    use crate::transport::mock::PairedTransport;

    /// A handle plus the server-side end of the paired transport, so
    /// tests can drive replies against the bridge connected to this
    /// runner.
    pub struct MockSpawn {
        pub handle: RunnerHandle,
        pub server: tokio::io::DuplexStream,
    }

    #[derive(Clone, Default)]
    pub struct MockRunnerPool {
        state: Arc<Mutex<PoolState>>,
    }

    impl MockRunnerPool {
        pub fn new() -> Self {
            Self::default()
        }

        /// Like `spawn` but returns the paired server stream so the
        /// test can pretend to BE the runner on the wire.
        pub async fn spawn_paired(&self, kind: RunnerKind) -> AppResult<MockSpawn> {
            if kind == RunnerKind::Primary
                && self
                    .state
                    .lock()
                    .runners
                    .values()
                    .any(|h| h.kind == RunnerKind::Primary)
            {
                return Err(AppError::SidecarStart(
                    "a primary runner already exists in this pool".into(),
                ));
            }
            let id = RunnerId::new();
            let sidecar = Arc::new(MockSidecar::new()) as Arc<dyn Sidecar>;
            let (transport, server) = PairedTransport::paired();
            let transport: Arc<dyn RunnerTransport> = Arc::new(transport);
            sidecar.start().await?;
            let handle = RunnerHandle {
                id: id.clone(),
                kind,
                socket: format!("mock://{id}"),
                sidecar,
                transport,
            };
            self.state.lock().runners.insert(id, handle.clone());
            Ok(MockSpawn { handle, server })
        }
    }

    #[async_trait]
    impl RunnerPool for MockRunnerPool {
        async fn spawn(&self, kind: RunnerKind) -> AppResult<RunnerHandle> {
            let spawn = self.spawn_paired(kind).await?;
            // Discard the server side — tests that need it use
            // spawn_paired() directly.
            drop(spawn.server);
            Ok(spawn.handle)
        }
        async fn kill(&self, id: &RunnerId) -> AppResult<()> {
            let removed = self.state.lock().runners.remove(id);
            if let Some(h) = removed {
                h.sidecar.stop().await?;
            }
            Ok(())
        }
        fn list(&self) -> Vec<RunnerHandle> {
            self.state.lock().runners.values().cloned().collect()
        }
        fn get(&self, id: &RunnerId) -> Option<RunnerHandle> {
            self.state.lock().runners.get(id).cloned()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> NodeRunnerPoolConfig {
        NodeRunnerPoolConfig {
            node_bin: "node".into(),
            cli_entry: "/tmp/cli.js".into(),
            cwd: None,
            primary_socket: "/tmp/serve.sock".into(),
            ephemeral_dir: PathBuf::from("/tmp/ephem"),
        }
    }

    #[test]
    fn runner_id_serialises_as_a_bare_string() {
        let id = RunnerId::new();
        let s = serde_json::to_string(&id).unwrap();
        assert!(s.starts_with('"') && s.ends_with('"'));
        let round: RunnerId = serde_json::from_str(&s).unwrap();
        assert_eq!(round, id);
    }

    #[test]
    fn each_runner_id_is_unique() {
        let a = RunnerId::new();
        let b = RunnerId::new();
        assert_ne!(a, b);
    }

    #[test]
    fn primary_uses_canonical_socket() {
        let pool = NodeRunnerPool::new(config());
        let id = RunnerId::new();
        assert_eq!(
            pool.socket_for(RunnerKind::Primary, &id),
            "/tmp/serve.sock"
        );
    }

    #[test]
    fn ephemerals_get_unique_socket_paths() {
        let pool = NodeRunnerPool::new(config());
        let a = pool.socket_for(RunnerKind::Ephemeral, &RunnerId::new());
        let b = pool.socket_for(RunnerKind::Ephemeral, &RunnerId::new());
        assert_ne!(a, b);
        assert!(a.starts_with("/tmp/ephem/serve-"));
    }

    #[test]
    fn ephemerals_carry_the_except_flag() {
        let pool = NodeRunnerPool::new(config());
        let s = pool.build_sidecar(RunnerKind::Ephemeral, "/tmp/x.sock");
        // Inspect through Debug since the field is private — the kind
        // contract guarantees the two-arg pair.
        let dbg = format!("{s:?}");
        assert!(dbg.contains("--except"));
        assert!(dbg.contains("scheduler,webhooks"));
    }

    #[test]
    fn primary_does_not_carry_except() {
        let pool = NodeRunnerPool::new(config());
        let s = pool.build_sidecar(RunnerKind::Primary, "/tmp/x.sock");
        let dbg = format!("{s:?}");
        assert!(!dbg.contains("--except"));
    }

    // ---- mock-pool behaviours -------------------------------------------

    #[tokio::test]
    async fn mock_pool_spawn_and_list() {
        let pool = mock::MockRunnerPool::new();
        let h1 = pool.spawn(RunnerKind::Primary).await.unwrap();
        let h2 = pool.spawn(RunnerKind::Ephemeral).await.unwrap();
        let listed = pool.list();
        assert_eq!(listed.len(), 2);
        let ids: std::collections::HashSet<_> = listed.iter().map(|h| h.id.clone()).collect();
        assert!(ids.contains(&h1.id));
        assert!(ids.contains(&h2.id));
    }

    #[tokio::test]
    async fn mock_pool_refuses_a_second_primary() {
        let pool = mock::MockRunnerPool::new();
        pool.spawn(RunnerKind::Primary).await.unwrap();
        let err = pool.spawn(RunnerKind::Primary).await.unwrap_err();
        assert!(matches!(err, AppError::SidecarStart(_)));
    }

    #[tokio::test]
    async fn mock_pool_kill_removes_and_stops() {
        let pool = mock::MockRunnerPool::new();
        let h = pool.spawn(RunnerKind::Primary).await.unwrap();
        assert!(pool.get(&h.id).is_some());
        pool.kill(&h.id).await.unwrap();
        assert!(pool.get(&h.id).is_none());
        assert_eq!(h.sidecar.status(), SidecarStatus::Stopped);
    }

    #[tokio::test]
    async fn mock_pool_kill_is_idempotent() {
        let pool = mock::MockRunnerPool::new();
        let id = RunnerId::new();
        // Killing an unknown id is a no-op.
        pool.kill(&id).await.unwrap();
    }
}
