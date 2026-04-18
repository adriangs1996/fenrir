# Tmux Session Manager — Terminal as First-Class Citizen

**Date:** 2026-04-18
**Status:** Approved
**Author:** Adrian Gonzalez + Claude

## Problem

T3 Code treats terminal as secondary — a collapsible bottom drawer under chat. Power users (neovim, tmux) need terminal as their primary workspace with persistent layouts per project. Switching projects should restore the entire terminal environment (neovim, servers, logs) instantly.

## Decision

Don't rebuild tmux. Orchestrate it. T3 Code becomes a tmux session manager — each project gets an auto-created tmux session, xterm.js attaches to it, project switching detaches/reattaches. Agents keep their own isolated PTYs.

### Why Not Rebuild Splits/Panes?

- Months of work recreating what tmux already does
- Lose user dotfiles, muscle memory, plugins
- xterm.js inside Electron will never match native terminal quality for heavy neovim use
- T3 Code's value is agent orchestration, not terminal emulation

## Architecture

### Core Components

```
┌─────────────────────────────────────────────┐
│ T3 Code (Electron / Web)                    │
│                                             │
│  ┌──────────┐  ┌────────────────────────┐   │
│  │  Chat /  │  │  xterm.js              │   │
│  │  Agent   │  │  ┌──────────────────┐  │   │
│  │  Panel   │  │  │ tmux attach -t   │  │   │
│  │          │  │  │ t3-{projectId}   │  │   │
│  │          │  │  └──────────────────┘  │   │
│  └──────────┘  └────────────────────────┘   │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │ Agent PTYs (isolated, unchanged)     │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
         │
         │ node-pty
         ▼
┌─────────────────────────────────────────────┐
│ tmux                                        │
│  session: t3-proj-abc  (neovim + server)    │
│  session: t3-proj-def  (nmap + burp + shell)│
│  session: t3-proj-ghi  (logs + scratch)     │
└─────────────────────────────────────────────┘
```

### Session Naming

All T3 Code-managed sessions use prefix `t3-{projectId}`. Avoids collision with user's personal tmux sessions.

## Design Sections

### 1. TmuxSessionManager Service

New Effect service layer at `apps/server/src/terminal/`.

**Interface:**

```typescript
interface TmuxSessionManager {
  createSession(projectId: string, cwd: string): Effect<void, TmuxError>
  attachSession(projectId: string): Effect<PtyStream, TmuxError>
  detachSession(projectId: string): Effect<void, TmuxError>
  killSession(projectId: string): Effect<void, TmuxError>
  hasSession(projectId: string): Effect<boolean, TmuxError>
  listSessions(): Effect<TmuxSession[], TmuxError>
}
```

**Lifecycle:**

1. User opens/creates project → `hasSession()` → `createSession()` if missing
2. xterm.js connects → `attachSession()` → returns PTY stream connected to tmux
3. User switches project → `detachSession()` on old, `attachSession()` on new
4. Project deleted → `killSession()` cleanup

**Implementation:** Uses existing `NodePTY` layer to spawn tmux commands. No new npm dependencies. Only requires `tmux` binary on `$PATH`.

### 2. xterm.js Integration

**WebSocket protocol — new message types:**

```typescript
// packages/contracts/src/terminal.ts

TerminalAttachTmux = {
  type: "terminal.attach-tmux"
  projectId: string
}

TerminalDetachTmux = {
  type: "terminal.detach-tmux"
  projectId: string
}
```

**Server handling:** Receives `attach-tmux` → spawns `tmux attach -t t3-{projectId}` via node-pty → streams stdout/stdin over existing WebSocket binary channel. Same transport as current terminal, different backing process.

**Client handling:** Minimal changes to xterm.js component. The terminal doesn't care what's on the other end of the PTY. On project switch:

1. Send `terminal.detach-tmux` for current project
2. Call `terminal.reset()` on xterm.js instance to clear stale buffer
3. Send `terminal.attach-tmux` for new project

**Resize:** xterm.js FitAddon already sends resize events → server forwards to tmux PTY → tmux propagates to inner panes. No new code.

**What stays the same:**

- Agent terminals — unchanged, still isolated PTYs via NodePTY
- Terminal activity tracking — still works (watching PTY output)
- Terminal links — still works (xterm.js link detection)
- Scrollback — tmux manages its own scrollback

