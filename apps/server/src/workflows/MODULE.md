# Module: Workflows

> Server-side workflow runtime, persistence, collaboration, and event streaming.

## Client Boundary

Workflows expose lifecycle and collaboration state through
`apps/server/src/workflows/Services/Workflow.ts` and the shared schemas in
`packages/contracts/src/workflows.ts`. These contracts are client-neutral:
web, Electron, MCP runners, and future native terminal clients observe the same
run snapshots, timeline events, input requests, notes, task proposals, and state
patches.

The runtime API name `ctx.ui.ask` is preserved for workflow compatibility, but
the server treats it as a structured input request. Any client can render and
answer that request through `WorkflowInputRequestSnapshot` and
`WorkflowRespondToInputInput`; no browser DOM, Electron shell, or terminal tab is
part of the contract.

Workflow event streams are control-plane metadata for run state and timeline
updates. Do not route terminal byte streams, remote command output streams, or
provider token streams through workflow orchestration helpers unless a separate
data-plane boundary is introduced.

Workflow runs and agents may attach tmux operational pane metadata through the
terminal kernel (`tmux.pane.attachMetadata` and
`tmux.operationalPanes.statuses`). That linkage is an operational surface only:
workflow snapshots and provider events remain the source of truth for workflow
state and do not gain terminal UI fields.

When a workflow or agent needs an operational pane, it must use the terminal
kernel contracts with an explicit `TmuxActor` and workspace grant. Do not infer
permission from a local workflow runner, Electron process, browser websocket, or
future native terminal transport. Pane output stays on
`tmux.pane.subscribeStream`; workflow event streams may reference pane identity
or lifecycle metadata but must not carry terminal bytes.

## Runner Boundary

`apps/server/src/workflows/Layers/Workflow.ts` starts an isolated JavaScript
runtime process for workflow source. `apps/server/src/mcp/mcpRunnerRuntime.ts`
may pass `ELECTRON_RUN_AS_NODE` when the packaged desktop process requires it,
but that is a local process-launch compatibility detail, not a workflow contract
and not an Electron IPC dependency.
