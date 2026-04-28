# Plan Runner Module

UI for discovering `.plans/` folders, browsing plan content, launching runs, monitoring progress, and cancelling runs.

## Public API

| Export                     | Kind          | Purpose                                           |
| -------------------------- | ------------- | ------------------------------------------------- |
| `usePlanRunnerStore`       | Zustand store | Feature lists, run snapshots, plan content cache  |
| `usePlanRunnerLifecycle`   | Hook          | Mount-level WS subscription + active run fetch    |
| `PlanRunnerProjectSection` | Component     | Per-project sidebar section showing features      |
| `PlanRunnerRunView`        | Component     | Full run detail page (route component)            |
| `PlanRunnerPlanPreview`    | Component     | Read-only plan markdown preview (route component) |

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
