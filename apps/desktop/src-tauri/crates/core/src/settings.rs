//! Provider configuration read/written to `~/.moxxy/config.yaml`.
//!
//! The moxxy CLI is authoritative for the schema; the desktop surfaces
//! a small subset (the provider block) so the user can paste an API key
//! during onboarding without learning YAML. For richer plugin / skill
//! configuration the user opens the file in their editor.
//!
//! We avoid pulling in a full YAML library here — the file we touch
//! is small enough (≤200 lines in practice) that a one-line `providers`
//! block append, plus a regex-based key replace, is enough for v1.
//! When a deeper edit is wanted, the user gets a clear "open in editor"
//! affordance instead.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// A provider entry as the desktop settings panel sees it. The CLI
/// expects richer config (model lists, auth methods, etc.) but for
/// onboarding we surface just the basics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderConfig {
    /// Provider name as the CLI knows it: `anthropic`, `openai`,
    /// `openai-codex`, etc.
    pub name: String,
    /// Whether `<NAME>_API_KEY` (or the equivalent vault entry) is
    /// configured in the moxxy config. We never load the actual secret
    /// into the desktop — see [`set_api_key`] for the write path.
    pub configured: bool,
}

/// Three providers known at the moment. The CLI plugin registry
/// determines the real list at runtime; this is the curated subset
/// the onboarding wizard surfaces.
pub fn known_providers() -> Vec<&'static str> {
    vec!["anthropic", "openai", "openai-codex"]
}

/// Inspect `~/.moxxy/config.yaml` for which providers already have a
/// `${vault:…}` reference set. We do a textual scan — cheap, robust
/// against the file being hand-edited, and good enough for the
/// onboarding signal.
pub async fn read_provider_status(path: &Path) -> Vec<ProviderConfig> {
    let body = tokio::fs::read_to_string(path).await.unwrap_or_default();
    known_providers()
        .into_iter()
        .map(|name| {
            let vault_ref = format!("${{vault:{}}}", vault_key_for(name));
            ProviderConfig {
                name: name.to_string(),
                // A provider is "configured" when its `<NAME>_API_KEY`
                // vault reference appears anywhere in the file. Simpler
                // and more accurate than YAML-aware scanning.
                configured: body.contains(&vault_ref),
            }
        })
        .collect()
}

/// Write an API key into the user's moxxy vault. The desktop never
/// stores the secret — we hand it off via the CLI vault command run
/// as a child process, so the key path matches whatever the runner
/// itself will read.
pub fn vault_key_for(provider: &str) -> String {
    format!("{}_API_KEY", provider.to_uppercase().replace('-', "_"))
}

/// Build the `vault set <KEY>` invocation for `provider`. Returns
/// `(program, args)`; the caller spawns it and pipes the secret via
/// stdin. Used by the Tauri command layer.
pub fn vault_set_command(cli_entry: &Path, provider: &str) -> (PathBuf, Vec<String>) {
    let key = vault_key_for(provider);
    (
        PathBuf::from("node"),
        vec![
            cli_entry.to_string_lossy().into_owned(),
            "vault".into(),
            "set".into(),
            key,
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn vault_key_uppercases_and_normalises() {
        assert_eq!(vault_key_for("anthropic"), "ANTHROPIC_API_KEY");
        assert_eq!(vault_key_for("openai-codex"), "OPENAI_CODEX_API_KEY");
    }

    #[tokio::test]
    async fn read_provider_status_finds_configured_entries() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("config.yaml");
        let body = r"
providers:
  anthropic:
    apiKey: ${vault:ANTHROPIC_API_KEY}
  openai:
    apiKey: ${vault:OPENAI_API_KEY}
";
        tokio::fs::write(&path, body).await.unwrap();
        let status = read_provider_status(&path).await;
        let anthropic = status.iter().find(|p| p.name == "anthropic").unwrap();
        let openai = status.iter().find(|p| p.name == "openai").unwrap();
        let codex = status.iter().find(|p| p.name == "openai-codex").unwrap();
        assert!(anthropic.configured);
        assert!(openai.configured);
        assert!(!codex.configured);
    }

    #[tokio::test]
    async fn read_provider_status_handles_missing_file() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("nope.yaml");
        let status = read_provider_status(&path).await;
        assert_eq!(status.len(), 3);
        for s in status {
            assert!(!s.configured);
        }
    }

    #[test]
    fn vault_set_command_uses_node_with_cli_entry() {
        let (program, args) = vault_set_command(Path::new("/x/bin.js"), "anthropic");
        assert_eq!(program.to_string_lossy(), "node");
        assert_eq!(args[0], "/x/bin.js");
        assert_eq!(args[1], "vault");
        assert_eq!(args[2], "set");
        assert_eq!(args[3], "ANTHROPIC_API_KEY");
    }
}
