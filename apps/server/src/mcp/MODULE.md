# Module: MCP Runners

> MCP tool runners and HTTP bridges for Browser Lab, Remote Host, and workflow
> automation.

## Browser Lab And Traffic Lens Boundary

Browser Lab MCP tools intentionally expose a mixed surface:

- **Terminal-renderable outputs**: text JSON summaries, Traffic Lens request
  detail, replay responses, findings, profile/rule/override metadata, storage
  snapshots, and `fenrir-image://...` screenshot handles.
- **Visual browser host actions**: tab lifecycle, navigation, click/type/key
  input, live paused-request control, and live storage capture. These require a
  connected browser host through the Browser Lab control WebSocket.

MCP result formatting should keep artifacts explicit. Screenshots should return
image content plus a Fenrir image handle, while structured metadata should remain
text/JSON so terminal clients can render it without embedding a browser view.

Do not route terminal byte streams, provider streams, or browser pixel streams
through MCP orchestration helpers. Add an explicit data-plane boundary if future
work needs high-volume visual or terminal streaming.

## Workflow And Remote Host Boundary

Workflow MCP tools are text/JSON adapters over
`apps/server/src/workflows/Services/Workflow.ts`. Management tools create,
validate, run, stop, and inspect workflow artifacts; collaboration tools patch
run state, add notes, propose tasks, and message workflow agents. They should
return snapshots or timeline metadata, not browser UI instructions or terminal
byte streams.

Remote Host MCP tools are text/JSON adapters over
`apps/server/src/puppeteer/Services/RemoteControllerService.ts`. Command output
is returned as bounded `RemoteCommandRunSnapshot` metadata through
`remote_host_send_command` and `remote_host_list_command_runs`. Interactive
terminal streaming, backpressure, and resize semantics belong behind a separate
terminal data plane, not these MCP runner helpers.

The MCP runners may inherit `ELECTRON_RUN_AS_NODE` from
`apps/server/src/mcp/mcpRunnerRuntime.ts` when Fenrir is packaged with Electron.
That environment forwarding is only process-launch compatibility; MCP tool
schemas and HTTP bridge payloads must stay host-neutral.
