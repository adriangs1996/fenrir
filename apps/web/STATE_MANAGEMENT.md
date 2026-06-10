# State Management

All paths below are relative to `apps/web/`.

The web app uses three state layers plus React component state:

1. **Zustand** for client state shared across components (orchestration read model, UI state, drafts, module state).
2. **TanStack React Query** for request/response server reads and mutations (git, diffs, providers, projects).
3. **Effect Atom** (`@effect/atom-react` + `Atom` from `effect/unstable/reactivity`) for push-driven state fed by WS streams or imperative writers (connection status, server config, git status).

Rule of thumb: data that arrives as events/streams lands in zustand or an Atom; data fetched on demand goes through React Query.

## Zustand stores

### App store (orchestration read model)

`src/store.ts` exports `useStore`, the largest store. It holds the per-environment orchestration read model: an `AppState` of `activeEnvironmentId` plus `environmentStateById`. Each `EnvironmentState` (defined in `src/appStore/state.ts`) owns projects, thread ids/shells/sessions/turn state, chat messages, activities, proposed plans, turn diff summaries, sidebar thread summaries, managed process instances, and a `bootstrapComplete` flag.

Internals are split under `src/appStore/`:

- `state.ts` — `AppState`/`EnvironmentState` shapes, `initialState`, `getStoredEnvironmentState`, `commitEnvironmentState`.
- `mappers.ts` — maps orchestration contracts to UI types (`mapProject`, `mapThread`, `setThreadDetailsHydrated`).
- `environmentState.ts` — pure writers (`syncEnvironmentReadModel`, `syncEnvironmentShellSnapshot`, `applyEnvironmentShellEvent`, `updateThreadState`, ...).
- `orchestrationEvents.ts` — the event reducer `applyEnvironmentOrchestrationEvent`.
- `selectors.ts` — selectors re-exported from `src/store.ts` (`selectEnvironmentState`, `selectThreadsForEnvironment`, `selectSidebarThreadsAcrossEnvironments`, `selectThreadByRef`, `selectManagedProcessInstancesForProject`, ...).

Store actions are thin wrappers over the pure functions: `syncServerBootstrapSnapshot`, `syncServerReadModel`, `syncThreadSnapshot`, `applyShellEvent`, `applyOrchestrationEvent(s)`, `setActiveEnvironmentId`, `setThreadBranch`, `setError`. They are driven by the WS client as snapshots/events arrive.

### Other stores

