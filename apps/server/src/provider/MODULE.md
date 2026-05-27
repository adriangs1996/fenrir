# Provider Runtime Module

Owns provider adapter composition, runtime session routing, persisted runtime
bindings, and provider-session lifecycle cleanup. Provider protocol details
remain inside individual adapters; orchestration and WebSocket code should
consume the public provider services.

## Public Layers

| Layer                               | Provides                   | Requires                                                                                        | Use                                                      |
| ----------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `ProviderSessionDirectoryLayerLive` | `ProviderSessionDirectory` | `SqlClient`                                                                                     | Persisted thread-to-provider runtime bindings            |
| `ProviderRuntimeServiceLive`        | `ProviderService`          | `ServerConfig`, `ServerSettingsService`, `SqlClient`, platform services, analytics dependencies | Adapter registry plus canonical provider runtime service |
| `ProviderRuntimeLifecycleLive`      | `ProviderSessionReaper`    | `ProviderRuntimeServiceLive` requirements plus `OrchestrationEngineService`                     | Background cleanup of inactive runtime sessions          |

## Public Services

| Service                    | Responsibility                                                                    |
| -------------------------- | --------------------------------------------------------------------------------- |
| `ProviderService`          | Start, resume, stop, and drive provider sessions; stream canonical runtime events |
| `ProviderSessionDirectory` | Store and read persisted runtime bindings for thread/provider/session recovery    |
| `ProviderAdapterRegistry`  | Resolve a provider instance to its adapter implementation                         |
| `ProviderInstanceRegistry` | Project configured provider instances and availability snapshots                  |
| `ProviderSessionReaper`    | Stop idle provider sessions when no turn is active                                |

## Boundary Rules

- Runtime composition should import `ProviderRuntimeServiceLive` or
  `ProviderRuntimeLifecycleLive` from `ProviderRuntimeModule.ts`.
- Feature modules should depend on `ProviderService` or
  `ProviderSessionDirectory`; they should not construct adapter registries.
- Individual adapter layers (`CodexAdapter`, `ClaudeAdapter`, `CursorAdapter`,
  `OpenCodeAdapter`) stay internal to runtime composition unless a test needs a
  specific adapter.
- Provider protocol normalization belongs in adapter implementations; domain
  projection belongs in orchestration ingestion.

## Current Integration Points

- `server.ts` composes the runtime service for core infrastructure.
- `serverRuntimeStartup.ts` starts `ProviderSessionReaper`.
- `ws.ts` consumes `ProviderService` and `ProviderRegistry`.
- Orchestration reactors consume `ProviderService` runtime events and commands.
