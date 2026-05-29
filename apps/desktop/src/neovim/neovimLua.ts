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

// ─────────────────────────────────────────────────────────────
// init.lua — baseline (vim.g.fenrir, _G.fenrir.private namespace)
// ─────────────────────────────────────────────────────────────
export const FENRIR_INIT_LUA = `
vim.g.fenrir = true

_G.fenrir = _G.fenrir or {}
_G.fenrir.private = _G.fenrir.private or {}

-- Source ginit.vim if the user has one (GUI-only init, mirrors neovide).
pcall(vim.cmd, "runtime! ginit.vim")
`.trim();

// ─────────────────────────────────────────────────────────────
// exit.lua — graceful shutdown (:qa)
// Currently unused via NeovimSource; wired directly in main.ts.
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// bridge.lua — app-callable functions exposed under _G.fenrir.private.bridge
// ─────────────────────────────────────────────────────────────
export const FENRIR_BRIDGE_LUA = `
local M = {}

-- Open a file at an optional 1-based line / col. Centers the cursor.
function M.open_file(path, line, col)
  if type(path) ~= "string" or #path == 0 then return end
  vim.cmd.edit(vim.fn.fnameescape(path))
  if type(line) == "number" and line > 0 then
    local target_col = (type(col) == "number" and col > 0) and (col - 1) or 0
    pcall(vim.api.nvim_win_set_cursor, 0, { line, target_col })
    vim.cmd("normal! zz")
  end
end

-- Capture the current visual selection (or the last one if no selection
-- is active) and notify the host. The host listens on channel 0
-- (msgpack-rpc parent) for "fenrir_send_to_composer".
function M.send_selection()
  local mode = vim.fn.mode()
  local in_visual = mode == "v" or mode == "V" or mode == "\\22" -- v, V, <C-V>

  if in_visual then
    -- Exit visual to populate '< / '>
    vim.cmd("normal! \\27") -- <Esc>
  end

  local sline = vim.fn.line("'<")
  local scol = vim.fn.col("'<")
  local eline = vim.fn.line("'>")
  local ecol = vim.fn.col("'>")

  if sline == 0 or eline == 0 then
    vim.notify("[fenrir] no selection to send", vim.log.levels.WARN)
    return
  end

  local lines = vim.api.nvim_buf_get_lines(0, sline - 1, eline, false)
  -- Trim columns on first/last line for char-wise selections
  if #lines > 0 and mode ~= "V" then
    lines[#lines] = string.sub(lines[#lines], 1, ecol)
    lines[1] = string.sub(lines[1], scol)
  end
  local text = table.concat(lines, "\\n")
  local file = vim.api.nvim_buf_get_name(0)

  vim.rpcnotify(0, "fenrir_send_to_composer", {
    file = file,
    lineStart = sline,
    lineEnd = eline,
    text = text,
  })
end

_G.fenrir.private.bridge = M
return true
`.trim();

export const FENRIR_SESSION_AUTOSAVE_DELAY_MS = 250;
export const FENRIR_SESSION_AUTOSAVE_EVENTS = [
  "BufEnter",
  "BufDelete",
  "BufFilePost",
  "DirChanged",
  "TabEnter",
  "TabClosed",
  "WinEnter",
  "WinClosed",
] as const;

const FENRIR_SESSION_AUTOSAVE_EVENTS_LUA = FENRIR_SESSION_AUTOSAVE_EVENTS.map(
  (event) => `"${event}"`,
).join(", ");

// ─────────────────────────────────────────────────────────────
// session.lua — per-cwd :mksession save/restore + debounced autosave.
// Reads vim.g.fenrir_session_dir + vim.g.fenrir_session_hash set by host.
// Restore is invoked explicitly by the host after bootstrap so it is
// deterministic during embedded respawns.
// ─────────────────────────────────────────────────────────────
export const FENRIR_SESSION_LUA = `
local M = {
  _restoring = false,
  _save_generation = 0,
  _saving = false,
}

local SESSIONOPTIONS = "buffers,curdir,folds,help,tabpages,winsize,winpos,localoptions"
local AUTOSAVE_DELAY_MS = ${FENRIR_SESSION_AUTOSAVE_DELAY_MS}
local AUTOSAVE_EVENTS = { ${FENRIR_SESSION_AUTOSAVE_EVENTS_LUA} }

local function paths()
  local dir = vim.g.fenrir_session_dir
  local hash = vim.g.fenrir_session_hash
  if not dir or not hash then return nil end
  return {
    session = dir .. "/" .. hash .. ".vim",
    meta = dir .. "/" .. hash .. ".meta.json",
  }
end

function M.save()
  local p = paths()
  if not p then return false end
  if M._saving then return false end
  M._saving = true

  -- Configure sessionoptions for embedded use.
  -- Skip 'options' (avoid leaking GUI-specific opts).
  -- Skip 'globals' (collide with user vars).
  local previous_sessionoptions = vim.o.sessionoptions
  vim.opt.sessionoptions = SESSIONOPTIONS

  local ok, err = pcall(vim.cmd, "mksession! " .. vim.fn.fnameescape(p.session))
  vim.o.sessionoptions = previous_sessionoptions
  M._saving = false
  if not ok then
    vim.notify("[fenrir] mksession failed: " .. tostring(err), vim.log.levels.WARN)
    return false
  end

  -- Sidecar meta JSON for debug / eviction display.
  local meta = vim.fn.json_encode({
    cwd = vim.fn.getcwd(),
    saved_at = os.date("!%Y-%m-%dT%H:%M:%SZ"),
    nvim_version = vim.version(),
  })
  local f = io.open(p.meta, "w")
  if f then
    f:write(meta)
    f:close()
  end

  return true
end

function M.schedule_save()
  if M._restoring then return false end
  M._save_generation = M._save_generation + 1
  local generation = M._save_generation
  vim.defer_fn(function()
    if M._save_generation ~= generation then return end
    if M._restoring then return end
    M.save()
  end, AUTOSAVE_DELAY_MS)
  return true
end

function M.restore()
  local p = paths()
  if not p then return false end
  if vim.fn.filereadable(p.session) ~= 1 then return false end
  -- Source quietly. swap files are an annoying prompt source — set shortmess+=A.
  local prev = vim.opt.shortmess:get()
  pcall(vim.opt.shortmess.append, vim.opt.shortmess, "A")
  M._restoring = true
  local ok, err = pcall(vim.cmd, "silent! source " .. vim.fn.fnameescape(p.session))
  M._restoring = false
  vim.opt.shortmess = prev
  if not ok then
    vim.notify("[fenrir] session restore failed: " .. tostring(err), vim.log.levels.WARN)
    return false
  end
  return true
end

_G.fenrir.private.session = M

local group = vim.api.nvim_create_augroup("FenrirSession", { clear = true })

for _, event in ipairs(AUTOSAVE_EVENTS) do
  pcall(vim.api.nvim_create_autocmd, event, {
    group = group,
    callback = function()
      M.schedule_save()
    end,
  })
end

pcall(vim.api.nvim_create_autocmd, "VimLeavePre", {
  group = group,
  callback = function()
    M.save()
  end,
})

return true
`.trim();

