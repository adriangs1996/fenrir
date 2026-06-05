# Plan Runner Module

UI for discovering `.plans/` folders, browsing plan content, launching runs, monitoring progress, and cancelling runs.

## Public API

| Export                              | Kind          | Purpose                                           |
| ----------------------------------- | ------------- | ------------------------------------------------- |
| `usePlanRunnerStore`                | Zustand store | Feature lists, run snapshots, plan content cache  |
| `useInternalPlanRunnerThreadIds`    | Hook          | `Set<ThreadId>` of hidden internal threads        |
| `useInternalPlanRunnerThreadOwners` | Hook          | `Map<ThreadId, PlanRunId>` for redirect lookup    |
| `selectInternalThreadIds`           | Selector      | Pure derivation from a `runById` snapshot map     |
| `selectRunIdByInternalThreadId`     | Selector      | Pure derivation from a `runById` snapshot map     |
| `usePlanRunnerLifecycle`            | Hook          | Mount-level WS subscription + active run fetch    |
| `PlanRunnerProjectSection`          | Component     | Per-project sidebar section showing features      |
| `PlanRunnerRunView`                 | Component     | Full run detail page (route component)            |
| `PlanRunnerPlanPreview`             | Component     | Read-only plan markdown preview (route component) |
| `archiveFeature` action             | Store action  | Optimistic remove + RPC archive                   |
| `unarchiveFeature` action           | Store action  | RPC unarchive + watcher refresh                   |
| `archivedFeaturesByProjectId`       | Selector      | `Record<ProjectId, ArchivedFeatureSummary[]>`     |

## Archived Plans UI

`ArchivedPlansPanel` lives in `@/components/settings/SettingsPanels.tsx`, not
inside the plan-runner module folder, but consumes `usePlanRunnerStore` for
the `archivedFeaturesByProjectId` selector and `archiveFeature` /
`unarchiveFeature` / `fetchArchivedFeatures` actions.

## Hidden-Thread Policy

Plan-runner spawns **executor** threads as internal implementation details.
Legacy runs may also contain analyzer or integration thread refs. They are
persisted in the orchestration store so logs can be reconstructed, but they
must NEVER appear in user-browsable surfaces.

Concretely:

- The `useInternalPlanRunnerThreadIds()` hook derives the hidden set from
  `runById` step snapshots (`steps[].threadRefs`). Derivation is strictly
  data-driven — title heuristics or naming conventions are NOT used.
- `Sidebar.tsx` filters internal threads out of every project list, count,
  preview, sort, and grouping computation.
- `SettingsPanels.tsx` (`ArchivedThreadsPanel`) hides internal threads even if
  `archivedAt` is set.
- `_chat.$environmentId.$threadId.tsx` blocks direct route access: if the
  target thread id is in the hidden set, the route redirects to the owning
  plan-runner run view. If ownership cannot be resolved, it falls back to the
  generic not-available behavior (route home) — never exposes the thread.

When adding a new surface that lists or links to threads, apply the same
filter using `useInternalPlanRunnerThreadIds()`. Do not bypass this gate.

## Dependencies

- `@fenrir/contracts` — schemas, types, WS method constants
- `zustand` — state management
- `react`, `@tanstack/react-router` — UI + routing
- `@/rpc/wsRpcClient` — RPC transport (via `getPrimaryEnvironmentConnection`)
- `@/components/ChatMarkdown` — markdown rendering
- `@/hooks/useHandleNewThread` — thread creation with `initialPrompt`

## Integration Points

- **Upstream**: `_chat.tsx` calls `usePlanRunnerLifecycle()` on mount
- **Upstream**: `Sidebar.tsx` renders `PlanRunnerProjectSection` under each project
- **Routes**: `_chat.plan-runner.$runId.tsx`, `_chat.plan-runner.$featureName.$planId.tsx`
- **Downstream**: WebSocket RPC to server `PlanRunnerService`

## Error Handling

- Missing `.plans/` directory: section shows empty state, no error
- WS subscription: auto-reconnects via transport layer
- Stale events for unknown runs: silently ignored (no-op in reducer)
