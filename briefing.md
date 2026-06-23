# Fenrir Workflows Briefing

This briefing captures the shared understanding and implementation plan for
Fenrir's new `workflows` feature. Use it as the reference document while
implementing the module.

## Goal

Build a new `workflows` module, parallel to `plan-runner`, that lets the active
chat agent create thread-scoped workflow drafts and lets users or agents run
those workflows as background work.

Workflows are JavaScript artifacts executed by Fenrir. They orchestrate named
agents, compose prompts, maintain live run state, ask the user for input when
needed, and expose progress through a thread-scoped workflow side panel.

The long-term direction is for workflows to become the general substrate that
eventually replaces `.plans` and `PlanRunner`, but `PlanRunner` should remain
stable while `workflows` matures.

## Research Summary

Claude Code has two relevant concepts:

- Code mode: use executable code as an orchestration surface so the system can
  loop, branch, filter intermediate data, and avoid forcing every result into
  the model context.
- Workflows: JavaScript scripts orchestrate background work and subagents. The
  script owns control flow, while agents do actual task work. Claude's default
  lifecycle is closer to generate, approve, run, and optionally save.

Fenrir intentionally diverges for v1:

- Generated workflows are reviewed drafts first.
- Drafts are local Fenrir artifacts tied to a chat thread.
- Workflow source is stable for a run; workflow run state is live.
- Execution is background and visible through a side panel, not the chat
  timeline.

References:

- https://www.anthropic.com/engineering/code-execution-with-mcp
- https://code.claude.com/docs/en/workflows

## Core Product Decisions

- The feature is named `workflows`, not `workflow-runner`.
- Workflows are a new module, not an extension of `plan-runner`.
- Workflows are a durable run type, not a provider `interactionMode`.
- Workflow drafts are created from the current conversation by the active chat
  agent through structured Fenrir MCP tools.
- Draft creation writes a reviewed draft artifact and stops. It does not run
  automatically.
- Thread-scoped generated workflows are Fenrir-local artifacts, not repo
  commit artifacts.
- Project-shareable workflows can come later through an explicit export action.
- The workflow source is stored in Fenrir state or DB, not under the project
  root.
- Opening a workflow materializes a Fenrir-managed temp-like file for editor
  integration.
- The temp file auto-syncs back to the DB on save or debounce.
- DB source is canonical. Execution snapshots DB source at run start.
- Workflows run in the background. The main chat thread remains usable.
- Workflow UI is scoped to the origin thread, but run lifecycle is independent
  of the route being mounted.
- Multiple workflows can run for the same thread.
- The composer shows a workflow affordance when the current thread has drafts,
  active runs, completed runs, or pending workflow input.

## Thread Ownership Model

Each workflow draft and run has:

- `projectId`
- `originThreadId`
- stable workflow IDs
- local source
- validation status
- run history

Thread-scoped ownership means:

- the current chat thread can discover its workflow drafts and runs quickly
  from Fenrir state
- the workflow composer button and side panel only show workflows for the
  current thread
- archiving a parent thread does not stop workflows
- deleting a parent thread should block or require confirmation while workflows
  are active

Thread ownership is local app state. It should not be committed to the project.

## Chat And UI Model

The chat timeline is not the workflow console.

The chat can contain compact lifecycle anchors:

- workflow draft created
- workflow run started
- workflow needs input
- workflow completed or failed

Live workflow execution belongs in a side panel or activity drawer scoped to
the current chat thread.

Composer behavior:

- If the thread has no workflows, no workflow button is shown.
- If the thread has one runnable workflow, the button can offer run/open.
- If the thread has multiple workflows, the button opens a picker sorted by
  recency with the latest selected.
- If workflows are active, the button shows status or count and opens the side
  panel.
- If a workflow is paused for input, the button shows a needs-input badge.

Side panel shape:

- Drafts
- Running runs
- Paused runs requiring input
- Completed and failed history
- Timeline of workflow events
- Steps
- Named team agents
- Task proposals
- Shared state and notes
- Run actions: run, stop, rerun, open source, open details

