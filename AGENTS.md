# AGENTS.md

## Task Completion Requirements

- All of `bun fmt`, `bun lint`, and `bun typecheck` must pass before considering tasks completed.
- NEVER run `bun test`. Always use `bun run test` (runs Vitest).

## Project Snapshot

Fenrir is desktop application for agentic first development. It aims to provide
all the tools to developers to edit/review code and interact with their machines
in a single APP, either via code editors/terminals or chatting with an agent.

## Coding Agent Agnostic

Fenrir hides the "agentic" interactions behind a "provider" interface.
Is paramount that each feature is guarded behind a common interface within the
supported providers.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

- Long term maintainability is a core priority.
- Before adding new functionality, first check if there is shared logic that can be extracted to a separate module or already defined
  functions you can use.
- Avoid duplication.
- Duplicated logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.
- Always follow the same architecture for features, using the same Software Layers for each slice if possible.
- If a functionality needs server interaction, prefer expose it through websocket and only use Electron IPC if is absolutely necessary.

## Libraries

Use Effect v4 API, if uncertain, search documentation.
Only install a library if absolutely necessary. Prefer the DIY approach.
