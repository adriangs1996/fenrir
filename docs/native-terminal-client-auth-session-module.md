# Native Client Module: AuthSession

Status: design reference.

This document defines the `AuthSession` product module for the native Fenrir
client.

`AuthSession` owns native client identity and credential lifecycle. It discovers
server auth policy, exchanges local or remote bootstrap credentials for bearer
sessions, persists bearer credentials in secure storage, issues short-lived
WebSocket tokens, builds explicit tmux actors, and revokes sessions when asked.

Related references:

- `docs/native-terminal-client-decisions.md`
- `docs/native-terminal-client-module-map.md`
- `docs/native-terminal-client-runtime-boundary.md`
- `docs/native-terminal-client-server-connection-module.md`
- `apps/server/src/auth/MODULE.md`
- `packages/contracts/src/auth.ts`

## Purpose

`AuthSession` answers: "Who is this native client, what authenticated server
session does it use, and what actor identity should be sent to server APIs?"

It is not:

- a server transport manager
- a tmux permission engine
- a WebSocket reconnect module
- a workspace lifecycle module
- a local server process supervisor

It is:

- the owner of native client auth session state
- the owner of secure local credential persistence
- the owner of local and remote pairing/bootstrap exchange
- the owner of bearer session lookup, refresh, and revocation
- the owner of WebSocket token issuance for authenticated transports
- the owner of explicit actor construction

## Responsibility Boundary

`AuthSession` is responsible for:

- discovering server auth descriptors
- exchanging desktop bootstrap credentials for bearer sessions
- exchanging remote one-time pairing credentials for bearer sessions
- loading and storing bearer session tokens in secure storage
- tracking session id, subject, role, expiry, and endpoint scope
- issuing short-lived WebSocket tokens from an existing bearer session
- building explicit actor identities from verified auth sessions
- validating that actor session id matches the authenticated bearer session
- listing and revoking client sessions when the current role allows it
- translating auth, keychain, pairing, and token issuance failures into stable
  `AuthSessionError` values

`AuthSession` is not responsible for:

- opening WebSocket sessions
- retrying server transport reconnect
- deciding workspace access or pane access
- rendering pairing UI
- launching local servers
- storing terminal, tmux, or workspace state

Those responsibilities belong to:

- `ServerConnection`
- `NativeHost`
- `WorkspaceCoordinator`
- `NativeRuntime`
- `WorkspaceShell`

## Public API

### Inbound Actions

The public interface of this module is a set of specific auth use cases.

#### `DiscoverAuthPolicy`

- `run(_ input: DiscoverAuthPolicyInput) -> Effect<DiscoverAuthPolicyResult, AuthSessionError>`

Reads the target server's auth descriptor and returns supported bootstrap and
session methods.

#### `BootstrapLocalAuthSession`

- `run(_ input: BootstrapLocalAuthSessionInput) -> Effect<BootstrapLocalAuthSessionResult, AuthSessionError>`

Exchanges a trusted local desktop bootstrap credential for a bearer session.
The bootstrap credential is provided by the application shell or local server
bootstrap path; this module does not create it.

#### `PairRemoteAuthSession`

- `run(_ input: PairRemoteAuthSessionInput) -> Effect<PairRemoteAuthSessionResult, AuthSessionError>`

Exchanges a remote one-time pairing credential for a bearer session.

#### `LoadAuthSession`

- `run(_ input: LoadAuthSessionInput) -> Effect<LoadAuthSessionResult, AuthSessionError>`

Loads a persisted bearer session for an endpoint/profile from secure storage and
validates it against the server session endpoint.

#### `RefreshAuthSession`

- `run(_ input: RefreshAuthSessionInput) -> Effect<RefreshAuthSessionResult, AuthSessionError>`

Refreshes session metadata and replaces persisted bearer material when the
server returns a newer bearer session.

#### `IssueWebSocketToken`

- `run(_ input: IssueWebSocketTokenInput) -> Effect<IssueWebSocketTokenResult, AuthSessionError>`

Issues a short-lived WebSocket token for an authenticated bearer session.

#### `BuildAuthenticatedActor`

- `run(_ input: BuildAuthenticatedActorInput) -> Effect<BuildAuthenticatedActorResult, AuthSessionError>`

Builds the explicit actor sent to tmux/runtime APIs. The actor session id must
match the authenticated bearer session id.

#### `ListAuthSessions`

- `run(_ input: ListAuthSessionsInput) -> Effect<ListAuthSessionsResult, AuthSessionError>`

Lists active client sessions for an endpoint when the current session has owner
access.

#### `RevokeAuthSession`

- `run(_ input: RevokeAuthSessionInput) -> Effect<RevokeAuthSessionResult, AuthSessionError>`

