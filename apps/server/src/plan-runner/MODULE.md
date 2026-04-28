# Plan Runner Module

Orchestrates multi-plan feature implementation: reads `.plans/{feature}/` folders, analyzes dependencies, spawns executor/reviewer threads per plan, and runs a final integration pass.

## Public API

| Method         | Input                                         | Output                    | Description           |
| -------------- | --------------------------------------------- | ------------------------- | --------------------- |
| `start`        | `{ projectId, featureName, modelSelection? }` | `{ runId, branch }`       | Start a plan run      |
| `getStatus`    | `runId`                                       | `PlanRunSnapshot`         | Get current run state |
| `cancel`       | `runId`                                       | `void`                    | Cancel an active run  |
| `streamEvents` | —                                             | `Stream<PlanRunnerEvent>` | Live event stream     |

## Events Emitted

| Event                         | When                               |
| ----------------------------- | ---------------------------------- |
| `planRunner.stateChanged`     | Feature-level state transition     |
| `planRunner.planStateChanged` | Per-plan state transition          |
| `planRunner.completed`        | Run finished (completed or failed) |

## Dependencies

| Service                      | Purpose                                    |
| ---------------------------- | ------------------------------------------ |
| `OrchestrationEngineService` | Thread creation, turn dispatch, read model |
| `GitCore`                    | Branch creation                            |
| `ServerConfig`               | Working directory (`cwd`)                  |
| `FileSystem`                 | Read plan files                            |
| `Path`                       | Path resolution                            |

## Error Taxonomy

| Error                     | When                                                |
| ------------------------- | --------------------------------------------------- |
| `PlanRunnerError`         | General: missing dir, duplicate run, branch failure |
| `PlanRunnerNotFoundError` | `getStatus`/`cancel` with unknown runId             |

## Filesystem Layout

```
apps/server/src/plan-runner/
├── MODULE.md
├── index.ts                    # Barrel export
├── Services/
│   └── PlanRunner.ts           # Service interface
└── Layers/
    └── PlanRunner.ts           # Core implementation
```

## Integration Points

- **Upstream**: `ws.ts` RPC layer (4 handlers)
- **Downstream**: OrchestrationEngine (thread lifecycle), GitCore (branching)
- **Layer composition**: Wired into `RuntimeDependenciesLive` in `server.ts`