| File                                                        | Hook / export                                                                                  | Owns                                                                                                                                                                                                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/composerDraftStore.ts`                                 | `useComposerDraftStore` (persisted via `zustand/middleware` `persist`)                         | Per-thread and per-draft composer state: text, image attachments, model/provider selection, draft threads. Helpers: `useComposerDraftModelState`, `finalizePromotedDraftThreadsByRef`; types/persistence live in `src/composerDraft/`. |
| `src/uiStateStore.ts`                                       | `useUiStateStore` (custom debounced localStorage persistence, key `fenrir:ui-state:v1`)        | Sidebar/project UI prefs: expanded projects, project drawer view, project order, thread changed-files expansion, plan-runner folder expansion.                                                                                         |
| `src/commandPaletteStore.ts`                                | `useCommandPaletteStore`                                                                       | Command palette open state and open intent (e.g. add-project).                                                                                                                                                                         |
| `src/rightPanelStore.ts`                                    | `useRightPanelStore`                                                                           | Active right panel tab (`"plan" \| "diff"`) or closed.                                                                                                                                                                                 |
| `src/threadSelectionStore.ts`                               | `useThreadSelectionStore`                                                                      | Sidebar thread multi-selection (toggle, shift-range, anchor).                                                                                                                                                                          |
| `src/rawTcpStore.ts`                                        | `useRawTcpStore`                                                                               | Raw TCP listeners, sessions, session output buffers, active session.                                                                                                                                                                   |
| `src/remoteControllerStore.ts`                              | `useRemoteControllerStore`                                                                     | Remote hosts, connections, command runs, selected host.                                                                                                                                                                                |
| `src/metasploitSessionTerminalStore.ts`                     | `useMetasploitSessionTerminalStore`                                                            | Bounded output buffer for Metasploit session terminals.                                                                                                                                                                                |
| `src/environments/primary/context.ts`                       | private store; consumed via `usePrimaryEnvironmentId`, `readPrimaryEnvironmentDescriptor`, ... | Primary environment bootstrap descriptor.                                                                                                                                                                                              |
| `src/environments/runtime/catalog.ts`                       | `useSavedEnvironmentRegistryStore`                                                             | Saved environment records; persisted through the LocalApi `persistence` RPC, not localStorage.                                                                                                                                         |
| `src/modules/terminal/stores/terminalState.ts`              | `useTerminalStateStore` (persisted, versioned migration)                                       | Terminal UI state keyed by scoped thread (terminal groups, heights, running subprocesses).                                                                                                                                             |
| `src/modules/action-runs/actionRunStore.ts`                 | `useActionRunStore` (persisted)                                                                | Action runs (status, source, per-thread keys) for the action run center.                                                                                                                                                               |
| `src/modules/neovim-editor/stores/editorStore.ts`           | `useEditorStore` (persisted)                                                                   | Active chat tab (`thread/gitdiff/terminal/editor`) and current nvim buffer file.                                                                                                                                                       |
| `src/modules/plan-runner/stores/usePlanRunnerStore.ts`      | `usePlanRunnerStore`                                                                           | Plan runs, step snapshots, step log caches, feature/plan summaries.                                                                                                                                                                    |
| `src/modules/traffic-lens/stores/useTrafficLensStore.ts`    | `useTrafficLensStore`                                                                          | Traffic Lens entries, rules, overrides, paused requests, storage panel state.                                                                                                                                                          |
| `src/modules/reverse-shells/stores/terminalHandlerStore.ts` | `terminalHandlerStore` (vanilla `createStore`, not a hook)                                     | Imperative xterm.js terminal mount/lifecycle handler.                                                                                                                                                                                  |

## React Query

The `QueryClient` is created in `src/router.ts` with default options (`new QueryClient()`) and provided via `QueryClientProvider` plus TanStack Router context. There are no global default overrides; `staleTime` is set per query where needed.

### `src/hooks/useRpc.ts` — the RPC access layer

Centralizes the read-api/null-check/try-catch/toast boilerplate around `EnvironmentApi` / `LocalApi`:

- `runEnvironmentRpc(environmentId, run, options)` — mutations and one-shot calls against an environment-scoped API. Resolves to `undefined` when the environment is not connected (optionally toasting via `options.unavailableToast`) or when the call failed with an `errorToast` configured.
- `runLocalRpc(run, options)` — same semantics against the `LocalApi` (primary connection).
- `useEnvironmentRpcQuery({ environmentId, queryKey, queryFn, enabled, staleTime })` — React Query wrapper for environment-scoped reads; disabled until `environmentId` is set, and a missing connection throws so the read recovers via retries after reconnects.
- `environmentRpcQueryFn(environmentId, queryFn)` — builds the same `queryFn` for imperative `prefetchQuery` calls.
- `rpcErrorMessage(error, fallback)` — normalizes unknown errors to user-visible text.

Use `runEnvironmentRpc` when the call targets a specific environment (most orchestration/git/provider calls); use `runLocalRpc` for machine-local APIs such as persistence and diagnostics. Streaming subscriptions and optimistic flows intentionally bypass these helpers.

### `src/lib/*ReactQuery.ts` modules

Each module owns query keys plus `queryOptions`/`mutationOptions` factories for one domain:

- `gitReactQuery.ts` — git/VCS operations: `gitQueryKeys`, `gitMutationKeys`, `invalidateGitQueries`, `vcsRefSearchInfiniteQueryOptions`, `vcsSwitchRefMutationOptions`, `vcsPullMutationOptions`, worktree create/remove, `gitPreparePullRequestThreadMutationOptions`, ...
- `gitDiffReactQuery.ts` — diff workbench: `gitDiffQueryKeys`, file index/file content query options (worktree, staged, stacked), change request checks/review threads, ignore lists, stage/close/merge/comment/revert mutations, `invalidateGitDiffQueries`.
- `sourceControlStackReactQuery.ts` — stacked-change snapshots and mutations: `sourceControlStackSnapshotQueryOptions`, `sourceControlStackMutationOptions`, `invalidateSourceControlStackQueries`.
- `providerReactQuery.ts` — checkpoint/turn diff reads: `providerQueryKeys`, `checkpointDiffQueryOptions`.
- `providerSkillsReactQuery.ts` — provider skill listing: `providerSkillsQueryOptions`.
- `projectReactQuery.ts` — project file search entries: `projectSearchEntriesQueryOptions`.
- `desktopUpdateReactQuery.ts` — desktop updater state: `desktopUpdateStateQueryOptions`, `useDesktopUpdateState`, `setDesktopUpdateStateQueryData`.

## Effect Atom

A single global registry lives in `src/rpc/atomRegistry.tsx` (`appAtomRegistry`, provided to React via `AppAtomRegistryProvider` in `src/router.ts`). Atoms are written imperatively (often from the WS client) and read with `useAtomValue`. Used for state that is pushed rather than fetched:

- `src/rpc/serverState.ts` — server config/settings/providers: `useServerConfig`, `useServerSettings`, `useServerProviders`, `useServerKeybindings`, welcome/config-updated subscriptions.
- `src/rpc/wsConnectionState.ts` — `wsConnectionStatusAtom`, `useWsConnectionStatus`, reconnect backoff constants.
- `src/rpc/requestLatencyState.ts` — slow RPC ack tracking: `useSlowRpcAckRequests`, `trackRpcRequestSent`.
- `src/lib/gitStatusState.ts` — `useGitStatus` (per-target git status fed by streams).
- `src/lib/archivedThreadsState.ts` — `useArchivedThreadSnapshots`.
- `src/lib/processDiagnosticsState.ts` — `useProcessDiagnostics`, `useProcessResourceHistory`.
- `src/lib/sourceControlDiscoveryState.ts` — `useSourceControlDiscovery`.
- `src/lib/traceDiagnosticsState.ts` — `useTraceDiagnostics`.

## Where new state should go

- **Server-derived, fetched on demand** (lists, snapshots, diffs): React Query. Add a `src/lib/<domain>ReactQuery.ts` module with query keys and `queryOptions` factories, and go through `useEnvironmentRpcQuery` / `environmentRpcQueryFn` (or `runEnvironmentRpc` / `runLocalRpc` for mutations) so connection gating and error handling stay consistent.
- **Server-pushed / stream-driven**: either reduce into the app store (`src/store.ts`) if it is part of the orchestration read model, or an Atom in the `appAtomRegistry` for standalone push state.
- **Cross-component client state** (selection, panel visibility, drafts): a zustand store. Use `persist` (with `~/lib/storage`'s `resolveStorage`) only when the state should survive reloads.
- **Component-local state**: plain `useState` / `useReducer`; do not create a store for it.
