# Native Client Module: ServerConnection

Status: design reference.

This document defines the `ServerConnection` product module for the native
Fenrir client.

`ServerConnection` owns authenticated communication with a Fenrir server. It
selects the target endpoint, establishes and maintains the authenticated
connection, exposes typed request and stream ports, tracks connection health,
and translates low-level transport failures into stable client errors.

Related references:

- `docs/native-terminal-client-decisions.md`
- `docs/native-terminal-client-module-map.md`
- `docs/native-terminal-client-runtime-boundary.md`
- `docs/tmux-session-kernel-architecture.md`

## Purpose

`ServerConnection` answers: "How does the native client reach a Fenrir server
reliably, locally or remotely, without leaking transport details into product
modules?"

It is not:

- a tmux runtime state machine
- a terminal byte renderer
- a native window or CLI controller
- an auth credential store
- a local server process supervisor

It is:

- the owner of server endpoint resolution
- the owner of authenticated transport session lifecycle
- the owner of connection health, heartbeat, reconnect, and request timeout
  semantics
- the owner of typed request/response and stream adapters used by other modules
- the transport boundary for control-plane calls and data-plane stream handles

## Responsibility Boundary

`ServerConnection` is responsible for:

- resolving a target Fenrir server endpoint from launch intent, settings, or
  workspace profile
- obtaining an explicit authenticated session from `AuthSession`
- opening and closing authenticated server sessions
- negotiating server capabilities and protocol versions
- maintaining heartbeat freshness and connection status
- reconnecting the underlying server session when recoverable failures occur
- resubscribing durable streams when the transport reconnects
- exposing typed request ports for server control-plane methods
- exposing typed stream ports for data-plane subscriptions
- translating transport, timeout, protocol, and auth failures into stable
  `ServerConnectionError` values

`ServerConnection` is not responsible for:

- launching or supervising the local Fenrir server process
- deciding workspace product behavior
- tracking pane stream cursors or replay state
- rendering terminal output
- owning credential persistence
- owning local client-control IPC

Those responsibilities belong to:

- `NativeHost` or a future application-shell server supervisor
- `WorkspaceCoordinator`
- `NativeRuntime`
- `TerminalViewport`
- `AuthSession`
- `ClientControl`

## Public API

### Inbound Actions

The public interface of this module is a set of specific connection use cases.

#### `ResolveServerEndpoint`

- `run(_ input: ResolveServerEndpointInput) -> Effect<ResolveServerEndpointResult, ServerConnectionError>`

Resolves the endpoint that should be used for a client session. Inputs may come
from a launch intent, workspace metadata, settings profile, or explicit remote
target.

#### `OpenServerSession`

- `run(_ input: OpenServerSessionInput) -> Effect<OpenServerSessionResult, ServerConnectionError>`

Creates an authenticated session to the selected server endpoint. This action
does not create native windows and does not attach workspaces.

#### `CloseServerSession`

- `run(_ input: CloseServerSessionInput) -> Effect<CloseServerSessionResult, ServerConnectionError>`

Closes the active transport session and all streams owned by that session.

#### `RefreshServerSession`

- `run(_ input: RefreshServerSessionInput) -> Effect<RefreshServerSessionResult, ServerConnectionError>`

Refreshes auth material and reopens the transport session without changing the
logical target endpoint.

#### `ReconnectServerSession`

- `run(_ input: ReconnectServerSessionInput) -> Effect<ReconnectServerSessionResult, ServerConnectionError>`

Replaces the underlying transport session after a recoverable disconnect. This
is transport-level reconnect. Workspace and pane semantic reconnect remain in
`NativeRuntime`.

#### `QueryServerCapabilities`

- `run(_ input: QueryServerCapabilitiesInput) -> Effect<QueryServerCapabilitiesResult, ServerConnectionError>`

Queries server capabilities and validates protocol compatibility for the native
terminal client.

#### `SendServerRequest`

- `run(_ input: SendServerRequestInput) -> Effect<SendServerRequestResult, ServerConnectionError>`

Executes one typed request/response call against the authenticated server.
Callers should normally use narrower ports instead of calling this action
directly.

#### `OpenServerStream`

- `run(_ input: OpenServerStreamInput) -> Effect<OpenServerStreamResult, ServerConnectionError>`

Opens one typed server stream and returns a stream handle. Stream payload
semantics remain owned by the consuming module.

#### `CloseServerStream`

- `run(_ input: CloseServerStreamInput) -> Effect<CloseServerStreamResult, ServerConnectionError>`

