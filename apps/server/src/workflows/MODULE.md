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

## Runner Boundary

`apps/server/src/workflows/Layers/Workflow.ts` starts an isolated JavaScript
runtime process for workflow source. `apps/server/src/mcp/mcpRunnerRuntime.ts`
may pass `ELECTRON_RUN_AS_NODE` when the packaged desktop process requires it,
but that is a local process-launch compatibility detail, not a workflow contract
and not an Electron IPC dependency.
