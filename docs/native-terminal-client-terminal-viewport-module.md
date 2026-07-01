# Native Client Module: TerminalViewport

Status: design reference.

This document defines the `TerminalViewport` product module for the native
Fenrir client.

`TerminalViewport` owns one visible terminal viewport bound to one tmux pane. It
coordinates native terminal renderer lifecycle, input, selection, clipboard,
scroll presentation, local focus, and viewport resize intents.

Related references:

- `docs/native-terminal-client-decisions.md`
- `docs/native-terminal-client-module-map.md`
- `docs/native-terminal-client-pane-grid-module.md`
- `docs/native-terminal-client-runtime-boundary.md`

## Purpose

`TerminalViewport` answers: "How does one tmux pane become an interactive native
terminal view?"

It is not:

- the tmux session kernel
- the pane stream protocol owner
- the workspace lifecycle owner
- the pane grid layout owner
- the server transport owner

It is:

- the native renderer host for one pane
- the translator from native input events to runtime write intents
- the owner of selection, clipboard, scroll presentation, and viewport-local
  focus state
- the bridge between `PaneGrid` presentation and `NativeRuntime` pane sessions

## Responsibility Boundary

`TerminalViewport` is responsible for:

- creating and disposing the native terminal renderer for one pane
- attaching renderer lifecycle to a `NativeRuntime` pane session
- sending input/write intents to `NativeRuntime`
- applying output chunks received from `NativeRuntime` to the renderer
- computing viewport size changes and producing resize intents
- handling selection, copy, paste, mouse input, and bracketed paste behavior
- exposing local viewport presentation state to `PaneGrid`

`TerminalViewport` is not responsible for:

- subscribing to server WebSocket streams directly
- deciding pane stream replay/backfill policy
- deciding workspace open/focus/attach behavior
- representing pane-grid split layout
- storing durable scrollback
- issuing auth sessions

Those responsibilities belong to:

- `NativeRuntime`
- `PaneGrid`
- `WorkspaceCoordinator`
- `ServerConnection`
- `AuthSession`

## Public API

### Inbound Actions

The public interface of this module is a set of specific viewport use cases.

#### `CreateTerminalViewport`

- `run(_ input: CreateTerminalViewportInput) -> Effect<CreateTerminalViewportResult, TerminalViewportError>`

#### `DisposeTerminalViewport`

- `run(_ input: DisposeTerminalViewportInput) -> Effect<DisposeTerminalViewportResult, TerminalViewportError>`

#### `FocusTerminalViewport`

- `run(_ input: FocusTerminalViewportInput) -> Effect<FocusTerminalViewportResult, TerminalViewportError>`

#### `ApplyTerminalOutput`

- `run(_ input: ApplyTerminalOutputInput) -> Effect<ApplyTerminalOutputResult, TerminalViewportError>`

#### `SendTerminalInput`

- `run(_ input: SendTerminalInputInput) -> Effect<SendTerminalInputResult, TerminalViewportError>`

#### `ResizeTerminalViewport`

- `run(_ input: ResizeTerminalViewportInput) -> Effect<ResizeTerminalViewportResult, TerminalViewportError>`

#### `CopyTerminalSelection`

- `run(_ input: CopyTerminalSelectionInput) -> Effect<CopyTerminalSelectionResult, TerminalViewportError>`

#### `PasteIntoTerminal`

- `run(_ input: PasteIntoTerminalInput) -> Effect<PasteIntoTerminalResult, TerminalViewportError>`

#### `ClearTerminalSelection`

- `run(_ input: ClearTerminalSelectionInput) -> Effect<ClearTerminalSelectionResult, TerminalViewportError>`

No generic `HandleTerminalViewportCommand` action should exist.

### Product Events

The module may emit viewport product events:

- `TerminalViewportCreated`
- `TerminalViewportDisposed`
- `TerminalViewportFocused`
- `TerminalOutputApplied`
- `TerminalInputSent`
- `TerminalViewportResized`
- `TerminalSelectionChanged`
- `TerminalSelectionCopied`
- `TerminalPasteRequested`

These are local client events. They are not server pane-stream events and not
tmux kernel lifecycle events.

## Contracts

### Inputs

Action-specific inputs:

- `CreateTerminalViewportInput`
- `DisposeTerminalViewportInput`
- `FocusTerminalViewportInput`
- `ApplyTerminalOutputInput`
- `SendTerminalInputInput`
- `ResizeTerminalViewportInput`
- `CopyTerminalSelectionInput`
- `PasteIntoTerminalInput`
- `ClearTerminalSelectionInput`

Common fields may include:

- `workspaceId`
- `windowId`
- `paneId`
- `viewportId`
- `data`
- `inputMode`
- `size`
- `source`

### Outputs

Action-specific outputs:

- `CreateTerminalViewportResult`
- `DisposeTerminalViewportResult`
- `FocusTerminalViewportResult`
- `ApplyTerminalOutputResult`
- `SendTerminalInputResult`
- `ResizeTerminalViewportResult`
- `CopyTerminalSelectionResult`
- `PasteIntoTerminalResult`
- `ClearTerminalSelectionResult`

Core DTOs:

- `TerminalViewportState`
- `TerminalViewportSize`
- `TerminalViewportFocusState`
- `TerminalSelectionState`
- `TerminalInputIntent`
- `TerminalResizeIntent`
- `TerminalRendererDescriptor`

`TerminalViewportState` may include:

- workspace id
- pane id
- viewport id
- focused state
- renderer status
- local size
- selection state
- local scroll presentation state

It must not include:

- auth tokens
- raw server stream handles
- durable pane replay buffers
- raw `libGhostty` objects in public DTOs
- full terminal scrollback as public state

### Errors

`TerminalViewportError`

Base tags:

- `TerminalViewportCreateFailed`
- `TerminalViewportDisposeFailed`
- `TerminalViewportNotFound`
- `TerminalRendererUnavailable`
- `TerminalOutputApplyFailed`
- `TerminalInputRejected`
- `TerminalResizeFailed`
- `TerminalSelectionUnavailable`
- `TerminalClipboardFailed`
- `TerminalPasteFailed`

Raw renderer, AppKit, clipboard, or runtime errors should be translated before
crossing the module boundary.

## Dependencies

`TerminalViewport` should depend only on swappable ports with real substitution
value.

Suggested ports:

- `TerminalViewportStore`
- `TerminalRendererHosting`
- `TerminalRendererWriting`
- `TerminalRendererSizing`
- `TerminalRendererSelection`
- `TerminalClipboard`
- `TerminalRuntimeWriting`
- `TerminalRuntimeResizing`
- `TerminalViewportEventPublishing`

Optional later ports:

- `TerminalLinkDetecting`
- `TerminalSearchIndexing`
- `TerminalAccessibilityPublishing`

It must not depend directly on:

- raw server RPC/WebSocket clients
- workspace recents/favorites
- local IPC listener state
- auth token storage
- pane-grid split tree internals

## Internal Structure

Canonical shape:

```text
TerminalViewport/
  MODULE.md
  index.swift
  Contracts/
    TerminalViewportError.swift
    TerminalViewportState.swift
    TerminalViewportEvents.swift
    CreateTerminalViewport.swift
    DisposeTerminalViewport.swift
    FocusTerminalViewport.swift
    ApplyTerminalOutput.swift
    SendTerminalInput.swift
    ResizeTerminalViewport.swift
    CopyTerminalSelection.swift
    PasteIntoTerminal.swift
    ClearTerminalSelection.swift
  Services/
    TerminalViewportStore.swift
    TerminalRendererHosting.swift
    TerminalRendererWriting.swift
    TerminalRendererSizing.swift
    TerminalRendererSelection.swift
    TerminalClipboard.swift
    TerminalRuntimeWriting.swift
    TerminalRuntimeResizing.swift
    TerminalViewportEventPublishing.swift
  Actions/
    CreateTerminalViewport.swift
    DisposeTerminalViewport.swift
    FocusTerminalViewport.swift
    ApplyTerminalOutput.swift
    SendTerminalInput.swift
    ResizeTerminalViewport.swift
    CopyTerminalSelection.swift
    PasteIntoTerminal.swift
    ClearTerminalSelection.swift
  Models/
    TerminalViewportModel.swift
    TerminalSelectionModel.swift
    TerminalInputModel.swift
    TerminalResizeModel.swift
  Layers/
    LiveTerminalViewportStore.swift
    GhosttyTerminalRendererHosting.swift
    GhosttyTerminalRendererWriting.swift
    GhosttyTerminalRendererSizing.swift
    GhosttyTerminalRendererSelection.swift
    SystemTerminalClipboard.swift
    LiveTerminalRuntimeWriting.swift
    LiveTerminalRuntimeResizing.swift
    LiveTerminalViewportEventPublishing.swift
  Views/
    TerminalViewportView.swift
  __tests__/
```

