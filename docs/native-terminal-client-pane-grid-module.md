# Native Client Module: PaneGrid

Status: design reference.

This document defines the `PaneGrid` product module for the native Fenrir
client.

`PaneGrid` owns the visible split layout for the active tmux window inside a
workspace shell. It coordinates pane focus, pane selection, split presentation,
and resize gestures between `WorkspaceShell` and `TerminalViewport`.

Related references:

- `docs/native-terminal-client-decisions.md`
- `docs/native-terminal-client-module-map.md`
- `docs/native-terminal-client-workspace-shell-module.md`

## Purpose

`PaneGrid` answers: "How are tmux panes presented, focused, and resized inside
the active workspace tab?"

It is not:

- the terminal renderer
- the tmux runtime client
- the owner of terminal bytes
- the owner of workspace lifecycle
- the owner of workspace sidebar or quick switcher UI

It is:

- the presentation owner for visible tmux pane splits
- the module that maps kernel pane/window snapshots to a native split tree
- the owner of pane focus presentation
- the owner of pane resize gestures and resize intent creation
- the host/coordinator for `TerminalViewport` instances

## Responsibility Boundary

`PaneGrid` is responsible for:

- rendering the visible split hierarchy for one active tmux window
- creating and disposing terminal viewport hosts for visible panes
- maintaining active pane presentation state
- handling pane focus navigation inside the grid
- translating split resize gestures into pane resize intents
- reflecting tmux layout changes from kernel snapshots

`PaneGrid` is not responsible for:

- subscribing to pane byte streams directly
- writing terminal input bytes
- deciding workspace open/attach/focus policy
- storing workspace recents/favorites
- issuing auth sessions
- parsing tmux control-mode output

Those responsibilities belong to:

- `TerminalViewport`
- `NativeRuntime`
- `WorkspaceCoordinator`
- `WorkspaceIndex`
- `ServerConnection`
- server-side tmux kernel services

## Public API

### Inbound Actions

The public interface of this module is a set of specific pane-grid use cases.

#### `CreatePaneGrid`

- `run(_ input: CreatePaneGridInput) -> Effect<CreatePaneGridResult, PaneGridError>`

#### `DisposePaneGrid`

- `run(_ input: DisposePaneGridInput) -> Effect<DisposePaneGridResult, PaneGridError>`

#### `ApplyPaneLayoutSnapshot`

- `run(_ input: ApplyPaneLayoutSnapshotInput) -> Effect<ApplyPaneLayoutSnapshotResult, PaneGridError>`

#### `FocusPane`

- `run(_ input: FocusPaneInput) -> Effect<FocusPaneResult, PaneGridError>`

#### `MovePaneFocus`

- `run(_ input: MovePaneFocusInput) -> Effect<MovePaneFocusResult, PaneGridError>`

#### `ResizePaneSplit`

- `run(_ input: ResizePaneSplitInput) -> Effect<ResizePaneSplitResult, PaneGridError>`

#### `ZoomPane`

- `run(_ input: ZoomPaneInput) -> Effect<ZoomPaneResult, PaneGridError>`

No generic `HandlePaneGridCommand` action should exist.

### Product Events

The module may emit pane-grid product events:

- `PaneGridCreated`
- `PaneGridDisposed`
- `PaneLayoutApplied`
- `PaneFocused`
- `PaneFocusMoved`
- `PaneResizeRequested`
- `PaneZoomChanged`

These are local product/UI events. They are not pane byte events and not server
kernel lifecycle events.

## Contracts

### Inputs

Action-specific inputs:

- `CreatePaneGridInput`
- `DisposePaneGridInput`
- `ApplyPaneLayoutSnapshotInput`
- `FocusPaneInput`
- `MovePaneFocusInput`
- `ResizePaneSplitInput`
- `ZoomPaneInput`

Common fields may include:

- `workspaceId`
- `windowId`
- `paneId`
- `layoutSnapshot`
- `direction`
- `resizeDelta`
- `source`

### Outputs

Action-specific outputs:

- `CreatePaneGridResult`
- `DisposePaneGridResult`
- `ApplyPaneLayoutSnapshotResult`
- `FocusPaneResult`
- `MovePaneFocusResult`
- `ResizePaneSplitResult`
- `ZoomPaneResult`

Core DTOs:

- `PaneGridState`
- `PaneGridLayout`
- `PaneGridNode`
- `PanePresentation`
- `PaneFocusState`
- `PaneResizeIntent`
- `PaneZoomState`

`PaneGridLayout` may include:

- workspace id
- tmux window id/Fenrir window id
- root split node
- leaf pane presentation nodes
- active pane id
- zoom state

It must not include:

- terminal bytes
- full pane scrollback
- auth tokens
- raw `libGhostty` objects
- raw AppKit objects in public DTOs

### Errors

`PaneGridError`

Base tags:

- `PaneGridCreateFailed`
- `PaneGridDisposeFailed`
- `PaneGridLayoutInvalid`
- `PaneGridPaneNotFound`
- `PaneGridFocusFailed`
- `PaneGridResizeFailed`
- `PaneGridZoomFailed`
- `PaneGridViewportHostFailed`

Raw AppKit, renderer, or runtime errors should be translated before crossing the
module boundary.

## Dependencies

`PaneGrid` should depend only on swappable ports with real substitution value.

Suggested ports:

- `PaneGridStore`
- `PaneLayoutProjecting`
- `PaneViewportHosting`
- `PaneFocusing`
- `PaneResizeRequesting`
- `PaneZoomManaging`
- `PaneGridEventPublishing`

Optional later ports:

- `PaneDragAndDropCoordinating`
- `PaneOverlayPresenting`

