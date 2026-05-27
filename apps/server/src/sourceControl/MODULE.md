# Source Control Module

Owns source-control workspace discovery, branch/status reads, and repository
mutation workflows for server-side features. The module is currently backed by
Git services, but callers should depend on the `SourceControl*` services rather
than Git layers unless they need raw Git operations that are not part of the
source-control contract.

## Public Layers

| Layer                        | Provides                                                                               | Requires                | Use                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------- |
| `SourceControlWorkspaceLive` | `SourceControl`                                                                        | none                    | Workspace detection and repository identity resolution            |
| `SourceControlModuleLive`    | `SourceControl`, `SourceControlQuery`, `SourceControlStatus`, `SourceControlWorkflows` | `GitCore`, `GitManager` | Full source-control capability set for server/runtime composition |

## Public Services

| Service                  | Responsibility                                                                  |
| ------------------------ | ------------------------------------------------------------------------------- |
| `SourceControl`          | Detect supported workspaces and resolve repository identity                     |
| `SourceControlQuery`     | Read branch metadata                                                            |
| `SourceControlStatus`    | Read, refresh, and stream status snapshots                                      |
| `SourceControlWorkflows` | Mutate branches, worktrees, repository initialization, and PR-related workflows |

## Boundary Rules

- Feature modules should import services from `Services/` and receive them via
  Effect layers.
- Runtime composition should import `SourceControlModuleLive` from
  `SourceControlModule.ts` instead of wiring individual implementation layers.
- Implementation layers under `Layers/` are internal adapters from Git-backed
  services to the source-control service contracts.
- New VCS functionality should first land behind the source-control service
  contracts when it is useful to more than one feature.

## Current Integration Points

- `server.ts` composes the full module once for runtime dependencies.
- `ws.ts`, orchestration reactors, review, and plan-runner consume the services.
- Git remains available for lower-level features that still need raw command
  execution or Git-specific behavior.