Revokes one client session. Revoking the current session must also clear local
secure storage for that endpoint/profile.

#### `ClearAuthSession`

- `run(_ input: ClearAuthSessionInput) -> Effect<ClearAuthSessionResult, AuthSessionError>`

Removes local persisted bearer material without requiring server revocation.

No generic `HandleAuthSessionCommand` action should exist.

### Auth Events

The module may emit auth-level events:

- `AuthPolicyDiscovered`
- `LocalAuthSessionBootstrapped`
- `RemoteAuthSessionPaired`
- `AuthSessionLoaded`
- `AuthSessionRefreshStarted`
- `AuthSessionRefreshed`
- `AuthSessionExpired`
- `AuthSessionCleared`
- `WebSocketTokenIssued`
- `AuthenticatedActorBuilt`
- `AuthSessionRevoked`
- `AuthSessionRevocationFailed`
- `AuthSecureStorageFailed`

These events are auth events. They are not server transport events, tmux runtime
events, or UI notifications.

## Contracts

### Inputs

Action-specific inputs:

- `DiscoverAuthPolicyInput`
- `BootstrapLocalAuthSessionInput`
- `PairRemoteAuthSessionInput`
- `LoadAuthSessionInput`
- `RefreshAuthSessionInput`
- `IssueWebSocketTokenInput`
- `BuildAuthenticatedActorInput`
- `ListAuthSessionsInput`
- `RevokeAuthSessionInput`
- `ClearAuthSessionInput`

Common fields may include:

- `endpoint`
- `profileId`
- `environmentId`
- `httpBaseUrl`
- `bootstrapCredential`
- `pairingCredential`
- `sessionId`
- `subject`
- `role`
- `clientMetadata`
- `secureStorageScope`
- `requestedTtl`
- `source`

### Outputs

Action-specific outputs:

- `DiscoverAuthPolicyResult`
- `BootstrapLocalAuthSessionResult`
- `PairRemoteAuthSessionResult`
- `LoadAuthSessionResult`
- `RefreshAuthSessionResult`
- `IssueWebSocketTokenResult`
- `BuildAuthenticatedActorResult`
- `ListAuthSessionsResult`
- `RevokeAuthSessionResult`
- `ClearAuthSessionResult`

Core DTOs:

- `AuthEndpointScope`
- `NativeAuthSession`
- `NativeAuthSessionId`
- `NativeBearerSession`
- `NativeAuthPolicy`
- `NativeAuthRole`
- `NativeAuthClientMetadata`
- `NativeWebSocketToken`
- `NativeAuthenticatedActor`
- `NativeAuthSessionState`
- `NativeAuthSessionSummary`

`NativeAuthSession` may include:

- endpoint scope
- auth session id
- subject
- role
- session method
- issued/expiry metadata
- client metadata
- persisted credential reference

It must not include:

- raw bearer token in ordinary public state snapshots
- WebSocket token after it has been handed to `ServerConnection`
- keychain item internals
- raw HTTP response objects
- native window references
- tmux pane or workspace state

`NativeBearerSession` may include bearer token material only as a short-lived
action result intended for `ServerConnection` or secure persistence. It should
not be stored in general UI state.

### Contract Mapping

Native client contracts should map directly to existing server auth contracts:

- `ServerAuthDescriptor`
- `AuthBootstrapInput`
- `AuthBearerBootstrapResult`
- `AuthWebSocketTokenResult`
- `AuthClientSession`
- `AuthSessionState`
- `AuthRevokeClientSessionInput`
- `AuthSessionId`
- `AuthSessionRole`

The native module may wrap these contracts in Swift-native DTOs, but it must not
change server semantics.

### Errors

`AuthSessionError`

Base tags:

- `AuthPolicyUnavailable`
- `AuthPolicyUnsupported`
- `AuthBootstrapCredentialMissing`
- `AuthBootstrapCredentialRejected`
- `AuthPairingCredentialMissing`
- `AuthPairingCredentialRejected`
- `AuthBearerSessionMissing`
- `AuthBearerSessionRejected`
- `AuthBearerSessionExpired`
- `AuthSessionRefreshFailed`
- `AuthWebSocketTokenIssueFailed`
- `AuthActorSessionMismatch`
- `AuthRoleInsufficient`
- `AuthSessionRevocationFailed`
- `AuthSecureStorageReadFailed`
- `AuthSecureStorageWriteFailed`
- `AuthSecureStorageDeleteFailed`
- `AuthServerUnavailable`
- `AuthProtocolMismatch`

Raw HTTP, keychain, serialization, and server auth failures should be translated
before crossing this module boundary.

## Dependencies