`ctx.ui.ask` pauses the workflow and surfaces pending input in the side panel
and composer badge. It does not inject a normal chat message by default.

## Agent-Initiated Workflow Operations

The active chat agent can create and run workflows through Fenrir MCP tools.

Use a Fenrir-native action surface. Do not rely on brittle assistant text
scraping.

Initial management tools:

```ts
workflow_create_draft({ name, description?, source })
workflow_list_thread_drafts({})
workflow_run({ workflowId?, args? })
workflow_get_status({ workflowRunId })
workflow_stop({ workflowRunId })
```

The server derives sensitive context:

- `projectId`
- `originThreadId`
- user/session identity

The agent should not be trusted to provide ownership IDs.

For v1, `workflow_run` runs immediately. No confirmation gate yet.

If `workflowId` is omitted, run the latest runnable workflow for the current
thread.

## Runnable Workflow Definition

A workflow is runnable only when it is validated and importable.

Minimum validation:

- source exists
- source length is under a sane cap
- has name and description from tool input or metadata
- exports a default async function
- passes a cheap compile/import check in the workflow sandbox
- no obvious forbidden v1 APIs or imports, such as:
  - `fs`
  - `child_process`
  - `net`
  - `http`
  - raw `fetch`
  - `Bun.spawn`
  - raw Fenrir module imports

Validation is not perfect security. It is a preflight quality and safety gate.
The real runtime must still be isolated and capability-based.

## Workflow Source Contract

Workflow source should be simple JavaScript:

```js
/**
 * @fenrir-workflow
 * name: Review And Implement Auth Cleanup
 * description: Convert this conversation into a review, plan, implement, verify flow.
 */

export default async function run(ctx, args) {
  const planner = ctx.team.agent("planner", {
    role: "Own planning, task routing, and risk discovery.",
  });

  const implementer = ctx.team.agent("implementer", {
    role: "Implement accepted tasks and report blockers.",
  });

  const plan = await ctx.step("plan", () =>
    planner.ask("Create a plan from the current conversation."),
  );

  await ctx.step("implement", () => implementer.ask(`Implement this plan:\n${plan.text}`));
}
```

Metadata is useful for display and review. DB state remains authoritative for
ownership and source status.

## Live Workflow Model

The workflow source is stable. The workflow run state is live.

Do not make self-modifying workflow source the core model. Agents should not
rewrite the executing workflow file mid-run.

Instead:

- the source defines the rules of the game
- run state is mutable and auditable
- named agents are persistent hidden threads
- agents communicate through workflow-mediated events and tools
- agents can add notes, scoped state, and task proposals
- workflow JS decides which mutations affect control flow

This allows dynamic behavior without losing auditability:

- optional steps
- dynamic research branches
- planner-updated context
- implementer feedback back to planner
- visible state changes
- task proposals that are accepted or rejected by workflow policy

## Runtime Model

Run workflow JS in an isolated worker or VM for v1, architected so it can move
to a separate OS process later.

Do not run workflow JS in the main server process with only restricted globals.

Runtime rules:

- frozen source snapshot at run start
- explicit capability-based `ctx`
- no raw imports of Fenrir modules
- no direct filesystem, shell, network, raw DB, raw UI, or raw MCP access
- workflow JS only receives serializable `args`
- workflow JS talks to Fenrir through `ctx`
- restart replay is not part of v1
- if Fenrir/server restarts mid-run, mark active runs `interrupted`
- users can inspect logs and rerun from the beginning

`ctx.step` is a runtime, control, and UI boundary in v1. It does not need to be
a replay boundary yet.

## V1 Workflow Context API

Initial capability surface:

```ts
ctx.step(id, fn)
ctx.parallel(items, mapper, { concurrency? })
ctx.log(messageOrEvent)
ctx.notify({ level, title, body? })

ctx.team.agent(name, {
  role,
  modelSelection?,
  runtimeMode?,
  mcpServerIds?,
})

agent.ask(promptOrInput)

ctx.ui.ask(inputRequest)

ctx.state.get(key)
ctx.state.set(key, value)
ctx.state.update(key, updater)

ctx.notes.add({ title?, body, visibility? })

ctx.tasks.propose(task)
ctx.tasks.list(filter?)
ctx.tasks.accept(taskId)
ctx.tasks.reject(taskId, reason?)
ctx.tasks.run(taskId)
```

