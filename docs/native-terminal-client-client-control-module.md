# Native Client Module: ClientControl

Status: design reference.

This document defines the `ClientControl` product module for the native Fenrir
client. It should act as the template for how the other native-client modules
are specified: narrow purpose, explicit contracts, atomic actions, hidden
implementation details, and testable seams.

Related references:

- `docs/native-terminal-client-decisions.md`
- `docs/native-terminal-client-module-map.md`

## Purpose

`ClientControl` owns the product use cases triggered by local client-control
commands such as `open`, `attach`, `focus`, `list`, and `terminate`.

The local IPC listener itself belongs to the outer application shell
(`NativeHost`). `ClientControl` starts after that boundary has already decoded a
request into a typed product command.

It is not:

- a server RPC transport module
- a terminal byte transport
- a workspace business-logic module
- an AppKit window manager

It is:

- the product command boundary for local client-control intents
- the module that owns the concrete product actions `OpenWorkspace`,
  `AttachWorkspace`, `FocusWorkspace`, `ListWorkspaces`, and
  `TerminateWorkspace`

## Responsibility Boundary

`ClientControl` is responsible for:

- validating typed local product commands
- returning typed success or failure results

`ClientControl` is not responsible for:

- binding or serving a local socket/IPC listener
- deciding workspace lifecycle policy
- deciding tmux pane behavior
- talking directly to tmux
- storing auth credentials
- rendering UI

Those responsibilities belong to other modules, mainly:

- `WorkspaceCoordinator`
- `WorkspaceIndex`
- `AuthSession`
- `NativeHost` application shell

## Public API

### Commands

These are the public product-control commands accepted by the module:

- `OpenWorkspace`
- `AttachWorkspace`
- `FocusWorkspace`
- `ListWorkspaces`
- `TerminateWorkspace`

Optional later commands:

- `ForgetWorkspace`
- `RevealWorkspace`
- `NewWindow`
- `ActivateLastWorkspace`

### Inbound Actions

The caller-facing public interface of this module should be its specific use
cases.

#### `OpenWorkspace`

- `run(_ input: OpenWorkspaceInput) -> Effect<OpenWorkspaceResult, ClientControlError>`

#### `AttachWorkspace`

- `run(_ input: AttachWorkspaceInput) -> Effect<AttachWorkspaceResult, ClientControlError>`

#### `FocusWorkspace`

- `run(_ input: FocusWorkspaceInput) -> Effect<FocusWorkspaceResult, ClientControlError>`

#### `ListWorkspaces`

- `run(_ input: ListWorkspacesInput) -> Effect<ListWorkspacesResult, ClientControlError>`

#### `TerminateWorkspace`

- `run(_ input: TerminateWorkspaceInput) -> Effect<TerminateWorkspaceResult, ClientControlError>`

`NativeHost` should decode IPC payloads and dispatch directly to one of these
actions. There should not be a single catch-all action that redispatches the
whole module.

### Services

The module may expose dependency-inversion ports only where there is real
substitution value. These are not the default caller-facing API.

Examples:

- `WorkspaceOpening`
- `WorkspaceAttaching`
- `WorkspaceFocusing`
- `WorkspaceListing`
- `WorkspaceTerminating`

## Contracts

### Inputs

Action-specific inputs:

- `OpenWorkspaceInput`
- `AttachWorkspaceInput`
- `FocusWorkspaceInput`
- `ListWorkspacesInput`
- `TerminateWorkspaceInput`

`workspaceRef` should be a durable product reference, not an internal tmux id.
It may resolve from:

- workspace id
- project id
- canonical project path
- named workspace alias

### Outputs

Action-specific outputs:

- `OpenWorkspaceResult`
- `AttachWorkspaceResult`
- `FocusWorkspaceResult`
- `ListWorkspacesResult`
- `TerminateWorkspaceResult`

Every result should include:

- `requestId`
- `resultKind`
- `timestamp`

Action-specific payloads may include:

- `workspaceId`
- `windowId`
- `didLaunchClient`
- `didCreateWindow`
- `didFocusExistingWindow`
- `workspaceStateSummary`

### Errors

`ClientControlError`

Base tags:

- `ClientControlUnavailable`
- `ClientControlDecodeError`
- `ClientControlPermissionError`
- `ClientControlWorkspaceNotFound`
- `ClientControlWorkspaceNotOpen`
- `ClientControlConfirmationRequired`

Errors should stay product-level. Raw IPC or AppKit errors must be translated
by the application shell before crossing into the module boundary.

## Dependencies

`ClientControl` may depend on these public module contracts:

- `WorkspaceCoordinator`
- `WorkspaceIndex`

Optional:

- `Notifications`, only if we later want user-visible local command feedback

