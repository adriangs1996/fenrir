# Maintainability Plans

1. `01-shared-model-normalization.md`
2. `02-typed-ipc-boundaries.md`
3. `03-split-codex-app-server-manager.md`
4. `04-split-chatview-component.md`
5. `05-zod-persisted-state-validation.md`
6. `06-provider-logstream-lifecycle.md`
7. `07-ci-quality-gates.md`
8. `08-precommit-format-and-lint.md`
9. `09-event-state-test-expansion.md`
10. `10-unify-process-session-abstraction.md`

## Neovim Editor Integration

See `neovim/` subdirectory:

11. `neovim/neovim-01-contracts.md` — Schemas, error types, RPC methods, keybinding command
12. `neovim/neovim-02-server-msgpack-rpc.md` — Server-side msgpack-RPC codec for nvim stdin/stdout
13. `neovim/neovim-03-server-neovim-manager.md` — NeovimManager Effect service (process lifecycle)
14. `neovim/neovim-04-server-binary-websocket.md` — Binary WebSocket route `/ws/neovim`
15. `neovim/neovim-05-web-msgpack-bridge.md` — Browser msgpack codec + binary WebSocket client
16. `neovim/neovim-06-web-grid-state.md` — Grid state manager + highlight manager + font metrics
17. `neovim/neovim-07-web-renderer.md` — Canvas2D + WebGL renderer
18. `neovim/neovim-08-web-input-handlers.md` — Keyboard + mouse input translation
19. `neovim/neovim-09-web-editor-component.md` — React component + hooks + Zustand store
20. `neovim/neovim-10-web-chatview-integration.md` — ChatView wiring + Cmd+E keybinding
