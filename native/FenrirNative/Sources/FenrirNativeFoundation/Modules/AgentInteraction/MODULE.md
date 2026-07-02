# AgentInteraction

Owns the native agent composer, bounded terminal-context attachments, prompt
dispatch to pane-hosted agent CLIs, and promotion to workflows.

There is no native chat view (D-037): agent CLIs (Claude Code, Codex, Cursor,
OpenCode) run as normal tmux pane processes and own their transcripts,
response rendering, model selection, and approval prompts in their own TUIs.
This module never reproduces those surfaces. Agents do not write directly into
user panes in the base native client; dispatching a user-authored prompt into
an agent-owned pane is user input (amended D-022, D-040).

Agent provisioning (hooks/skills/MCP) and presence ingestion are owned by
`AgentIntegration` (D-038/D-039), not by this module. This module consumes
`AgentIntegration` detection/presence contracts only for dispatch targeting.

Public API:

- terminal-context attachment contracts for selection, viewport, and last-line
  capture
- workspace-targeted composer contracts for draft, submit, and cancel
  lifecycle
- dispatch target contracts: existing agent pane or new agent pane spawned
  with launch input; targets are always explicit, never ambiguous
- dispatch result contracts confirming exactly-once delivery through runtime
  write acknowledgements
- specific actions:
  - `CaptureAgentSelection`
  - `CaptureAgentViewport`
  - `CaptureAgentLastLines`
  - `OpenAgentComposer`
  - `OpenAgentComposerFromContext`
  - `EditAgentPromptDraft`
  - `SubmitAgentPrompt` (dispatches to a pane-hosted agent per D-040)
  - `CancelAgentPrompt`
- service ports for composer storage, terminal context capture, redaction,
  pane dispatch (spawn-with-prompt and bracketed-paste write through runtime
  contracts), clock, and event publishing
- AppKit modal composer view that displays context summaries/provenance only;
  raw terminal context remains in attachments and is not logged or rendered as
  diagnostic text

Dependencies consumed:

- `FenrirNativeShared`
- `WorkspaceOverlays`
- `Notifications`
- `AgentIntegration` detection/presence contracts for dispatch targeting
- `NativeRuntime` public pane spawn/write actions for dispatch delivery

Events emitted:

- agent interaction registration
- terminal context captured
- composer opened/cancelled
- prompt draft edited
- prompt dispatched or dispatch failed

Testing:

- keep unit tests in `__tests__`
- mock dispatch and runtime ports at the action boundary
- cover exactly-once dispatch semantics: reconnect must not double-send, and a
  failed acknowledgement must surface a visible failure
- keep base-client tests guarding against user-pane write-port dependencies
  (dispatch targets agent-owned panes only)
- keep tests guarding that no transcript-store or response-stream port exists
