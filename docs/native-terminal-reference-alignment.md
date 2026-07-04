# Native Terminal Reference Alignment: cmux (primary) / Supacode (secondary) / Fenrir-owned

Status: analysis feeding decision updates. Complements
`docs/native-terminal-client-decisions.md` (D-017 establishes the reference
order) and `docs/native-terminal-client-roadmap.md` (lines 24-34 state the
reference roles and the source-of-truth guardrail).

Method: this maps every relevant product/engineering area to one of three
buckets — copy cmux, copy Supacode, or Fenrir-owned — based on the decision
log, the roadmap, and a code-level inventory of both vendored references
(`references/cmux`, `references/supacode`).

Reference identities, verified against the vendored sources:

- **cmux** (`references/cmux`): native Swift/AppKit macOS terminal on
  libghostty; ~292k LOC. Vertical tabs = workspaces, horizontal tabs =
  surfaces, Bonsplit split tree, OSC 9/99/777 notifications + `cmux notify`,
  Feed (approval cards via agent hooks), 15-agent hook/resume provisioning,
  session restore with agent `--resume` replay, password-authed unix socket +
  ~180-command CLI, in-app WKWebView browser with agent-browser automation,
  SSH via uploaded Go daemon, Sparkle. Philosophy: "a primitive, not a
  solution". No tmux, no server, single-user, local-only state.
- **Supacode** (`references/supacode`): SwiftUI + TCA 1.23 macOS orchestrator
  on libghostty; ~104k LOC. Worktree-per-task product loop (create/setup
  script/archive/merge), sidebar of repositories→worktrees with cached
  `SidebarStructure` projections, terminal runtime outside TCA behind a
  command/event `AsyncStream` client, ownership-marked idempotent hook
  installers, OSC 3008 presence/notify, zmx-wrapped shells for persistence,
  Run-script split button + open-in-editor split button in the toolbar,
  single window.

Non-negotiable guardrail (roadmap line 31-34): Fenrir's server-owned tmux
kernel, auth/actor model, WebSocket RPC contracts, pane data-plane semantics,
workflow contracts, and MCP/provider contracts remain the source of truth. No
reference feature may bypass them. cmux's local-only socket/session model and
Supacode's app-local zmx/worktree state are the two most common shapes that
must be re-based onto Fenrir server contracts when copied.

---

## 1. Copy from cmux (primary: product/runtime shape)

