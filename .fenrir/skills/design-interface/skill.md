---
name: design-interface
displayName: Design Interface
description: "Investigate a feature deeply, extract it into a well-defined module with public interface, and mark it for parallel AI agent work. Use when user says 'design interface', 'extract module', 'define module boundary', 'feature interface', 'vertical slice', 'split into modules', 'module interface', 'design-interface'. Triggers on: design interface, extract module, module boundary, vertical slice."
tags: []
enabled: true
---

# Design Interface — Feature Module Extraction & Interface Definition

Extract features into self-contained modules with well-defined public interfaces. Each module becomes a vertical slice: it contains everything it needs, exports a clean API, and can be worked on by an AI agent independently.

## The Job

Transform a vague feature description into:

1. A fully understood feature specification (no gaps)
2. A module with clear public interface extracted from the codebase
3. A MODULE.md marker file that enables parallel AI agent work
4. Integration contracts that guarantee modules compose correctly

## Phase 1: Investigation — Grill Until No Gaps

**Goal**: Understand the feature completely with no gaps.

### Questioning Strategy

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

If a question can be answered by exploring the codebase, explore the codebase instead.

### Investigation Output

Before proceeding, present a **Feature Specification Summary**:

```
## Feature: [Name]

### Behavior
[What it does, triggers, success/failure states]

### Data Flow
[Inputs → Processing → Outputs → Side Effects]

### Boundaries
- Owns: [what's inside the module]
- Depends on: [external services/modules it consumes]
- Exposes: [public API surface]
- Emits: [events/signals for other modules]

### Error Taxonomy
[Named error types and recovery strategies]

### Non-Goals
[Explicitly what this module does NOT do]
```

Get user confirmation before proceeding to Phase 2.

## Phase 2: Codebase Archaeology — Find Everything

**Goal**: Map every piece of code that touches this feature.

### Search Strategy

1. **Contract search**: Grep `packages/contracts/src/` for related schemas, types, branded IDs
2. **Service search**: Grep `apps/server/src/*/Services/` for related service interfaces
3. **Layer search**: Grep `apps/server/src/*/Layers/` for related implementations
4. **Persistence search**: Grep `apps/server/src/persistence/` for related stores/projections
5. **Web search**: Grep `apps/web/src/` for related components, hooks, stores, routes
6. **Desktop search**: Grep `apps/desktop/src/` for related desktop integrations
7. **Shared search**: Grep `packages/shared/src/` for related utilities
8. **Test search**: Find all test files related to the feature
9. **Plan search**: Check `.plans/` for related architectural plans

### Mapping Output

Present a **Code Map**:

```
## Code Map: [Feature Name]

### Contracts (packages/contracts)
- [file]: [what it defines for this feature]

### Server Services (apps/server/src/[domain]/Services/)
- [file]: [service interface relevant to feature]

### Server Layers (apps/server/src/[domain]/Layers/)
- [file]: [implementation relevant to feature]

### Persistence (apps/server/src/persistence/)
- [file]: [stores/projections for this feature]

### Web (apps/web/src/)
- [file]: [components/hooks/stores for this feature]

### Desktop (apps/desktop/src/)
- [file]: [desktop integrations for this feature]

### Shared (packages/shared/src/)
- [file]: [utilities used by this feature]

### Cross-Cutting Concerns
- [what's tangled with other features and needs untangling]
```

## Phase 3: Module Design — Define the Interface

**Goal**: Design the module's public interface before writing any code.

### Module Structure Convention

Every module follows this filesystem layout:

```
apps/server/src/[module-name]/
  MODULE.md              # Agent-discoverable module marker (CRITICAL)
  Services/
    [ServiceName].ts     # Effect Service interface (public contract). This is what others might use
  Layers/
    [ServiceName].ts     # Effect Layer implementation (private)
  __tests__/
    [ServiceName].test.ts
```

For web modules:

```
apps/web/src/modules/[module-name]/
  MODULE.md
  index.ts               # Public API barrel export
  components/            # React components (internal)
  hooks/                 # React hooks (some public, some internal)
  stores/                # Zustand/atom stores (internal)
  __tests__/
```

For contract additions:

```
packages/contracts/src/
  [module-name].ts       # Schema definitions for this module
```

### Interface Design Rules

1. **Public API = Effect Service shape only.** Consumers depend on the Service interface, never on Layer internals.
2. **Errors are part of the interface.** Every public method declares its error channel with `Schema.TaggedError`.
3. **Events are part of the interface.** If the module emits events, define them in contracts.
4. **Dependencies are explicit.** The Layer's `yield*` imports ARE the dependency list.
5. **No leaking internals.** Internal types/helpers stay unexported.

### Interface Template

```typescript
// Services/[Name].ts — PUBLIC CONTRACT

import { ServiceMap } from "effect"
import type { Schema } from "effect"

// --- Error Types (part of public contract) ---
export class [Name]Error extends Schema.TaggedError<[Name]Error>()(
  "[Name]Error",
  { message: Schema.String, cause: Schema.optional(Schema.Unknown) }
) {}

// --- Service Shape (public API) ---
export interface [Name]Shape {
  /**
   * [Description of what this does]
   * @since 1.0.0
   */
  readonly [methodName]: (
    input: [InputType]
  ) => Effect.Effect<[OutputType], [Name]Error>
}

// --- Service Tag ---
export class [Name] extends ServiceMap.Service<
  [Name],
  [Name]Shape
>()("fenrir/[module-name]/[Name]") {}
```

## Phase 4: MODULE.md — The Agent Discovery Marker

**Goal**: Create a MODULE.md that gives any AI agent everything it needs to work on or consume this module — WITHOUT reading implementation files.

### MODULE.md Template

````markdown
# Module: [Name]

