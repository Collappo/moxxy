//! Per-window state: which desk is bound, which session is being
//! resumed, which runner is pinned.
//!
//! The [`WindowRegistry`] trait abstracts the actual native window
//! handle (Tauri's `WebviewWindow` in production, a mock in tests). The
//! pin store is a small JSON document on disk so windows survive an app
//! relaunch — the user expects "I left two windows open, I reopen the
//! app, they come back".

use async_trait::async_trait;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::fs;
use tokio::sync::Mutex as TokioMutex;

use crate::desks::DeskId;
use crate::error::{AppError, AppResult};
use crate::pool::RunnerId;

/// Stable per-window identifier. Tauri uses window labels (strings) as
/// the routing key for `emit_to`, so we use the same shape.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct WindowId(String);

impl WindowId {
    pub fn new(raw: impl Into<String>) -> AppResult<Self> {
        let raw = raw.into();
        if raw.is_empty() || raw.len() > 96 {
            return Err(AppError::InvalidDeskId(format!("window id: {raw}")));
        }
        if !raw
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(AppError::InvalidDeskId(format!("window id: {raw}")));
        }
        Ok(Self(raw))
    }

    /// The label assigned to the main window. Stable wire contract —
    /// the JS side references this in its Tauri event filters.
    pub fn main() -> Self {
        Self("main".to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for WindowId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// One persisted window-state row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowPin {
    pub window_id: WindowId,
    pub runner_id: RunnerId,
    pub desk_id: Option<DeskId>,
    /// If set, the window should resume this session on relaunch.
    #[serde(rename = "sessionId", skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

/// On-disk document for window-pin persistence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowPinDoc {
    pub version: u32,
    pub pins: Vec<WindowPin>,
}

impl Default for WindowPinDoc {
    fn default() -> Self {
        Self {
            version: Self::CURRENT_VERSION,
            pins: Vec::new(),
        }
    }
}

impl WindowPinDoc {
    pub const CURRENT_VERSION: u32 = 1;
}

#[async_trait]
pub trait WindowPinStore: Send + Sync + 'static {
    async fn list(&self) -> AppResult<Vec<WindowPin>>;
    async fn upsert(&self, pin: WindowPin) -> AppResult<()>;
    async fn remove(&self, window: &WindowId) -> AppResult<()>;
    async fn clear(&self) -> AppResult<()>;
}

/// File-backed store. Atomic write via temp + rename, mutex around the
/// load/save cycle — same pattern as `JsonDeskStore`.
#[derive(Debug, Clone)]
pub struct JsonWindowPinStore {
    path: PathBuf,
    lock: Arc<TokioMutex<()>>,
}

impl JsonWindowPinStore {
    pub fn at(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            lock: Arc::new(TokioMutex::new(())),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    async fn load(&self) -> AppResult<WindowPinDoc> {
        match fs::read(&self.path).await {
            Ok(bytes) if bytes.is_empty() => Ok(WindowPinDoc::default()),
            Ok(bytes) => {
                let mut doc: WindowPinDoc = serde_json::from_slice(&bytes)?;
                if doc.version > WindowPinDoc::CURRENT_VERSION {
                    tracing::warn!(
                        "window-pins.json is from a newer version ({}); coercing",
                        doc.version
                    );
                }
                doc.version = WindowPinDoc::CURRENT_VERSION;
                Ok(doc)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(WindowPinDoc::default()),
            Err(e) => Err(AppError::Io(e)),
        }
    }

    async fn save(&self, doc: &WindowPinDoc) -> AppResult<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).await?;
        }
        let bytes = serde_json::to_vec_pretty(doc)?;
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, &bytes).await?;
        fs::rename(&tmp, &self.path).await?;
        Ok(())
    }
}

#[async_trait]
impl WindowPinStore for JsonWindowPinStore {
    async fn list(&self) -> AppResult<Vec<WindowPin>> {
        let _g = self.lock.lock().await;
        Ok(self.load().await?.pins)
    }

    async fn upsert(&self, pin: WindowPin) -> AppResult<()> {
        let _g = self.lock.lock().await;
        let mut doc = self.load().await?;
        if let Some(slot) = doc.pins.iter_mut().find(|p| p.window_id == pin.window_id) {
            *slot = pin;
        } else {
            doc.pins.push(pin);
        }
        self.save(&doc).await
    }

