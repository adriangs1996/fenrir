# Native Client Module: NativeRuntime

Status: design reference.

This document defines the `NativeRuntime` product module for the native Fenrir
client.

`NativeRuntime` owns the native client runtime protocol for attaching to
tmux-backed workspaces and panes through the Fenrir server. It manages pane
session state, stream reconnect state, replay/backfill handling, write
acknowledgements, and resize requests.

Related references:

- `docs/native-terminal-client-decisions.md`
- `docs/native-terminal-client-module-map.md`
- `docs/native-terminal-client-runtime-boundary.md`
- `docs/tmux-session-kernel-architecture.md`

## Purpose

`NativeRuntime` answers: "How does the native client talk to the Fenrir server
and tmux kernel as a durable terminal runtime?"

It is not:

- an AppKit module
- a terminal renderer
- a pane grid layout module
- a workspace sidebar or switcher module
- an auth credential store

It is:

- the native Swift implementation of the client runtime boundary
- the owner of workspace/pane attach, detach, and reconnect state
- the owner of pane stream cursor, replay, gap, overflow, and slow-client state
- the owner of write acknowledgement and runtime-level resize requests

## Responsibility Boundary

`NativeRuntime` is responsible for:

- discovering server/kernel capabilities
- attaching and detaching workspaces
- attaching and reconnecting panes
- subscribing to pane streams through explicit data-plane APIs
- tracking pane stream cursors and reconnect inputs
- translating stream events into runtime-level output/gap/overflow events
- sending pane input and returning write acknowledgement results
- sending pane resize requests

`NativeRuntime` is not responsible for:

- rendering terminal bytes
- computing pane-grid layout
- opening or focusing native windows
- storing workspace recents/favorites
- issuing or persisting auth credentials
- implementing server transport sockets directly

Those responsibilities belong to:

- `TerminalViewport`
- `PaneGrid`
- `WorkspaceCoordinator`
- `WorkspaceIndex`
- `AuthSession`
- `ServerConnection`

## Public API

### Inbound Actions

The public interface of this module is a set of specific runtime use cases.

#### `DiscoverRuntimeCapabilities`

- `run(_ input: DiscoverRuntimeCapabilitiesInput) -> Effect<DiscoverRuntimeCapabilitiesResult, NativeRuntimeError>`

#### `AttachWorkspaceRuntime`

- `run(_ input: AttachWorkspaceRuntimeInput) -> Effect<AttachWorkspaceRuntimeResult, NativeRuntimeError>`

#### `DetachWorkspaceRuntime`

- `run(_ input: DetachWorkspaceRuntimeInput) -> Effect<DetachWorkspaceRuntimeResult, NativeRuntimeError>`

#### `ReconnectWorkspaceRuntime`

- `run(_ input: ReconnectWorkspaceRuntimeInput) -> Effect<ReconnectWorkspaceRuntimeResult, NativeRuntimeError>`

#### `AttachPaneRuntime`

- `run(_ input: AttachPaneRuntimeInput) -> Effect<AttachPaneRuntimeResult, NativeRuntimeError>`

#### `ReconnectPaneStream`

- `run(_ input: ReconnectPaneStreamInput) -> Effect<ReconnectPaneStreamResult, NativeRuntimeError>`

#### `SendPaneInput`

- `run(_ input: SendPaneInputInput) -> Effect<SendPaneInputResult, NativeRuntimeError>`

#### `ResizePaneRuntime`

- `run(_ input: ResizePaneRuntimeInput) -> Effect<ResizePaneRuntimeResult, NativeRuntimeError>`

#### `ClosePaneRuntime`

- `run(_ input: ClosePaneRuntimeInput) -> Effect<ClosePaneRuntimeResult, NativeRuntimeError>`

No generic `HandleNativeRuntimeCommand` action should exist.

### Runtime Events

The module may emit runtime-level events:

- `RuntimeCapabilitiesDiscovered`
- `WorkspaceRuntimeAttached`
- `WorkspaceRuntimeDetached`
- `WorkspaceRuntimeReconnected`
- `PaneRuntimeAttached`
- `PaneOutputReceived`
- `PaneStreamGapDetected`
- `PaneStreamOverflowDetected`
- `PaneStreamClosed`
- `PaneInputAccepted`
- `PaneInputRejected`
- `PaneResizeRequested`

These events are runtime events. They are not AppKit events and not renderer
events.

## Contracts

### Inputs

Action-specific inputs:

- `DiscoverRuntimeCapabilitiesInput`
- `AttachWorkspaceRuntimeInput`
- `DetachWorkspaceRuntimeInput`
- `ReconnectWorkspaceRuntimeInput`
- `AttachPaneRuntimeInput`
- `ReconnectPaneStreamInput`
- `SendPaneInputInput`
- `ResizePaneRuntimeInput`
- `ClosePaneRuntimeInput`

