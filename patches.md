# Upstream Cherry-Pick Patch Guide — Tier 3

## Upstream <https://github.com/pingdotgg/t3code>

Hand-off notes for agent picking up Tier 3. Tiers 1 + 2 already merged.

## Repo state

- Fork base `chore/upstream-update` already on top of `e82b9873` (last common upstream).
- Branches merged so far: `chore/upstream-cherry-pick-tier1`, `chore/upstream-cherry-pick-tier2`.
- Current branch: `upstream-cherry-picks` (collector).
- Local effect: `4.0.0-beta.43` — older API than upstream (`Context.Service` → use `ServiceMap.Service`; `Cache.makeWith({ lookup })` not `(fn, opts)`).
- Local contracts namespace: `@fenrir/contracts`, shared: `@fenrir/shared`. Upstream: `@t3tools/*`. Always rebrand on conflict.
- Local brand schema API: `.makeUnsafe()` (upstream renamed to `.make()`).
- Local Claude effort type: `ClaudeCodeEffort` (upstream renamed to `ClaudeAgentEffort`).
- Local extra surface upstream lacks: traffic-lens, plan-runner, metasploit, global-actions, Neovim editor module, embedded browser, terminal split into `apps/web/src/modules/terminal/`.
- Local LACKS upstream surface: LegendList chat virtualizer, OpenCode provider, Cursor/ACP, command palette, project grouping infrastructure, thread shell summary projection (`projection_threads.pending_approval_count`), thread detail subscription warm-cache, RightPanelSheet (added in tier 2), filePathDisplay (added in tier 2).
- Local migrations occupy IDs 1-25. Migration 26 = `CleanupInvalidProjectionPendingApprovals` (renumbered from upstream 25 to coexist).

## Cherry-pick playbook

### General loop

```
git cherry-pick <sha>          # try
# resolve conflicts (see patterns below)
git add <files>
git -c core.editor=true cherry-pick --continue
```

After a batch:

```
bun install                    # if bun.lock conflicted
bun run typecheck              # diff against pre-pick baseline
bun run --cwd apps/server build
bun run dev                    # smoke
```

### Conflict patterns to expect