    async fn remove(&self, window: &WindowId) -> AppResult<()> {
        let _g = self.lock.lock().await;
        let mut doc = self.load().await?;
        doc.pins.retain(|p| p.window_id != *window);
        self.save(&doc).await
    }

    async fn clear(&self) -> AppResult<()> {
        let _g = self.lock.lock().await;
        self.save(&WindowPinDoc::default()).await
    }
}

/// Options when opening a new session window. Carried through the
/// WindowRegistry into whatever native window-spawning code exists.
#[derive(Debug, Clone)]
pub struct OpenSessionOpts {
    pub desk_id: Option<DeskId>,
    pub resume_session_id: Option<String>,
}

/// What the rest of the app sees about a window. Conscious to NOT carry
/// any Tauri-specific handle so this stays usable in tests + headless
/// runs.
#[derive(Debug, Clone)]
pub struct WindowHandle {
    pub id: WindowId,
    pub focused: bool,
}

/// Abstracts native window operations. The Tauri implementation lives in
/// the app crate (`apps/desktop/src-tauri/src/windows.rs`); tests pair
/// this trait with [`mock::MockWindowRegistry`].
#[async_trait]
pub trait WindowRegistry: Send + Sync + 'static {
    async fn open_session(&self, opts: OpenSessionOpts) -> AppResult<WindowId>;
    async fn open_quick_prompt(&self) -> AppResult<WindowId>;
    async fn close(&self, id: &WindowId) -> AppResult<()>;
    async fn focus(&self, id: &WindowId) -> AppResult<()>;
    fn list(&self) -> Vec<WindowHandle>;
}

pub mod mock {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    #[derive(Default)]
    struct State {
        windows: HashMap<WindowId, WindowHandle>,
        next: AtomicU64,
        last_open_opts: Vec<OpenSessionOpts>,
    }

    /// Drives windows in tests. Records every `open_session` call so
    /// pin-restore logic can assert how many windows it asked for.
    #[derive(Clone, Default)]
    pub struct MockWindowRegistry {
        state: Arc<Mutex<State>>,
    }

    impl MockWindowRegistry {
        pub fn new() -> Self {
            Self::default()
        }

        /// Pre-seed a window with a fixed id (useful for restore tests).
        pub fn seed(&self, id: WindowId) {
            self.state.lock().windows.insert(
                id.clone(),
                WindowHandle { id, focused: false },
            );
        }

        pub fn open_calls(&self) -> Vec<OpenSessionOpts> {
            self.state.lock().last_open_opts.clone()
        }
    }

    #[async_trait]
    impl WindowRegistry for MockWindowRegistry {
        async fn open_session(&self, opts: OpenSessionOpts) -> AppResult<WindowId> {
            let mut state = self.state.lock();
            let n = state.next.fetch_add(1, Ordering::Relaxed);
            let id = WindowId::new(format!("session-{n}"))?;
            state.windows.insert(
                id.clone(),
                WindowHandle {
                    id: id.clone(),
                    focused: true,
                },
            );
            state.last_open_opts.push(opts);
            Ok(id)
        }

        async fn open_quick_prompt(&self) -> AppResult<WindowId> {
            let id = WindowId::new("quick-prompt")?;
            self.state.lock().windows.insert(
                id.clone(),
                WindowHandle {
                    id: id.clone(),
                    focused: true,
                },
            );
            Ok(id)
        }

        async fn close(&self, id: &WindowId) -> AppResult<()> {
            self.state.lock().windows.remove(id);
            Ok(())
        }

        async fn focus(&self, id: &WindowId) -> AppResult<()> {
            let mut state = self.state.lock();
            for (wid, w) in state.windows.iter_mut() {
                w.focused = wid == id;
            }
            Ok(())
        }

