import { RegisteredCustomThemes, registerCustomTheme } from "@pierre/diffs";

export const TOKYONIGHT_MOON_DIFF_THEME_NAME = "tokyonight-moon";

type TokenColor = {
  scope?: string | string[];
  settings: {
    background?: string;
    foreground?: string;
    fontStyle?: string;
  };
};

type TextMateTheme = {
  name: string;
  displayName: string;
  type: "dark" | "light";
  colors: Record<string, string>;
  tokenColors: TokenColor[];
};

const moon = {
  bg: "#222436",
  bgDark: "#1e2030",
  bgDark1: "#191b29",
  bgHighlight: "#2f334d",
  blue: "#82aaff",
  blue0: "#3e68d7",
  blue1: "#65bcff",
  blue2: "#0db9d7",
  blue5: "#89ddff",
  blue6: "#b4f9f8",
  blue7: "#394b70",
  comment: "#636da6",
  cyan: "#86e1fc",
  dark3: "#545c7e",
  dark5: "#737aa2",
  fg: "#c8d3f5",
  fgDark: "#828bb8",
  fgGutter: "#3b4261",
  green: "#c3e88d",
  green1: "#4fd6be",
  green2: "#41a6b5",
  magenta: "#c099ff",
  magenta2: "#ff007c",
  orange: "#ff966c",
  purple: "#fca7ea",
  red: "#ff757f",
  red1: "#c53b53",
  terminalBlack: "#444a73",
  yellow: "#ffc777",
  gitAdd: "#b8db87",
  gitChange: "#7ca1f2",
  gitDelete: "#e26a75",
};