`AuthSession` should depend only on swappable ports with real substitution
value.

Suggested ports:

- `AuthPolicyDiscovering`
- `AuthBootstrapExchanging`
- `AuthPairingExchanging`
- `AuthSessionFetching`
- `AuthWebSocketTokenIssuing`
- `AuthSessionRevoking`
- `AuthSecureStorage`
- `AuthClientMetadataProviding`
- `AuthSessionStore`
- `AuthSessionEventPublishing`
- `AuthSessionClock`

Expected implementations:

- `AuthSecureStorage` is backed by Keychain or a platform secure-storage
  adapter.
- `AuthPolicyDiscovering`, `AuthBootstrapExchanging`,
  `AuthPairingExchanging`, `AuthSessionFetching`, `AuthWebSocketTokenIssuing`,
  and `AuthSessionRevoking` are backed by narrow HTTP auth endpoint adapters.
- `AuthClientMetadataProviding` is backed by native app/device metadata.
- `AuthSessionStore` stores non-secret session state and references to secure
  credential entries.

It must not depend directly on:

- `ServerConnection`
- AppKit windows or views
- `libGhostty` renderer objects
- tmux runtime state
- local client-control IPC listener state
- concrete local server process supervision

The no-`ServerConnection` rule prevents a dependency cycle:

```text
AuthSession -> auth HTTP/keychain ports
ServerConnection -> AuthSession
NativeRuntime -> ServerConnection
```

## Internal Structure

The intended Swift module shape is:

```text
AuthSession/
  MODULE.md
  index.swift
  Contracts/
    AuthEndpointScope.swift
    NativeAuthSession.swift
    NativeBearerSession.swift
    NativeAuthPolicy.swift
    NativeAuthRole.swift
    NativeAuthClientMetadata.swift
    NativeWebSocketToken.swift
    NativeAuthenticatedActor.swift
    NativeAuthSessionState.swift
    NativeAuthSessionSummary.swift
    AuthSessionEvents.swift
    AuthSessionError.swift
  Services/
    AuthPolicyDiscovering.swift
    AuthBootstrapExchanging.swift
    AuthPairingExchanging.swift
    AuthSessionFetching.swift
    AuthWebSocketTokenIssuing.swift
    AuthSessionRevoking.swift
    AuthSecureStorage.swift
    AuthClientMetadataProviding.swift
    AuthSessionStore.swift
    AuthSessionEventPublishing.swift
    AuthSessionClock.swift
  Actions/
    DiscoverAuthPolicy.swift
    BootstrapLocalAuthSession.swift
    PairRemoteAuthSession.swift
    LoadAuthSession.swift
    RefreshAuthSession.swift
    IssueWebSocketToken.swift
    BuildAuthenticatedActor.swift
    ListAuthSessions.swift
    RevokeAuthSession.swift
    ClearAuthSession.swift
  Models/
    AuthSessionModel.swift
    AuthEndpointScopeModel.swift
    AuthSecureStorageModel.swift
    AuthPairingModel.swift
    AuthActorModel.swift
  Layers/
    LiveAuthPolicyDiscovering.swift
    LiveAuthBootstrapExchanging.swift
    LiveAuthPairingExchanging.swift
    LiveAuthSessionFetching.swift
    LiveAuthWebSocketTokenIssuing.swift
    LiveAuthSessionRevoking.swift
    KeychainAuthSecureStorage.swift
    LiveAuthClientMetadataProviding.swift
    LiveAuthSessionStore.swift
    LiveAuthSessionEventPublishing.swift
    SystemAuthSessionClock.swift
  __tests__/
```

## Runtime Rules

### Identity

- Actor identity must be explicit.
- Actor `sessionId` must match the authenticated bearer session id.
- Actor `subject` must come from the verified auth session or explicit session
  subject returned by the auth endpoint.
- Actor identity must never be inferred from native, Electron, web, CLI,
  localhost, or remote transport type.

### Credential Handling

- Bearer tokens are secrets.
- WebSocket tokens are short-lived secrets.
- Public state snapshots may expose session id, role, subject, expiry, and
  endpoint scope, but not token material.
- Secure storage keys must be scoped by endpoint/profile to avoid leaking a
  remote token into a local connection or the reverse.
- Clearing a session must remove local secret material even when server
  revocation fails.

### Bootstrap

- Local desktop bootstrap is a trust-establishment handoff from application
  shell/local server bootstrap to this module.
- Remote pairing uses one-time credentials.
- Bootstrap credentials are not steady-state session credentials.
- After bootstrap succeeds, steady-state requests use bearer session token
  semantics.

### WebSocket Tokens

- `IssueWebSocketToken` must use a current bearer session.
- WebSocket token TTL is server-owned.
- WebSocket tokens should be minted close to connection time and should not be
  persisted.
