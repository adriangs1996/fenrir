# Fenrir End-to-End MCP Guide

This document is the reference for adding a new MCP to Fenrir end to end.

It covers the built-in Fenrir MCP path used by Browser Lab and Remote Host:

- the MCP appears in Fenrir's selectable MCP server list
- Codex receives it as a thread-scoped MCP server
- the MCP runner bridges back into Fenrir over HTTP
- tool calls operate on real server state
- the MCP is packaged into the built server artifact

This is the path to copy for future built-in MCPs.

## Architecture

For a built-in MCP, the execution chain is:

1. Shared built-in definition in `packages/shared/src/mcpBuiltIns.ts`
2. Tool catalog and result formatter in `apps/server/src/mcp/<name>Tools.ts`
3. Stdio MCP runner in `apps/server/src/mcp/<name>Runner.ts`
4. Runtime helpers in `apps/server/src/mcp/<name>McpRuntime.ts`
5. Internal HTTP bridge in `apps/server/src/mcp/<name>McpHttp.ts`
6. Resolver wiring in `apps/server/src/mcp/Layers/McpConfigResolver.ts`
7. Route registration in `apps/server/src/server.ts`
8. Build packaging in `apps/server/tsdown.config.ts`
9. Tests that prove all of the above

If any one of those steps is missing, the MCP can appear partially wired while still being unusable.

## Implementation Checklist

### 1. Add the built-in MCP definition

File:

- `packages/shared/src/mcpBuiltIns.ts`

Add:

- a stable MCP id constant, for example `FENRIR_REMOTE_HOST_MCP_ID`
- a built-in server definition in `FENRIR_BUILT_IN_MCP_SERVERS`

Notes:

- use `source: "fenrir"`
- use `transport.type: "stdio"`
- the `command` placeholder is symbolic only; the real runner path is resolved server-side

This makes the MCP selectable in Fenrir settings and composer UI.

### 2. Define the tool catalog

File pattern:

- `apps/server/src/mcp/<name>Tools.ts`

Add:

- `readonly name`
- `readonly description`
- `readonly inputSchema`
- a formatter that returns MCP content payloads

Guidelines:

- use concrete Zod schemas for every tool
- keep tool descriptions operational and explicit
- return structured MCP `content`, not ad hoc strings
- if the tool can emit binary output, format it correctly for MCP, as Browser Lab does for screenshots

Tests:

- tool count
- every tool has a schema
- schema validation for representative inputs
- result formatting behavior
- runner-advertised schemas are concrete and discoverable over stdio

Reference files:

- `apps/server/src/mcp/browserLabTools.ts`
- `apps/server/src/mcp/remoteHostTools.ts`

### 3. Implement the stdio MCP runner

File pattern:

- `apps/server/src/mcp/<name>Runner.ts`

Responsibilities:

- start `McpServer`
- require `FENRIR_MCP_BACKEND_URL`
- require `FENRIR_MCP_TOKEN`
- register each tool from `<name>Tools.ts`
- forward tool calls to Fenrir over HTTP
- format returned values into MCP output

Guidelines:

- keep the runner thin
- do not embed business logic in the runner
- fail fast if backend URL or token is missing

Reference files:

- `apps/server/src/mcp/browserLabRunner.ts`
- `apps/server/src/mcp/remoteHostRunner.ts`

### 4. Add runtime helpers

File pattern:

- `apps/server/src/mcp/<name>McpRuntime.ts`

Responsibilities:

- generate the per-process MCP token
- compute the loopback backend URL
- resolve the MCP runner path
- provide any special env vars needed by the runner

Shared helper:

- `apps/server/src/mcp/mcpRunnerRuntime.ts`

Important:

- never return a guessed runner path if the artifact is missing
- `resolveMcpRunnerPath(...)` must throw when no runner exists

This was a real failure mode: Remote Host was wired everywhere else, but the built artifact did not contain `remoteHostRunner`, so the MCP was selected but unavailable at runtime.

Reference files:

- `apps/server/src/mcp/browserLabMcpRuntime.ts`
- `apps/server/src/mcp/remoteHostMcpRuntime.ts`
- `apps/server/src/mcp/mcpRunnerRuntime.ts`

### 5. Add the internal HTTP bridge

File pattern:

- `apps/server/src/mcp/<name>McpHttp.ts`

Responsibilities:

- expose an internal authenticated route
- validate `Authorization: Bearer <token>`
- decode `{ toolName, input }`
- route the call to the real server-side services
- return `{ ok: true, result }` or `{ ok: false, error }`

Guidelines:

- keep the HTTP layer thin
- map tool names explicitly
- return stable JSON shapes
- keep auth token generation private to the server process

Reference files:

- `apps/server/src/browserLab/browserLabControlHttp.ts`
- `apps/server/src/mcp/remoteHostMcpHttp.ts`

### 6. Resolve built-ins into real runner config

File:

- `apps/server/src/mcp/Layers/McpConfigResolver.ts`

Responsibilities:

- detect the built-in MCP id
- replace the symbolic built-in definition with a real resolved stdio config
- set:
  - `command: process.execPath`
  - `args: [resolvedRunnerPath]`
  - `env.FENRIR_MCP_BACKEND_URL`
  - `env.FENRIR_MCP_TOKEN`

The resulting resolved server config is what gets handed to Codex.

Tests:

- resolver returns the expected stdio transport
- runner path matches the expected file
- env contains backend URL and token

Reference files:

- `apps/server/src/mcp/Layers/McpConfigResolver.ts`
- `apps/server/src/mcp/Layers/McpConfigResolver.test.ts`

### 7. Register the HTTP route in the server

File:

- `apps/server/src/server.ts`

Make sure the new MCP HTTP route layer is included in the live server.

If this step is missed, the runner starts successfully but every tool call fails when it tries to bridge back into Fenrir.

### 8. Package the runner into the build

File:

- `apps/server/tsdown.config.ts`

Every built-in runner must be an explicit build entry.

Example:

```ts
entry: ["src/bin.ts", "src/mcp/browserLabRunner.ts", "src/mcp/remoteHostRunner.ts"];
```

This is not optional. If the runner is not built into `dist/mcp`, the MCP may look configured in the UI but will not be available in built/runtime environments.

Tests:

- config test that asserts all built-in runner entries are present
- build output check that `dist/mcp/<name>Runner.{mjs,cjs}` exists after `bun run build`

Reference files:

- `apps/server/tsdown.config.ts`
- `apps/server/tsdown.config.test.ts`

### 9. Verify thread-scoped MCP selection reaches Codex

Relevant files:

- `apps/web/src/components/ChatView.tsx`
- `packages/contracts/src/orchestration.ts`
- `apps/server/src/orchestration/decider.ts`
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`

Important detail:

- the selected MCP ids must be attached directly to `thread.turn.start`
- do not rely only on the thread projection having caught up

This was another real failure mode. Persisting thread MCP selection and immediately starting a turn can race with the projection reactor, causing a turn to start without the intended MCP servers.

Current rule:

- `thread.turn.start` should carry `mcpServerIds`
- the provider reactor should prefer event-level MCP ids when present

If a new MCP is selectable from chat, confirm this path still works for it.

## Testing Standard

Use as little mock as possible. Prefer real functionality over mock behavior.

Minimum coverage for a new MCP:

1. Tool catalog tests
2. Runner schema advertisement test over stdio
3. HTTP bridge test through the real tool handler
4. Resolver test for the built-in MCP id
5. Build packaging test for the runner entry
6. Build artifact verification after `bun run build`
7. If turn-start behavior changed, a regression test for `mcpServerIds` propagation

Recommended examples:

- `apps/server/src/mcp/browserLabTools.test.ts`
- `apps/server/src/mcp/remoteHostTools.test.ts`
- `apps/server/src/mcp/Layers/McpConfigResolver.test.ts`
- `apps/server/src/mcp/mcpRunnerRuntime.test.ts`
- `apps/server/tsdown.config.test.ts`

## Manual Verification Flow

Use this sequence when validating a new MCP end to end:

1. Enable the MCP in Fenrir
2. Start a fresh chat thread
3. Ask the agent to use the MCP by name
4. Confirm the model performs MCP tool calls instead of answering from local shell fallbacks
5. If the MCP drives shared server state, confirm the UI that consumes that state reflects the changes

For direct probing:

- `mcpServer/tool/call` is useful to prove the runner and HTTP bridge work
- `mcpServerStatus/list` is not authoritative for thread-scoped MCP availability

We observed a case where direct `mcpServer/tool/call` worked while `mcpServerStatus/list` did not list the MCP. Do not use `mcpServerStatus/list` as the final truth for whether the model can access a tool.

## Failure Modes We Hit

### 1. Runner missing from build output

Symptom:

- MCP is visible/selectable
- Browser Lab works
- new MCP is "not available"

Root cause:

- the runner was not included in `apps/server/tsdown.config.ts`

Fix:

- add the runner entry
- verify `dist/mcp/<name>Runner.mjs` and `.cjs` exist

### 2. Runtime helper returned a phantom runner path

Symptom:

- MCP appears configured
- runtime errors are indirect or hard to diagnose

Root cause:

- runtime helper returned the first candidate path even when no file existed

Fix:

- throw immediately when no runner artifact exists

### 3. Thread-start race dropped selected MCPs

Symptom:

- MCP is enabled in UI
- model claims tool is unavailable
- direct MCP probing may still work

Root cause:

- `thread.mcp-servers.set` persisted, but `thread.turn.start` fired before the thread projection reflected the change

Fix:

- include `mcpServerIds` directly on `thread.turn.start`
- consume those ids in `ProviderCommandReactor`

### 4. `mcpServerStatus/list` disagreed with reality

Symptom:

- status list does not show the MCP
- direct MCP calls succeed

Conclusion:

- `mcpServerStatus/list` is diagnostic only
- actual tool-call behavior is the stronger signal

## Files to Touch for a New Built-In MCP

At minimum:

- `packages/shared/src/mcpBuiltIns.ts`
- `apps/server/src/mcp/<name>Tools.ts`
- `apps/server/src/mcp/<name>Runner.ts`
- `apps/server/src/mcp/<name>McpRuntime.ts`
- `apps/server/src/mcp/<name>McpHttp.ts`
- `apps/server/src/mcp/Layers/McpConfigResolver.ts`
- `apps/server/src/server.ts`
- `apps/server/tsdown.config.ts`

Usually also:

- tests for each of the above
- UI or orchestration wiring if the MCP is user-selectable or reflected in the workspace

## Required Final Checks

Before considering the MCP done:

- `bun fmt`
- `bun lint`
- `bun typecheck`

And for the affected server package:

- focused `bun run test ...`
- `cd apps/server && bun run build`

If the MCP is used in the running app, restart the Fenrir server or desktop process after the build so the new runner artifacts are actually loaded.