// ─────────────────────────────────────────────────────────────
// cmd.lua — :Fenrir user command with subcommands.
// ─────────────────────────────────────────────────────────────
export const FENRIR_CMD_LUA = `
local SUBCOMMANDS = {
  ["focus-chat"] = function(_)
    vim.rpcnotify(0, "fenrir_cmd", { subcommand = "focus-chat" })
  end,
  ["send"] = function(_)
    if _G.fenrir and _G.fenrir.private and _G.fenrir.private.bridge then
      _G.fenrir.private.bridge.send_selection()
    end
  end,
  ["save-and-quit"] = function(_)
    if _G.fenrir and _G.fenrir.private and _G.fenrir.private.session then
      _G.fenrir.private.session.save()
    end
    vim.cmd("qa!")
  end,
  ["new-thread"] = function(_)
    vim.rpcnotify(0, "fenrir_cmd", { subcommand = "new-thread" })
  end,
  ["submit"] = function(_)
    vim.rpcnotify(0, "fenrir_cmd", { subcommand = "submit" })
  end,
  ["open"] = function(args)
    local path = args.fargs[2]
    if not path or #path == 0 then
      vim.notify("[fenrir] :Fenrir open <path> — path required", vim.log.levels.WARN)
      return
    end
    if _G.fenrir and _G.fenrir.private and _G.fenrir.private.bridge then
      _G.fenrir.private.bridge.open_file(path)
    end
  end,
  ["log"] = function(_)
    print(vim.inspect(_G.fenrir))
  end,
}

vim.api.nvim_create_user_command("Fenrir", function(args)
  local sub = args.fargs[1]
  if not sub then
    vim.notify("[fenrir] :Fenrir <subcommand>. Try: focus-chat, send, save-and-quit, new-thread, submit, open, log", vim.log.levels.INFO)
    return
  end
  local fn = SUBCOMMANDS[sub]
  if not fn then
    vim.notify("[fenrir] unknown subcommand: " .. sub, vim.log.levels.WARN)
    return
  end
  fn(args)
end, {
  nargs = "+",
  complete = function(_, line)
    local parts = vim.split(line, "%s+")
    if #parts <= 2 then
      local keys = {}
      for k in pairs(SUBCOMMANDS) do table.insert(keys, k) end
      table.sort(keys)
      return keys
    end
    -- Subcommand-specific completion (e.g. :Fenrir open <path>) -> file completion.
    if parts[2] == "open" then
      return vim.fn.getcompletion(parts[#parts] or "", "file")
    end
    return {}
  end,
})
`.trim();

// ─────────────────────────────────────────────────────────────
// events.lua — autocmds → rpcnotify "fenrir_autocmd"
// (NB: the neovim Node client swallows any notification whose name ends in
// "_event" unless it starts with "nvim_buf_", so we avoid that suffix.)
// ─────────────────────────────────────────────────────────────
export const FENRIR_EVENTS_LUA = `
local group = vim.api.nvim_create_augroup("FenrirEvents", { clear = true })

local function notify(payload)
  vim.rpcnotify(0, "fenrir_autocmd", payload)
end

vim.api.nvim_create_autocmd("BufEnter", {
  group = group,
  callback = function(args)
    local buf = args.buf
    -- Skip non-file buffers (terminal, help, prompt, etc.) by checking buftype.
    if vim.bo[buf].buftype ~= "" then return end
    local file = vim.api.nvim_buf_get_name(buf)
    if file == "" then return end
    notify({ kind = "buf_enter", file = file, ft = vim.bo[buf].filetype })
  end,
})

vim.api.nvim_create_autocmd("BufWritePost", {
  group = group,
  callback = function(args)
    local file = vim.api.nvim_buf_get_name(args.buf)
    if file == "" then return end
    notify({ kind = "buf_write_post", file = file })
  end,
})

vim.api.nvim_create_autocmd("BufModifiedSet", {
  group = group,
  callback = function(args)
    local buf = args.buf
    if vim.bo[buf].buftype ~= "" then return end
    local file = vim.api.nvim_buf_get_name(buf)
    if file == "" then return end
    notify({ kind = "buf_modified_set", file = file, modified = vim.bo[buf].modified })
  end,
})
`.trim();
