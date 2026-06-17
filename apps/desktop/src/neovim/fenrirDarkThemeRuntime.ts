import type { EmbeddedNvimThemeRuntimeFile } from "./embeddedThemeRuntime";

const FENRIR_DARK_LUA = String.raw`
-- Fenrir Dark Neovim theme.
-- Mirrors the default dark palette from apps/web/src/index.css.

local M = {}

local palette = {
  bg = "#161616",
  bg_dark = "#101010",
  bg_float = "#1b1b1b",
  bg_inset = "#1f1f1f",
  bg_hover = "#242424",
  fg = "#f5f5f5",
  fg_dim = "#c9c9c9",
  fg_muted = "#818181",
  fg_subtle = "#626262",
  border = "#242424",
  border_strong = "#000000",
  primary = "#366ffb",
  primary_fg = "#ffffff",
  info = "#3b82f6",
  info_fg = "#60a5fa",
  success = "#10b981",
  success_fg = "#34d399",
  warning = "#f59e0b",
  warning_fg = "#fbbf24",
  danger = "#f15757",
  danger_fg = "#f87171",
  mauve = "#cba6f7",
  peach = "#fab387",
  teal = "#94e2d5",
  pink = "#f5c2e7",
  sky = "#89dcfe",
}

local function hex_to_rgb(hex)
  hex = hex:gsub("#", "")
  return tonumber(hex:sub(1, 2), 16), tonumber(hex:sub(3, 4), 16), tonumber(hex:sub(5, 6), 16)
end

local function blend(fg, bg, alpha)
  local fr, fg_, fb = hex_to_rgb(fg)
  local br, bg_, bb = hex_to_rgb(bg)
  local function channel(a, b)
    return math.floor((a * alpha) + (b * (1 - alpha)) + 0.5)
  end
  return string.format("#%02x%02x%02x", channel(fr, br), channel(fg_, bg_), channel(fb, bb))
end

local colors = {
  raw = palette,
  bg = {
    editor = palette.bg,
    window = palette.bg_dark,
    inset = palette.bg_inset,
    elevated = palette.bg_float,
    hover = palette.bg_hover,
  },
  fg = {
    base = palette.fg,
    fg1 = palette.fg,
    fg2 = palette.fg_dim,
    fg3 = palette.fg_muted,
    fg4 = palette.fg_subtle,
  },
  border = {
    window = palette.border_strong,
    editor = palette.border,
    inset = palette.border,
    elevated = palette.border,
    indent_guide = palette.bg_hover,
    indent_guide_active = palette.fg_subtle,
  },
  accent = {
    primary = palette.primary,
    link = palette.info_fg,
    subtle = blend(palette.primary, palette.bg, 0.18),
    contrast = palette.primary_fg,
  },
  states = {
    success = palette.success,
    danger = palette.danger_fg,
    warn = palette.warning_fg,
    info = palette.info_fg,
    merge = palette.mauve,
  },
  syntax = {
    comment = palette.fg_muted,
    string = palette.success_fg,
    number = palette.warning_fg,
    keyword = palette.primary,
    regexp = palette.teal,
    func = palette.info_fg,
    method = palette.info_fg,
    type = blend(palette.fg, palette.info, 0.32),
    interface = blend(palette.fg, palette.info, 0.32),
    variable = palette.fg,
    operator = blend(palette.fg, palette.primary, 0.25),
    punctuation = palette.fg_subtle,
    constant = blend(palette.fg, palette.warning, 0.34),
    enum = blend(palette.fg, palette.info, 0.32),
    enum_member = palette.warning_fg,
    parameter = palette.peach,
    property = palette.warning_fg,
    namespace = palette.teal,
    macro = palette.pink,
    preproc = palette.peach,
    decorator = palette.mauve,
    escape = palette.teal,
    invalid = palette.danger_fg,
    tag = palette.sky,
    attribute = palette.success_fg,
  },
}

local terminal = {
  "#181818",
  palette.danger_fg,
  palette.success_fg,
  palette.warning_fg,
  palette.info_fg,
  palette.mauve,
  palette.teal,
  palette.fg_dim,
  palette.fg_subtle,
  "#ff9b9b",
  "#74f0b3",
  "#ffd36b",
  "#92b9ff",
  palette.pink,
  palette.sky,
  palette.fg,
}

local function set(group, spec)
  vim.api.nvim_set_hl(0, group, spec)
end

local function link(group, target)
  set(group, { link = target })
end

local function set_terminal_colors()
  for index, color in ipairs(terminal) do
    vim.g["terminal_color_" .. (index - 1)] = color
  end
  vim.g.terminal_ansi_colors = terminal
end

function M.colors()
  return colors
end

function M.lualine_theme()
  local c = colors
  return {
    normal = {
      a = { fg = c.accent.contrast, bg = c.accent.primary, gui = "bold" },
      b = { fg = c.accent.primary, bg = c.bg.inset },
      c = { fg = c.fg.fg2, bg = c.bg.window },
    },
    insert = {
      a = { fg = c.bg.editor, bg = c.states.success, gui = "bold" },
      b = { fg = c.states.success, bg = c.bg.inset },
    },
    visual = {
      a = { fg = c.bg.editor, bg = c.syntax.decorator, gui = "bold" },
      b = { fg = c.syntax.decorator, bg = c.bg.inset },
    },
    replace = {
      a = { fg = c.bg.editor, bg = c.states.danger, gui = "bold" },
      b = { fg = c.states.danger, bg = c.bg.inset },
    },
    command = {
      a = { fg = c.bg.editor, bg = c.states.warn, gui = "bold" },
      b = { fg = c.states.warn, bg = c.bg.inset },
    },
    terminal = {
      a = { fg = c.bg.editor, bg = c.states.info, gui = "bold" },
      b = { fg = c.states.info, bg = c.bg.inset },
    },
    inactive = {
      a = { fg = c.fg.fg4, bg = c.bg.window },
      b = { fg = c.fg.fg4, bg = c.bg.window },
      c = { fg = c.fg.fg3, bg = c.bg.window },
    },
  }
end

function M.bufferline_highlights()
  local c = colors
  local fill = c.bg.window
  local tab = c.bg.window
  local selected = c.bg.editor
  local visible = c.bg.inset
  local muted = c.fg.fg3
  local subtle = c.fg.fg4

  return {
    fill = { bg = fill },
    background = { fg = muted, bg = tab },
    tab = { fg = muted, bg = tab },
    tab_selected = { fg = c.fg.base, bg = selected, bold = true },
    tab_separator = { fg = fill, bg = tab },
    tab_separator_selected = { fg = fill, bg = selected },
    tab_close = { fg = subtle, bg = tab },
    close_button = { fg = subtle, bg = tab },
    close_button_visible = { fg = muted, bg = visible },
    close_button_selected = { fg = c.states.danger, bg = selected },
    buffer_visible = { fg = c.fg.fg2, bg = visible },
    buffer_selected = { fg = c.fg.base, bg = selected, bold = true, italic = false },
    numbers = { fg = subtle, bg = tab },
    numbers_visible = { fg = muted, bg = visible },
    numbers_selected = { fg = c.fg.fg2, bg = selected, bold = true },
    diagnostic = { fg = subtle, bg = tab },
    diagnostic_visible = { fg = muted, bg = visible },
    diagnostic_selected = { fg = c.fg.fg2, bg = selected, bold = true },
    hint = { fg = c.states.info, sp = c.states.info, bg = tab },
    hint_visible = { fg = c.states.info, bg = visible },
    hint_selected = { fg = c.states.info, sp = c.states.info, bg = selected, bold = true },
    info = { fg = c.states.info, sp = c.states.info, bg = tab },
    info_visible = { fg = c.states.info, bg = visible },
    info_selected = { fg = c.states.info, sp = c.states.info, bg = selected, bold = true },
    warning = { fg = c.states.warn, sp = c.states.warn, bg = tab },
    warning_visible = { fg = c.states.warn, bg = visible },
    warning_selected = { fg = c.states.warn, sp = c.states.warn, bg = selected, bold = true },
    error = { fg = c.states.danger, sp = c.states.danger, bg = tab },
    error_visible = { fg = c.states.danger, bg = visible },
    error_selected = { fg = c.states.danger, sp = c.states.danger, bg = selected, bold = true },
    modified = { fg = c.states.warn, bg = tab },
    modified_visible = { fg = c.states.warn, bg = visible },
    modified_selected = { fg = c.states.warn, bg = selected },
    duplicate = { fg = muted, bg = tab, italic = false },
    duplicate_visible = { fg = muted, bg = visible, italic = false },
    duplicate_selected = { fg = c.fg.fg2, bg = selected, italic = false },
    separator = { fg = fill, bg = tab },
    separator_visible = { fg = fill, bg = visible },
    separator_selected = { fg = fill, bg = selected },
    indicator_visible = { fg = fill, bg = visible },
    indicator_selected = { fg = c.accent.primary, bg = selected, sp = c.accent.primary },
    pick = { fg = c.states.warn, bg = tab, bold = true },
    pick_visible = { fg = c.states.warn, bg = visible, bold = true },
    pick_selected = { fg = c.states.warn, bg = selected, bold = true },
    offset_separator = { fg = c.border.window, bg = fill },
    trunc_marker = { fg = subtle, bg = fill },
  }
end

local function set_lualine_highlights()
  local theme = M.lualine_theme()
  for mode, sections in pairs(theme) do
    for section, spec in pairs(sections) do
      local attrs = {}
      if spec.fg then attrs.fg = spec.fg end
      if spec.bg then attrs.bg = spec.bg end
      if spec.gui == "bold" then attrs.bold = true end
      set("lualine_" .. section .. "_" .. mode, attrs)
    end
  end
end

function M.setup()
  local c = colors
  local s = c.syntax
  local visual = blend(c.accent.primary, c.bg.editor, 0.28)
  local search = blend(c.states.warn, c.bg.editor, 0.24)
  local match = blend(c.states.info, c.bg.editor, 0.24)
  local cursorline = blend(c.bg.inset, c.bg.editor, 0.72)
  local hover = blend(c.accent.primary, c.bg.editor, 0.14)
  local diff_add = blend(c.states.success, c.bg.editor, 0.18)
  local diff_change = blend(c.accent.primary, c.bg.editor, 0.16)
  local diff_delete = blend(c.states.danger, c.bg.editor, 0.18)
  local diff_text = blend(c.states.info, c.bg.editor, 0.32)

  vim.o.termguicolors = true
  vim.o.background = "dark"
  vim.cmd("highlight clear")
  if vim.fn.exists("syntax_on") == 1 then
    vim.cmd("syntax reset")
  end
  vim.g.colors_name = "fenrir-dark"

  set_terminal_colors()

  -- Core editor UI
  set("Normal", { fg = c.fg.base, bg = c.bg.editor })
  set("NormalNC", { fg = c.fg.base, bg = c.bg.editor })
  set("NormalFloat", { fg = c.fg.base, bg = c.bg.elevated })
  set("FloatBorder", { fg = c.border.elevated, bg = c.bg.elevated })
  set("FloatTitle", { fg = c.fg.base, bg = c.bg.elevated, bold = true })
  set("EndOfBuffer", { fg = c.bg.editor, bg = c.bg.editor })
  set("Cursor", { fg = c.bg.editor, bg = c.states.info })
  set("CursorLine", { bg = cursorline })
  set("CursorLineNr", { fg = c.states.info, bg = cursorline, bold = true })
  set("LineNr", { fg = c.fg.fg4 })
  set("SignColumn", { fg = c.fg.fg4, bg = c.bg.editor })
  set("FoldColumn", { fg = c.fg.fg4, bg = c.bg.editor })
  set("Folded", { fg = c.fg.fg3, bg = c.bg.inset })
  set("ColorColumn", { bg = c.bg.inset })
  set("WinSeparator", { fg = c.border.window, bg = c.bg.editor })
  set("VertSplit", { fg = c.border.window, bg = c.bg.editor })
  set("StatusLine", { fg = c.fg.base, bg = c.bg.window })
  set("StatusLineNC", { fg = c.fg.fg3, bg = c.bg.window })
  set("TabLine", { fg = c.fg.fg3, bg = c.bg.window })
  set("TabLineFill", { fg = c.fg.fg4, bg = c.bg.window })
  set("TabLineSel", { fg = c.fg.base, bg = c.bg.editor, bold = true })
  set("Pmenu", { fg = c.fg.base, bg = c.bg.elevated })
  set("PmenuSel", { fg = c.fg.base, bg = visual })
  set("PmenuSbar", { bg = c.bg.inset })
  set("PmenuThumb", { bg = c.fg.fg4 })
  set("Visual", { bg = visual })
  set("Search", { fg = c.fg.base, bg = search })
  set("IncSearch", { fg = c.bg.editor, bg = c.states.warn, bold = true })
  set("CurSearch", { fg = c.bg.editor, bg = c.states.warn, bold = true })
  set("MatchParen", { fg = c.fg.base, bg = match, bold = true })
  set("Directory", { fg = c.states.info })
  set("Title", { fg = c.accent.primary, bold = true })
  set("Conceal", { fg = c.fg.fg3 })
  set("NonText", { fg = c.fg.fg4 })
  set("SpecialKey", { fg = c.fg.fg4 })
  set("Whitespace", { fg = c.fg.fg4 })
  set("Question", { fg = c.states.info })
  set("MoreMsg", { fg = c.states.success })
  set("ModeMsg", { fg = c.fg.base })
  set("MsgArea", { fg = c.fg.base, bg = c.bg.editor })
  set("ErrorMsg", { fg = c.states.danger, bold = true })
  set("WarningMsg", { fg = c.states.warn, bold = true })

  -- Vim syntax
  set("Comment", { fg = s.comment, italic = true })
  set("Constant", { fg = s.constant })
  set("String", { fg = s.string })
  set("Character", { fg = s.string })
  set("Number", { fg = s.number })
  set("Boolean", { fg = s.number })
  set("Float", { fg = s.number })
  set("Identifier", { fg = s.variable })
  set("Function", { fg = s.func })
  set("Statement", { fg = s.keyword })
  set("Conditional", { fg = s.keyword })
  set("Repeat", { fg = s.keyword })
  set("Label", { fg = s.decorator })
  set("Operator", { fg = s.operator })
  set("Keyword", { fg = s.keyword })
  set("Exception", { fg = s.keyword })
  set("PreProc", { fg = s.preproc })
  set("Include", { fg = s.preproc })
  set("Define", { fg = s.macro })
  set("Macro", { fg = s.macro })
  set("PreCondit", { fg = s.preproc })
  set("Type", { fg = s.type })
  set("StorageClass", { fg = s.keyword })
  set("Structure", { fg = s.type })
  set("Typedef", { fg = s.type })
  set("Special", { fg = s.decorator })
  set("SpecialChar", { fg = s.escape })
  set("Tag", { fg = s.tag })
  set("Delimiter", { fg = s.punctuation })
  set("SpecialComment", { fg = s.comment, italic = true })
  set("Debug", { fg = s.macro })
  set("Underlined", { fg = c.accent.link, underline = true })
  set("Error", { fg = c.states.danger })
  set("Todo", { fg = c.bg.editor, bg = c.states.warn, bold = true })

  -- Diff and diagnostics
  set("DiffAdd", { bg = diff_add })
  set("DiffChange", { bg = diff_change })
  set("DiffDelete", { fg = c.states.danger, bg = diff_delete })
  set("DiffText", { bg = diff_text })
  set("DiagnosticError", { fg = c.states.danger })
  set("DiagnosticWarn", { fg = c.states.warn })
  set("DiagnosticInfo", { fg = c.states.info })
  set("DiagnosticHint", { fg = c.states.success })
  set("DiagnosticOk", { fg = c.states.success })
  set("DiagnosticVirtualTextError", { fg = c.states.danger, bg = diff_delete })
  set("DiagnosticVirtualTextWarn", { fg = c.states.warn, bg = blend(c.states.warn, c.bg.editor, 0.12) })
  set("DiagnosticVirtualTextInfo", { fg = c.states.info, bg = blend(c.states.info, c.bg.editor, 0.12) })
  set("DiagnosticVirtualTextHint", { fg = c.states.success, bg = blend(c.states.success, c.bg.editor, 0.12) })
  set("DiagnosticUnderlineError", { sp = c.states.danger, undercurl = true })
  set("DiagnosticUnderlineWarn", { sp = c.states.warn, undercurl = true })
  set("DiagnosticUnderlineInfo", { sp = c.states.info, undercurl = true })
  set("DiagnosticUnderlineHint", { sp = c.states.success, undercurl = true })
  set("LspReferenceText", { bg = hover })
  set("LspReferenceRead", { bg = hover })
  set("LspReferenceWrite", { bg = hover })
  set("LspInlayHint", { fg = c.fg.fg3, bg = c.bg.inset })

  -- Treesitter
  local treesitter_links = {
    ["@text"] = "Normal",
    ["@text.strong"] = "Bold",
    ["@text.emphasis"] = "Italic",
    ["@text.uri"] = "Underlined",
    ["@comment"] = "Comment",
    ["@comment.documentation"] = "Comment",
    ["@constant"] = "Constant",
    ["@constant.builtin"] = "Constant",
    ["@constant.macro"] = "Macro",
    ["@string"] = "String",
    ["@string.escape"] = "SpecialChar",
    ["@string.regexp"] = "String",
    ["@number"] = "Number",
    ["@boolean"] = "Boolean",
    ["@float"] = "Float",
    ["@function"] = "Function",
    ["@function.call"] = "Function",
    ["@function.builtin"] = "Function",
    ["@function.macro"] = "Macro",
    ["@method"] = "Function",
    ["@method.call"] = "Function",
    ["@constructor"] = "Type",
    ["@parameter"] = "Identifier",
    ["@variable"] = "Identifier",
    ["@variable.builtin"] = "Keyword",
    ["@property"] = "Constant",
    ["@field"] = "Constant",
    ["@namespace"] = "Include",
    ["@module"] = "Include",
    ["@keyword"] = "Keyword",
    ["@keyword.function"] = "Keyword",
    ["@keyword.operator"] = "Operator",
    ["@operator"] = "Operator",
    ["@punctuation.delimiter"] = "Delimiter",
    ["@punctuation.bracket"] = "Delimiter",
    ["@punctuation.special"] = "Special",
    ["@type"] = "Type",
    ["@type.builtin"] = "Type",
    ["@tag"] = "Tag",
    ["@tag.attribute"] = "Identifier",
    ["@tag.delimiter"] = "Delimiter",
    ["@label"] = "Label",
  }
  for group, target in pairs(treesitter_links) do
    link(group, target)
  end
  set("@parameter", { fg = s.parameter, italic = true })
  set("@property", { fg = s.property })
  set("@field", { fg = s.property })
  set("@namespace", { fg = s.namespace })
  set("@module", { fg = s.namespace })
  set("@variable.builtin", { fg = s.keyword, italic = true })
  set("@tag.attribute", { fg = s.attribute, italic = true })

  -- Completion
  set("CmpBorder", { fg = c.border.elevated, bg = c.bg.elevated })
  set("CmpItemAbbr", { fg = c.fg.base })
  set("CmpItemAbbrDeprecated", { fg = c.fg.fg4, strikethrough = true })
  set("CmpItemAbbrMatch", { fg = c.accent.primary, bold = true })
  set("CmpItemAbbrMatchFuzzy", { fg = c.accent.primary, bold = true })
  set("CmpItemKind", { fg = s.type })
  set("CmpItemMenu", { fg = c.fg.fg3 })
  set("CmpItemKindFunction", { fg = s.func })
  set("CmpItemKindMethod", { fg = s.method })
  set("CmpItemKindConstructor", { fg = s.type })
  set("CmpItemKindClass", { fg = s.type })
  set("CmpItemKindInterface", { fg = s.interface })
  set("CmpItemKindModule", { fg = s.namespace })
  set("CmpItemKindProperty", { fg = s.property })
  set("CmpItemKindField", { fg = s.property })
  set("CmpItemKindVariable", { fg = s.variable })
  set("CmpItemKindConstant", { fg = s.constant })
  set("CmpItemKindKeyword", { fg = s.keyword })
  set("CmpItemKindSnippet", { fg = s.decorator })
  set("CmpItemKindString", { fg = s.string })
  set("CmpItemKindNumber", { fg = s.number })
  set("CmpItemKindBoolean", { fg = s.number })
  set("CmpItemKindEnum", { fg = s.enum })
  set("CmpItemKindEnumMember", { fg = s.enum_member })
  set("CmpItemKindOperator", { fg = s.operator })
  link("BlinkCmpMenu", "Pmenu")
  link("BlinkCmpMenuBorder", "FloatBorder")
  link("BlinkCmpMenuSelection", "PmenuSel")
  link("BlinkCmpDoc", "NormalFloat")
  link("BlinkCmpDocBorder", "FloatBorder")
  link("BlinkCmpSignatureHelp", "NormalFloat")
  link("BlinkCmpSignatureHelpBorder", "FloatBorder")
  link("BlinkCmpLabelMatch", "CmpItemAbbrMatch")
  link("BlinkCmpKind", "CmpItemKind")
  set("BlinkCmpLabel", { fg = c.fg.base })
  set("BlinkCmpLabelDescription", { fg = c.fg.fg3 })
  set("BlinkCmpLabelDetail", { fg = c.fg.fg3 })
  set("BlinkCmpLabelDeprecated", { fg = c.fg.fg4, strikethrough = true })
  set("BlinkCmpSource", { fg = c.fg.fg3 })
  set("BlinkCmpGhostText", { fg = c.fg.fg4, italic = true })
  set("BlinkCmpDocSeparator", { fg = c.border.elevated })
  set("BlinkCmpDocCursorLine", { bg = visual })
  set("BlinkCmpSignatureHelpActiveParameter", { fg = s.parameter, bold = true })
  set("BlinkCmpScrollBarGutter", { bg = c.bg.window })
  set("BlinkCmpScrollBarThumb", { bg = c.fg.fg4 })

  -- Pickers and UI plugins
  set("TelescopeNormal", { fg = c.fg.base, bg = c.bg.elevated })
  set("TelescopeBorder", { fg = c.border.elevated, bg = c.bg.elevated })
  set("TelescopePromptNormal", { fg = c.fg.base, bg = c.bg.inset })
  set("TelescopePromptBorder", { fg = c.border.inset, bg = c.bg.inset })
  set("TelescopePromptTitle", { fg = c.accent.contrast, bg = c.accent.primary, bold = true })
  set("TelescopePreviewTitle", { fg = c.bg.editor, bg = c.states.success, bold = true })
  set("TelescopeResultsTitle", { fg = c.bg.editor, bg = c.fg.fg4, bold = true })
  set("TelescopeSelection", { fg = c.fg.base, bg = visual })
  set("TelescopeMatching", { fg = c.accent.primary, bold = true })
  link("FzfLuaNormal", "TelescopeNormal")
  link("FzfLuaBorder", "TelescopeBorder")
  link("FzfLuaTitle", "TelescopePromptTitle")
  link("FzfLuaCursorLine", "TelescopeSelection")
  link("FzfLuaSearch", "TelescopeMatching")
  set("SnacksPicker", { fg = c.fg.base, bg = c.bg.elevated })
  set("SnacksPickerBorder", { fg = c.border.elevated, bg = c.bg.elevated })
  set("SnacksPickerMatch", { fg = c.states.warn, bold = true })
  set("SnacksPickerSearch", { fg = c.states.warn, bold = true })
  set("SnacksPickerDir", { fg = c.fg.fg2 })
  set("SnacksPickerPathHidden", { fg = c.fg.fg2 })
  set("SnacksPickerPathIgnored", { fg = c.fg.fg3 })
  set("MasonHighlight", { fg = c.accent.primary })
  set("MasonHighlightSecondary", { fg = c.states.success })
  set("MasonHighlightBlock", { fg = c.accent.contrast, bg = c.accent.primary })
  set("MasonHeader", { fg = c.accent.contrast, bg = c.accent.primary, bold = true })
  set("WhichKey", { fg = c.accent.primary })
  set("WhichKeyDesc", { fg = c.fg.base })
  set("WhichKeyGroup", { fg = s.type })
  set("WhichKeySeparator", { fg = c.fg.fg4 })
  set("WhichKeyFloat", { bg = c.bg.elevated })
  set("NoiceCmdlinePopup", { fg = c.fg.base, bg = c.bg.elevated })
  set("NoiceCmdlinePopupBorder", { fg = c.border.elevated, bg = c.bg.elevated })
  set("NoiceConfirmBorder", { fg = c.border.elevated, bg = c.bg.elevated })
  set("NoicePopupBorder", { fg = c.border.elevated, bg = c.bg.elevated })
  link("NoiceCompletionItemKindDefault", "CmpItemKind")
  link("NotifyBackground", "NormalFloat")
  link("NotifyERRORBorder", "DiagnosticError")
  link("NotifyWARNBorder", "DiagnosticWarn")
  link("NotifyINFOBorder", "DiagnosticInfo")
  link("NotifyDEBUGBorder", "DiagnosticHint")
  link("NotifyTRACEBorder", "DiagnosticHint")

  -- File/tree/git surfaces
  set("GitSignsAdd", { fg = c.states.success })
  set("GitSignsChange", { fg = c.states.warn })
  set("GitSignsDelete", { fg = c.states.danger })
  set("NeoTreeNormal", { fg = c.fg.base, bg = c.bg.window })
  set("NeoTreeNormalNC", { fg = c.fg.base, bg = c.bg.window })
  set("NeoTreeDirectoryName", { fg = c.states.info })
  set("NeoTreeDirectoryIcon", { fg = c.states.info })
  set("NeoTreeFileName", { fg = c.fg.base })
  set("NeoTreeFileNameOpened", { fg = c.fg.base, bold = true })
  set("NeoTreeGitAdded", { fg = c.states.success })
  set("NeoTreeGitModified", { fg = c.states.warn })
  set("NeoTreeGitDeleted", { fg = c.states.danger })
  set("NeoTreeIndentMarker", { fg = c.border.indent_guide })
  set("NeoTreeRootName", { fg = c.accent.primary, bold = true })
  set("NeoTreeTabActive", { fg = c.fg.base, bg = c.bg.editor, bold = true })
  set("NeoTreeTabInactive", { fg = c.fg.fg3, bg = c.bg.window })
  set("NeoTreeWinSeparator", { fg = c.border.window, bg = c.bg.window })
  set("LazyNormal", { fg = c.fg.base, bg = c.bg.elevated })
  set("LazyButton", { fg = c.fg.base, bg = c.bg.inset })
  set("LazyButtonActive", { fg = c.accent.contrast, bg = c.accent.primary, bold = true })
  set("TroubleNormal", { fg = c.fg.base, bg = c.bg.window })
  set("TroubleText", { fg = c.fg.base })
  set("TroubleCount", { fg = c.accent.primary, bg = c.bg.inset })

  -- Bufferline and lualine
  local bufferline = M.bufferline_highlights()
  for group, spec in pairs(bufferline) do
    local name = "BufferLine"
      .. group:gsub("_(%l)", function(letter)
        return letter:upper()
      end):gsub("^%l", string.upper)
    set(name, spec)
  end
  set("BufferLineFill", { bg = c.bg.window })
  set("BufferLineOffsetSeparator", { fg = c.border.window, bg = c.bg.window })
  set_lualine_highlights()

  -- Markdown and annotation plugins
  set("RenderMarkdownH1", { fg = c.accent.primary, bold = true })
  set("RenderMarkdownH2", { fg = s.type, bold = true })
  set("RenderMarkdownH3", { fg = s.keyword, bold = true })
  set("RenderMarkdownH4", { fg = s.parameter, bold = true })
  set("RenderMarkdownH5", { fg = s.constant, bold = true })
  set("RenderMarkdownH6", { fg = s.string, bold = true })
  set("RenderMarkdownCode", { bg = c.bg.window })
  set("RenderMarkdownCodeBorder", { fg = c.border.editor, bg = c.bg.window })
  set("RenderMarkdownCodeInline", { fg = s.string, bg = c.bg.inset })
  set("RenderMarkdownBullet", { fg = s.tag })
  set("RenderMarkdownDash", { fg = c.border.editor })
  set("RenderMarkdownTableHead", { fg = c.accent.primary, bold = true })
  set("RenderMarkdownTableRow", { fg = c.border.editor })
  set("RenderMarkdownQuote", { fg = c.fg.fg3 })
  set("RenderMarkdownLink", { fg = c.accent.link, underline = true })
  local todo_colors = {
    TODO = c.accent.primary,
    FIX = c.states.danger,
    FIXME = c.states.danger,
    BUG = c.states.danger,
    HACK = c.states.warn,
    WARN = c.states.warn,
    WARNING = c.states.warn,
    PERF = s.type,
    NOTE = c.states.info,
    INFO = c.states.info,
    TEST = c.states.success,
  }
  for name, color in pairs(todo_colors) do
    set("TodoFg" .. name, { fg = color, bold = true })
    set("TodoBg" .. name, { fg = c.bg.editor, bg = color, bold = true })
    set("TodoSign" .. name, { fg = color, bg = c.bg.editor })
  end

  -- Misc
  set("MiniFilesNormal", { fg = c.fg.base, bg = c.bg.elevated })
  set("MiniFilesBorder", { fg = c.border.elevated, bg = c.bg.elevated })
  set("MiniFilesCursorLine", { bg = visual })
  set("MiniFilesDirectory", { fg = c.accent.primary })
  set("MiniSurroundHighlight", { bg = visual })
  set("YaziFloat", { fg = c.fg.base, bg = c.bg.elevated })
  set("YaziFloatBorder", { fg = c.border.elevated, bg = c.bg.elevated })
  set("YaziBufferHovered", { bg = visual })
  set("FlashMatch", { fg = c.fg.base, bg = search })
  set("FlashCurrent", { fg = c.bg.editor, bg = c.states.warn, bold = true })
  set("FlashLabel", { fg = c.bg.editor, bg = s.keyword, bold = true })
  set("FlashBackdrop", { fg = c.fg.fg4 })
  set("CopilotSuggestion", { fg = c.fg.fg4, italic = true })
  set("CopilotAnnotation", { fg = c.fg.fg3 })

  return c
end

return M
`;

export const FENRIR_DARK_THEME_RUNTIME_FILES = [
  {
    path: "colors/fenrir-dark.lua",
    contents: 'require("fenrir_dark").setup()\n',
  },
  {
    path: "lua/fenrir_dark/init.lua",
    contents: FENRIR_DARK_LUA,
  },
  {
    path: "lua/lualine/themes/fenrir-dark.lua",
    contents: 'return require("fenrir_dark").lualine_theme()\n',
  },
] as const satisfies readonly EmbeddedNvimThemeRuntimeFile[];
