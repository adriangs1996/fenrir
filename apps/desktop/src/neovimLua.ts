/**
 * Lua snippets executed inside the embedded Neovim after `nvim_ui_attach`.
 *
 * Mirrors neovide's pattern (`src/bridge/setup.rs` + `lua/init.lua` +
 * `lua/exit_handler.lua`). Kept inline as TS string constants so tsdown
 * bundles them into `dist-electron/main.js` without extra resource handling.
 *
 * Public surface inside Neovim:
 *   - `vim.g.fenrir`               → user config can detect Fenrir.
 *   - `_G.fenrir.private`          → namespace for future GUI ↔ Neovim RPC
 *                                    helpers (clipboard, file drop, IME).
 *   - `vim.g.fenrir_confirm_quit`  → opt-in `:confirm qa` instead of `:qa!`.
 *
 * Keep these snippets dependency-free: they run before any user plugin manager.
 */

export const FENRIR_INIT_LUA = `
vim.g.fenrir = true

_G.fenrir = _G.fenrir or {}
_G.fenrir.private = _G.fenrir.private or {}

-- Source ginit.vim if the user has one (GUI-only init, mirrors neovide).
pcall(vim.cmd, "runtime! ginit.vim")
`.trim();

export const FENRIR_EXIT_LUA = `
-- Force-quit unless the user opted into a confirmation prompt. The Fenrir
-- shell tears the process down right after this runs; modified buffers are
-- intentionally discarded so the IPC channel can close promptly.
if vim.g.fenrir_confirm_quit then
  vim.cmd("confirm qa")
else
  vim.cmd("qa!")
end
`.trim();
