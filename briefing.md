# Fenrir Workflows Runtime Source Of Truth

This document is the canonical source of truth for Fenrir workflows.

It replaces the older thread-scoped workflow briefing. If code, UI copy, tests,
or agent instructions disagree with this document, this document wins and the
implementation should be migrated toward it.

## Status And Scope

The current implementation already has a `workflows` module, workflow source
storage, an isolated JavaScript runtime, hidden workflow agent threads, workflow
events, run state, task proposals, and a thread-scoped web panel.

The target architecture changes the ownership model:

- workflows are project/Fenrir resources
- threads are interfaces that create, link, operate, or monitor workflows
- Fenrir is the workflow runtime
- agents are workers and context consumers
- workflows orchestrate context, prompts, memory, state, tools, and external
  world interaction through Fenrir capabilities

The goal is not deterministic replay. LLM workflows are intentionally
non-deterministic. The goal is causal traceability and steadily improving
probability of success through better context accumulated from prior runs,
user edits, failures, checks, and workflow memory.

## Product Goal

Build workflows into Fenrir runtime primitives.

A workflow is a durable, inspectable orchestration artifact that can:

- create and coordinate named agents
- build prompts and context for those agents
- read and write workflow state
- record a rich event log
- remember useful lessons across runs
- expose controlled capabilities for filesystem and workspace interaction
- run in the background without requiring the originating thread to stay alive
- be run manually, from a thread, from an API, or from a one-shot schedule
- be monitored from project-level UI

Threads remain important, but they are not the workflow container. A thread can
create a workflow, update its source, start a run, subscribe to events, respond
to user input, or inspect history. The workflow must not depend on that thread
for execution.

## Current Implementation Baseline

The existing implementation is useful but thread-scoped:

- contracts live in `packages/contracts/src/workflows.ts`
- server service lives under `apps/server/src/workflows/`
- persistence uses migration `039_Workflows`
- workflow MCP tools live under `apps/server/src/mcp/workflow*.ts`
- web state lives under `apps/web/src/modules/workflows/`
- `WorkflowDraft`, `WorkflowRunSnapshot`, repository queries, MCP context, and
  UI selectors rely heavily on `originThreadId`
- `ctx.team.agent` currently derives provider/runtime defaults from the origin
  thread
- the thread panel is currently the primary workflow UI

Migration work should start from that baseline and move deliberately toward the
model below. Do not keep a permanent dual model.

## Core Decisions

- The feature is named `workflows`.
- Workflows are a module, not an extension of `plan-runner`.
- A workflow belongs to a project, not to a thread.
- `originThreadId` must not be required to create, list, run, schedule, or
  monitor a workflow.
- Threads are linked to workflows through explicit relationship rows.
- Fenrir is the runtime that executes workflow source and exposes capabilities.
- Workflow source is a durable Fenrir artifact, not a repo file by default.
- Opening source may materialize a Fenrir-managed editable file, but the DB
  source remains authoritative.
- Workflow runs are durable and inspectable.
- Run state is mutable and auditable.
- Workflow memory is first-class and may influence future prompt/context builds
  automatically.
- Every memory use and prompt build must be visible in the event log.
- Scheduling v1 supports manual runs and one-shot `runAt` schedules.
- Recurring cron/interval schedules are deferred.
- The main workflow UI is a project-level Workflow Center.
- Thread UI is contextual and only shows linked or relevant workflows.
- MCP workflows must expose `workflow_reference`, a skill-like API reference
  tool that agents must read before creating or updating workflow source.

## Domain Model

### WorkflowDefinition

`WorkflowDefinition` replaces the mental model of `WorkflowDraft`.

```ts
interface WorkflowDefinition {
  workflowId: WorkflowId;
  projectId: ProjectId;
  name: string;
  description: string | null;
  source: string;
  sourceHash: string;
  sourceRevision: number;
  status: "draft" | "active" | "invalid" | "archived";
  validationStatus: "pending" | "valid" | "invalid";
  validationError: string | null;
  declaredCapabilities: WorkflowCapabilityDeclaration[];
  defaultRuntimeContext: WorkflowRuntimeContext;
  createdFromThreadId: ThreadId | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  archivedAt: IsoDateTime | null;
}
```

Rules:

- `projectId` is required.
- `createdFromThreadId` is provenance only.
- `createdFromThreadId` must not be used as an execution dependency.
- `sourceRevision` increments whenever source changes.
- `declaredCapabilities` describes what the workflow may ask Fenrir Runtime to
  do.

### WorkflowThreadLink

Threads relate to workflows through link rows.

