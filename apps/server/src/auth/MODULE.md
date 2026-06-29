# Module: Auth

> Server-side pairing, session issuance, and access-management boundaries.

## Client Boundary

Auth is host-neutral. Web, Electron, CLI, and future native terminal clients use
the same pairing and session contracts from `packages/contracts/src/auth.ts`.
Desktop bootstrap is only a local trust-establishment method; steady-state
requests use either the browser session cookie or bearer session token.

Remote/native clients should pair first, then use:

- `POST /api/auth/bootstrap/bearer` to exchange a one-time pairing credential
  for a bearer session token.
- `POST /api/auth/ws-token` to mint a short-lived WebSocket token from an
  existing authenticated session.
- `GET /api/auth/clients`, `POST /api/auth/clients/revoke`, and
  `POST /api/auth/clients/revoke-others` for owner-driven client-session
  revocation.

## Scopes

The current authorization model has two session roles:

- `owner`: can create pairing links and revoke client sessions.
- `client`: can use authenticated server capabilities but cannot manage access.

This is intentionally not broad RBAC. Per-project permissions should be added as
new explicit contract fields or methods on top of the existing session identity,
not inferred from transport, host, Electron state, browser state, or terminal
client type.

## Stream Boundary

`apps/server/src/ws/routes/auth.ts` streams access metadata: pairing-link and
client-session snapshots/events. It does not carry terminal byte streams,
provider token streams, or project data. Future multiuser permission updates
should keep this stream limited to auth/access metadata.