> [One-line description of what this module does]

## Public API

### Services

#### `[ServiceName]`

| Method       | Input       | Output       | Errors         | Description  |
| ------------ | ----------- | ------------ | -------------- | ------------ |
| `methodName` | `InputType` | `OutputType` | `ServiceError` | What it does |

### Events Emitted

| Event         | Schema        | When                |
| ------------- | ------------- | ------------------- |
| `[EventName]` | `[SchemaRef]` | [Trigger condition] |

### Contracts (from @fenrir/contracts)

- `[SchemaName]` — [what it defines]

## Dependencies

### Services Consumed

| Service         | From Module     | Why                  |
| --------------- | --------------- | -------------------- |
| `[ServiceName]` | `[module-path]` | [What we use it for] |

### Packages

- `@fenrir/contracts` — [which schemas]
- `@fenrir/shared/[subpath]` — [which utilities]

## Error Taxonomy

| Error         | Tag     | Recovery                      |
| ------------- | ------- | ----------------------------- |
| `[ErrorName]` | `[tag]` | [How consumers should handle] |

## Filesystem Layout

```
[module-path]/
  MODULE.md
  Services/
    [files]
  Layers/
    [files]
  __tests__/
    [files]
```

## Integration Points

- **Upstream**: [Who calls this module's API]
- **Downstream**: [What this module calls]
- **Events**: [What events flow in/out]

## Working On This Module

### For implementers (working INSIDE this module):

- Layer implementations in `Layers/` — change freely without breaking consumers
- Service interface in `Services/` — changes here are BREAKING, coordinate with consumers
- Tests must cover all public API methods

### For consumers (working in OTHER modules):

- Import ONLY from `Services/[Name].ts`
- Never import from `Layers/`
- Handle all declared error types
- Subscribe to events via the documented event bus, not by importing internals
````

### Why MODULE.md Matters

1. **Agent Discovery**: `find . -name MODULE.md` → instant module inventory
2. **Parallel Work**: Agent A works on Module X, Agent B works on Module Y. Neither needs to read the other's internals — MODULE.md has the contract.
3. **Interface Enforcement**: If a change requires updating MODULE.md's public API table, it's a breaking change. Think twice.
4. **Onboarding**: New agent (or human) reads MODULE.md → knows exactly what the module does, how to use it, how to change it.

## Phase 5: Execution Plan — Split & Parallelize

**Goal**: Produce a concrete plan for implementing changes across affected modules.

### Output Format

```
## Execution Plan: [Feature Name]

### Affected Modules
| Module | Change Type | Can Parallelize? | Depends On |
|--------|------------|-------------------|------------|
| `contracts/[schema]` | New schema | Yes (do first) | — |
| `server/[module-a]` | New service | Yes (after contracts) | contracts |
| `server/[module-b]` | Update service | Yes (after contracts) | contracts |
| `web/[module-c]` | New component | Yes (after contracts) | contracts |

### Parallel Work Lanes

**Lane 1 — Contracts (do first)**
- [ ] Add schemas to `packages/contracts/src/[file].ts`
- [ ] Export from contracts package

**Lane 2 — Server Module A (after Lane 1)**
Agent can work independently. Interface:
- Consumes: [services from MODULE.md]
- Produces: [services/events from MODULE.md]

**Lane 3 — Server Module B (after Lane 1)**
Agent can work independently. Interface:
- Consumes: [services from MODULE.md]
- Produces: [services/events from MODULE.md]

**Lane 4 — Web Module C (after Lane 1)**
Agent can work independently. Interface:
- Consumes: [RPC methods / WebSocket channels]
- Produces: [UI state / user actions]

### Integration Verification (after all lanes)
- [ ] All MODULE.md files updated
- [ ] `bun typecheck` passes
- [ ] `bun lint` passes
- [ ] `bun fmt` passes
- [ ] Integration tests cover cross-module flows
```

## Anti-Patterns

### DO NOT

- **Skip investigation**: "I think I understand" → you don't. Ask more questions.
- **Design interface after implementation**: Interface comes FIRST. Implementation fills it.
- **Leak Layer internals**: If a consumer needs something from a Layer, it belongs in the Service interface.
- **Create modules without MODULE.md**: No marker = invisible to agents = defeats the purpose.
- **Put runtime logic in contracts**: Contracts package is schema-only. Runtime logic goes in shared or the module itself.
- **Use barrel exports in shared**: `@fenrir/shared` uses explicit subpath exports. Follow the pattern.
- **Ignore error taxonomy**: Every public method must declare its error types. "throws unknown" is not acceptable.
- **Make MODULE.md a formality**: If MODULE.md doesn't have enough info for an agent to work independently, it's incomplete.

### RED FLAGS

| What you see                                    | What's wrong          | Fix                                                   |
| ----------------------------------------------- | --------------------- | ----------------------------------------------------- |
| Module imports another module's `Layers/` file  | Leaking internals     | Import from `Services/` only                          |
| MODULE.md says "see implementation for details" | Defeats the purpose   | Document the contract in MODULE.md                    |
| Two modules share the same persistence table    | Unclear ownership     | One module owns the table, other consumes via service |
| Error type is `Error` or `unknown`              | No error taxonomy     | Define `Schema.TaggedError` per failure mode          |
| Module has no tests                             | Can't verify contract | Write tests for every public API method               |

## Quick Reference: Module Discovery Commands

```bash
# Find all modules
find . -name MODULE.md

# List module names
find . -name MODULE.md -exec head -1 {} \;

# Find module by feature keyword
grep -rl "keyword" $(find . -name MODULE.md)

# Show module dependencies
grep -A5 "Services Consumed" $(find . -name MODULE.md)

# Check module status
grep -A4 "## Status" $(find . -name MODULE.md)
```
