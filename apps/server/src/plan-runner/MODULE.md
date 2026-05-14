# Plan Runner Module

Orchestrates multi-plan feature implementation: reads `.plans/{feature}/`
folders, freezes the plan graph at `start()`, persists every state
transition through `PlanRunnerRepository`, spawns executor threads per
plan, and runs a final integration pass.

Persistence is the source of truth. The in-memory `activeRuns` map is a
hot-cache for the executor fiber; reads fall through to the repository for
runs that have already terminated and been evicted.

## Public API

| Method                 | Input                                         | Output                             | Description                                |
| ---------------------- | --------------------------------------------- | ---------------------------------- | ------------------------------------------ |
| `start`                | `{ projectId, featureName, modelSelection? }` | `{ runId, branch }`                | Start a plan run                           |
| `getStatus`            | `runId`                                       | `PlanRunSnapshot`                  | Current run snapshot (cache → repo)        |
| `cancel`               | `runId`                                       | `void`                             | Cancel an active run                       |
| `listFeatures`         | `{ projectId }`                               | `{ features: FeatureSummary[] }`   | Filesystem + persisted feature summary     |
| `getFeaturePlans`      | `{ projectId, featureName }`                  | `{ featureName, plans }`           | Plan files in `.plans/<feature>/`          |
| `getFeatureRun`        | `{ projectId, featureName }`                  | `{ run: PlanRunSnapshot \| null }` | Latest run for a feature (cache → repo)    |
| `listRuns`             | `{ projectId? }`                              | `{ runs: PlanRunSnapshot[] }`      | All persisted runs, hot-cache overlaid     |
| `getStepLog`           | `{ runId, stepKey }`                          | `{ runId, stepKey, entries }`      | Per-step log entries (assembly in plan 05) |
| `archiveFeature`       | `{ projectId, featureName }`                  | `{ archivedDirName }`              | Move `.plans/{f}/` → `.plans/.archive/`    |
| `unarchiveFeature`     | `{ projectId, archivedDirName }`              | `{ featureName }`                  | Inverse rename                             |
| `listArchivedFeatures` | `{ projectId? }`                              | `{ features }`                     | Read `.plans/.archive/`                    |
| `streamEvents`         | —                                             | `Stream<PlanRunnerEvent>`          | Live event stream                          |

## Events Emitted

| Event                                | When                                                            |
| ------------------------------------ | --------------------------------------------------------------- |
| `planRunner.stateChanged`            | Feature-level state transition (incl. recovery start)           |
| `planRunner.planStateChanged`        | Per-plan state transition                                       |
| `planRunner.completed`               | Run finished (completed or failed)                              |
| `planRunner.featuresChanged`         | `.plans/` watcher fired or persisted summaries changed          |
| `planRunner.stepLogAppended`         | Per-step synthetic log entry appended (next plan)               |
| `planRunner.archivedFeaturesChanged` | `.plans/.archive/` watcher fired or archive/unarchive completed |

## Run Lifecycle

### `start()`

1. Reject if a run for `(projectId, featureName)` is currently active in
   the hot cache, currently being recovered after a server boot, or has a
   non-terminal persisted state row.
2. Read `.plans/<feature>/` once and **freeze** the plan graph: parse
   frontmatter, strip self/unknown deps, capture markdown bodies. Subsequent
   edits to `.plans/` are intentionally ignored for the run's lifetime.
   Markdown files whose names start with `_` are treated as reference-only
   and excluded from the frozen execution graph.
3. Resolve or create the `feature/<featureName>` branch + worktree.
4. Build a fresh `PlanRunnerRunRow` plus seed `PlanRunnerStepRow` rows
   (`analyzer`, `integration`, one per plan in `blocked`/`ready`).
5. Capture the **old** run's internal thread refs from
   `PlanRunnerRepository.listInternalThreadRefs` so the orchestration-side
   threads can be deleted after the row is replaced.
6. Call `PlanRunnerRepository.replaceFeatureRun` — atomic delete-then-insert
   inside the repository transaction.
7. After the transaction succeeds, dispatch `thread.delete` for every
   captured old thread id. If any dispatch fails, the new run is rolled
   back via `deleteRun(newRunId)` and the start surfaces a
   `PlanRunnerError` — the new start is aborted and the operator is
   expected to retry.
8. Cache the run in `activeRuns`, publish an initial
   `planRunner.stateChanged`, and fork `driveExecution` into the layer's
   runtime scope.

### Runtime mutations (write-through cache)

Every meaningful scheduler mutation is written through to the repository
before/after the in-memory mutation; the in-memory map is only a hot
execution cache.

| Mutation                           | Repository call                               |
| ---------------------------------- | --------------------------------------------- |
| Feature state transition           | `updateRunState`                              |
| Step state transition + retries    | `updateStepState` (bumps `last_updated_at`)   |
| First run-out-of-`blocked`/`ready` | `setStepExecutionOrder`                       |
| New executor/integration thread    | `registerInternalThread`                      |
| Terminal summary + `completedAt`   | `updateRunState`                              |
| Recovery synthetic log entry       | `appendSyntheticLogEntry` (`runner.recovery`) |

