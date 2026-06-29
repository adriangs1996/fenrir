# Module: Desktop IPC

> Electron-only host adapter that exposes local desktop capabilities to the web
> renderer through `window.desktopBridge`.

## Boundary

`window.desktopBridge` is the current Electron preload implementation of the
`DesktopHostAdapter` contract from `@fenrir/contracts`. It is a local shell
adapter, not a backend-environment API.

Use this surface only for capabilities that require the local desktop host:

- native dialogs, context menus, external links, update state, VPN, and local
  persistence;
- embedded host surfaces such as Neovim, VS Code Web, Browser Lab, and Traffic
  Lens views;
- render-loop frames and input for local embedded editor surfaces.

Do not add server/backend lifecycle behavior here when a WebSocket RPC route can
own it. Terminal sessions, managed processes, workflows, remote controller
state, provider streams, and other backend-environment operations should stay on
server contracts unless there is an explicit data-plane boundary.

## Replacement Contract

A future native terminal shell should replace this module by implementing the
same host-adapter semantics:

- expose a host adapter to the web runtime;
- preserve feature detection for optional capabilities;
- keep local host features separate from selected backend environment APIs;
- avoid routing terminal byte streams or provider content through high-level
  orchestration or Electron-specific IPC paths.

The Electron channel constants remain in `@fenrir/contracts/ipcChannels`; the
renderer-facing capability shape lives in `@fenrir/contracts` as
`DesktopBridge` and `DesktopHostAdapter`.