## Action Semantics

### `CreateTerminalViewport`

Owns this behavior:

- create renderer host for one pane
- initialize viewport state
- attach renderer state to a runtime pane session descriptor
- publish `TerminalViewportCreated`

### `DisposeTerminalViewport`

Owns this behavior:

- dispose renderer resources
- clear viewport state
- must not close or terminate the tmux pane
- publish `TerminalViewportDisposed`

### `FocusTerminalViewport`

Owns this behavior:

- focus the native renderer view
- update local viewport focus state
- publish `TerminalViewportFocused`

### `ApplyTerminalOutput`

Owns this behavior:

- apply one runtime output chunk to the renderer
- preserve runtime sequencing outside this module
- publish `TerminalOutputApplied`

### `SendTerminalInput`

Owns this behavior:

- convert native input into a terminal input intent
- respect input mode such as bracketed paste where applicable
- call `TerminalRuntimeWriting`
- publish `TerminalInputSent` on accepted write

### `ResizeTerminalViewport`

Owns this behavior:

- calculate renderer columns/rows from native viewport dimensions
- update local viewport size state
- call `TerminalRuntimeResizing`
- publish `TerminalViewportResized`

### `CopyTerminalSelection`

Owns this behavior:

- read selection from renderer
- normalize copied text if needed
- write text to clipboard
- publish `TerminalSelectionCopied`

### `PasteIntoTerminal`

Owns this behavior:

- read paste payload from clipboard or action input
- transform payload according to paste mode
- call `SendTerminalInput`
- publish `TerminalPasteRequested`

### `ClearTerminalSelection`

Owns this behavior:

- clear renderer selection
- update selection state
- publish `TerminalSelectionChanged`

## Renderer Rules

- `libGhostty` integration details must remain behind renderer service ports.
- Public DTOs must not expose raw renderer pointers or implementation objects.
- Renderer-local scrollback is viewport state, not durable replay state.
- Runtime replay/backfill semantics belong to `NativeRuntime`.
- The viewport may cache presentation state, but it must not become the source
  of truth for pane stream sequence numbers.

## Traceability

Expected output flow:

```text
NativeRuntime emits pane output chunk
-> ApplyTerminalOutput
-> TerminalRendererWriting.write
-> TerminalViewportStore.update
-> TerminalViewportEventPublishing.publish
```

Expected input flow:

```text
native key event
-> SendTerminalInput
-> TerminalRuntimeWriting.write
-> runtime write acknowledgement
-> TerminalViewportEventPublishing.publish
```

Expected resize flow:

```text
PaneGrid resize or native view bounds change
-> ResizeTerminalViewport
-> TerminalRendererSizing.measure
-> TerminalRuntimeResizing.resize
-> later kernel snapshot/layout update
```

## Testing Strategy

### Unit tests

Must exist for:

- viewport creation initializes state
- dispose does not close tmux pane
- output applies to renderer
- input intent generation
- input rejection mapping
- resize dimension calculation
- copy selection writes clipboard
- paste transforms payload correctly
- clear selection updates state
- event emission per action

### Focused integration tests

Should exist for:

- renderer host lifecycle through the wrapper port
- runtime writing adapter shape
- runtime resize adapter shape
- clipboard adapter behavior

### E2E expectations

End-to-end coverage should stay small. Paths involving this module:

- terminal output appears in a visible pane
- key input reaches the tmux pane and receives write acknowledgement
- resize changes renderer dimensions and requests kernel resize
- copy/paste works through native clipboard

## Failure Modes

The module should make these easy to isolate:

- renderer host creation failed
- renderer write failed
- viewport disappeared before output arrived
- runtime rejected input
- resize measurement failed
- clipboard read/write failed
- paste payload cannot be transformed safely

Each should map to a stable `TerminalViewportError`.