Do not expose in v1:

```ts
ctx.exec(...)
ctx.readFile(...)
ctx.writeFile(...)
ctx.fetch(...)
ctx.db.query(...)
ctx.renderReact(...)
ctx.rawMcpClient(...)
ctx.orchestrationEngine.dispatch(...)
```

MCP in v1:

- workflow JS can pass `mcpServerIds` to agents
- workflow JS can list available servers if needed
- workflow JS should not call arbitrary MCP tools directly in v1

## Team Agents

`ctx.team.agent(name, options)` creates or reuses one named hidden internal
thread for the workflow run.

Named agents are persistent for the run. Later turns preserve their own
provider context.

Default behavior:

- project inherited from the parent thread
- model/runtime inherited unless overridden
- hidden internal orchestration thread
- ownership metadata includes workflow run and agent name
- logs are projected into the workflow side panel
- internal agent threads are hidden from normal thread lists

Agents should act like a team, but communication is mediated by the workflow
runtime. Avoid raw peer-to-peer autonomous chatter in v1.

Recommended team flow:

```js
const planner = ctx.team.agent("planner", {
  role: "Own planning and task routing.",
});

const researcher = ctx.team.agent("researcher", {
  role: "Research libraries and ecosystem details.",
});

const implementer = ctx.team.agent("implementer", {
  role: "Apply code changes from accepted plans.",
});

const plan = await ctx.step("plan", () =>
  planner.ask("Create the initial plan and propose extra research tasks if needed."),
);

const tasks = await ctx.tasks.list({ status: "proposed" });

for (const task of tasks) {
  if (task.kind === "research") {
    await ctx.tasks.accept(task.id);
    await ctx.tasks.run(task.id);
  }
}
```

## Workflow Agent Tools

Internal workflow agents must not receive workflow management tools in v1:

- no `workflow_create_draft`
- no `workflow_run`
- no `workflow_stop`
- no `workflow_delete`

They can receive run-scoped collaboration tools controlled by the workflow
runtime:

```ts
workflow_state_patch({ patch })
workflow_add_note({ title?, body })
workflow_propose_task({ title, reason, kind, assignee?, prompt })
workflow_message_agent({ to, message })
workflow_set_flag({ key, value })
```

Control-flow changes should not be directly applied by agents. Agents can
mutate scoped notes/state and propose tasks. The workflow JS accepts, rejects,
or runs tasks according to its policy.

## Task Proposals

Task proposals are part of v1.

Agents propose tasks; workflow JS accepts, rejects, or runs them.

Example:

```js
const proposals = await ctx.tasks.list({ status: "proposed" });

for (const task of proposals) {
  if (task.kind === "research") {
    await ctx.tasks.accept(task.id);
    await ctx.tasks.run(task.id);
  } else if (task.kind === "implementation") {
    const answer = await ctx.ui.ask({
      title: "Accept implementation-expanding task?",
      fields: [
        {
          type: "confirm",
          name: "accept",
          label: task.title,
        },
      ],
    });

    if (answer.accept) {
      await ctx.tasks.accept(task.id);
      await ctx.tasks.run(task.id);
    } else {
      await ctx.tasks.reject(task.id, "User declined.");
    }
  }
}
```

Default generated workflow policy:

- auto-accept research and analysis tasks
- ask the user before accepting implementation-expanding tasks

## Timeline And Auditability

Collaboration and state mutations are first-class timeline events in the side
panel.

Examples:

- Planner proposed research task
- Workflow accepted task
- Researcher completed research
- Planner updated shared context
- Workflow unblocked implementation step
- Workflow paused for user input
- User accepted/rejected task

Every state mutation should have provenance:

- run ID
- step ID if applicable
- agent name if applicable
- event type
- payload
- timestamp

## Codebase Fit

Existing relevant architecture:

- Provider abstractions are centralized under `apps/server/src/provider`.
- Provider adapters should avoid cross-provider orchestration concerns.
- `ProviderSendTurnInput` already carries prompt text, attachments, model
  selection, and interaction mode.
