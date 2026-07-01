# Native Client Module: WorkspaceShell

Status: design reference.

This document defines the `WorkspaceShell` product module for the native Fenrir
client.

`WorkspaceShell` owns the visible shell for one workspace window. It coordinates
the workspace sidebar, tab strip, quick switcher invocation, shell chrome, and
the active pane grid host.

Related references:

- `docs/native-terminal-client-decisions.md`
- `docs/native-terminal-client-module-map.md`
- `docs/native-terminal-client-workspace-index-module.md`
- `docs/native-terminal-client-workspace-coordinator-module.md`

## Purpose

`WorkspaceShell` answers: "How is one workspace presented and navigated in a
native window?"

It is not:

- the owner of workspace lifecycle policy
- the terminal renderer
- the tmux runtime client
- the workspace index store
- the local CLI/IPC control surface

It is:

- the visual shell for one workspace
- the owner of sidebar visibility and shell chrome state
- the owner of active tab/pane presentation state
- the host for `PaneGrid`
- the bridge between keybindings and workspace-shell actions

## Responsibility Boundary

`WorkspaceShell` is responsible for:

- presenting one workspace in one native window
- controlling sidebar collapsed/expanded state
- invoking the workspace quick switcher
- presenting in-app tabs that map to tmux windows
- hosting the active `PaneGrid`
- tracking active shell tab and active pane presentation
- routing shell-level commands to downstream actions

`WorkspaceShell` is not responsible for:

- opening, attaching, terminating, or forgetting workspaces
- owning tmux pane layout semantics
- owning terminal byte streams
- storing workspace recents/favorites
- issuing auth sessions

Those responsibilities belong to:

- `WorkspaceCoordinator`
- `WorkspaceIndex`
- `PaneGrid`
- `TerminalViewport`
- `NativeRuntime`
- `AuthSession`

## Public API

### Inbound Actions

The public interface of this module is a set of specific shell use cases.

#### `CreateWorkspaceShell`

- `run(_ input: CreateWorkspaceShellInput) -> Effect<CreateWorkspaceShellResult, WorkspaceShellError>`

#### `CloseWorkspaceShell`

- `run(_ input: CloseWorkspaceShellInput) -> Effect<CloseWorkspaceShellResult, WorkspaceShellError>`

#### `FocusWorkspaceShell`

- `run(_ input: FocusWorkspaceShellInput) -> Effect<FocusWorkspaceShellResult, WorkspaceShellError>`

#### `ToggleWorkspaceSidebar`

- `run(_ input: ToggleWorkspaceSidebarInput) -> Effect<ToggleWorkspaceSidebarResult, WorkspaceShellError>`

#### `ShowWorkspaceSwitcher`

- `run(_ input: ShowWorkspaceSwitcherInput) -> Effect<ShowWorkspaceSwitcherResult, WorkspaceShellError>`

#### `SelectWorkspaceTab`

- `run(_ input: SelectWorkspaceTabInput) -> Effect<SelectWorkspaceTabResult, WorkspaceShellError>`

#### `SelectWorkspacePane`

- `run(_ input: SelectWorkspacePaneInput) -> Effect<SelectWorkspacePaneResult, WorkspaceShellError>`

No generic `HandleWorkspaceShellCommand` action should exist.

### Product Events

The module may emit shell-scoped product events:

- `WorkspaceShellCreated`
- `WorkspaceShellClosed`
- `WorkspaceShellFocused`
- `WorkspaceSidebarVisibilityChanged`
- `WorkspaceSwitcherShown`
- `WorkspaceTabSelected`
- `WorkspacePaneSelected`

These are UI/product events. They are not tmux lifecycle events and not pane
stream events.

## Contracts

### Inputs

Action-specific inputs:

- `CreateWorkspaceShellInput`
- `CloseWorkspaceShellInput`
- `FocusWorkspaceShellInput`
- `ToggleWorkspaceSidebarInput`
- `ShowWorkspaceSwitcherInput`
- `SelectWorkspaceTabInput`
- `SelectWorkspacePaneInput`

Common fields may include:

- `workspaceId`
- `windowId`
- `tabId`
- `paneId`
- `source`

### Outputs

Action-specific outputs:

- `CreateWorkspaceShellResult`
- `CloseWorkspaceShellResult`
- `FocusWorkspaceShellResult`
- `ToggleWorkspaceSidebarResult`
- `ShowWorkspaceSwitcherResult`
- `SelectWorkspaceTabResult`
- `SelectWorkspacePaneResult`

Core DTOs:

- `WorkspaceShellState`
- `WorkspaceShellChromeState`
- `WorkspaceTabPresentation`
- `WorkspacePanePresentation`
- `WorkspaceSidebarState`
- `WorkspaceSwitcherState`

`WorkspaceShellState` may include:

- workspace id
- window id
- sidebar visibility
- active tab id
- active pane id
- tab presentation summaries
- shell chrome state

It must not include:

- terminal bytes
- full pane scrollback
- auth tokens
- raw AppKit objects in public DTOs

### Errors

`WorkspaceShellError`

Base tags:

- `WorkspaceShellCreateFailed`
- `WorkspaceShellCloseFailed`
- `WorkspaceShellFocusFailed`
- `WorkspaceShellNotFound`
- `WorkspaceShellTabNotFound`
- `WorkspaceShellPaneNotFound`
- `WorkspaceShellSwitcherFailed`

Raw AppKit errors should be translated before crossing the module boundary.

## Dependencies

`WorkspaceShell` should depend only on swappable ports with real substitution
value.

Suggested ports:

- `WorkspaceShellStore`
- `WorkspaceWindowCreating`
- `WorkspaceWindowClosing`
- `WorkspaceWindowFocusing`
- `WorkspaceIndexQuerying`
- `WorkspaceTabSelecting`
- `WorkspacePaneSelecting`
- `WorkspaceSwitcherPresenting`
- `WorkspaceShellEventPublishing`

Optional later ports:

- `WorkspaceNotificationSummarizing`
- `WorkspaceSidebarPersistence`

It must not depend directly on:

- local IPC listener state
- raw server RPC/WebSocket clients
- terminal renderer internals
- pane stream buffers
- auth token storage

## Internal Structure

Canonical shape:

```text
WorkspaceShell/
  MODULE.md
  index.swift
  Contracts/
    WorkspaceShellError.swift
    WorkspaceShellState.swift
    WorkspaceShellEvents.swift
    CreateWorkspaceShell.swift
    CloseWorkspaceShell.swift
    FocusWorkspaceShell.swift
    ToggleWorkspaceSidebar.swift
    ShowWorkspaceSwitcher.swift
    SelectWorkspaceTab.swift
    SelectWorkspacePane.swift
  Services/
    WorkspaceShellStore.swift
    WorkspaceWindowCreating.swift
    WorkspaceWindowClosing.swift
    WorkspaceWindowFocusing.swift
    WorkspaceIndexQuerying.swift
    WorkspaceTabSelecting.swift
    WorkspacePaneSelecting.swift
    WorkspaceSwitcherPresenting.swift
    WorkspaceShellEventPublishing.swift
  Actions/
    CreateWorkspaceShell.swift
    CloseWorkspaceShell.swift
    FocusWorkspaceShell.swift
    ToggleWorkspaceSidebar.swift
    ShowWorkspaceSwitcher.swift
    SelectWorkspaceTab.swift
    SelectWorkspacePane.swift
  Models/
    WorkspaceShellModel.swift
    WorkspaceChromeModel.swift
    WorkspaceSidebarModel.swift
    WorkspaceSwitcherModel.swift
  Layers/
    AppKitWorkspaceWindowCreating.swift
    AppKitWorkspaceWindowClosing.swift
    AppKitWorkspaceWindowFocusing.swift
    LiveWorkspaceShellStore.swift
    LiveWorkspaceIndexQuerying.swift
    LiveWorkspaceTabSelecting.swift
    LiveWorkspacePaneSelecting.swift
    LiveWorkspaceSwitcherPresenting.swift
    LiveWorkspaceShellEventPublishing.swift
  Views/
    WorkspaceShellView.swift
    WorkspaceSidebarView.swift
    WorkspaceTabStripView.swift
    WorkspaceSwitcherView.swift
  __tests__/
```