### Boot recovery

On layer construction:

1. `listRecoverableRuns()` returns every persisted run whose `state` is
   non-terminal (`analyzing`, `executing`, `integrating`, `recovering`).
2. Each `(projectId, featureName)` is added synchronously to
   `recoveringFeatures` so any concurrent `start()` is blocked before the
   recovery fiber even runs.
3. A reconcile fiber is forked per recovered run, scoped to the layer:
   - Mark feature state = `recovering` via `updateRunState`.
   - Append a synthetic `runner.recovery` log entry on the analyzer step.
   - Publish `planRunner.stateChanged`.
   - Re-hydrate the in-memory `PlanRunState` from the persisted snapshot
     (plans, thread refs, model selection from project default).
   - Validate that every `running` plan still has a live
     orchestration thread. If any is missing, the run is unrecoverable:
     mark the run failed, persist the failure, publish a terminal
     `planRunner.completed` and drop the recovery gate.
   - Otherwise, restore the prior feature state (`executing` or
     `integrating`) and resume `driveExecution` from the persisted point —
     completed steps are not re-run, and the analyzer phase is skipped
     because the plan graph was already frozen at the original `start()`.
4. The `recoveringFeatures` gate is cleared once `driveExecution`
   terminates (success **or** failure), via `Effect.ensuring`.

### Recovery rules

| Rule                                                               | Source of truth |
| ------------------------------------------------------------------ | --------------- |
| Resume from persisted state; do **not** rerun completed steps      | repository      |
| Recovery is a feature-level state only (`recovering`)              | `FeatureState`  |
| No step-level `recovering` state — `PlanState` has no such literal | `PlanState`     |
| Lost backing thread/session ⇒ run fails immediately                | reactor         |
| Successful recovery ⇒ continue normal execution                    | reactor         |

### Start gating

`start()` rejects with `PlanRunnerError` when **any** of the following are
true for `(projectId, featureName)`:

- The feature is in `recoveringFeatures` because boot recovery is still
  reconciling it.
- An in-memory active run exists (state is not `completed`/`failed`).
- A persisted run exists with a non-terminal state.

The first two cases are the primary contract; the third is a defense-in-
depth check that catches inconsistencies (e.g. a recovery fiber that
crashed before clearing its cache entry).

## Archive Lifecycle

Archive/unarchive is a **filesystem-only** operation — persisted run rows
are untouched.

- **`archiveFeature`** renames `.plans/{featureName}/` →
  `.plans/.archive/{featureName}/`. If the destination already exists, a
  suffix `--archived-{epochMs}` is appended so both copies co-exist.
- **`unarchiveFeature`** is the inverse rename. The `--archived-{epochMs}`
  suffix is stripped from the directory name so the feature restores under
  its original display name. Rejects if a feature with the same name already
  exists in `.plans/`.
- **`listArchivedFeatures`** reads `.plans/.archive/` and parses
  `archivedAt` from the epoch suffix when present, falling back to the
  directory's `mtime` otherwise. Results are sorted by `archivedAt` desc.
- The **active-run gate** uses the same predicate as `start()` (extracted
  to `assertNoActiveRun`): recovering features, in-memory active runs, and
  persisted non-terminal runs all block archiving.
- **Path traversal** is rejected at the input layer — feature names
  containing `/`, `\`, or `..` produce an immediate `PlanRunnerError`
  before any filesystem operation.

## Dependencies

| Service                      | Purpose                                                |
| ---------------------------- | ------------------------------------------------------ |
| `OrchestrationEngineService` | Thread creation, turn dispatch, read model             |
| `GitCore`                    | Branch + worktree lifecycle                            |
| `FileSystem`                 | Read plan files                                        |
| `Path`                       | Path resolution                                        |
| `PlanRunnerRepository`       | Durable run/step/internal-thread/synthetic-log storage |

## Error Taxonomy

| Error                     | When                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `PlanRunnerError`         | Missing plan dir/files, duplicate or recovering run, branch failure, persistence failure |
| `PlanRunnerNotFoundError` | `getStatus`/`cancel`/`getStepLog` with unknown runId                                     |

## Filesystem Layout

```
apps/server/src/plan-runner/
├── MODULE.md
├── index.ts                    # Barrel export
├── Services/
│   └── PlanRunner.ts           # Service interface
└── Layers/
    └── PlanRunner.ts           # Core implementation (durable + recoverable)
```

## Integration Points

- **Upstream**: `ws.ts` RPC layer (11 handlers + event subscription)
- **Downstream**: `OrchestrationEngine` (thread lifecycle), `GitCore`
  (branching), `PlanRunnerRepository` (persistence)
- **Layer composition**: Wired into `RuntimeDependenciesLive` in
  `server.ts` with `PersistenceLayerLive` provided so boot recovery can run
  during layer construction.
