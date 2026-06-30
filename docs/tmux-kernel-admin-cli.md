# Tmux Kernel Admin CLI

Fenrir exposes tmux session-kernel administration through the server CLI:

```sh
fenrir tmux-kernel list
fenrir tmux-kernel inspect <workspace-id>
fenrir tmux-kernel reconnect <workspace-id> --server-url http://127.0.0.1:3000 --bearer-token "$FENRIR_TOKEN" --actor-session-id "$FENRIR_SESSION_ID"
fenrir tmux-kernel panes <workspace-id>
fenrir tmux-kernel metadata
fenrir tmux-kernel remote-targets --server-url http://127.0.0.1:3000 --bearer-token "$FENRIR_TOKEN"
```

During development the same command tree is available through:

```sh
cd apps/server
bun run src/bin.ts tmux-kernel list
bun run scripts/tmux-kernel-admin.ts list
```

All commands accept `--base-dir` and `--dev-url`, matching the server CLI location flags. Commands that read or control tmux workspaces also accept `--actor-session-id` and `--actor-subject`. Those values are converted into the explicit `TmuxActor` passed to `TmuxWorkspaceService`; permissions are checked by the workspace service and are not inferred from whether the caller is local, web, Electron, or native.

The default actor is:

```text
sessionId: auth-session-cli-admin
subject: cli-admin
```

That actor only sees or controls workspaces where it has been explicitly granted the required tmux permissions. Use `--json` on any command for machine-readable output. Live tmux workspace commands require the actor session id to match the bearer session used for WebSocket authentication. Create both with:

```sh
fenrir auth session issue --json
```

Use the returned `sessionId` as `--actor-session-id` and the returned `token` as `--bearer-token`. `--token-only` is useful for non-tmux APIs, but it does not print the session id needed by live tmux workspace auth.

## Commands

`list` is an offline/local inspection command. It loads the selected Fenrir state directory, calls `TmuxWorkspaceService.listWorkspaces`, and returns persisted workspace metadata visible to the actor. It never parses `tmux list-sessions` output directly.

`inspect <workspace-id>` is an offline/local inspection command. It calls `TmuxWorkspaceService.getSnapshot` against the selected local metadata state and prints workspace, window, and pane metadata. Pane byte output is not included; clients must use pane stream data-plane contracts for high-volume terminal data.

`reconnect <workspace-id>` is a live server command. It requires `--server-url`, `--bearer-token`, and `--actor-session-id`. The actor session id must match the authenticated bearer session because tmux workspace routes reject actor claims from other sessions. The command obtains a short-lived websocket token from `/api/auth/ws-token`, then calls the running server's `tmux.workspace.reconnect` RPC. The control-mode connection remains owned by the running Fenrir server, not by the short-lived CLI process.

`panes <workspace-id>` is an offline/local inspection command. It calls `TmuxWorkspaceService.listOperationalPaneStatuses` against the selected local metadata state and returns registered operational pane metadata for agents, workflows, managed processes, remote processes, browser lab surfaces, and custom panes.

`metadata` reports the local metadata file path under the resolved Fenrir state directory. It is an admin storage inspection helper, not an alternate persistence API.

`remote-targets` is a live server command. It requires `--server-url` and `--bearer-token`, then calls the running server's `remoteController.listHosts` and `remoteController.listConnections` RPCs. It does not instantiate a fresh local `RemoteController`, because remote targets are live in-memory server state.

## Local And Remote Execution

Offline commands (`list`, `inspect`, `panes`, and `metadata`) run in-process against the local server service APIs and local Fenrir state directory selected by `--base-dir` or `FENRIR_HOME`. They are for persisted metadata inspection and do not claim ownership of the running server's control-mode connections.

Live commands (`reconnect` and `remote-targets`) use authenticated WebSocket/RPC routes against the running server. A remote transport does not imply tmux permissions: the caller still needs an authenticated server session, and tmux workspace commands still require explicit workspace grants for the actor represented in the request.

Native terminal clients should bootstrap a workspace through the authenticated control-plane contract, then subscribe to pane streams through the explicit pane data-plane APIs. The CLI is for inspection, recovery, and local administration; it is not a terminal byte transport.
