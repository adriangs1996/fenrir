# AgentInteraction

Owns native agent composer, bounded terminal-context attachments,
conversation summaries, response streams, and promotion to workflows. Agents do
not write directly into user panes in the base native client.

Public API:

- terminal-context attachment contracts for selection, viewport, and last-line
  capture
- workspace-targeted composer contracts for draft, submit, and cancel
  lifecycle
- server prompt request and accepted-event contracts
- specific actions:
  - `CaptureAgentSelection`
  - `CaptureAgentViewport`
  - `CaptureAgentLastLines`
  - `OpenAgentComposer`
  - `OpenAgentComposerFromContext`
  - `EditAgentPromptDraft`
  - `SubmitAgentPrompt`
  - `CancelAgentPrompt`
- service ports for composer storage, terminal context capture, redaction,
  server prompt submission, clock, and event publishing
- AppKit modal composer view that displays context summaries/provenance only;
  raw terminal context remains in attachments and is not logged or rendered as
  diagnostic text

Dependencies consumed:

- `FenrirNativeShared`
- `WorkspaceOverlays`
- `Notifications`

Events emitted:

- agent interaction registration
- terminal context captured
- composer opened/cancelled
- prompt draft edited
- prompt submitted or submit failed

Testing:

- keep unit tests in `__tests__`
- mock server-backed conversation ports at the action boundary
- keep base-client tests guarding against terminal write-port dependencies