| Area                         | What to copy                                                                                                                                                                                                                                                                              | Evidence in cmux                                                                        | How it lands in Fenrir                                                                                                                                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attention UX                 | Notification **rings around panes** + sidebar row lighting + unread badges; **⌘⇧U jump to latest unread**; notifications panel (⌘I) with per-item read state                                                                                                                              | `TerminalNotificationStore.swift`, README "Notification rings", `docs/notifications.md` | Presence chip in pane headers already exists (D-041); add the ring treatment, sidebar-row lighting, jump-to-unread action, and a notifications panel overlay (D-023 surface). Attention source stays D-038 presence + Notifications module                                                  |
| Terminal notifications       | Parse **standard OSC 9/99/777** in addition to Fenrir's reserved presence OSC, so any CLI (not just provisioned agents) can notify                                                                                                                                                        | `TerminalNotificationPolicy.swift`                                                      | Extend `TerminalViewport` OSC handling; route into the D-041 Notifications model. Keeps D-038's reserved channel for structured presence                                                                                                                                                    |
| macOS notifications          | Banners only when surface unfocused; **click focuses workspace+pane**; **inline action buttons** on banners; notification coalescing/withdrawal rules                                                                                                                                     | `CmuxNotifications`, `AppDelegate+NotificationNavSeams.swift`                           | Workstream 15. Focus routing goes through WorkspaceCoordinator actions, not AppKit-side state                                                                                                                                                                                               |
| Agent resume                 | Hooks record agent **session IDs** per pane; on workspace reopen, relaunch agents with their native resume command (`claude --resume <id>`, `codex resume <id>`, …); custom resume commands require signed, cwd+env-bound approval                                                        | `docs/agent-hooks.md`, `RestorableAgentSession.swift`, `cmux surface resume set`        | AgentIntegration already provisions hooks (D-039). Add session-id capture to hook payloads and a resume step to workspace projection. Shell survival itself is tmux/server-owned (Fenrir advantage — cmux must snapshot scrollback; we don't)                                               |
| Sidebar row metadata         | Rows show **git branch, PR status/number, cwd, listening ports, latest notification line**                                                                                                                                                                                                | README, `ContentView.swift` `VerticalTabsSidebar`                                       | D-041 workspace tree already has agents/apps/dev-servers groups; enrich the workspace row itself with branch/PR/ports/last-notification. Ports come from the server's localServers discovery (already exists), PR data needs a server-side git/PR probe contract — not client-side scraping |
| Local control surface        | Command breadth and ergonomics: stable handles across moves, ref syntax (`workspace:2`), `send-key`/`read-screen`, `tree`/`top`, sidebar metadata setters (`set-status`/`set-progress`/`log`), **v2 JSON-RPC + `events.stream`**                                                          | `docs/cli-contract.md`, `CmuxControlSocket` package                                     | Fenrir's control socket (D-008/D-014) adopts the command vocabulary and eventing; transport stays Fenrir's socket, terminal bytes stay off this channel (roadmap guardrail, already codified)                                                                                               |
| Per-terminal env             | Inject `FENRIR_WORKSPACE_ID` / `FENRIR_PANE_ID` / socket path into every pane env so CLIs and hooks can self-address                                                                                                                                                                      | `CMUX_WORKSPACE_ID`/`CMUX_SURFACE_ID` env                                               | Server sets pane env at spawn (tmux `-e`); CLI + hooks consume it                                                                                                                                                                                                                           |
| Ghostty embedding discipline | Full `NSTextInputClient` IME handling; key routing via `ghostty_surface_key_is_binding` so app shortcuts win only when bound; **typing-latency rules** (no allocations on keystroke path, Equatable row gating, no app-level display link); reading the user's `~/.config/ghostty/config` | `GhosttyTerminalView.swift`, `CLAUDE.md` latency notes                                  | Vendored GhosttyTerminal already covers most; adopt the latency discipline as review rules for `TerminalViewport`/`PaneGrid`. Ghostty config inheritance shipped 2026-07-03 (inlined config)                                                                                                |
| GPU resource reclaim         | Release Metal swap-chain/IOSurface of occluded surfaces while keeping the session alive; rebuild on re-show                                                                                                                                                                               | fork API `ghostty_surface_set_renderer_realized`, `RendererRealizationController.swift` | Future perf work: requires a libghostty build change (our binary is Lakr233's trimmed build). Track as an upstream/fork task for Workstream 21, not copyable today                                                                                                                          |
| Shortcuts model              | Workspace/surface dual-axis shortcut families (⌘1-8 workspaces, ⌃1-8 tabs, ⌘D/⌘⇧D splits, ⌥⌘arrows directional focus); **palette shortcut clearable so the keypress reaches the terminal**                                                                                                | README shortcuts, `CommandPaletteShortcutRouting.swift`                                 | Keybinding module (Workstream 14). Terminal-first rule: any Fenrir shortcut must be clearable/overridable so it can fall through to the pane (aligns D-028)                                                                                                                                 |
| Distribution                 | DMG + Homebrew cask + **Sparkle auto-update**, nightly as separate bundle id                                                                                                                                                                                                              | README install, `Sources/Update/`                                                       | Workstream 23 adopts the same shape around `package-app.sh`                                                                                                                                                                                                                                 |
| Philosophy                   | "A primitive, not a solution": scriptable everything, no forced agent workflow                                                                                                                                                                                                            | README "Zen of cmux"                                                                    | Keep Fenrir's base client unopinionated about agent workflow; Fenrir's opinionated layer (workflows) stays server-side and optional                                                                                                                                                         |

## 2. Copy from Supacode (secondary: boundaries, projections, installers, product loops)

| Area                    | What to copy                                                                                                                                                                                                                                                                  | Evidence in Supacode                                                                    | How it lands in Fenrir                                                                                                                                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar performance     | **Cached, reducer-computed `SidebarStructure`** recomputed only for actions that affect structure, Equatable-diffed to avoid no-op invalidation; per-row/per-tab **projections** so leaf churn never re-renders siblings                                                      | `SidebarStructure.swift` (1015 lines), `TerminalClient.Event.worktreeProjectionChanged` | Already codified (D-027/D-041 row-level caches); use Supacode's concrete recompute-gating + Equatable-diff pattern in `WorkspaceIndex` projections                                                                                                                                     |
| Runtime/state boundary  | Terminal runtime **outside** the state framework, bridged by a narrow typed command/event `AsyncStream` client; no notification-center coupling between features                                                                                                              | `TerminalClient.swift`, AGENTS.md                                                       | Validates Fenrir's existing Actions/Services split (D-015/D-026); use as review benchmark, not new work                                                                                                                                                                                |
| Hook installers         | **install = uninstall + append** in one atomic read-modify-write; ownership decided solely by a trailing **sentinel marker** with legacy-fingerprint fallbacks; tri-state `installed/outdated/notInstalled`; rollback on partial install; user-authored entries never touched | `AgentHookSettingsFileInstaller.swift`, `AgentHookCommandOwnership.swift`               | `ManagedAgentIntegrationProvisioner` / `ProviderStructuredAgentIntegrationProvisioner` already follow this (D-039); adopt the install=uninstall+append hardening where not yet present                                                                                                 |
| Presence OSC discipline | Single source of truth for **emit and parse** of the presence OSC (shell snippets generated from the same definitions); base64 title/body; stay under libghostty's 2048-byte OSC ceiling; pid liveness sweep to reap crashed agents; awaiting-input ≠ busy shimmer semantics  | `AgentPresenceOSC.swift`, `AgentPresenceFeature.swift`                                  | D-038 implementation details: generate hook emitters from the same Swift definitions the parser uses; add the liveness sweep for local panes; presence taxonomy already matches                                                                                                        |
| Worktree product loop   | **Worktree-per-task lifecycle**: create (pending → setup script), archive (script), delete (script), copy untracked/ignored on create, lock-with-owner metadata, streamed creation progress                                                                                   | `RepositoriesFeature.swift`, `GitClient.swift`, `supacode.json`                         | This is the agentic-dev loop Fenrir Desktop already has server-side; the native client copies the **UX shape** (pending rows, lifecycle states, per-repo setup/archive scripts) implemented over Fenrir server/VCS contracts — never app-local git                                     |
| Run scripts             | `ScriptDefinition` model (run/test/lint/format/custom), repo + global merge with repo precedence, **Run split-button** (primary = run/stop, dropdown = all scripts + manage), forged-kind protection                                                                          | `ScriptMenu` in `WorktreeDetailView.swift`, `ScriptDefinition.swift`                    | Adopt the model and the toolbar surface (requires D-041 amendment, see §4). Execution is Fenrir-own: scripts run as **real tmux panes** with managed-process metadata (D-019/D-034), not app-local blocking processes — that also gives the D-041 "dev servers" sidebar group its rows |
| Open-in-editor          | `OpenWorktreeAction` catalogue (~35 targets: editors, terminals, git clients, Finder, `$EDITOR`), split-button with per-repo/global default persistence                                                                                                                       | `OpenWorktreeAction.swift` (368 lines)                                                  | Pure client feature; port the catalogue + split-button (requires D-041 amendment). Path comes from workspace identity                                                                                                                                                                  |
| Palette ranking         | Recency map persisted per item id, blended with **priority tiers** when query is empty; fuzzy scorer when not; hotkey badges on items; PR/CI action items                                                                                                                     | `CommandPaletteFeature.swift`, `CommandPaletteItem.swift`                               | D-029 keeps Fenrir's prefix domains; adopt recency+tier ranking and hotkey badges. PR/CI actions arrive only when a server-side PR contract exists                                                                                                                                     |
| Settings hygiene        | Schema-versioned settings file, idempotent migrator with pre-migration backup, lossy decode for forward compat                                                                                                                                                                | `SidebarPersistenceMigrator.swift`, `Lossy.swift`                                       | `Settings` module (D-030) adopts the migration/backup discipline                                                                                                                                                                                                                       |
| Theme sync toggle       | "App theme drives terminal theme" as an explicit setting, honoring the user's Ghostty config when off                                                                                                                                                                         | `terminalThemeSyncEnabled`, `GhosttyColorSchemeSyncView.swift`                          | D-041 theming: Fenrir token themes drive the Ghostty palette when on; user's Ghostty config wins when off (config inheritance already shipped)                                                                                                                                         |

## 3. Fenrir-owned (copy neither; references must be adapted to this)

- **Server-owned tmux kernel + WS RPC + actor/auth model** (D-002, D-004,
  D-008, D-011, D-012): cmux has no server and snapshots scrollback to
  survive relaunch; Supacode leans on zmx. Fenrir's tmux/server already gives
  durable sessions, multiuser, and remote — both references' persistence
  machinery is explicitly **not** copied. Remote/SSH is the Fenrir server
  story; from cmux we keep only remote UX semantics (remote workspace rows,
  drag-to-upload, remote ports surfaced), not the uploaded-daemon transport.
- **Window/tab/pane identity = tmux identity** (D-010, D-019): one native
  window = one workspace = one tmux session; tabs are tmux windows; no
  client-only fake panes. cmux's many-workspaces-per-window vertical tabs and
  Supacode's single-window worktree sidebar both diverge here; Fenrir's
  sidebar workspace tree plays the role of cmux's vertical tabs without
  breaking the tmux mapping.
- **Module architecture** (D-015/D-016/D-017): no TCA (Supacode), no
  god-objects (cmux's 18k-line `AppDelegate`/16k-line `ContentView` are the
  anti-pattern our module map exists to prevent). Reference code is studied
  for behavior, never for structure.
- **Workflows** (D-020, D-025): server-executed durable workflows have no
  equivalent in either reference; native client is visualization/control only.
- **Agent write authority + composer** (D-021, D-022, D-040): bounded context
  capture, no client writes into panes, server-orchestrated prompt
  submission. cmux's `send-keys`-style automation exists behind its socket;
  Fenrir deliberately does not expose agent-driven pane writes in the base
  client.
- **Theming registry** (D-041): shared token registry with Fenrir Desktop.
  References only contribute the sync-toggle idea.
- **Privacy/diagnostics rules** (D-031) and **keymap import via server
  runtime** (D-028): Fenrir-specific, keep.
- **Provider-agnostic contracts** (repo root rule, D-039): cmux hardcodes 15
  agents, Supacode a fixed 7-agent enum; Fenrir keeps adapters behind a
  common contract where adding an agent is data/adapter work, not new code
  paths.

## 4. Tensions that needed explicit decision updates

> Resolved 2026-07-03: the recommendations below are now recorded as D-042
> (approval feed, amends D-037), D-043 (generic notification ingestion,
> amends D-038), D-044 (agent session resume, extends D-039), and D-045
> (titlebar controls and row metadata, amends D-041) in
> `docs/native-terminal-client-decisions.md`. This section is kept as the
> rationale trail.

1. **Approvals surface (Feed) vs D-037.** cmux's Feed is a native approval
   surface (PermissionRequest / ExitPlanMode / AskUserQuestion cards) fed by
   hooks with a ≤120s soft-wait semaphore and TUI fallback on timeout — the
   agent never blocks on the native UI. Current D-037 says "no approval
   panel; approvals happen in the agent's TUI". With cmux primary this is the
   single biggest product gap between Fenrir's plan and its primary
   reference. Recommendation: amend D-037 to allow a **Feed-style approval
   overlay** (D-023 surface, hook-fed, soft-wait + fallback, no transcript,
   no chat) as a post-base milestone. The no-chat-view stance is unaffected —
   cmux itself has no chat view on macOS.
2. **D-041 titlebar additions.** The "operations deck" contract deliberately
   excludes Run/editor controls. Adopting Supacode's Run split-button and
   open-in-editor split-button (and a cmux-style notifications panel button)
   requires amending D-041's titlebar spec and the mockup. Recommendation:
   amend; all three earn their chrome under the deck's own "chrome pays
   rent" rule.
3. **Standard notification OSC.** D-038 reserves a Fenrir OSC for presence;
   cmux additionally honors OSC 9/99/777 from arbitrary programs.
   Recommendation: record in D-038 that generic notification OSC parsing is
   in scope for `TerminalViewport` and feeds Notifications (metadata-only
   rules unchanged).
4. **Agent session resume.** No decision currently covers relaunch-time agent
   resume (cmux: hooks record session ids, restore replays `--resume`).
   Recommendation: new decision under D-039's umbrella; tmux keeps the pane
   alive across client restarts, so native resume only matters after
   pane/process death — scope it to that case.
5. **D-041 sidebar row metadata.** Branch is specified; PR status/number,
   ports, and latest-notification line (cmux row metadata) are not, and PR
   data needs a server contract. Recommendation: track as a D-041 amendment
   plus a server-side git/PR probe contract decision.

## 5. Suggested order

1. Attention loop (cmux): rings, row lighting, jump-to-unread, notifications
   panel, macOS banner routing — this is cmux's core value and Fenrir's
   presence plumbing (D-038/D-039) already feeds it.
2. Run scripts + open-in-editor (Supacode surfaces over tmux panes) with the
   D-041 amendment.
3. Agent resume via hooks (cmux) — after presence hooks are proven.
4. Palette ranking (Supacode) + shortcut clearability (cmux).
5. Feed-style approvals (cmux) — after D-037 amendment; biggest new surface.
6. Sidebar row metadata enrichment (cmux) — gated on server PR probe
   contract.
7. Distribution polish (cmux Sparkle model) per Workstream 23.
