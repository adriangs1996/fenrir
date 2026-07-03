# WorkflowControl

Owns native visualization and control for server-backed Fenrir workflows. The
server executes workflows; this module only presents state, navigation, and
control actions.

Workflow execution is never performed by the native client. All run lifecycle
changes, timeline events, retries, cancellation, pausing, and state mutations
come from authenticated Fenrir server contracts. The native module renders
server-owned snapshots, replays server timeline events after reconnect, and
invokes specific typed control actions through service ports.

Public API:

- workflow control contracts and typed action DTOs
- `ListWorkflowRuns`
- `ObserveWorkflowRunTimeline`
- `ObserveWorkflowEventStream`
- `PauseWorkflowRun`
- `StopWorkflowRun`
- `RerunWorkflowRun`
- `ProjectWorkflowRunState`
- workflow service ports for server-backed adapters

Dependencies consumed:

- `FenrirNativeShared`
- `WorkspaceOverlays`
- `Notifications`
- `NativeRuntime` only through public focus/open linked-pane contracts

Events emitted:

- workflow control registration and future workflow attention events

Testing:

- keep unit tests in `__tests__`
- mock workflow service ports and linked-surface focus ports
- cover status projection, stable timeline ordering, reconnect replay cursors,
  and server command failures

Live workflow events are consumed through `WorkflowEventStreaming` and normalized as typed `WorkflowEventStreamItem` values. Current server capabilities intentionally disable native pause controls until the server exposes a pause RPC.