Closes one active stream handle without closing the whole server session.

#### `GetServerConnectionHealth`

- `run(_ input: GetServerConnectionHealthInput) -> Effect<GetServerConnectionHealthResult, ServerConnectionError>`

Returns current connection status, heartbeat freshness, reconnect attempt state,
and active request/stream counts.

No generic `HandleServerConnectionCommand` action should exist.

### Connection Events

The module may emit connection-level events:

- `ServerEndpointResolved`
- `ServerSessionOpening`
- `ServerSessionOpened`
- `ServerSessionClosed`
- `ServerSessionRefreshStarted`
- `ServerSessionRefreshed`
- `ServerSessionReconnectStarted`
- `ServerSessionReconnected`
- `ServerSessionReconnectFailed`
- `ServerHeartbeatFresh`
- `ServerHeartbeatStale`
- `ServerCapabilitiesNegotiated`
- `ServerRequestStarted`
- `ServerRequestCompleted`
- `ServerRequestFailed`
- `ServerStreamOpened`
- `ServerStreamResubscribed`
- `ServerStreamClosed`
- `ServerTransportBackpressureDetected`

These events are connection events. They are not tmux runtime events and not UI
notification events.

## Contracts

### Inputs

Action-specific inputs:

- `ResolveServerEndpointInput`
- `OpenServerSessionInput`
- `CloseServerSessionInput`
- `RefreshServerSessionInput`
- `ReconnectServerSessionInput`
- `QueryServerCapabilitiesInput`
- `SendServerRequestInput`
- `OpenServerStreamInput`
- `CloseServerStreamInput`
- `GetServerConnectionHealthInput`

Common fields may include:

- `launchIntent`
- `workspaceId`
- `workspacePath`
- `profileId`
- `endpoint`
- `authSession`
- `actor`
- `requestId`
- `streamId`
- `method`
- `payload`
- `timeout`
- `reconnectPolicy`
- `clientName`
- `protocolVersion`

### Outputs

Action-specific outputs:

- `ResolveServerEndpointResult`
- `OpenServerSessionResult`
- `CloseServerSessionResult`
- `RefreshServerSessionResult`
- `ReconnectServerSessionResult`
- `QueryServerCapabilitiesResult`
- `SendServerRequestResult`
- `OpenServerStreamResult`
- `CloseServerStreamResult`
- `GetServerConnectionHealthResult`

Core DTOs:

- `ServerEndpoint`
- `ServerEndpointProfile`
- `ServerSession`
- `ServerSessionId`
- `ServerProtocolVersion`
- `ServerCapabilities`
- `ServerConnectionState`
- `ServerConnectionHealth`
- `ServerRequestEnvelope`
- `ServerResponseEnvelope`
- `ServerStreamHandle`
- `ServerStreamState`
- `ServerReconnectPolicy`
- `ServerTransportStats`

`ServerEndpoint` may include:

- endpoint kind: `local`, `remote`, or `profile`
- websocket URL or Unix-domain-socket descriptor
- server base URL for HTTP bootstrap if needed
- display name
- trust policy
- expected server identity

It must not include:

- bearer token material
- keychain references
- native window references
- raw socket objects
- pane stream replay cursors

`ServerSession` may include:

- session id
- endpoint
- actor identity
- auth session id
- negotiated capabilities
- connection status
- heartbeat timestamps
- reconnect generation

It must not include:

- credential secrets
- AppKit objects
- tmux pane state
- terminal scrollback

### Errors

`ServerConnectionError`

Base tags:

- `ServerEndpointUnavailable`
- `ServerEndpointUnsupported`
- `ServerBootstrapRequired`
- `ServerAuthUnavailable`
- `ServerAuthRejected`
- `ServerSessionOpenFailed`
- `ServerSessionClosed`
- `ServerSessionRefreshFailed`
- `ServerSessionReconnectFailed`
- `ServerCapabilityMismatch`
- `ServerProtocolMismatch`
- `ServerRequestTimedOut`
- `ServerRequestRejected`
- `ServerStreamOpenFailed`
- `ServerStreamDisconnected`
- `ServerStreamResubscribeFailed`
- `ServerTransportBackpressure`
- `ServerTransportUnavailable`
- `ServerTransportDisposed`

Raw socket, HTTP, TLS, RPC, and serialization failures should be translated
before crossing this module boundary.

## Dependencies

`ServerConnection` should depend only on swappable ports with real substitution
value.

Suggested ports:

- `ServerEndpointResolving`
- `ServerAuthSessionProviding`
- `ServerTransportOpening`
- `ServerRequestSending`
- `ServerStreamOpening`
- `ServerHeartbeatMonitoring`
- `ServerCapabilityQuerying`
- `ServerConnectionStore`
- `ServerConnectionEventPublishing`
- `ServerConnectionClock`

Expected implementations:

- `ServerAuthSessionProviding` is backed by `AuthSession`.
- `ServerEndpointResolving` is backed by `Settings`, launch intent, and
  workspace profile lookup.
- `ServerTransportOpening`, `ServerRequestSending`, and `ServerStreamOpening`
  are backed by the concrete Swift transport adapter.
- Local server process supervision is provided by the application shell before
  `OpenServerSession` is called, or by an explicit external port that returns a
  reachable endpoint. `ServerConnection` must not directly spawn or kill server
  processes.

It must not depend directly on:

- AppKit windows or views
- `libGhostty` renderer objects
- tmux pane layout state
- local client-control IPC listener state
- keychain implementation details
- concrete process supervisor internals

## Internal Structure

The intended Swift module shape is:

```text
ServerConnection/
  MODULE.md
  index.swift
  Contracts/
    ServerEndpoint.swift
    ServerEndpointProfile.swift
    ServerSession.swift
    ServerSessionId.swift
    ServerCapabilities.swift
    ServerConnectionState.swift
    ServerConnectionHealth.swift
    ServerConnectionEvents.swift
    ServerConnectionError.swift
    ServerRequestEnvelope.swift
    ServerResponseEnvelope.swift
    ServerStreamHandle.swift
    ServerStreamState.swift
    ServerReconnectPolicy.swift
    ServerTransportStats.swift
  Services/
    ServerEndpointResolving.swift
    ServerAuthSessionProviding.swift
    ServerTransportOpening.swift
    ServerRequestSending.swift
    ServerStreamOpening.swift
    ServerHeartbeatMonitoring.swift
    ServerCapabilityQuerying.swift
    ServerConnectionStore.swift
    ServerConnectionEventPublishing.swift
    ServerConnectionClock.swift
  Actions/
    ResolveServerEndpoint.swift
    OpenServerSession.swift
    CloseServerSession.swift
    RefreshServerSession.swift
    ReconnectServerSession.swift
    QueryServerCapabilities.swift
    SendServerRequest.swift
    OpenServerStream.swift
    CloseServerStream.swift
    GetServerConnectionHealth.swift
  Models/
    ServerConnectionModel.swift
    ServerEndpointResolutionModel.swift
    ServerSessionModel.swift
    ServerReconnectModel.swift
    ServerStreamRegistry.swift
    ServerRequestRegistry.swift
  Layers/
    LiveServerEndpointResolving.swift
    LiveServerAuthSessionProviding.swift
    LiveServerTransportOpening.swift
    LiveServerRequestSending.swift
    LiveServerStreamOpening.swift
    LiveServerHeartbeatMonitoring.swift
    LiveServerCapabilityQuerying.swift
    LiveServerConnectionStore.swift
    LiveServerConnectionEventPublishing.swift
    SystemServerConnectionClock.swift
  __tests__/
```

## Runtime Rules

### Endpoint Resolution

- Endpoint selection must be explicit and reproducible.
- Launch intent has priority over workspace profile.
- Workspace profile has priority over default settings.
- Default settings may point to a local or remote server.
- If a local endpoint is selected but no server is reachable,
  `ResolveServerEndpoint` or `OpenServerSession` returns
  `ServerBootstrapRequired` unless the application shell already ensured the
  server exists.

### Authentication

- The actor is never inferred from transport type.
- Bearer session identity and actor session identity must match server-side
  authorization rules.
- `ServerConnection` can request current auth material from `AuthSession`, but
  it must not persist or refresh secrets itself.
- Refreshing a server session may request new auth material, reopen transport,
  and emit a new connection generation.

### Control Plane And Data Plane

- Control-plane requests are typed request/response calls.
- Data-plane streams are typed stream handles with explicit lifecycle.
- High-volume pane bytes must not be routed through generic client-control
  actions.
- `ServerConnection` may resubscribe streams after transport reconnect, but the
  consuming module owns semantic replay inputs such as pane stream cursors.

### Reconnect

- Transport reconnect changes the server session generation.
- Stale transport lifecycle events from previous generations must be ignored.
- In-flight unary requests must fail or retry according to their explicit
  request policy.