- If token issuance fails because the bearer session expired or was revoked,
  return `AuthBearerSessionExpired` or `AuthBearerSessionRejected` rather than a
  generic transport failure.

### Roles

- `owner` may manage pairing links and revoke client sessions.
- `client` may use authenticated capabilities but must not manage access.
- Future per-project permissions must be explicit contract fields or server
  APIs, not inferred from client role or transport type.

## Action Sketches

### `DiscoverAuthPolicy`

Responsibilities:

- query the target server auth descriptor
- normalize policy and supported methods
- reject unsupported policies for native operation
- publish `AuthPolicyDiscovered`

### `BootstrapLocalAuthSession`

Responsibilities:

- validate bootstrap credential presence
- exchange `desktop-bootstrap` credential for bearer session
- persist bearer token in secure storage
- store non-secret session metadata
- publish `LocalAuthSessionBootstrapped`

### `PairRemoteAuthSession`

Responsibilities:

- validate one-time pairing credential
- exchange credential for bearer session
- persist bearer token scoped to remote endpoint/profile
- store non-secret session metadata
- publish `RemoteAuthSessionPaired`

### `LoadAuthSession`

Responsibilities:

- locate secure storage entry by endpoint/profile scope
- read bearer token
- call server session endpoint to verify status
- map expired/revoked sessions to stable errors
- return session summary without leaking token in ordinary state

### `IssueWebSocketToken`

Responsibilities:

- load current bearer session if not provided
- call server WebSocket-token endpoint
- return short-lived token without persistence
- publish `WebSocketTokenIssued`

### `BuildAuthenticatedActor`

Responsibilities:

- read verified auth session
- construct actor `{ sessionId, subject }`
- verify actor session id matches bearer session id
- publish `AuthenticatedActorBuilt`

### `RevokeAuthSession`

Responsibilities:

- call server revoke endpoint when possible
- clear local secure storage if revoking the current session
- update non-secret session store
- publish `AuthSessionRevoked` or `AuthSessionRevocationFailed`

## Integration Flows

### Local native app startup

```text
NativeHost launch
-> application shell ensures local server and bootstrap credential if needed
-> AuthSession.DiscoverAuthPolicy
-> AuthSession.BootstrapLocalAuthSession or AuthSession.LoadAuthSession
-> ServerConnection.OpenServerSession
```

### Remote profile connection

```text
user selects remote profile
-> AuthSession.LoadAuthSession
-> if missing/expired: AuthSession.PairRemoteAuthSession
-> AuthSession.IssueWebSocketToken
-> ServerConnection.OpenServerSession
```

### Tmux runtime call

```text
NativeRuntime action
-> ServerConnection typed request/stream
-> ServerConnection obtains auth material from AuthSession
-> AuthSession.BuildAuthenticatedActor
-> server validates bearer session id == actor.sessionId
```

### Session revocation

```text
settings/access UI or CLI action
-> AuthSession.ListAuthSessions
-> AuthSession.RevokeAuthSession
-> AuthSession clears local token if current session was revoked
-> ServerConnection.RefreshServerSession or CloseServerSession
```

## Testing Contract

Unit tests should cover:

- auth policy discovery and unsupported policy rejection
- local bootstrap credential missing
- local bootstrap credential rejected
- remote pairing credential missing
- remote pairing credential rejected
- bearer token persisted under endpoint/profile scope
- session load verifies token against server session endpoint
- expired bearer session maps to `AuthBearerSessionExpired`
- WebSocket token issue does not persist the token
- actor construction uses verified session subject
- actor/session mismatch maps to `AuthActorSessionMismatch`
- owner-only session listing/revocation
- clearing local session deletes secure storage even if server is unreachable
- keychain read/write/delete error mapping

Focused integration tests should cover:

- Keychain-backed secure storage
- local desktop bootstrap exchange
- remote one-time pairing exchange
- WebSocket token issuance from bearer session
- revoke current session and clear local credential

End-to-end tests should cover:

- first local app launch obtains/loads auth and opens server session
- remote profile pairing then reconnect without re-pairing
- revoked session forces reconnect/auth recovery flow

## Failure Modes To Preserve

The implementation must make these failure modes observable:

- server auth policy is unsupported
- local bootstrap credential is missing
- local bootstrap credential was already consumed or expired
- remote pairing credential was already consumed or expired
- secure storage is unavailable
- bearer token exists but server rejects it
- bearer token expired
- WebSocket token issuance fails
- actor session id does not match bearer session id
- current role cannot manage access
- revocation succeeds remotely but local secure delete fails

Each should map to a stable `AuthSessionError`.