export const TOKYONIGHT_MOON_SHIKI_THEME = {
  name: TOKYONIGHT_MOON_DIFF_THEME_NAME,
  displayName: "Tokyonight Moon",
  type: "dark",
  colors: {
    "activityBar.background": moon.bgDark1,
    "activityBar.foreground": moon.fgDark,
    "badge.background": `${moon.blue0}55`,
    "badge.foreground": moon.fg,
    "button.background": moon.blue0,
    "button.foreground": "#ffffff",
    "dropdown.background": moon.bgDark,
    "dropdown.foreground": moon.fg,
    "editor.background": moon.bg,
    "editor.foreground": moon.fg,
    "editor.lineHighlightBackground": moon.bgHighlight,
    "editor.selectionBackground": "#2d3f76",
    "editor.selectionHighlightBackground": `${moon.blue7}88`,
    "editorCursor.foreground": moon.fg,
    "editorError.foreground": moon.red,
    "editorGutter.addedBackground": moon.gitAdd,
    "editorGutter.deletedBackground": moon.gitDelete,
    "editorGutter.modifiedBackground": moon.gitChange,
    "editorIndentGuide.activeBackground1": moon.dark3,
    "editorIndentGuide.background1": moon.fgGutter,
    "editorInfo.foreground": moon.cyan,
    "editorLineNumber.activeForeground": moon.fgDark,
    "editorLineNumber.foreground": moon.fgGutter,
    "editorWarning.foreground": moon.yellow,
    "editorWhitespace.foreground": moon.fgGutter,
    "editorWidget.background": moon.bgDark,
    foreground: moon.fgDark,
    "gitDecoration.addedResourceForeground": moon.gitAdd,
    "gitDecoration.deletedResourceForeground": moon.gitDelete,
    "gitDecoration.modifiedResourceForeground": moon.gitChange,
    "input.background": moon.bgDark,
    "input.foreground": moon.fg,
    "list.activeSelectionBackground": moon.bgHighlight,
    "list.activeSelectionForeground": moon.fg,
    "list.hoverBackground": moon.bgDark,
    "list.hoverForeground": moon.fg,
    "panel.background": moon.bgDark,
    "panel.border": moon.bgDark1,
    "scrollbarSlider.activeBackground": `${moon.terminalBlack}cc`,
    "scrollbarSlider.background": `${moon.terminalBlack}8c`,
    "scrollbarSlider.hoverBackground": `${moon.dark3}b8`,
    "sideBar.background": moon.bgDark,
    "sideBar.border": moon.bgDark1,
    "sideBar.foreground": moon.fgDark,
    "tab.activeBackground": moon.bg,
    "tab.activeForeground": moon.fg,
    "tab.border": moon.bgDark1,
    "tab.inactiveBackground": moon.bgDark,
    "tab.inactiveForeground": moon.fgDark,
    "terminal.ansiBlack": "#1b1d2b",
    "terminal.ansiBlue": moon.blue,
    "terminal.ansiBrightBlack": moon.terminalBlack,
    "terminal.ansiBrightBlue": "#9ab8ff",
    "terminal.ansiBrightCyan": "#b2ebff",
    "terminal.ansiBrightGreen": "#c7fb6d",
    "terminal.ansiBrightMagenta": "#caabff",
    "terminal.ansiBrightRed": "#ff8d94",
    "terminal.ansiBrightWhite": moon.fg,
    "terminal.ansiBrightYellow": "#ffd8ab",
    "terminal.ansiCyan": moon.cyan,
    "terminal.ansiGreen": moon.green,
    "terminal.ansiMagenta": moon.magenta,
    "terminal.ansiRed": moon.red,
    "terminal.ansiWhite": moon.fgDark,
    "terminal.ansiYellow": moon.yellow,
    "terminal.background": moon.bg,
    "terminal.foreground": moon.fg,
  },
  tokenColors: [
    {
      settings: {
        background: moon.bg,
        foreground: moon.fg,
      },
    },
    {
      scope: [
        "comment",
        "punctuation.definition.comment",
        "string.quoted.docstring",
        "comment.block.documentation",
      ],
      settings: {
        foreground: moon.comment,
        fontStyle: "italic",
      },
    },
    {
      scope: [
        "constant",
        "constant.numeric",
        "constant.language",
        "support.constant",
        "variable.other.constant",
      ],
      settings: {
        foreground: moon.orange,
      },
    },
    {
      scope: ["string", "constant.other.symbol", "constant.other.key"],
      settings: {
        foreground: moon.green,
      },
    },
    {
      scope: ["string.regexp", "constant.character.escape"],
      settings: {
        foreground: moon.blue6,
      },
    },
    {
      scope: ["invalid", "invalid.illegal", "token.error-token"],
      settings: {
        foreground: moon.red,
      },
    },
    {
      scope: [
        "keyword",
        "keyword.control",
        "keyword.other",
        "storage",
        "storage.type",
        "storage.modifier",
      ],
      settings: {
        foreground: moon.magenta,
      },
    },
    {
      scope: ["keyword.operator", "punctuation", "punctuation.separator", "punctuation.terminator"],
      settings: {
        foreground: moon.blue5,
      },
    },
    {
      scope: [
        "entity.name.function",
        "meta.function-call",
        "support.function",
        "variable.function",
      ],
      settings: {
        foreground: moon.blue,
      },
    },
    {
      scope: [
        "entity.name.type",
        "entity.other.inherited-class",
        "support.class",
        "support.type",
        "entity.name.namespace",
      ],
      settings: {
        foreground: moon.blue2,
      },
    },
    {
      scope: ["variable", "support.variable", "meta.definition.variable"],
      settings: {
        foreground: moon.fg,
      },
    },
    {
      scope: [
        "variable.parameter",
        "meta.function.parameters",
        "meta.function.parameter",
        "entity.name.variable.parameter",
      ],
      settings: {
        foreground: moon.yellow,
      },
    },
    {
      scope: ["variable.other.property", "support.variable.property", "meta.object-literal.key"],
      settings: {
        foreground: moon.green1,
      },
    },
    {
      scope: ["entity.name.tag", "meta.tag"],
      settings: {
        foreground: moon.red,
      },
    },
    {
      scope: ["entity.other.attribute-name", "text.html entity.other.attribute-name"],
      settings: {
        foreground: moon.magenta,
      },
    },
    {
      scope: ["support.type.property-name", "support.type.vendored.property-name"],
      settings: {
        foreground: moon.blue,
      },
    },
    {
      scope: ["support.constant.property-value", "meta.property-value"],
      settings: {
        foreground: moon.orange,
      },
    },
    {
      scope: ["markup.heading", "markup.heading entity.name"],
      settings: {
        foreground: moon.blue5,
        fontStyle: "bold",
      },
    },
    {
      scope: ["markup.bold", "markup.bold punctuation"],
      settings: {
        foreground: moon.fg,
        fontStyle: "bold",
      },
    },
    {
      scope: ["markup.italic", "markup.italic punctuation"],
      settings: {
        foreground: moon.fg,
        fontStyle: "italic",
      },
    },
    {
      scope: ["markup.inserted"],
      settings: {
        foreground: moon.gitAdd,
      },
    },
    {
      scope: ["markup.deleted"],
      settings: {
        foreground: moon.gitDelete,
      },
    },
    {
      scope: ["markup.changed"],
      settings: {
        foreground: moon.gitChange,
      },
    },
    {
      scope: ["markup.underline.link", "string.other.link"],
      settings: {
        foreground: moon.cyan,
      },
    },
  ],
} satisfies TextMateTheme;

export function registerTokyonightMoonDiffTheme() {
  if (RegisteredCustomThemes.has(TOKYONIGHT_MOON_DIFF_THEME_NAME)) {
    return;
  }

  registerCustomTheme(TOKYONIGHT_MOON_DIFF_THEME_NAME, async () => TOKYONIGHT_MOON_SHIKI_THEME);
}