- `PlanRunner` already demonstrates durable runs, hidden internal threads,
  run events, step logs, cancellation, and recovery.
- `workflows` should reuse the same architectural style, not the same module.

Key files to study:

- `apps/server/src/provider/Services/ProviderAdapter.ts`
- `apps/server/src/provider/Layers/ProviderService.ts`
- `packages/contracts/src/provider.ts`
- `packages/contracts/src/orchestration.ts`
- `apps/server/src/plan-runner/MODULE.md`
- `apps/server/src/plan-runner/Layers/PlanRunner.ts`
- `apps/server/src/persistence/Services/PlanRunnerRepository.ts`
- `apps/web/src/modules/plan-runner/MODULE.md`

## Implementation Module Layout

Recommended names:

- `packages/contracts/src/workflows.ts`
- `apps/server/src/workflows/`
- `apps/web/src/modules/workflows/`
- RPC domain: `workflows.*`
- service: `WorkflowService`
- UI label: `Workflows`

Recommended DB tables:

- `workflows`
- `workflow_runs`
- `workflow_steps`
- `workflow_agents`
- `workflow_events`
- `workflow_state`
- `workflow_tasks`

## Contracts

Add `packages/contracts/src/workflows.ts`.

Core IDs:

- `WorkflowId`
- `WorkflowRunId`
- `WorkflowStepId`
- `WorkflowAgentId`
- `WorkflowTaskId`
- `WorkflowEventId`
- `WorkflowInputRequestId`

Draft state:

- `draft`
- `validated`
- `invalid`
- `archived`

Run state:

- `running`
- `paused`
- `completed`
- `failed`
- `cancelled`
- `interrupted`

Step state:

- `pending`
- `running`
- `completed`
- `failed`
- `skipped`

Task state:

- `proposed`
- `accepted`
- `rejected`
- `running`
- `completed`
- `failed`

Agent state:

- `idle`
- `running`
- `waiting`
- `failed`
- `stopped`

Event kinds should cover:

- draft created
- source opened
- source synced
- validation changed
- run started
- run paused
- run resumed
- run completed
- run failed
- step started
- step completed
- step failed
- agent created
- agent message sent
- agent message completed
- state updated
- note added
- task proposed
- task accepted
- task rejected
- task started
- task completed
- user input requested
- user input resolved
- notification emitted

## Server Service API

Create `apps/server/src/workflows/Services/Workflow.ts` and
`apps/server/src/workflows/Layers/Workflow.ts`.

Initial service shape:

```ts
createDraft(input);
listThreadWorkflows(input);
openDraftSource(input);
syncDraftSource(input);
validateDraft(input);
run(input);
stop(input);
respondToInput(input);
getRun(input);
getTimeline(input);
streamEvents;
```

Important behavior:

- `createDraft` stores source locally and validates it.
- `listThreadWorkflows` is fast and DB-backed.
- `openDraftSource` materializes/syncs a Fenrir-managed file.
- `run` snapshots source and args.
- `run` creates a `workflow_run` row and starts isolated execution.
- `stop` cancels runtime and active hidden agent turns where possible.
- `respondToInput` resumes a paused `ctx.ui.ask`.
- `streamEvents` powers side panel and composer badges.

## Persistence Plan

Create a new migration after the current latest migration.

Tables:

### `workflows`

- `workflow_id`
- `project_id`
- `origin_thread_id`
- `name`
- `description`
- `source`
- `source_hash`
- `validation_status`
- `validation_error`
- `created_at`
- `updated_at`
- `archived_at`

### `workflow_runs`

- `run_id`
- `workflow_id`
- `project_id`
- `origin_thread_id`
- `name`
- `args_json`
- `source_snapshot`
- `source_hash`
- `status`
- `summary`
- `started_at`
- `completed_at`
- `last_updated_at`

### `workflow_steps`

- `run_id`
- `step_id`
- `step_key`
- `status`
- `started_at`
- `completed_at`
- `result_json`
- `error`
- `sequence`

### `workflow_agents`