## Action Semantics

### `CreateWorkspaceShell`

Owns this behavior:

- create a native window shell for one workspace
- initialize shell state
- initialize sidebar state
- mount the initial pane-grid host
- publish `WorkspaceShellCreated`

### `CloseWorkspaceShell`

Owns this behavior:

- close the native window shell
- clear local shell state for that window
- must not terminate the workspace session
- publish `WorkspaceShellClosed`

### `FocusWorkspaceShell`

Owns this behavior:

- focus an existing workspace window
- update last-focused shell state if needed
- publish `WorkspaceShellFocused`

### `ToggleWorkspaceSidebar`

Owns this behavior:

- toggle sidebar collapsed/expanded state
- optionally persist sidebar preference later
- publish `WorkspaceSidebarVisibilityChanged`

### `ShowWorkspaceSwitcher`

Owns this behavior:

- query known workspaces through `WorkspaceIndexQuerying`
- present the quick-open style switcher
- return the selected workspace intent or cancellation result
- publish `WorkspaceSwitcherShown`

### `SelectWorkspaceTab`

Owns this behavior:

- select an in-app tab representing a tmux window
- update shell active tab state
- delegate pane-grid refresh through `PaneGrid` ownership, not direct tmux calls
- publish `WorkspaceTabSelected`

### `SelectWorkspacePane`

Owns this behavior:

- select the active pane presentation inside the current shell
- delegate pane focus semantics to `PaneGrid`
- update shell active pane state
- publish `WorkspacePaneSelected`

## UI Rules

- The workspace sidebar is collapsible.
- The quick switcher is required and should behave like a quick-open surface.
- Workspace switching must have keybindings.
- Keybindings should follow tmux-friendly conventions where practical.
- The main pane grid only hosts real tmux panes through `PaneGrid`.
- Native overlays, command palette, settings, and lightweight inspectors may
  exist outside the pane grid.

Workspace metadata shown in sidebar/switcher remains a later decision.

## Traceability

Expected sidebar toggle flow:

```text
keybinding or menu item
-> ToggleWorkspaceSidebar
-> WorkspaceShellStore.update
-> WorkspaceShellEventPublishing.publish
-> WorkspaceShellView updates
```

Expected switcher flow:

```text
keybinding or menu item
-> ShowWorkspaceSwitcher
-> WorkspaceIndexQuerying.listWorkspaces
-> WorkspaceSwitcherPresenting.present
-> selected workspace intent returned
-> WorkspaceCoordinator.OpenWorkspace or FocusWorkspace
```

Expected tab selection flow:

```text
tab click or keybinding
-> SelectWorkspaceTab
-> WorkspaceTabSelecting.select
-> PaneGrid refresh/focus action
-> WorkspaceShellEventPublishing.publish
```

## Testing Strategy

### Unit tests

Must exist for:

- create shell initializes state correctly
- close shell does not terminate workspace
- focus shell updates focus state
- sidebar toggle changes only sidebar state
- switcher queries `WorkspaceIndex`
- switcher cancellation produces no workspace lifecycle action
- tab selection updates active tab state
- pane selection delegates focus to `PaneGrid`
- event emission per action

### Focused integration tests

Should exist for:

- AppKit window creation adapter
- shell store plus shell view model updates
- switcher integrating with workspace index query results
- tab selection integrating with pane-grid host refresh

### E2E expectations

End-to-end coverage should stay small. Paths involving this module:

- open workspace creates a visible workspace shell window
- sidebar can be collapsed and expanded without losing pane focus
- quick switcher can switch to a different workspace
- selecting a tab changes the active tmux window presentation

## Failure Modes

The module should make these easy to isolate:

- window shell creation failed
- shell state missing for window id
- sidebar state write failed
- switcher failed to present
- workspace index query failed during switcher open
- tab id no longer exists after server reconciliation
- pane id no longer exists after tab switch

Each should map to a stable `WorkspaceShellError`.
