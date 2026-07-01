# Native Client Module: WorkspaceIndex

Status: design reference.

This document defines the `WorkspaceIndex` product module for the native Fenrir
client.

`WorkspaceIndex` owns the local queryable index of workspaces known to the
native client. It feeds sidebar, quick switcher, CLI listing, and workspace
selection surfaces.

Related references:

- `docs/native-terminal-client-decisions.md`
- `docs/native-terminal-client-module-map.md`
- `docs/native-terminal-client-workspace-coordinator-module.md`

## Purpose

`WorkspaceIndex` answers: "Which workspaces does the client know about, and
what lightweight state can product surfaces use to present them?"

It is not:

- the owner of workspace lifecycle policy
- a server workspace provisioning module
- an AppKit window registry
- a terminal pane or tmux stream module

It is:

- the local workspace catalog
- the source for recents/favorites
- the read model for workspace sidebar and quick switcher
- the local summary of which workspaces are open in this client instance

## Responsibility Boundary

`WorkspaceIndex` is responsible for:

- listing known workspaces
- tracking recents and favorites
- recording lightweight local open-state summaries
- resolving sidebar/switcher query models
- merging local persisted knowledge with server-visible workspace summaries

`WorkspaceIndex` is not responsible for:

- deciding whether to open, attach, focus, terminate, or forget a workspace
- creating native windows
- attaching terminal runtime streams
- issuing auth sessions
- storing terminal bytes or pane layouts

Those responsibilities belong to:

- `WorkspaceCoordinator`
- `WorkspaceShell`
- `NativeRuntime`
- `ServerConnection`
- `AuthSession`

## Public API

### Inbound Actions

The public interface of this module is a set of specific query and mutation use
cases.

#### `ListWorkspaces`

- `run(_ input: ListWorkspacesInput) -> Effect<ListWorkspacesResult, WorkspaceIndexError>`

#### `GetWorkspaceSummary`

- `run(_ input: GetWorkspaceSummaryInput) -> Effect<GetWorkspaceSummaryResult, WorkspaceIndexError>`

#### `RecordWorkspaceOpened`

- `run(_ input: RecordWorkspaceOpenedInput) -> Effect<RecordWorkspaceOpenedResult, WorkspaceIndexError>`

#### `RecordWorkspaceClosed`

- `run(_ input: RecordWorkspaceClosedInput) -> Effect<RecordWorkspaceClosedResult, WorkspaceIndexError>`

#### `MarkWorkspaceFavorite`

- `run(_ input: MarkWorkspaceFavoriteInput) -> Effect<MarkWorkspaceFavoriteResult, WorkspaceIndexError>`

#### `UnmarkWorkspaceFavorite`

- `run(_ input: UnmarkWorkspaceFavoriteInput) -> Effect<UnmarkWorkspaceFavoriteResult, WorkspaceIndexError>`

#### `ForgetWorkspace`

- `run(_ input: ForgetWorkspaceInput) -> Effect<ForgetWorkspaceResult, WorkspaceIndexError>`

No generic `HandleWorkspaceIndexCommand` action should exist.

### Product Events

The module may emit lightweight index events:

- `WorkspaceIndexChanged`
- `WorkspaceOpenedRecorded`
- `WorkspaceClosedRecorded`
- `WorkspaceFavoriteChanged`
- `WorkspaceForgotten`

These events are local client product events. They are not tmux lifecycle
events, server workspace events, or pane stream events.

## Contracts

### Inputs

Action-specific inputs:

- `ListWorkspacesInput`
- `GetWorkspaceSummaryInput`
- `RecordWorkspaceOpenedInput`
- `RecordWorkspaceClosedInput`
- `MarkWorkspaceFavoriteInput`
- `UnmarkWorkspaceFavoriteInput`
- `ForgetWorkspaceInput`

Common fields may include:

- `workspaceRef`
- `workspaceId`
- `projectId`
- `canonicalPath`
- `windowId`
- `filter`
- `sort`
- `source`

### Outputs

Action-specific outputs:

- `ListWorkspacesResult`
- `GetWorkspaceSummaryResult`
- `RecordWorkspaceOpenedResult`
- `RecordWorkspaceClosedResult`
- `MarkWorkspaceFavoriteResult`
- `UnmarkWorkspaceFavoriteResult`
- `ForgetWorkspaceResult`

Core DTOs:

- `WorkspaceSummary`
- `WorkspaceOpenState`
- `WorkspaceFavoriteState`
- `WorkspaceRecentState`
- `WorkspaceIndexSnapshot`

`WorkspaceSummary` should remain lightweight. It may include:

- workspace id
- display name
- project id
- canonical path
- server id or profile id
- local open state
- favorite flag
- last opened timestamp
- last focused timestamp
- coarse status

It must not include:

- terminal bytes
- full pane history
- full tmux layout internals
- auth tokens

### Errors

`WorkspaceIndexError`

Base tags:

- `WorkspaceIndexReadFailed`
- `WorkspaceIndexWriteFailed`
- `WorkspaceIndexDecodeFailed`
- `WorkspaceIndexWorkspaceNotFound`
- `WorkspaceIndexServerUnavailable`
- `WorkspaceIndexPermissionDenied`

Raw storage, server, or decoding errors should be translated before crossing the
module boundary.

## Dependencies

`WorkspaceIndex` should depend only on swappable ports with real substitution
value.

Suggested ports:

- `WorkspaceIndexStore`
- `WorkspaceServerListing`
- `WorkspaceClock`
- `WorkspaceEventPublishing`

Optional later ports:

- `WorkspaceRepositoryIdentityReading`
- `WorkspaceNotificationSummaryReading`

It must not depend directly on:

- AppKit windows or `NSViewController`
- local IPC listener state
- terminal renderer state
- pane stream buffers
- raw HTTP/WebSocket clients
- secure credential storage

## Internal Structure

Canonical shape:

```text
WorkspaceIndex/
  MODULE.md
  index.swift
  Contracts/
    WorkspaceIndexError.swift
    WorkspaceSummary.swift
    WorkspaceIndexSnapshot.swift
    ListWorkspaces.swift
    GetWorkspaceSummary.swift
    RecordWorkspaceOpened.swift
    RecordWorkspaceClosed.swift
    MarkWorkspaceFavorite.swift
    UnmarkWorkspaceFavorite.swift
    ForgetWorkspace.swift
    WorkspaceIndexEvents.swift
  Services/
    WorkspaceIndexStore.swift
    WorkspaceServerListing.swift
    WorkspaceClock.swift
    WorkspaceEventPublishing.swift
  Actions/
    ListWorkspaces.swift
    GetWorkspaceSummary.swift
    RecordWorkspaceOpened.swift
    RecordWorkspaceClosed.swift
    MarkWorkspaceFavorite.swift
    UnmarkWorkspaceFavorite.swift
    ForgetWorkspace.swift
  Models/
    PersistedWorkspaceIndex.swift
    WorkspaceIndexMergePlan.swift
    WorkspaceIndexSortKey.swift
  Layers/
    FileWorkspaceIndexStore.swift
    LiveWorkspaceServerListing.swift
    SystemWorkspaceClock.swift
    LiveWorkspaceEventPublishing.swift
  __tests__/
```

## Action Semantics

### `ListWorkspaces`

Owns this behavior:

- read local index
- optionally fetch server-visible workspace summaries
- merge local and server summaries
- apply filter and sort
- return lightweight list for sidebar, switcher, or CLI

### `GetWorkspaceSummary`

Owns this behavior:

- resolve one workspace from local index and optional server summary
- return a lightweight summary
- fail with `WorkspaceIndexWorkspaceNotFound` if unresolved

### `RecordWorkspaceOpened`

Owns this behavior:

- upsert local workspace summary
- mark workspace as open in this client instance
- update last opened and focused timestamps
- publish `WorkspaceOpenedRecorded`

### `RecordWorkspaceClosed`

Owns this behavior:

- update local open state for the workspace/window
- keep recent/favorite state intact
- publish `WorkspaceClosedRecorded`

### `MarkWorkspaceFavorite`

Owns this behavior:

- mark the workspace as favorite
- persist the local index update
- publish `WorkspaceFavoriteChanged`

### `UnmarkWorkspaceFavorite`

Owns this behavior:

- remove favorite state
- preserve recent/open state
- publish `WorkspaceFavoriteChanged`

### `ForgetWorkspace`

Owns this behavior:

- remove local recent/favorite entry
- remove local open-state summary if no longer valid
- must not terminate tmux or server workspace state
- publish `WorkspaceForgotten`

## Merge Rules

`WorkspaceIndex` merges two kinds of knowledge:

- local knowledge:
  - recents
  - favorites
  - aliases
  - local open windows
  - last focused/opened timestamps
- server knowledge:
  - workspaces visible to the authenticated session
  - server-backed status summaries
  - project identity

Rules:

- local favorites should survive temporary server unavailability
- local recents should survive until explicitly forgotten
- server-visible workspaces should appear even if not in local recents
- open-state is local to this client instance, not global multiuser truth
- server state must not overwrite local alias/favorite without explicit action

## Traceability

Expected `ListWorkspaces` flow:

```text
ListWorkspaces
-> WorkspaceIndexStore.read
-> WorkspaceServerListing.listVisibleWorkspaces
-> build merge plan
-> apply filter/sort
-> return ListWorkspacesResult
```

Expected `RecordWorkspaceOpened` flow:

```text
WorkspaceCoordinator.OpenWorkspace
-> WorkspaceIndex.RecordWorkspaceOpened
-> WorkspaceIndexStore.write
-> WorkspaceEventPublishing.publish(WorkspaceOpenedRecorded)
```

## Testing Strategy

### Unit tests

Must exist for:

- local-only list
- server-only list
- merged local/server list
- favorite survives server outage
- recent survives server outage
- server-visible workspace appears without local recent state
- open-state is local and does not imply server session ownership
- forget never terminates workspace
- event emission per mutation action

### Focused integration tests

Should exist for:

- file-backed store read/write compatibility
- server listing adapter shape
- sidebar/switcher list query using merged data

### E2E expectations

End-to-end coverage should stay small. Paths involving this module:

- sidebar shows known workspaces after opening one
- quick switcher lists recent/favorite/server-visible workspaces
- `fenrir list workspaces` returns the same high-level summaries as the app

## Failure Modes

The module should make these easy to isolate:

- local index file cannot be read
- local index cannot be decoded
- local index cannot be written
- server listing fails but local index is available
- workspace cannot be resolved by ref
- forget requested for an unknown workspace
- server-visible workspace conflicts with local alias

Each should map to a stable `WorkspaceIndexError`.