It must not depend directly on:

- local IPC socket/server lifecycle
- `NativeRuntime`
- `ServerConnection`
- `TerminalViewport`
- `PaneGrid`
- AppKit window classes

Those belong behind `WorkspaceCoordinator` or the application shell.

## Internal Structure

Canonical shape:

```text
ClientControl/
  MODULE.md
  index.swift
  Contracts/
    ClientControlError.swift
    OpenWorkspace.swift
    AttachWorkspace.swift
    FocusWorkspace.swift
    ListWorkspaces.swift
    TerminateWorkspace.swift
  Services/
    WorkspaceOpening.swift
    WorkspaceAttaching.swift
    WorkspaceFocusing.swift
    WorkspaceListing.swift
    WorkspaceTerminating.swift
  Actions/
    OpenWorkspace.swift
    AttachWorkspace.swift
    FocusWorkspace.swift
    ListWorkspaces.swift
    TerminateWorkspace.swift
  Models/
    ClientControlResolution.swift
  Layers/
    LiveWorkspaceOpening.swift
    LiveWorkspaceAttaching.swift
    LiveWorkspaceFocusing.swift
    LiveWorkspaceListing.swift
    LiveWorkspaceTerminating.swift
  __tests__/
```

## Atomic Actions

Each action should do one thing only.

Recommended first actions:

- `OpenWorkspace`
  - execute one `open` command against downstream product services
- `AttachWorkspace`
  - execute one `attach` command against downstream product services
- `FocusWorkspace`
  - execute one `focus` command against downstream product services
- `ListWorkspaces`
  - execute one `list` query against the workspace index
- `TerminateWorkspace`
  - execute one `terminate` command against workspace coordination

Avoid composite “god actions” such as:

- `HandleAllClientControl`
- `HandleClientControlCommand`
- `RouteClientControlCommand`
- `OpenOrAttachOrFocusWorkspace`

Those should be decomposed into specific product actions.

## Action Semantics

Action ownership should be explicit:

- `OpenWorkspace` -> `WorkspaceCoordinator.openWorkspace`
- `AttachWorkspace` -> `WorkspaceCoordinator.attachWorkspace`
- `FocusWorkspace` -> `WorkspaceCoordinator.focusWorkspace`
- `TerminateWorkspace` -> `WorkspaceCoordinator.terminateWorkspace`
- `ListWorkspaces` -> `WorkspaceIndex.listKnownWorkspaces`

This is important:

- `NativeHost` chooses the action from the decoded IPC request
- `ClientControl` defines the actions
- `WorkspaceCoordinator` decides product behavior
- `WorkspaceIndex` provides index/query behavior

`ClientControl` should not duplicate workspace policy logic.

## Delivery Boundary

The IPC delivery adapter belongs to `NativeHost`, not to this module.

That outer layer is responsible for:

- binding the local endpoint
- reading raw request payloads
- decoding them into the correct action input
- calling the corresponding action
- encoding the typed result back to the caller
- translating delivery/transport failures into product-level errors where
  appropriate

Recommended transport for that outer shell:

- local Unix domain socket

Requirements for the outer delivery adapter:

- single-instance friendly
- local-machine only
- small structured messages only
- no terminal byte traffic
- bounded request/response lifecycle

Recommended delivery envelope shape:

- request:
  - `requestId`
  - `command`
  - `payload`
- response:
  - `requestId`
  - `ok`
  - `result` or `error`

JSON is good enough for the first version. Do not introduce a binary protocol
unless the local control surface proves to be a bottleneck.

## Traceability

Every product-control flow should be easy to follow.

Example:

```text
fenrir open <workspace>
-> NativeHost IPC listener receives request
-> request decoded to OpenWorkspaceInput
-> OpenWorkspace
-> WorkspaceCoordinator.openWorkspace
-> response returned to CLI
```

No AppKit-specific logic or tmux-specific logic should be needed to understand
that flow from inside `ClientControl`.

## Testing Strategy

### Unit tests

Must exist for:

- each action in isolation
- response shaping
- product-level error mapping

### Focused integration tests

Should exist for:

- action integration with `WorkspaceCoordinator`
- action integration with `WorkspaceIndex`
- confirmation-required behavior for destructive commands

### E2E expectations

Handled elsewhere, but the main end-to-end path involving this module is:

- `fenrir open <workspace>` launches or reaches the native client and opens the
  correct workspace

## Failure Modes

The module should make these easy to identify:

- no running client instance
- stale or invalid local endpoint
- malformed command payload
- command routed to a workspace that does not exist
- `focus` requested for a workspace not currently open locally
- `terminate` requested without required confirmation

Every one of these should map to a stable product-level error, not an opaque
implementation exception.