### 3. Project Switch Flow

```
User clicks Project B in sidebar (or Alt-2)
  → UI sends terminal.detach-tmux { projectId: "A" }
  → Server detaches PTY from tmux session t3-A
  → UI calls terminal.reset() on xterm.js
  → UI sends terminal.attach-tmux { projectId: "B" }
  → Server: tmux session t3-B exists?
      → No: createSession("B", projectCwd) first
      → Yes: attach directly
  → Server spawns `tmux attach -t t3-B` via node-pty
  → Output streams to xterm.js
  → User sees tmux workspace exactly as they left it
```

**Timing:** ~50ms for tmux attach. Imperceptible.

**Edge cases:**

| Case | Behavior |
|------|----------|
| First open after T3 Code restart | tmux sessions survive — just reattach. Neovim, servers still running. |
| tmux binary not found | Graceful fallback to current behavior (raw shell PTY). Log warning. |
| Session crashed/dead | `hasSession` returns false → create fresh session |
| Multiple T3 Code instances | Single-instance constraint. Document as known limitation. |

### 4. Server Layer Integration

**New files:**

| File | Purpose |
|------|---------|
| `apps/server/src/terminal/Services/TmuxSessionManager.ts` | Service interface (Effect Tag + schema) |
| `apps/server/src/terminal/Layers/TmuxSessionManager.ts` | Implementation using NodePTY |

**Modified files:**

| File | Change |
|------|--------|
| `apps/server/src/terminal/Layers/Manager.ts` | Add `attachTmux`/`detachTmux` methods |
| `apps/server/src/serverLayers.ts` | Compose TmuxSessionManager into layer graph |
| `apps/server/src/ws.ts` | Handle new WebSocket message types |
| `packages/contracts/src/terminal.ts` | Add tmux contract schemas |
| `apps/web/src/components/ThreadTerminalDrawer.tsx` | Workspace terminal uses tmux attach/detach |
| `apps/web/src/terminalStateStore.ts` | Track active tmux session per project |

**Untouched:**

- Agent terminal paths
- Provider adapters (Codex, Claude)
- Orchestration engine
- Git layer
- Desktop/Electron shell

**Dependencies:** Zero new npm packages. Only runtime dependency: `tmux` on `$PATH`.

### 5. Keybindings

**Principle:** Terminal focused = all keystrokes pass through to tmux. T3 Code keybindings only fire at the application level.

**Project switching (position-based):**

| Keybinding | Action |
|-----------|--------|
| `Alt-1` through `Alt-9` | Switch to project by sidebar position |

Sidebar already supports drag-and-drop reordering via `dnd-kit`. `Alt-N` maps to index N-1 in the ordered project list. Triggers same detach/attach flow.

**Application controls:**

| Keybinding | Action |
|-----------|--------|
| `Ctrl-Shift-Space` | Toggle chat panel |
| `Ctrl-Shift-T` | Focus terminal |
| `Ctrl-Shift-C` | Focus chat |
| `Ctrl-Shift-P` | Project switcher (fuzzy) — for 10+ projects |

**Why `Ctrl-Shift` prefix:** No collision with tmux (`Ctrl-b`), neovim bindings, or shell shortcuts (`Ctrl-c/d/z/r`).

**All shortcuts configurable** via existing `keybindings.json` system.

**tmux passthrough:** When xterm.js terminal has focus, T3 Code registers no key handlers on that element. Raw keystrokes flow: DOM → xterm.js → WebSocket → PTY → tmux. User's `.tmux.conf` is the only authority.

## Explicitly Not In Scope

- Layout templates per project (user manages tmux layout manually)
- Agent commands running in tmux panes (agents keep isolated PTYs)
- `t3 attach` CLI for external terminal access
- Git branch / port / notification metadata in sidebar
- Browser panes (cmux feature — not needed)
- SSH remote sessions

## Future Considerations

These are noted but deliberately deferred:

- **Layout templates:** Per-project `.t3/tmux-layout.conf` that auto-applies on session creation
- **External attach:** `t3 attach` CLI so user's native terminal can connect to same tmux session
- **Agent → tmux projection:** Option to mirror agent terminal output into a tmux pane
- **Session snapshots:** Save/restore tmux layouts beyond what tmux-resurrect provides
