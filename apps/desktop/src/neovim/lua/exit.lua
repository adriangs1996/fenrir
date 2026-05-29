-- Fenrir exit.lua — graceful shutdown (:qa)
-- Force-quit unless the user opted into a confirmation prompt.
-- The Fenrir shell tears the process down right after this runs;
-- modified buffers are intentionally discarded so the IPC channel
-- can close promptly.
--
-- This file is the canonical source; the TS string constant in
-- neovimLua.ts is kept in sync manually until a build-time loader
-- is wired up. Touched in plan 07 for session save.

if vim.g.fenrir_confirm_quit then
  vim.cmd("confirm qa")
else
  vim.cmd("qa!")
end
