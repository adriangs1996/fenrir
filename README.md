# Fenrir

Next-generation IDE for agentic-first development. Whatever your workflow is, Fenrir tries to support it.

Fenrir is a fork of T3Code and continues to use it as a reference for many features. This project exists because of the outstanding work in T3Code and the patterns it established for building a practical, agent-centered development environment.

Today, Fenrir is still behind that reference. The long-term goal is a fast, reliable, workflow-flexible IDE for coding agents, but the current project is not feature-complete and should be treated as an early, experimental fork.

Currently Codex-first, with Claude support via the Claude Agent SDK.

> [!WARNING]
> Very early WIP. Bugs expected. APIs, schemas, and UX will change without notice. Many workflows are incomplete, rough, or temporarily behind the behavior available in T3Code.

## Current status

Fenrir is usable as a local development workbench for experimenting with provider sessions, conversations, terminals, editors, and git-aware workflows, but it is not polished product software yet.

Expect the current state to include:

- missing or incomplete flows compared with T3Code
- behavior that changes quickly as the architecture settles
- rough edges around session recovery, reconnects, partial streams, and provider differences
- UI that reflects active development more than a stable release
- desktop packaging that may lag the browser/server workflow

## Fenrir-only direction

Even though Fenrir is behind T3Code in overall polish and coverage, it is exploring several features that are not part of the current T3Code baseline:

- **Plan runner** — discovers `.plans/` feature folders, freezes a plan graph, runs executor/analyzer/integration agent threads, persists run state, supports recovery after restarts, and exposes run monitoring in the UI.
- **Browser lab and Traffic Lens** — an embedded browser workflow with captured HTTP traffic, request replay, rules/overrides, profiles, cookies, local storage, and session storage inspection.
- **Managed processes** — project-scoped long-running processes for dev servers and watchers, with tmux-backed restart reconciliation, auto-restart policies, readiness probes, and streamed logs.
- **Embedded Neovim workspace** — an Electron-backed Neovim pane with project cwd sync, dirty-buffer tracking, and editor selections that can be sent into the agent composer as structured context.
- **Provider skills workspace** — UI and server support for inspecting, editing, importing, and syncing provider skills across Codex and Claude-style skill folders.

These areas should be read as active product bets, not stable guarantees. Some are partially wired, some are desktop-only, and some still need the same reliability work as the rest of the app.

## What it is

Fenrir runs a local Node WebSocket server that wraps the [`codex app-server`](https://developers.openai.com/codex/sdk/#app-server) (JSON-RPC over stdio) and the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk). It serves a React UI that is being built toward managing sessions, conversations, terminals, editors, and git worktrees in one place.

It ships in two shapes:

- **Server + browser UI** — `apps/server` boots a WebSocket server, serves the bundled web app, and brokers provider sessions.
- **Desktop app** — `apps/desktop` wraps the same server and UI in Electron.

## Requirements

- Bun `^1.3.9`
- Node `^24.13.1`
- At least one provider installed and authenticated:
  - **Codex**: install [Codex CLI](https://github.com/openai/codex) and run `codex login`
  - **Claude**: install Claude Code and authenticate

Optional: [`mise`](https://mise.jdx.dev/) for managing tool versions (see `.mise.toml`).

## Repository layout

This is a Turborepo monorepo using Bun workspaces.

```
apps/
  server/          Node WebSocket server. Wraps codex app-server + Claude Agent SDK.
                   Manages provider sessions, PTYs, sqlite-backed state, git ops.
                   Published as the `fenrir` npm bin.
  web/             React 19 + Vite UI. TanStack Router, xterm.js terminals,
                   Lexical editor, dnd-kit, TanStack Query, Zustand, Tailwind v4.
  desktop/         Electron 40 shell. Bundles server + web for distribution.

packages/
  contracts/       Effect Schema contracts for WS protocol, provider events,
                   model/session types. Schema-only — no runtime logic.
  shared/          Shared runtime utilities (e.g. `@fenrir/shared/git`).
                   Explicit subpath exports — no barrel index.
  client-runtime/  Browser-side runtime glue.

scripts/           Dev runner, desktop artifact builders, smoke tests.
docs/              Observability, release, effect-fn checklist.
```

## Architecture notes

- **Provider transport**: `apps/server/src/codexAppServerManager.ts` spawns and manages `codex app-server` per session over JSON-RPC/stdio. Provider dispatch and thread-event logging live in `apps/server/src/providerManager.ts`.
- **Browser transport**: WebSocket. NativeApi methods routed in `apps/server/src/wsServer.ts`. The web app subscribes to orchestration domain events on the `orchestration.domainEvent` push channel; provider runtime activity is projected into orchestration events server-side.
- **Effect-based**: most server and shared code uses [Effect](https://effect.website) (`effect`, `@effect/platform-*`, `@effect/sql-sqlite-bun`, `@effect/atom-react`).
- **Storage**: SQLite via `@effect/sql-sqlite-bun` for session/thread state.
- **Terminals**: `node-pty` server-side, `xterm.js` client-side.
- **Git**: worktree-aware operations in `@fenrir/shared/git`.

## Development

```bash
# install
bun install

# all dev servers (web + server)
bun dev

# individually
bun dev:server
bun dev:web
bun dev:desktop
```

### Task completion checks

Before considering a change done:

```bash
bun fmt          # oxfmt
bun lint         # oxlint
bun typecheck    # turbo typecheck across workspaces
bun run test     # Vitest (NEVER `bun test`)
```

### Desktop builds

```bash
bun dist:desktop:dmg:arm64        # macOS arm64 dmg
bun dist:desktop:dmg:x64          # macOS x64 dmg
bun dist:desktop:linux            # Linux AppImage
bun dist:desktop:win              # Windows nsis
bun install:desktop:mac:arm64     # build + install locally (macOS arm64)
```

## Priorities

1. Performance.
2. Reliability.
3. Predictable behavior under load and during failures (session restarts, reconnects, partial streams).

Correctness and robustness over short-term convenience.

## Contributing

Not actively accepting contributions. See [CONTRIBUTING.md](./CONTRIBUTING.md) before opening anything.

## Reference

- Codex App Server: <https://developers.openai.com/codex/sdk/#app-server>
- Codex (open-source): <https://github.com/openai/codex>
- CodexMonitor (Tauri reference impl): <https://github.com/Dimillian/CodexMonitor>
- Observability: [docs/observability.md](./docs/observability.md)
- Release process: [docs/release.md](./docs/release.md)

## License

MIT. See [LICENSE](./LICENSE).