```ts
interface WorkflowThreadLink {
  workflowId: WorkflowId;
  projectId: ProjectId;
  threadId: ThreadId;
  relation: "created_from" | "operator" | "subscriber";
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
```

Relations:

- `created_from`: the thread originated the workflow
- `operator`: the thread can operate the workflow directly from thread UI
- `subscriber`: the thread wants lifecycle/status notifications

A workflow may have zero active thread links after creation. Deleting or
archiving a thread must not delete or stop a workflow.

### WorkflowRun

```ts
interface WorkflowRun {
  runId: WorkflowRunId;
  workflowId: WorkflowId;
  projectId: ProjectId;
  trigger: "manual" | "thread" | "schedule" | "api";
  requestedByThreadId: ThreadId | null;
  scheduleId: WorkflowScheduleId | null;
  args: unknown;
  runtimeContext: WorkflowRuntimeContext;
  sourceHash: string;
  sourceRevision: number;
  memoryRevision: number;
  status: "queued" | "running" | "paused" | "completed" | "failed" | "cancelled" | "interrupted";
  summary: string | null;
  startedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  lastUpdatedAt: IsoDateTime;
}
```

Rules:

- `requestedByThreadId` is optional provenance for thread-triggered runs.
- `trigger = "schedule"` requires `scheduleId`.
- `sourceRevision` and `memoryRevision` record what the run used.
- Runs do not need to be reproducible, but they must be explainable.

## Thread Relationship Model

Threads are clients of workflows.

Threads can:

- create a workflow definition
- update source
- link or unlink themselves
- run a workflow with thread provenance
- respond to `ctx.ui.ask`
- inspect events and memory
- subscribe to lifecycle notifications

Threads cannot:

- be required for a scheduled run to start
- be required for workflow source to remain valid
- own internal workflow agent threads by naming convention
- hide or delete workflow history implicitly

Internal workflow agent threads must use data ownership:

```ts
owner: {
  kind: "workflowAgent";
  workflowId: WorkflowId;
  workflowRunId: WorkflowRunId;
  agentName: string;
  parentThreadId?: ThreadId;
}
```

`parentThreadId` is optional compatibility/provenance. UI hiding must be based
on owner metadata, not titles.

## Run And Trigger Model

Supported trigger kinds:

- `manual`: user starts a run from Workflow Center
- `thread`: user or agent starts a run from a thread
- `schedule`: one-shot schedule starts a run
- `api`: Fenrir API or future automation starts a run

Run lifecycle:

```txt
queued -> running -> paused -> running -> completed
queued -> running -> failed
queued -> running -> cancelled
queued -> running -> interrupted
```

Rules:

- `paused` means the workflow is waiting for user input or an explicit resume
  condition.
- `interrupted` is used when Fenrir/server restarts and v1 cannot resume the
  active run.
- Restart replay is deferred.
- Users can inspect the event log and rerun.

## Fenrir Runtime And Capabilities

Workflow source contract:

```ts
export default async function run(ctx, args) {
  // workflow code
}
```

Fenrir executes workflow source in an isolated runtime. Workflow source must
not import Fenrir internals or use raw runtime access.

Allowed interaction happens through `ctx`.

Initial runtime API:

```ts
ctx.step(...)
ctx.parallel(...)
ctx.log(...)
ctx.notify(...)

ctx.team.agent(...)
agent.ask(...)

ctx.context.build(...)
ctx.memory.list(...)
ctx.memory.remember(...)
ctx.workspace.search(...)
ctx.workspace.readFile(...)
ctx.fs.readFile(...)
ctx.fs.writeFile(...)

ctx.state.get(...)
ctx.state.set(...)
ctx.state.update(...)
ctx.notes.add(...)
ctx.tasks.propose(...)
ctx.tasks.accept(...)
ctx.tasks.reject(...)
ctx.tasks.run(...)
ctx.ui.ask(...)
```

Capability rules:

- all capabilities are declared and enforced by Fenrir Runtime
- all capability calls are event-logged
- `workspace.search`, `workspace.readFile`, workflow state, workflow events,
  workflow memory, workflow task, and workflow agent capabilities are safe
  defaults
- `fs.write` is not a default capability
- raw shell is not a default capability
- raw DB is forbidden
- raw network is forbidden unless a future explicit capability is designed
- raw MCP clients are forbidden in v1
- raw Fenrir module imports are forbidden

The workflow runtime may expose filesystem/workspace APIs directly because the
workflow is a Fenrir runtime program, not an agent transcript. Agents should
not receive hidden direct access to Fenrir internals; they receive prompts,
tools, and run-scoped collaboration tools selected by the workflow/runtime.

## Context Planning And Workflow Memory

Workflow memory is first-class. It is not a transcript dump.

