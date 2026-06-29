# Module: Remote Controller

> Server-side remote host and command execution controller.

## Client Boundary

The remote controller lives under `apps/server/src/puppeteer` for historical
reasons, but its public surface is not a browser or Electron UI. The service in
`apps/server/src/puppeteer/Services/RemoteControllerService.ts` and schemas in
`packages/contracts/src/remoteController.ts` expose host, connection, directory,
and command-run metadata that any client can render.

`RemoteCommandRunSnapshot.output` is a bounded command result captured after a
run completes. It is suitable for timeline panels, MCP JSON/text responses, and
future terminal-client metadata views. It is not a live terminal byte stream and
does not provide terminal backpressure semantics. If interactive remote terminal
streaming is needed, add an explicit data-plane boundary instead of extending
workflow or MCP orchestration paths.

Remote transports are command templates such as SSH wrappers, local shells, or
CTF/RCE harnesses. They are server-side process adapters; clients should drive
them through the WebSocket/RPC/MCP controller surfaces rather than Electron IPC
or browser-specific APIs.
