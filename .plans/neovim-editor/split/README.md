# Neovim Editor — Split Plans

Granular sub-plans dispatchable to a smaller model (e.g., Sonnet). Each file is self-contained: imports, code snippets, validation, done criteria. Dependencies declared via `depends_on:` frontmatter.

## Topological order

A bead can run as soon as all its `depends_on` plans are merged. Many splits run in parallel.

| Plan | Depends on | What it does |
|---|---|---|
| `neovim-01a-input-schemas` | — | Contracts: status, snapshot, input schemas |
| `neovim-01b-events-errors` | 01a | Contracts: lifecycle events + 7 tagged errors |
| `neovim-01c-rpc-methods` | 01b | Contracts: WS_METHODS + Rpc.make + WsRpcGroup |
| `neovim-01d-keybindings-export` | 01c | Contracts: keybinding command + barrel export |
| `neovim-02a-msgpack-rpc-service` | — | Server: MsgpackRpc service interface |
| `neovim-02b-msgpack-rpc-layer` | 02a | Server: MsgpackRpcFactoryLive impl |
| `neovim-02c-msgpack-rpc-tests` | 02b | Server: 10 codec tests |
| `neovim-03a-manager-service` | 01b, 02a | Server: NeovimManager service interface |
| `neovim-03b-manager-spawn` | 03a, 02b | Server: spawn/kill/state/lifecycle |
| `neovim-03c-manager-ui-input` | 03b | Server: attach/detach/input/mouse/cmd/resize |
| `neovim-03d-manager-composition-tests` | 03c | Server: layer wiring + integration tests |
| `neovim-04a-rpc-handlers` | 01c, 03c | Server: 4 JSON RPC handlers in ws.ts |
| `neovim-04b-binary-ws-route` | 04a | Server: binary WS auth + upgrade scaffold |
| `neovim-04c-binary-ws-dispatch` | 04b | Server: binary frame dispatch + cleanup |
| `neovim-05a-msgpack-codec` | 01a | Web: 6 encoders + decodeFrame |
| `neovim-05b-redraw-types` | — | Web: 25 RedrawEvent type defs |
| `neovim-05c-redraw-parser` | 05b | Web: parseRedrawBatch + per-event parsers |
| `neovim-05d-bridge` | 05a, 05c | Web: NeovimBridge class |
| `neovim-05e-bridge-tests` | 05d | Web: codec/parser/bridge tests |
| `neovim-06a-grid-state-skeleton` | 05b | Web: GridStateManager scaffold |
| `neovim-06b-grid-event-handlers` | 06a, 06d | Web: grid_*/highlight handlers |
| `neovim-06c-window-mode-handlers` | 06b | Web: win/mode/global handlers |
| `neovim-06d-highlight-manager` | 05b | Web: HighlightManager + cache |
| `neovim-06e-font-metrics-tests` | 06c, 06d | Web: FontMetrics + grid/hl tests |
| `neovim-07a-canvas-renderer-row` | 06d, 06e | Web: CanvasRenderer ctor + renderRow + decorations |
| `neovim-07b-canvas-renderer-cursor` | 07a | Web: renderCursor + resize + setFont |
| `neovim-07c-cursor-renderer` | 07b | Web: CursorRenderer with blink |
| `neovim-07d-webgl-init` | 07b | Web: WebGLCompositor ctor + shaders + buffers |
| `neovim-07e-webgl-composite` | 07d | Web: composite + fallback + resize + dispose |
| `neovim-07f-renderer-tests` | 07b, 07c | Web: canvas mock setup + 10 renderer tests |
| `neovim-08a-keyboard-handler` | — | Web: keyEventToNeovimInput + IME |
| `neovim-08b-mouse-handler` | 06e | Web: mouse + wheel + multigrid resolver |
| `neovim-08c-input-tests` | 08a, 08b | Web: 18 keyboard + 11 mouse tests |
| `neovim-09a-zustand-store` | — | Web: editor store |
| `neovim-09b-bridge-hook` | 05d, 09a | Web: useNeovimBridge |
| `neovim-09c-renderer-hook` | 06e, 07c, 07e | Web: useNeovimRenderer with rAF coalesce |
| `neovim-09d-keyboard-mouse-hooks` | 08a, 08b, 09b | Web: useNeovimKeyboard + useNeovimMouse |
| `neovim-09e-editor-component` | 09b, 09c, 09d | Web: NeovimEditor.tsx |
| `neovim-09f-statusbar-export` | 09e | Web: status bar + barrel export |
| `neovim-10a-rpc-client-env-api` | 04a, 09f | Web: WsRpcClient + EnvironmentApi neovim namespace |
| `neovim-10b-chatview-toggle` | 09f, 10a | Web: ChatView editor toggle + render |
| `neovim-10c-keybinding-spawn-ai` | 10b | Web: ⌘E shortcut + neovimFocus + checktime hook |

## Critical path

The longest dep chain is roughly:

```
01a → 01b → 03a → 03b → 03c → 04a → 04b → 04c
                                   └→ 10a → 10b → 10c
05b → 05c → 05d → 09b → 09e → 09f
06a → 06b → 06c → 06e → 07a → 07b → 07c → 07e → 09c → 09e
08a/08b → 09d → 09e
```

Fan-out is wide: 01a, 02a, 05b, 06d, 08a, 09a all start from no deps, so 6 splits can begin immediately.

## How to dispatch

Each split frontmatter:

```yaml
---
depends_on:
  - some-plan-id
  - other-plan-id
---
```

A bead/dispatcher tool reads this frontmatter to gate execution. A split with `depends_on: []` is ready immediately.

## Originals

The unsplit plans live one level up at `.plans/neovim-editor/neovim-{01..10}-*.md`. Treat them as overview specs; the splits are the dispatchable units.
