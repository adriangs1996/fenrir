# AgentIntegration

AgentIntegration owns external agent CLI integration for Fenrir Native:
detection, integration status, hook/skill/MCP provisioning contracts, and
metadata-only presence ingestion from TerminalViewport-forwarded reserved OSC
signals.

## Public API

- Agent descriptors for Claude Code, Codex, Cursor, OpenCode, custom, and
  future adapters.
- Integration status/version/result contracts.
- AgentIntegration panel state and view command contracts for refresh, repair,
  and remove UI intents.
- Managed config ownership marker/version contracts.
- Hook/skill/MCP provisioning requests and results.
- Presence signal, payload, provenance, state, record, and event contracts.
- Atomic actions for detect, status, install, update, remove, MCP provision,
  presence ingest, and presence list.

## Boundaries

Presence is advisory UI metadata. It never authorizes actions and this module
does not define any pane-write port. TerminalViewport strips and forwards the
reserved OSC signal; AgentIntegration parses and validates the forwarded
payload.

Live agent configuration edits are available only through explicit provisioning ports. The managed provisioner writes Fenrir-owned hook/skill blocks and MCP JSON entries with backups, conflict detection, and idempotent updates. It never defines or uses a pane-write port.

Live layers:

- `PathAgentIntegrationDetector` detects supported agent CLIs on PATH without mutating user config.
- `ManagedAgentIntegrationProvisioner` implements the legacy Fenrir-owned text-block install/update/remove and JSON MCP provisioning behind file-store ports.
- `ProviderAgentInstallTargetResolver` maps Claude Code, Codex, Cursor, and OpenCode to their provider-real config surfaces without allowing generic text-block writes into structured provider files.
- `ProviderStructuredAgentIntegrationProvisioner` implements provider-real hook, skill, plugin, JSON MCP, and TOML MCP writes for Claude Code, Codex, Cursor, and OpenCode with ownership markers, idempotency, backups, clean removal, and conflict refusal.
- NativeHost exposes explicit agent-integration status, repair, and remove operations through the diagnostics product command. The `fenrir agent-integration status|repair|remove` CLI routes call those operations over the local native control socket.
- `LocalAgentIntegrationConfigFileStore` performs atomic local writes and backup creation; tests use `InMemoryAgentIntegrationConfigFileStore`.