```ts
interface WorkflowMemoryItem {
  memoryId: WorkflowMemoryId;
  workflowId: WorkflowId;
  projectId: ProjectId;
  kind: "repo_fact" | "user_preference" | "failure_pattern" | "prompt_hint" | "context_rule";
  content: string;
  evidenceRunIds: WorkflowRunId[];
  evidenceEventIds: WorkflowEventId[];
  confidence: number;
  status: "active" | "suppressed" | "stale";
  usageCount: number;
  successCount: number;
  lastUsedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
```

Every agent prompt build should be recorded:

```ts
interface WorkflowPromptBuild {
  promptBuildId: WorkflowPromptBuildId;
  runId: WorkflowRunId;
  workflowId: WorkflowId;
  stepId: WorkflowStepId | null;
  agentName: string | null;
  selectedMemoryIds: WorkflowMemoryId[];
  selectedContextRefs: WorkflowContextRef[];
  renderedPrompt: string;
  rationale: string;
  createdAt: IsoDateTime;
}
```

Pipeline:

```txt
workflow events
  -> signals
  -> memory items
  -> context planner
  -> prompt build
  -> agent call
  -> evaluation
```

Memory sources:

- accepted diffs
- rejected diffs
- user corrections
- failed checks
- successful checks
- repeated file selections
- workflow task outcomes
- manual memory entries
- agent notes accepted by workflow policy

Memory rules:

- active memory may be auto-applied to future prompt/context builds
- memory use must be recorded in `WorkflowPromptBuild`
- memory can be suppressed by the user
- suppressed memory must not influence future prompt builds
- confidence should change over time based on evidence
- old or low-value memory can become `stale`

The workflow does not need to produce the same output twice. It should become
more historically informed over time.

## MCP Reference Skill

The `fenrir-workflows` MCP server must include a skill-like tool:

```ts
workflow_reference({
  format?: "markdown" | "json";
  section?: "overview" | "ctx" | "examples" | "capabilities" | "errors";
})
```

The tool returns:

```ts
{
  referenceVersion: string;
  readToken: string;
  expiresAt: string;
  content: string | object;
}
```

Rules:

- agents must call `workflow_reference` before creating or updating workflow
  source
- create/update tools require `referenceVersion` and `readToken`
- tokens are bound to the current MCP session
- tokens expire after 30 minutes
- tokens become invalid when the reference version changes
- errors must instruct the agent to call `workflow_reference`
- agents must not inspect Fenrir source code to learn the workflow runtime API

The reference must document:

- source contract
- every `ctx.*` API
- every capability and default/non-default status
- emitted events
- serialization rules
- examples
- forbidden APIs
- runtime limits
- expected errors and recovery patterns

The reference should be generated from a single registry such as
`WorkflowRuntimeApiReference` / `WorkflowRuntimeApiRegistry`. There must not be
a usable `ctx.*` API that is absent from the MCP reference.

## MCP And Agent Tooling

Management MCP tools:

```ts
workflow_reference(...)
workflow_create(...)
workflow_update(...)
workflow_list_project(...)
workflow_list_thread_links(...)
workflow_link_thread(...)
workflow_unlink_thread(...)
workflow_run(...)
workflow_schedule_run(...)
workflow_cancel_scheduled_run(...)
workflow_get_status(...)
workflow_get_timeline(...)
workflow_get_memory(...)
workflow_suppress_memory(...)
workflow_archive(...)
```

Compatibility aliases may exist temporarily:

```ts
workflow_create_draft(...)
workflow_update_draft(...)
workflow_list_thread_drafts(...)
workflow_archive_draft(...)
```

Aliases must migrate toward the project/workflow model and must not become a
permanent second API.

Collaboration MCP tools for internal workflow agents:

```ts
workflow_state_patch(...)
workflow_add_note(...)
workflow_propose_task(...)
workflow_message_agent(...)
workflow_set_flag(...)
```

Internal workflow agents must not receive management tools by default.

## Public Service APIs

Target service shape:

```ts
createWorkflow(input)
updateWorkflowSource(input)
listProjectWorkflows({ projectId, includeArchived? })
listThreadWorkflowLinks({ projectId, threadId })
linkWorkflowThread({ workflowId, threadId, relation })
unlinkWorkflowThread({ workflowId, threadId })
runWorkflow({ workflowId, args?, trigger?, runtimeContext? })
scheduleWorkflowRun({ workflowId, runAt, args?, runtimeContext? })
cancelScheduledWorkflowRun({ scheduleId })
getWorkflowRun({ runId })
getWorkflowTimeline({ runId })
listWorkflowMemory({ workflowId })
suppressWorkflowMemoryItem({ memoryId })
streamWorkflowEvents()
```