- `run_id`
- `agent_id`
- `name`
- `role`
- `thread_id`
- `status`
- `created_at`
- `updated_at`

### `workflow_events`

- `event_id`
- `run_id`
- `workflow_id`
- `step_id`
- `agent_id`
- `task_id`
- `kind`
- `title`
- `body`
- `payload_json`
- `created_at`
- `sequence`

### `workflow_state`

- `run_id`
- `scope`
- `key`
- `value_json`
- `updated_at`

### `workflow_tasks`

- `task_id`
- `run_id`
- `title`
- `reason`
- `kind`
- `assignee`
- `prompt`
- `status`
- `created_by_agent_id`
- `created_at`
- `updated_at`
- `result_json`
- `error`

Create `WorkflowRepository` following the pattern of `PlanRunnerRepository`.

## Web Module

Create `apps/web/src/modules/workflows/`.

Suggested pieces:

- store
- selectors for current thread workflows
- lifecycle subscription hook
- composer button component
- workflow picker
- side panel
- timeline component
- task proposal component
- input request component
- source open/sync hooks

Composer button rules:

- hidden when no thread workflows or runs exist
- opens picker when multiple drafts exist
- opens side panel when active or paused runs exist
- shows needs-input badge when any run is paused for input

Side panel should be the main workflow UI.

## Integration With Hidden Threads

Workflow internal agent threads need the same hiding discipline as PlanRunner
internal threads.

Add a data-driven way for the web app to derive hidden workflow thread IDs from
workflow run snapshots or workflow event state.

Do not hide by title heuristics.

Surfaces that list threads must filter workflow internal thread IDs:

- sidebar active threads
- archive settings
- direct thread routes
- counts/previews

If a user navigates directly to a workflow internal thread, redirect to the
owning workflow run detail or side panel.

## Implementation Phases

1. Contracts, RPC names, and schema tests.
2. DB migration and `WorkflowRepository` tests.
3. Server `WorkflowService` for draft create/list/open/sync/validate.
4. Web store, subscription plumbing, composer button, empty side panel.
5. Fenrir MCP tools for `workflow_create_draft`, list, run, status, stop.
6. Isolated JS runtime with `ctx.step`, `ctx.log`, and basic lifecycle.
7. `ctx.team.agent` and hidden internal agent threads.
8. Timeline projection of agent messages, step lifecycle, logs, notifications.
9. Live state and notes APIs.
10. Task proposal APIs and `ctx.ui.ask` pause/resume flow.
11. Stop/cancel behavior and interrupted-on-restart handling.
12. Validation hardening and UX polish.

## Test Plan

Required tests:

- contract schema tests
- migration tests
- repository create/list/update tests
- draft create/list tests
- source open/sync tests
- validation/import tests
- MCP tool tests
- runtime ctx tests
- hidden agent ownership tests
- workflow event stream tests
- web store reducer tests
- composer visibility tests
- picker behavior tests
- side panel event rendering tests
- input request pause/resume tests
- task proposal accept/reject/run tests

Per repo rules, before implementation tasks are considered complete:

- `bun fmt`
- `bun lint`
- `bun typecheck`

Do not run `bun test`; use `bun run test` for Vitest when tests are needed.

## Deferred For Later

- Project-shareable workflow templates.
- Export thread-scoped workflow as reusable project template.
- Full replay/resume from completed steps.
- Separate OS-process runtime instead of worker/VM.
- Direct workflow-level MCP tool calls.
- Rich custom UI rendering.
- PlanRunner compatibility layer on top of workflows.
- Migration path from `.plans` to workflow templates.
- Confirmation policy for agent-initiated `workflow_run`.

## Non-Negotiables

- Keep provider abstractions provider-agnostic.
- Workflow orchestration belongs above provider adapters.
- No raw DB, raw UI, raw fs, raw shell, raw network, or raw MCP from workflow
  JS in v1.
- Workflow source is stable during a run.
- Workflow run state is live, mutable, and auditable.
- Internal workflow agent threads are hidden by data ownership, not naming.
- The side panel is the workflow console; chat remains usable.
- The DB/source registry is authoritative for thread ownership.