- Streams may be resubscribed after reconnect if their handle is still active.
- `NativeRuntime` remains responsible for workspace reconnect and pane
  cursor-backed stream reconnect.

### Heartbeat

- Any inbound server frame may refresh heartbeat freshness.
- Explicit heartbeat pongs may also refresh heartbeat freshness.
- Stale heartbeat is a degraded connection state, not immediately a closed
  session.
- Closed or disposed sessions must report heartbeat as unavailable.

### Backpressure

- Slow streams must surface `ServerTransportBackpressure` or stream-specific
  failure events instead of silently dropping application-level data.
- `ServerConnection` can report transport pressure, but it must not decide pane
  replay policy. That belongs to `NativeRuntime`.

## Action Sketches

### `ResolveServerEndpoint`

Responsibilities:

- read launch intent endpoint if provided
- read workspace profile endpoint if provided
- read default settings endpoint otherwise
- normalize endpoint shape
- validate supported endpoint kind and transport capability
- return `ServerBootstrapRequired` for missing local server when the endpoint
  cannot be reached and bootstrap is required outside this module

### `OpenServerSession`

Responsibilities:

- obtain auth session from `AuthSession`
- build explicit actor identity
- open transport session
- query and validate capabilities
- store `ServerConnectionState`
- publish `ServerSessionOpened`

### `ReconnectServerSession`

Responsibilities:

- increment connection generation
- clear request latency/active request state
- reopen transport
- close previous transport session
- resubscribe active streams when their policy allows it
- publish reconnect success or failure

### `OpenServerStream`

Responsibilities:

- validate active server session
- open typed stream
- register stream handle
- attach generation-aware lifecycle callbacks
- publish stream events

### `GetServerConnectionHealth`

Responsibilities:

- read current session state
- compute heartbeat freshness
- report active request count
- report active stream count
- report reconnect attempt state
- return transport stats for diagnostics

## Integration Flows

### Native app startup

```text
NativeHost launch
-> application shell ensures local server if policy requires it
-> ServerConnection.ResolveServerEndpoint
-> AuthSession action
-> ServerConnection.OpenServerSession
-> WorkspaceCoordinator / WorkspaceIndex / NativeRuntime actions
```

### Remote attach

```text
CLI or UI remote target
-> ServerConnection.ResolveServerEndpoint(remote/profile)
-> ServerConnection.OpenServerSession
-> WorkspaceCoordinator.AttachWorkspace
-> NativeRuntime.AttachWorkspaceRuntime
```

### Pane stream subscription

```text
TerminalViewport.CreateTerminalViewport
-> NativeRuntime.AttachPaneRuntime
-> ServerConnection.OpenServerStream
-> tmux.pane.subscribeStream
-> NativeRuntime stream cursor/replay handling
-> TerminalViewport.ApplyTerminalOutput
```

### Transport reconnect

```text
transport disconnect
-> ServerConnection.ReconnectServerSession
-> ServerConnection resubscribes live stream handles
-> NativeRuntime.ReconnectWorkspaceRuntime if workspace semantic state needs reconciliation
-> NativeRuntime.ReconnectPaneStream with cursor-backed input
```

## Testing Contract

Unit tests should cover:

- endpoint precedence: launch intent, workspace profile, settings default
- unsupported endpoint kinds
- missing local server returns `ServerBootstrapRequired`
- auth session is requested before transport open
- actor/session identity is explicit in requests
- capability mismatch fails before exposing an open session
- request timeout mapping
- stale transport events ignored after reconnect generation changes
- heartbeat freshness from inbound frames
- heartbeat stale transition
- stream registration and close
- stream resubscribe after reconnect
- disposed session rejects new requests and streams

Focused integration tests should cover:

- local endpoint connection over the selected local transport
- remote endpoint connection with explicit auth
- websocket request/response adapter
- websocket stream adapter
- reconnect while pane stream is active

End-to-end tests should cover:

- native app opens, resolves local server, and attaches workspace
- remote workspace attach through configured profile
- pane stream resumes correctly after transport reconnect

## Failure Modes To Preserve

The implementation must make these failure modes observable:

- local server is not running and bootstrap has not happened
- endpoint points to unsupported protocol
- token exists but actor session does not match server session
- server accepts connection but lacks native terminal capabilities
- unary request times out
- stream disconnects while session remains open
- reconnect opens a new session but old session emits stale lifecycle events
- transport becomes backpressured
- server closes session due to auth expiry

Each should map to a stable `ServerConnectionError`.