Thread-scoped methods should be removed after migration. Compatibility wrappers
may call the new APIs during the migration window.

## Scheduling

Scheduling v1 supports one-shot `runAt`.

```ts
interface WorkflowSchedule {
  scheduleId: WorkflowScheduleId;
  workflowId: WorkflowId;
  projectId: ProjectId;
  runAt: IsoDateTime;
  args: unknown;
  runtimeContext: WorkflowRuntimeContext;
  status: "scheduled" | "claimed" | "started" | "cancelled" | "failed";
  createdByThreadId: ThreadId | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
```

Rules:

- schedules survive restart
- due schedules are claimed before starting a run
- a claimed schedule should either start exactly once or become inspectably
  failed
- recurring schedules are deferred

## Workflow Center UI

Workflow Center is the primary UI for workflows.

Project-level views:

- workflow list
- active runs
- historical runs
- schedules
- memory
- prompt builds
- capability declarations
- source open/edit
- run, schedule, stop, archive
- timeline/events

Thread UI is contextual:

- linked workflows only
- link/unlink controls
- run from this thread
- latest relevant run
- pending input badge
- lifecycle anchors in chat only when useful

The chat timeline is not the workflow console.

## Persistence And Migration Plan

Create a migration after `039_Workflows`.

Add tables:

```txt
workflow_thread_links
workflow_schedules
workflow_memory_items
workflow_prompt_builds
```

Modify existing tables:

- `workflows.origin_thread_id` becomes `created_from_thread_id`
- `workflows.source_revision` is added
- `workflows.declared_capabilities_json` is added
- `workflows.default_runtime_context_json` is added
- `workflow_runs.trigger` is added
- `workflow_runs.requested_by_thread_id` is added
- `workflow_runs.schedule_id` is added
- `workflow_runs.runtime_context_json` is added
- `workflow_runs.source_revision` is added
- `workflow_runs.memory_revision` is added

Migration behavior:

- for each existing workflow, copy old `origin_thread_id` into
  `created_from_thread_id`
- create a `workflow_thread_links` row with `relation = "created_from"`
- for each existing run, set `trigger = "thread"` and
  `requested_by_thread_id = old origin_thread_id`
- keep history inspectable
- remove public reliance on `originThreadId`

No permanent dual mode.

## Implementation Phases

1. Rewrite this briefing as the canonical source of truth.
2. Add `workflow_reference` registry/tool and read-token gating.
3. Update contracts in `packages/contracts/src/workflows.ts`.
4. Add persistence migration and repository methods.
5. Refactor `WorkflowService` away from required `originThreadId`.
6. Update runtime agent creation so internal agents do not require an origin
   thread.
7. Add one-shot `runAt` scheduling.
8. Add memory extraction, prompt builds, and auto-applied context planning.
9. Add controlled runtime capabilities.
10. Build Workflow Center and update web store/selectors.
11. Remove old thread-scoped workflow assumptions and tests.

## Test Plan

Required scenarios:

- `workflow_reference` markdown and JSON include every registered `ctx.*` API
- `workflow_create` and `workflow_update` fail without `workflow_reference`
- stale, expired, or cross-session reference tokens fail
- workflow can be created from a thread and linked via `created_from`
- workflow can run from Workflow Center with no active thread
- thread-triggered run records `requestedByThreadId`
- scheduled `runAt` survives restart and starts once
- memory item from one run influences the next prompt build
- suppressed memory item is not used
- prompt build records selected memory, context, and rationale
- internal workflow agent threads remain hidden by ownership metadata
- event log records capability calls, state changes, prompt builds, memory use,
  and run lifecycle

Required repo checks before considering implementation tasks complete:

```bash
bun fmt
bun lint
bun typecheck
bun run test
```

Never run `bun test`; use `bun run test`.

## Deferred Work

- cron or interval recurring schedules
- deterministic replay
- resumable runs after restart
- direct raw network capability
- direct raw shell capability
- project-shareable workflow templates
- PlanRunner replacement layer
- migration from `.plans` to workflow templates

## Non-Negotiables

- Workflows are project/Fenrir resources, not thread-owned objects.
- Threads are workflow clients.
- Fenrir Runtime owns capabilities, event logging, scheduling, memory, and
  context planning.
- Agents do not get hidden direct access to Fenrir internals.
- Every external-world workflow action goes through a documented capability.
- Every capability call, prompt build, memory use, and state mutation is
  traceable.
- MCP workflow source creation/update must be preceded by `workflow_reference`.
- The MCP reference is part of the public workflow contract.
- No raw DB, raw shell, raw network, raw Fenrir imports, or unrestricted
  filesystem access from workflow source by default.
