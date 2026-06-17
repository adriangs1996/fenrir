-- Fenrir theme.lua — apply app-selected colorscheme
--
-- neovimLua.ts is kept in sync manually until a build-time loader
-- exists for these snippets.

local colorscheme = ...
if type(colorscheme) ~= "string" or #colorscheme == 0 then
  return false
end

vim.g.fenrir_colorscheme = colorscheme
local ok, err = pcall(vim.cmd.colorscheme, colorscheme)
if not ok then
  vim.notify("[fenrir] colorscheme failed: " .. tostring(err), vim.log.levels.WARN)
  return false
end

return true