        fn list(&self) -> Vec<WindowHandle> {
            self.state.lock().windows.values().cloned().collect()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn pin(window: &str, runner: RunnerId) -> WindowPin {
        WindowPin {
            window_id: WindowId::new(window).unwrap(),
            runner_id: runner,
            desk_id: None,
            session_id: None,
        }
    }

    #[test]
    fn window_id_accepts_url_safe_strings() {
        WindowId::new("main").unwrap();
        WindowId::new("session-abc-123").unwrap();
    }

    #[test]
    fn window_id_rejects_unsafe_strings() {
        for bad in ["", "a b", "a/b", &"a".repeat(200)] {
            assert!(WindowId::new(bad).is_err());
        }
    }

    #[tokio::test]
    async fn pin_store_round_trips_through_disk() {
        let tmp = TempDir::new().unwrap();
        let store = JsonWindowPinStore::at(tmp.path().join("window-pins.json"));
        let runner = RunnerId::new();
        store.upsert(pin("main", runner.clone())).await.unwrap();
        let list = store.list().await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].runner_id, runner);
    }

    #[tokio::test]
    async fn pin_store_updates_existing_window_in_place() {
        let tmp = TempDir::new().unwrap();
        let store = JsonWindowPinStore::at(tmp.path().join("window-pins.json"));
        let r1 = RunnerId::new();
        let r2 = RunnerId::new();
        store.upsert(pin("main", r1)).await.unwrap();
        store.upsert(pin("main", r2.clone())).await.unwrap();
        let list = store.list().await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].runner_id, r2);
    }

    #[tokio::test]
    async fn pin_store_removes_by_window() {
        let tmp = TempDir::new().unwrap();
        let store = JsonWindowPinStore::at(tmp.path().join("window-pins.json"));
        store
            .upsert(pin("main", RunnerId::new()))
            .await
            .unwrap();
        store.remove(&WindowId::new("main").unwrap()).await.unwrap();
        assert!(store.list().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn pin_store_clear_truncates_to_default() {
        let tmp = TempDir::new().unwrap();
        let store = JsonWindowPinStore::at(tmp.path().join("window-pins.json"));
        store.upsert(pin("a", RunnerId::new())).await.unwrap();
        store.upsert(pin("b", RunnerId::new())).await.unwrap();
        store.clear().await.unwrap();
        assert!(store.list().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn pin_store_creates_parent_directory_on_first_save() {
        let tmp = TempDir::new().unwrap();
        let nested = tmp.path().join("nested/deep/window-pins.json");
        let store = JsonWindowPinStore::at(&nested);
        store
            .upsert(pin("main", RunnerId::new()))
            .await
            .unwrap();
        assert!(nested.exists());
    }

    #[tokio::test]
    async fn mock_window_registry_open_and_close() {
        let reg = mock::MockWindowRegistry::new();
        let opts = OpenSessionOpts {
            desk_id: None,
            resume_session_id: None,
        };
        let id = reg.open_session(opts).await.unwrap();
        assert_eq!(reg.list().len(), 1);
        reg.close(&id).await.unwrap();
        assert!(reg.list().is_empty());
    }

    #[tokio::test]
    async fn mock_window_registry_records_open_options() {
        let reg = mock::MockWindowRegistry::new();
        let opts = OpenSessionOpts {
            desk_id: Some(DeskId::new("personal").unwrap()),
            resume_session_id: Some("sess-1".into()),
        };
        reg.open_session(opts).await.unwrap();
        let calls = reg.open_calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].desk_id.as_ref().map(|d| d.as_str()), Some("personal"));
        assert_eq!(calls[0].resume_session_id.as_deref(), Some("sess-1"));
    }

    #[tokio::test]
    async fn mock_window_registry_focus_is_exclusive() {
        let reg = mock::MockWindowRegistry::new();
        let a = reg
            .open_session(OpenSessionOpts {
                desk_id: None,
                resume_session_id: None,
            })
            .await
            .unwrap();
        let b = reg
            .open_session(OpenSessionOpts {
                desk_id: None,
                resume_session_id: None,
            })
            .await
            .unwrap();
        reg.focus(&a).await.unwrap();
        let list = reg.list();
        let focused: Vec<_> = list.iter().filter(|w| w.focused).map(|w| &w.id).collect();
        assert_eq!(focused.len(), 1);
        assert_eq!(focused[0], &a);
        // Re-focus b.
        reg.focus(&b).await.unwrap();
        let focused: Vec<_> = reg
            .list()
            .into_iter()
            .filter(|w| w.focused)
            .map(|w| w.id)
            .collect();
        assert_eq!(focused, vec![b]);
    }
}