Common fields may include:

- `workspaceId`
- `windowId`
- `paneId`
- `actor`
- `capabilitySet`
- `streamState`
- `afterSeq`
- `backfill`
- `inputBytes`
- `size`
- `source`

### Outputs

Action-specific outputs:

- `DiscoverRuntimeCapabilitiesResult`
- `AttachWorkspaceRuntimeResult`
- `DetachWorkspaceRuntimeResult`
- `ReconnectWorkspaceRuntimeResult`
- `AttachPaneRuntimeResult`
- `ReconnectPaneStreamResult`
- `SendPaneInputResult`
- `ResizePaneRuntimeResult`
- `ClosePaneRuntimeResult`

Core DTOs:

- `NativeRuntimeState`
- `NativeWorkspaceRuntimeState`
- `NativePaneRuntimeState`
- `NativePaneStreamState`
- `NativePaneWriteAck`
- `NativePaneResizeRequest`
- `NativeRuntimeCapabilities`

`NativePaneStreamState` may include:

- pane id
- last observed sequence
- low/high replay bounds
- gap state
- overflow counters
- slow-client state
- connection status

It must not include:

- raw WebSocket objects
- auth secrets
- renderer objects
- AppKit view state
- full terminal scrollback as public durable state

### Errors

`NativeRuntimeError`

Base tags:

- `NativeRuntimeCapabilitiesUnavailable`
- `NativeRuntimeWorkspaceAttachFailed`
- `NativeRuntimeWorkspaceDetachFailed`
- `NativeRuntimeWorkspaceReconnectFailed`
- `NativeRuntimePaneAttachFailed`
- `NativeRuntimePaneStreamFailed`
- `NativeRuntimePaneStreamGap`
- `NativeRuntimePaneStreamOverflow`
- `NativeRuntimePaneWriteRejected`
- `NativeRuntimePaneResizeRejected`
- `NativeRuntimePaneClosed`
- `NativeRuntimeServerUnavailable`
- `NativeRuntimePermissionDenied`

Raw server transport and websocket errors should be translated before crossing
this module boundary.

## Dependencies

`NativeRuntime` should depend only on swappable ports with real substitution
value.

Suggested ports:

- `RuntimeCapabilityQuerying`
- `WorkspaceRuntimeAttaching`
- `WorkspaceRuntimeDetaching`
- `WorkspaceRuntimeReconnecting`
- `PaneRuntimeAttaching`
- `PaneStreamSubscribing`
- `PaneInputWriting`
- `PaneRuntimeResizing`
- `PaneRuntimeClosing`
- `NativeRuntimeStore`
- `NativeRuntimeEventPublishing`

These ports are expected to be implemented mostly by `ServerConnection` backed
adapters.

It must not depend directly on:

- AppKit windows or views
- `libGhostty` renderer objects
- local IPC listener state
- workspace sidebar/switcher state
- secure credential storage internals

## Internal Structure

Canonical shape:

```text
NativeRuntime/
  MODULE.md
  index.swift
  Contracts/
    NativeRuntimeError.swift
    NativeRuntimeState.swift
    NativeRuntimeEvents.swift
    DiscoverRuntimeCapabilities.swift
    AttachWorkspaceRuntime.swift
    DetachWorkspaceRuntime.swift
    ReconnectWorkspaceRuntime.swift
    AttachPaneRuntime.swift
    ReconnectPaneStream.swift
    SendPaneInput.swift
    ResizePaneRuntime.swift
    ClosePaneRuntime.swift
  Services/
    RuntimeCapabilityQuerying.swift
    WorkspaceRuntimeAttaching.swift
    WorkspaceRuntimeDetaching.swift
    WorkspaceRuntimeReconnecting.swift
    PaneRuntimeAttaching.swift
    PaneStreamSubscribing.swift
    PaneInputWriting.swift
    PaneRuntimeResizing.swift
    PaneRuntimeClosing.swift
    NativeRuntimeStore.swift
    NativeRuntimeEventPublishing.swift
  Actions/
    DiscoverRuntimeCapabilities.swift
    AttachWorkspaceRuntime.swift
    DetachWorkspaceRuntime.swift
    ReconnectWorkspaceRuntime.swift
    AttachPaneRuntime.swift
    ReconnectPaneStream.swift
    SendPaneInput.swift
    ResizePaneRuntime.swift
    ClosePaneRuntime.swift
  Models/
    NativeRuntimeModel.swift
    NativePaneStreamModel.swift
    NativePaneWriteModel.swift
    NativeReconnectModel.swift
  Layers/
    LiveRuntimeCapabilityQuerying.swift
    LiveWorkspaceRuntimeAttaching.swift
    LiveWorkspaceRuntimeDetaching.swift
    LiveWorkspaceRuntimeReconnecting.swift
    LivePaneRuntimeAttaching.swift
    LivePaneStreamSubscribing.swift
    LivePaneInputWriting.swift
    LivePaneRuntimeResizing.swift
    LivePaneRuntimeClosing.swift
    LiveNativeRuntimeStore.swift
    LiveNativeRuntimeEventPublishing.swift
  __tests__/
```

