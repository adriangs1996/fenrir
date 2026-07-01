# Native Client Module: WorkspaceCoordinator

Status: design reference.

This document defines the `WorkspaceCoordinator` product module for the native
Fenrir client.

`WorkspaceCoordinator` owns workspace-level product behavior. It is where the
client decides what it means to open, attach, focus, terminate, or forget a
workspace.

Related references:

- `docs/native-terminal-client-decisions.md`
- `docs/native-terminal-client-module-map.md`
- `docs/native-terminal-client-client-control-module.md`

## Purpose

`WorkspaceCoordinator` is the product module that translates workspace intents
into coordinated effects across:

- workspace index state
- native windows and shell instances
- Fenrir server connection
- native runtime attach/reconnect behavior

It is not:

- a transport module
- a terminal viewport module
- an AppKit window-controller implementation
- a local IPC module

It is:

- the owner of workspace lifecycle product behavior
- the place where workspace policy is decided
- the module that coordinates multiple downstream modules to satisfy a single
  workspace intent

## Responsibility Boundary

`WorkspaceCoordinator` is responsible for:

- deciding whether a workspace should be opened, focused, attached in a new
  window, terminated, or forgotten
- resolving a workspace reference into a durable workspace identity
- coordinating the correct downstream actions in the correct order
- producing typed results and product-level errors
- emitting workspace lifecycle product events

`WorkspaceCoordinator` is not responsible for:

- listening for IPC requests
- rendering windows or panes directly
- terminal input/output byte handling
- low-level server RPC transport
- secure credential storage

## Public API

### Inbound Actions

The public interface of this module is a set of specific use cases.

#### `OpenWorkspace`

- `run(_ input: OpenWorkspaceInput) -> Effect<OpenWorkspaceResult, WorkspaceCoordinatorError>`

#### `AttachWorkspace`

- `run(_ input: AttachWorkspaceInput) -> Effect<AttachWorkspaceResult, WorkspaceCoordinatorError>`

#### `FocusWorkspace`

- `run(_ input: FocusWorkspaceInput) -> Effect<FocusWorkspaceResult, WorkspaceCoordinatorError>`

#### `TerminateWorkspace`

- `run(_ input: TerminateWorkspaceInput) -> Effect<TerminateWorkspaceResult, WorkspaceCoordinatorError>`

#### `ForgetWorkspace`

- `run(_ input: ForgetWorkspaceInput) -> Effect<ForgetWorkspaceResult, WorkspaceCoordinatorError>`

No `HandleWorkspaceCommand` action should exist. The caller must choose the
specific action.

### Product Events

Each action may emit explicit product events.

First events to define:

- `WorkspaceOpened`
- `WorkspaceAttached`
- `WorkspaceFocused`
- `WorkspaceTerminationRequested`
- `WorkspaceTerminated`
- `WorkspaceForgotten`

These are product events, not pane stream events and not raw server events.

## Contracts

### Inputs

Action-specific inputs:

- `OpenWorkspaceInput`
- `AttachWorkspaceInput`
- `FocusWorkspaceInput`
- `TerminateWorkspaceInput`
- `ForgetWorkspaceInput`

Common fields may include:

- `workspaceRef`
- `openMode`
- `createIfMissing`
- `newWindow`
- `confirmationToken`
- `source`

`workspaceRef` is a durable product reference and may resolve from:

- workspace id
- project id
- canonical project path
- user alias

### Outputs

Action-specific outputs:

- `OpenWorkspaceResult`
- `AttachWorkspaceResult`
- `FocusWorkspaceResult`
- `TerminateWorkspaceResult`
- `ForgetWorkspaceResult`

Common payload fields may include:

- `workspaceId`
- `windowId`
- `didCreateWorkspace`
- `didCreateWindow`
- `didFocusExistingWindow`
- `workspaceStateSummary`

### Errors

`WorkspaceCoordinatorError`

Base tags:

- `WorkspaceResolutionFailed`
- `WorkspaceAlreadyOpen`
- `WorkspaceNotOpen`
- `WorkspaceNotFound`
- `WorkspaceCreationFailed`
- `WorkspaceAttachFailed`
- `WorkspaceFocusFailed`
- `WorkspaceTerminationFailed`
- `WorkspaceForgetFailed`
- `WorkspaceConfirmationRequired`
- `WorkspacePermissionDenied`
- `WorkspaceServerUnavailable`

Errors must stay product-level. Raw AppKit, IPC, RPC, or tmux errors should be
translated before crossing the boundary.

## Dependencies

`WorkspaceCoordinator` should depend only on swappable service ports with real
substitution value.

Suggested ports:

- `WorkspaceIndexReader`
- `WorkspaceIndexWriter`
- `WorkspaceWindowRegistry`
- `WorkspaceWindowOpening`
- `WorkspaceWindowFocusing`
- `WorkspaceWindowClosing`
- `WorkspaceResolving`
- `WorkspaceProvisioning`
- `WorkspaceRuntimeAttaching`
- `WorkspaceRuntimeReconnecting`
- `WorkspaceTerminating`
- `WorkspaceEventPublishing`

It must not depend directly on:

- AppKit window/controller types
- raw WebSocket or HTTP clients
- `libGhostty` views
- pane-grid view types
- terminal byte stream adapters

## Internal Structure

Canonical shape:

```text
WorkspaceCoordinator/
  MODULE.md
  index.swift
  Contracts/
    WorkspaceCoordinatorError.swift
    OpenWorkspace.swift
    AttachWorkspace.swift
    FocusWorkspace.swift
    TerminateWorkspace.swift
    ForgetWorkspace.swift
    WorkspaceEvents.swift
  Services/
    WorkspaceIndexReader.swift
    WorkspaceIndexWriter.swift
    WorkspaceWindowRegistry.swift
    WorkspaceWindowOpening.swift
    WorkspaceWindowFocusing.swift
    WorkspaceWindowClosing.swift
    WorkspaceResolving.swift
    WorkspaceProvisioning.swift
    WorkspaceRuntimeAttaching.swift
    WorkspaceRuntimeReconnecting.swift
    WorkspaceTerminating.swift
    WorkspaceEventPublishing.swift
  Actions/
    OpenWorkspace.swift
    AttachWorkspace.swift
    FocusWorkspace.swift
    TerminateWorkspace.swift
    ForgetWorkspace.swift
  Models/
    WorkspaceResolution.swift
    WorkspaceOpenState.swift
    WorkspaceActionPlan.swift
  Layers/
    LiveWorkspaceIndexReader.swift
    LiveWorkspaceIndexWriter.swift
    LiveWorkspaceWindowRegistry.swift
    LiveWorkspaceWindowOpening.swift
    LiveWorkspaceWindowFocusing.swift
    LiveWorkspaceWindowClosing.swift
    LiveWorkspaceResolving.swift
    LiveWorkspaceProvisioning.swift
    LiveWorkspaceRuntimeAttaching.swift
    LiveWorkspaceRuntimeReconnecting.swift
    LiveWorkspaceTerminating.swift
    LiveWorkspaceEventPublishing.swift
  __tests__/
```

## Action Semantics

### `OpenWorkspace`

Owns this behavior:

- resolve the target workspace
- if already open locally:
  - focus existing window unless `newWindow` or attach-like behavior is required
- if not open locally:
  - provision or recover workspace if needed
  - open a new native window
  - attach the runtime to the workspace
- publish `WorkspaceOpened`

### `AttachWorkspace`

Owns this behavior:

- resolve the target workspace
- ensure it exists or can be recovered
- always create a new window for it
- attach runtime in that window
- publish `WorkspaceAttached`

### `FocusWorkspace`

Owns this behavior:

- resolve the target workspace
- require that it is already open locally
- focus its existing window
- publish `WorkspaceFocused`

### `TerminateWorkspace`

Owns this behavior:

- require explicit confirmation when policy demands it
- route destructive termination through the server-backed session kernel path
- update local window/index state accordingly
- publish `WorkspaceTerminationRequested`
- publish `WorkspaceTerminated` on success

### `ForgetWorkspace`

Owns this behavior:

- remove the workspace from local recents/favorites/index surfaces
- must not terminate the tmux session
- publish `WorkspaceForgotten`

## Coordination Rules

The module should coordinate by building an action plan internally, not by
embedding unrelated imperative code inside the outer shell.

Typical `OpenWorkspace` flow:

```text
OpenWorkspace
-> resolve workspace ref
-> inspect local open state
-> inspect server-known workspace state if needed
-> decide plan
-> execute plan:
   - focus existing window
   - or open window
   - or provision workspace
   - or attach runtime
-> publish product event
-> return typed result
```

This keeps decision logic traceable and unit-testable.

## Traceability

Expected flow:

```text
NativeHost or ClientControl
-> OpenWorkspace
-> WorkspaceResolving
-> WorkspaceWindowRegistry / WorkspaceProvisioning / WorkspaceRuntimeAttaching
-> WorkspaceEventPublishing
-> typed result
```

The action should make it obvious where a failure happened:

- resolution
- open-state lookup
- window creation
- server provisioning
- runtime attach

## Testing Strategy

### Unit tests

Must exist for:

- open policy when workspace is already open
- open policy when workspace exists but is not open
- attach policy always creating a new window
- focus policy failing when workspace is not open
- terminate policy requiring confirmation
- forget policy never killing the workspace
- event emission per action

### Focused integration tests

Should exist for:

- coordination between workspace index and window registry
- coordination between server provisioning and runtime attach
- termination updating both local and server-backed state

### E2E expectations

The minimal end-to-end paths involving this module are:

- `fenrir open <workspace>` opens or focuses correctly
- `fenrir attach <workspace>` opens a new window on an existing workspace
- `fenrir focus <workspace>` fails cleanly when the workspace is not open
- `fenrir terminate <workspace>` is explicit and destructive only when
  confirmed

## Failure Modes

The module should make these easy to isolate:

- workspace ref cannot be resolved
- workspace is already open but caller required a new window
- workspace is not open and focus was requested
- server provisioning failed
- runtime attach failed after window creation
- termination failed remotely after local confirmation
- forget attempted on unknown workspace

Each one should map to a stable product-level error and be traceable to one
step in the action plan.
