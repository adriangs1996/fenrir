-- Fenrir init.lua — baseline
-- Sets vim.g.fenrir for user config detection and creates the
-- _G.fenrir.private namespace for GUI ↔ Neovim RPC helpers.
--
-- This file is the canonical source; the TS string constant in
-- neovimLua.ts is kept in sync manually until a build-time loader
-- is wired up.

vim.g.fenrir = true

_G.fenrir = _G.fenrir or {}
_G.fenrir.private = _G.fenrir.private or {}

-- Source ginit.vim if the user has one (GUI-only init, mirrors neovide).
pcall(vim.cmd, "runtime! ginit.vim")
