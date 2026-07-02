# Diagnostics

Owns native diagnostics and observability policy for the Swift terminal client.
Diagnostics records operational events for server connection, tmux runtime,
workflow, keybinding, terminal viewport, and native shell failures without
capturing terminal text by default.

## Public API

- diagnostic event contracts and support-bundle report DTOs
- redaction policy and safe event projection
- event recording and support bundle actions
- command palette provider for opening the diagnostics overlay

## Dependencies

- `FenrirNativeShared`
- `Settings` for persisted diagnostics policy
- `WorkspaceOverlays` for palette integration only

## Events

Diagnostics consumes metadata-only operational failures and emits safe report
records. Terminal content is marked as terminal content and redacted unless the
settings policy explicitly allows it.

## Testing

Unit tests cover redaction, event categorization, disabled behavior, and palette
surface wiring. Tests must not use real terminal bytes as expected output.
