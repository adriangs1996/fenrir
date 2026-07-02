# AgentIntegration

AgentIntegration owns external agent CLI integration for Fenrir Native:
detection, integration status, hook/skill/MCP provisioning contracts, and
metadata-only presence ingestion from TerminalViewport-forwarded reserved OSC
signals.

## Public API

- Agent descriptors for Claude Code, Codex, Cursor, OpenCode, custom, and
  future adapters.
- Integration status/version/result contracts.
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

Live destructive edits to real agent config directories are out of scope for
this foundation slice. Live adapters must sit behind the installer and MCP
provisioner ports.