## Action Semantics

### `DiscoverRuntimeCapabilities`

Owns this behavior:

- query server/kernel capability surface
- validate required tmux-kernel APIs are present
- persist capability state
- publish `RuntimeCapabilitiesDiscovered`

### `AttachWorkspaceRuntime`

Owns this behavior:

- attach a native client runtime to a workspace
- initialize workspace runtime state
- capture actor/session identity used for runtime calls
- publish `WorkspaceRuntimeAttached`

### `DetachWorkspaceRuntime`

Owns this behavior:

- detach this native client viewport/runtime association
- preserve server workspace state
- clear local runtime state for the detached viewport
- publish `WorkspaceRuntimeDetached`

### `ReconnectWorkspaceRuntime`

Owns this behavior:

- reconnect server workspace runtime/control state
- refresh workspace snapshot
- rebuild pane runtime state as needed
- publish `WorkspaceRuntimeReconnected`

### `AttachPaneRuntime`

Owns this behavior:

- attach a runtime session to one tmux pane
- initialize stream state
- choose initial backfill semantics:
  - `latest` when no cursor exists
  - `from-seq` when a known cursor exists
- publish `PaneRuntimeAttached`

### `ReconnectPaneStream`

Owns this behavior:

- build reconnect input from existing stream state
- request replay/backfill from the server pane data plane
- emit output, gap, overflow, and closed events as runtime events
- update stream state after each event

### `SendPaneInput`

Owns this behavior:

- send bounded input bytes to the pane data plane
- return accepted/rejected acknowledgement
- publish `PaneInputAccepted` or `PaneInputRejected`

### `ResizePaneRuntime`

Owns this behavior:

- send pane resize request to the kernel
- return accepted/rejected result
- publish `PaneResizeRequested`

### `ClosePaneRuntime`

Owns this behavior:

- request pane close through the server/kernel
- clear local runtime state for the pane
- publish `PaneStreamClosed` or equivalent close state

## Runtime Rules

- Terminal bytes must stay on explicit pane stream APIs.
- Generic workspace/control events must not carry terminal bytes.
- Stream cursors are runtime state, not renderer state.
- Renderer-local scrollback must not become durable replay truth.
- No-cursor attach uses `backfill: latest`.
- Cursor-backed reconnect uses `backfill: from-seq`.
- Gaps and overflow are explicit states, not hidden log messages.
- Write acknowledgements are required for pane input.
- Auth actor/session identity must be explicit and transport-independent.

## Traceability

Expected pane attach flow:

```text
TerminalViewport.CreateTerminalViewport
-> AttachPaneRuntime
-> PaneRuntimeAttaching.attach
-> NativeRuntimeStore.update
-> NativeRuntimeEventPublishing.publish(PaneRuntimeAttached)
```

Expected output flow:

```text
PaneStreamSubscribing emits event
-> ReconnectPaneStream or AttachPaneRuntime stream loop
-> NativeRuntimeStore.update stream cursor
-> NativeRuntimeEventPublishing.publish(PaneOutputReceived)
-> TerminalViewport.ApplyTerminalOutput
```

Expected input flow:

```text
TerminalViewport.SendTerminalInput
-> SendPaneInput
-> PaneInputWriting.write
-> NativeRuntimeEventPublishing.publish(PaneInputAccepted/Rejected)
```

## Testing Strategy

### Unit tests

Must exist for:

- capability validation
- workspace attach state
- workspace detach preserving server state
- workspace reconnect rebuilding pane state
- pane attach no-cursor uses `latest`
- pane reconnect with cursor uses `from-seq`
- stream gap transitions
- stream overflow transitions
- write accepted acknowledgement
- write rejected acknowledgement
- resize accepted/rejected mapping
- event emission per action

### Focused integration tests

Should exist for:

- server-backed capability query adapter
- pane stream subscription adapter
- write acknowledgement adapter
- reconnect after server session refresh

### E2E expectations

End-to-end coverage should stay small. Paths involving this module:

- workspace attach opens runtime state and renders pane output
- pane stream reconnect resumes after client restart
- input writes receive acknowledgement
- slow-client overflow is visible as runtime state
- resize requests are reflected after kernel snapshot

## Failure Modes

The module should make these easy to isolate:

- server does not expose required runtime capability
- workspace attach rejected by permission
- pane stream starts after retained replay window
- pane stream overflows
- pane stream closes while viewport is visible
- input write rejected
- resize rejected
- actor/session mismatch
- server unavailable during reconnect

Each should map to a stable `NativeRuntimeError`.