It must not depend directly on:

- local IPC listener state
- raw server RPC/WebSocket clients
- pane byte stream buffers
- auth token storage
- workspace recents/favorites

## Internal Structure

Canonical shape:

```text
PaneGrid/
  MODULE.md
  index.swift
  Contracts/
    PaneGridError.swift
    PaneGridState.swift
    PaneGridEvents.swift
    CreatePaneGrid.swift
    DisposePaneGrid.swift
    ApplyPaneLayoutSnapshot.swift
    FocusPane.swift
    MovePaneFocus.swift
    ResizePaneSplit.swift
    ZoomPane.swift
  Services/
    PaneGridStore.swift
    PaneLayoutProjecting.swift
    PaneViewportHosting.swift
    PaneFocusing.swift
    PaneResizeRequesting.swift
    PaneZoomManaging.swift
    PaneGridEventPublishing.swift
  Actions/
    CreatePaneGrid.swift
    DisposePaneGrid.swift
    ApplyPaneLayoutSnapshot.swift
    FocusPane.swift
    MovePaneFocus.swift
    ResizePaneSplit.swift
    ZoomPane.swift
  Models/
    PaneGridModel.swift
    PaneSplitTree.swift
    PaneFocusModel.swift
    PaneResizeModel.swift
  Layers/
    LivePaneGridStore.swift
    TmuxPaneLayoutProjecting.swift
    LivePaneViewportHosting.swift
    LivePaneFocusing.swift
    LivePaneResizeRequesting.swift
    LivePaneZoomManaging.swift
    LivePaneGridEventPublishing.swift
  Views/
    PaneGridView.swift
    PaneSplitView.swift
    PaneLeafView.swift
    PaneDividerView.swift
  __tests__/
```

## Action Semantics

### `CreatePaneGrid`

Owns this behavior:

- initialize grid state for one workspace window and active tmux window
- project the initial layout snapshot into a split tree
- create viewport hosts for visible leaf panes
- publish `PaneGridCreated`

### `DisposePaneGrid`

Owns this behavior:

- dispose viewport hosts
- clear grid state for the active window
- must not close or terminate tmux panes
- publish `PaneGridDisposed`

### `ApplyPaneLayoutSnapshot`

Owns this behavior:

- project a server/kernel layout snapshot into pane-grid presentation state
- create viewport hosts for newly visible panes
- dispose viewport hosts for removed panes
- preserve focus when possible
- publish `PaneLayoutApplied`

### `FocusPane`

Owns this behavior:

- focus one visible pane presentation
- delegate runtime/kernel focus intent through `PaneFocusing`
- update local focus state
- publish `PaneFocused`

### `MovePaneFocus`

Owns this behavior:

- resolve directional focus from the current split tree
- call `FocusPane` semantics for the resolved pane
- publish `PaneFocusMoved`

### `ResizePaneSplit`

Owns this behavior:

- translate divider drag or key resize into a pane resize intent
- update local preview state if applicable
- delegate authoritative resize through `PaneResizeRequesting`
- publish `PaneResizeRequested`

### `ZoomPane`

Owns this behavior:

- toggle zoom presentation for one pane
- keep underlying tmux pane identity intact
- coordinate with `TerminalViewport` so renderer size is recalculated
- publish `PaneZoomChanged`

## Layout Rules

- The visible grid must represent real tmux panes.
- Client-only panels, overlays, command palettes, and inspectors must not appear
  as grid leaves.
- A grid leaf corresponds to exactly one tmux pane.
- Layout projection may normalize server snapshots for native rendering, but it
  must not create a second source of truth.
- The authoritative pane/window topology comes from the server tmux kernel.
- Resize authority is finalized in `D-011`; until then, pane resize actions
  should produce explicit resize intents rather than hide policy in the view.

## Traceability

Expected layout apply flow:

```text
WorkspaceShell receives window snapshot
-> ApplyPaneLayoutSnapshot
-> PaneLayoutProjecting.project
-> PaneViewportHosting.create/dispose
-> PaneGridStore.update
-> PaneGridEventPublishing.publish
-> PaneGridView updates
```

Expected focus flow:

```text
click/keybinding
-> FocusPane
-> PaneFocusing.focus
-> PaneGridStore.update
-> PaneGridEventPublishing.publish(PaneFocused)
-> TerminalViewport focus update
```

Expected resize flow:

```text
divider drag/keybinding
-> ResizePaneSplit
-> PaneResizeRequesting.requestResize
-> server/runtime resize path
-> later kernel snapshot
-> ApplyPaneLayoutSnapshot
```

## Testing Strategy

### Unit tests

Must exist for:

- layout projection from kernel snapshot
- invalid layout rejection
- viewport host creation for new panes
- viewport host disposal for removed panes
- focus pane success
- focus pane missing failure
- directional focus resolution
- resize intent generation
- zoom state transitions
- event emission per action

### Focused integration tests

Should exist for:

- grid store plus layout projection
- viewport hosting lifecycle
- focus action delegating to kernel/runtime focus port
- resize action producing a request and applying the later snapshot

### E2E expectations

End-to-end coverage should stay small. Paths involving this module:

- opening a workspace renders the correct tmux panes
- splitting a pane updates the visible grid after server snapshot
- selecting a pane changes focus without corrupting stream state
- resizing a split updates the renderer size after kernel acknowledgement

## Failure Modes

The module should make these easy to isolate:

- invalid layout snapshot
- pane disappeared before focus
- pane disappeared during resize
- viewport host failed to create
- viewport host failed to dispose
- directional focus has no target
- resize intent rejected by downstream runtime/kernel

Each should map to a stable `PaneGridError`.