| Pattern                                                                                                                 | Resolution                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import { X } from "@t3tools/foo"` vs local `@fenrir/foo`                                                               | Keep local namespace. Drop upstream block.                                                                                                                                                     |
| `Context.Service<...>`                                                                                                  | Replace with `ServiceMap.Service<...>`.                                                                                                                                                        |
| `Cache.makeWith(fn, opts)`                                                                                              | Rewrite as `Cache.makeWith({ ...opts, lookup: fn })`.                                                                                                                                          |
| `BrandId.make(...)` in tests                                                                                            | sed `BrandId.make(` → `BrandId.makeUnsafe(`.                                                                                                                                                   |
| `ClaudeAgentEffort` in adapter                                                                                          | sed → `ClaudeCodeEffort`.                                                                                                                                                                      |
| New file imports via `./terminal-links`                                                                                 | Rewrite to `./modules/terminal` (re-exported).                                                                                                                                                 |
| Deleted-by-us files (DU) for OpenCode/Cursor                                                                            | `git rm -f <file>`, accept removal.                                                                                                                                                            |
| `bun.lock` conflict                                                                                                     | `git checkout HEAD -- bun.lock`, run `bun install` after pick lands.                                                                                                                           |
| Dropped upstream block leaks dangling refs (e.g. `models`, `opus47UpgradeMessage`, `extraArgs`, `dedupedSlashCommands`) | Grep call-sites, swap to local equivalent or remove the `...message: opus47UpgradeMessage` branches outright. **Always grep for every var introduced in the dropped block before continuing.** |
| Migration adds column local doesn't have                                                                                | Drop the SQL statement that touches missing column, keep cleanup statements that work standalone. Renumber migration ID to next free local slot, rename file.                                  |
| Test file references upstream-only schema                                                                               | Delete the test (lower priority than passing build).                                                                                                                                           |
| `.electron-runtime/...` binaries show as conflict                                                                       | Ignore — gitignored runtime artifacts.                                                                                                                                                         |
| Tooltip / Sheet / RightPanelSheet usage missing import                                                                  | Local has the components in `apps/web/src/components/ui/`. Re-add import.                                                                                                                      |

### Empty cherry-picks

`git cherry-pick --skip` if `nothing to commit, working tree clean` after auto-merge — means the change is already covered by something local has.

### Deletion-of-upstream-block trap

If you `<<<<<<< HEAD\n=======\n<upstream block>\n>>>>>>>` and the upstream block introduces a `const X = ...`, deleting it without checking later usages = silent runtime crash.

**Always**: `grep -n "<introduced var>" <file>` after deletion. If post-block code uses it, either:

1. Rewrite uses to local equivalent (preferred — see ClaudeProvider `models` → `allModels`, `opus47UpgradeMessage` → drop).
2. Re-add a stub binding.
3. Delete dependent code blocks too.

### Server runtime crash signature

If `dist/bin.mjs` crashes with `ReferenceError: X is not defined` or `does not provide an export named 'Context'`, you bundled an upstream artifact local effect doesn't support. Look at the failing file, fix, rebuild via `bun run --cwd apps/server build`.

## Tier 3 commits

Listed roughly by **value × risk**. Each row: SHA, scope, dependencies, conflict notes, recommended action.

### A. High value, isolated — pick first

| SHA        | Title                                                      | Files        | Notes                                                                                                                                                                                                    |
| ---------- | ---------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e0117b27` | Claude process leak + archiving + stale session monitoring | 19           | **Memory leak fix.** Touches ClaudeAdapter, session lifecycle. Pre-req: clean Tier 1+2 state. Conflicts: ClaudeAdapter (`extraArgs` already dropped — re-grep), session-runtime files. Worth the effort. |
| `b7c89cf4` | Refresh Codex protocol bindings                            | 7 / 6k lines | Generated bindings — accept upstream wholesale. Conflicts in `apps/server/src/codex/protocol.ts` should resolve as “take theirs”.                                                                        |
| `1cba2f64` | (already in Tier 2)                                        | —            | Skip — already merged.                                                                                                                                                                                   |
| `2e42f3fd` | (already in Tier 2)                                        | —            | Skip.                                                                                                                                                                                                    |

### B. Win/build/CI block — pick as one batch

| SHA                                               | Title                                             | Notes                                                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `6891c77d`                                        | Build for Windows ARM                             | Touches release scripts + electron-builder config. Local has Fenrir branding in builder configs — keep brand, accept new arm64 target entries. |
| `b7df3dfc`                                        | Fix Windows release manifest publishing           | Pair with `6891c77d`.                                                                                                                          |
| `505db9f6`                                        | Try blacksmith for releases                       | Workflow file — local has different release workflow; merge target lists carefully.                                                            |
| `b991b9b9`                                        | Revert to Github Runner for Windows               | Reverts blacksmith for Win — pair with above.                                                                                                  |
| `54179c86`                                        | ubuntu-24.04 runner                               | Trivial.                                                                                                                                       |
| `df9d3400`                                        | Modernize release runners                         | Pair w/ above.                                                                                                                                 |
| `52a60678`                                        | Throttle nightly to every 3h                      | Trivial.                                                                                                                                       |
| `409ff90a`                                        | Nightly release channel                           | 49 files, infra-heavy. Skip if you don't ship nightlies.                                                                                       |
| `9ff31f8c`                                        | Fix nightly desktop product name                  | Depends on `409ff90a`.                                                                                                                         |
| `f9580ff0`                                        | Default nightly desktop builds to nightly channel | Depends on `409ff90a`.                                                                                                                         |
| `c83bc5d4`                                        | Use `v<semver>` tag format                        | Pair with release block.                                                                                                                       |
| `9df3c640`                                        | GitHub App token for release uploads              | Pair.                                                                                                                                          |
| `8ac57f79` / `29cb917a`                           | Guard release jobs upstream success               | Pair.                                                                                                                                          |
| `b2cca674`                                        | Install deps before finalize version bump         | Pair.                                                                                                                                          |
| `2d87574e` / `ada410bc` / `a3f29277` / `a3dadf31` | Release prep commits (v0.0.16/17/20/21)           | Skip — local versioning differs.                                                                                                               |

Rule of thumb: pick the runner/throttle/token commits, **skip nightly-channel block** unless you actually run nightlies.

### C. Provider/protocol big rewrites — decide consciously

| SHA        | Title                                       | Files     | Notes                                                                                                                                                                                                                                                                                                  |
| ---------- | ------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `3b98fe35` | `effect-codex-app-server`                   | 35 / 38k  | Major Codex backend rewrite. Local diverges at `codexAppServerManager.ts`, `provider/codexAppServer.ts`. **Plan a dedicated week.** Rebrand `@t3tools` → `@fenrir`. Convert any `Context.Service` → `ServiceMap.Service`. After this, `aa2d385a` (CODEX_HOME tilde — Tier 1 skipped) becomes pickable. |
| `9c64f12e` | ACP + Cursor provider                       | 98 / 26k  | New provider. All-or-nothing. Adds new contracts, new sidebar surface, new auth flow. If you don't want Cursor, **skip entire commit**.                                                                                                                                                                |
| `ce94feee` | OpenCode provider support                   | 52 / 4.7k | Foundation for OpenCode follow-ups. All-or-nothing. After this, picks unblocked: `306ec4bb`, `055897f0`, `40b3a800`, `37965da0` (37965da0 already partially in Tier 1 — Utils.ts only).                                                                                                                |
| `306ec4bb` | OpenCode lifecycle refactor                 | 14        | Depends on `ce94feee`.                                                                                                                                                                                                                                                                                 |
| `8d1d699f` | Provider model selections → option arrays   | 67        | Big provider-shape refactor. Touches every provider adapter + UI. **Pair with `66c326b8`** (model picker redesign). After this, ClaudeProvider can re-take dropped Tier 2 `getBuiltInClaudeModelsForVersion` / `supportsClaudeOpus47` block.                                                           |
| `66c326b8` | Redesign model picker w/ favorites + search | 41        | Pair w/ above. UX win.                                                                                                                                                                                                                                                                                 |
| `58e5f714` | Provider skill discovery                    | 34        | Provider-shape change. Adds `ServerProviderSkill` contract. Skip unless ACP/Cursor brought in.                                                                                                                                                                                                         |
| `8dba2d64` | Node-native TypeScript for desktop+server   | 140       | Build/runtime change. tsdown configs local has modified for dist outputs — careful. **Highest blast radius.** Defer unless build pain demands.                                                                                                                                                         |
| `3405a64d` | Bump effect to latest beta                  | 174       | Dep bump. After picking, `Context.Service` becomes available; upstream APIs match. **Do this BEFORE the big provider rewrites if you plan to take them — saves rebrand work.**                                                                                                                         |

### D. UI/UX features (medium scope)

| SHA        | Title                                                       | Files      | Notes                                                                                                                                                                                                                                                                                                  |
| ---------- | ----------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `934037cb` | Extensible command palette                                  | 24         | Foundation for `d8d32969`, `44afe784`. New keybinding surface. Local already has `apps/web/src/components/CommandPalette.logic.ts` (deleted in Tier 2 to resolve conflict — restore from history if needed).                                                                                           |
| `d8d32969` | Show thread status in palette                               | 5          | Depends on `934037cb`.                                                                                                                                                                                                                                                                                 |
| `44afe784` | Filesystem browse API + palette project picker              | 35         | Depends on `934037cb`. New IPC method.                                                                                                                                                                                                                                                                 |
| `188a40c3` | Configurable project grouping                               | 21         | New `sidebarProjectGroupingMode` setting + override map. Local Sidebar.tsx already has grouped reorder logic — careful. After this, Tier 2-deferred `cadd7086` (already picked), `4e0c003e` toast (already picked) make more sense; also `54904386` (already picked partial) becomes fully meaningful. |
| `3a1daa87` | Close buttons on toasts                                     | 19         | Touches local-modified `apps/web/src/components/ui/toast.tsx`. Manual merge.                                                                                                                                                                                                                           |
| `96c9306d` | Migrate chat scrolling to LegendList                        | 15 / -2.6k | Big UI rewrite. Drops virtualizer (`@tanstack/react-virtual`). After this, Tier 1 `33dadb5a` autoscroll fix can be re-applied properly (currently neutered). **Disrupts MessagesTimeline.tsx local logic.**                                                                                            |
| `f7fa62aa` | Shell snapshot queries for orchestration                    | 40         | Adds `projection_threads.pending_approval_count`, `pending_user_input_count`, `has_actionable_proposed_plan`, `latest_user_message_at`. **Pre-req for**: Tier 2-deferred `6f699346` (latest user message time), `569fea87` (warm sidebar subs), `c9b07d66` (backfill). Worth picking as a foundation.  |
| `c9b07d66` | Backfill projected shell summaries + stale approval cleanup | 5          | Depends on `f7fa62aa`. After picking, the second SQL statement in migration 026 (`UPDATE projection_threads SET pending_approval_count`) becomes valid — restore it.                                                                                                                                   |
| `008ac5c3` | Cache provider status, gate desktop startup                 | 18         | Restores `apps/server/src/provider/providerStatusCache.ts` (deleted locally — `git checkout chore/upstream-update -- ...` if needed). Local has `serverRuntimeStartup.ts` already.                                                                                                                     |
| `40009735` | Extract backend startup readiness coordination              | 3          | Tier 1 baseline already touched startup paths. Should apply mostly clean.                                                                                                                                                                                                                              |
| `721b6b4c` | Preserve provider bindings on session stop                  | 8          | Provider area conflict likely.                                                                                                                                                                                                                                                                         |

### E. Tier 2 deferrals worth retrying after Tier 3 foundations

Add these once their pre-reqs land (see Pre-req column):

| SHA        | Title                                          | Pre-req                                                                                                                                                                                       |
| ---------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `4ae9de31` | Stabilize auth session cookies per server mode | None — local auth diverged but reachable. Try fresh.                                                                                                                                          |
| `e3004ae8` | Harden secret store + catalog overrides        | None. Try fresh.                                                                                                                                                                              |
| `5e1dd56d` | Launch Args setting (Claude provider)          | After landing, restore `claude.query.extra_args_json` telemetry line dropped from `ClaudeAdapter.ts` in Tier 1 (search for `claude.query.settings_json` and add `extra_args_json` line back). |
| `5fa09fa2` | [codex] composer footer compact                | Tier 2 skipped. Try fresh.                                                                                                                                                                    |
| `055897f0` | OpenCode ≥1.14.19 + Wayland                    | Pre-req: `ce94feee`.                                                                                                                                                                          |
| `57b59b5b` | Devcontainer / IDE updates                     | Local `.devcontainer/devcontainer.json` is Fenrir-branded — manual merge.                                                                                                                     |
| `569fea87` | Warm sidebar thread detail subscriptions       | Pre-req: `f7fa62aa`. Re-apply Tier 1 `0d55a428` resolution but this time take upstream's threadDetailSubscriptions infra.                                                                     |
| `6f699346` | Latest user message time for thread timestamps | Pre-req: `f7fa62aa`.                                                                                                                                                                          |
| `97880e88` | Logical-to-physical key in drag reorder        | Pre-req: `188a40c3` (project grouping). Local `reorderProjects(state, dragged, target)` signature differs — accept upstream's array-target signature once grouping infrastructure lands.      |
| `aa2d385a` | CODEX_HOME tilde expansion (full)              | Pre-req: `3b98fe35`. Tier 1 skipped because effect-codex-app-server not in tree.                                                                                                              |
| `40b3a800` | Trim OpenCode model names                      | Pre-req: `ce94feee`.                                                                                                                                                                          |
| `37965da0` | OpenCode text response in commit gen           | Pre-req: `ce94feee`. Note: Tier 1 already pulled the Utils.ts `extractJsonObject` helper — only need OpenCodeTextGeneration.ts side.                                                          |
| `33dadb5a` | Thread timeline autoscroll                     | Pre-req: `96c9306d` (LegendList). Re-apply once virtualizer rewrite lands.                                                                                                                    |

## Skipped from Tier 1 — coverage gaps to track

These were skipped or partially applied. Track for future tiers:

- **`5cf83ffe` smoke manifest merge** — depends on `b7df3dfc` Win manifest (Tier 3.B).
- **`aa2d385a` CODEX_HOME** — see Tier 3.E.
- **`40b3a800` trim OpenCode** — see Tier 3.E.
- **Migration 026 SQL** — second statement (`UPDATE projection_threads SET pending_approval_count`) commented/dropped. Restore after `f7fa62aa` adds the column.
- **`4e0c003e` Sidebar UI** — Tier 1 took only the server-side ThreadDeletionReactor + `force?: boolean` contract. Sidebar `<button>Delete anyway</button>` toast action and inline `removeProject(member, { force: true })` flow were skipped. After project grouping (`188a40c3`) lands, redo upstream `Sidebar.tsx` block.
- **`d22c6f52` user-input pending approvals leak** — Tier 1 dropped the `provider.approval.respond.failed` branch (depends on `c9b07d66`). Re-add after `c9b07d66`.
- **`8dbcf92a` probeClaudeCapabilities** — Tier 1 dropped slash-command parser (`parseClaudeInitializationCommands` / `dedupeSlashCommands`). Re-add after `8d1d699f` + `66c326b8`.

## Recommended order

SKIP github action infra commits

1. **Foundations**: `3405a64d` (effect bump) → makes everything else easier (matching APIs).
2. **High value isolated**: `e0117b27` (leak fix), `b7c89cf4` (Codex bindings).
3. **Provider rewrites cluster** (if any picked): `3b98fe35` → `8d1d699f` → `66c326b8` → `aa2d385a`.
4. **OpenCode cluster** (only if shipping OpenCode): `ce94feee` → `306ec4bb` → `055897f0` → `40b3a800` → `37965da0`.
5. **ACP/Cursor cluster** (only if shipping Cursor): `9c64f12e` standalone.
6. **Shell-summary cluster**: `f7fa62aa` → `c9b07d66` → restore migration 026 statement → `569fea87` → `6f699346`.
7. **Project grouping**: `188a40c3` → `97880e88` → finish `4e0c003e` Sidebar bits.
8. **Command palette**: `934037cb` → `d8d32969` → `44afe784`.
9. **LegendList rewrite**: `96c9306d` → re-apply `33dadb5a`.
10. **Win/CI**: pick from B above.
11. **Build modernization**: `8dba2d64` last (highest blast radius).

## Verification harness

After each batch:

```bash
bun install                              # if bun.lock changed
bun run typecheck 2>&1 | grep "error TS" # diff vs pre-pick baseline
bun run --cwd apps/server build
bun run dev                              # smoke desktop boot
```

Any **new** error after a pick = your fix needed. **Always grep for every variable introduced in the upstream block before deleting that block.**

## Scope discipline

User's repo has substantial divergence (Fenrir branding, plan-runner, traffic-lens, metasploit, Neovim, embedded browser, terminal module split). On every conflict: **local wins by default**. Upstream additive infrastructure either:

1. Coexists (rename, renumber, namespace) — preferred.
2. Adapts to local API (effect Service tag, brand schemas, contract paths).
3. Gets dropped if dependency chain too deep — note in this file.

Never delete user's surface to take upstream's. If a feature needs UI scaffolding the user already removed/replaced, drop the upstream UI part and keep only the backend.
