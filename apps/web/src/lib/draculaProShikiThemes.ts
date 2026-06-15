import { RegisteredCustomThemes, registerCustomTheme } from "@pierre/diffs";
import {
  DRACULA_PRO_VARIANTS,
  type DraculaProPalette,
  type DraculaProThemeName,
  type DraculaProVariant,
} from "./draculaProThemeData";

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

function createDraculaProShikiTheme(variant: DraculaProVariant): TextMateTheme {
  const palette: DraculaProPalette = variant.palette;

  return {
    name: variant.name,
    displayName: variant.label,
    type: "dark",
    colors: {
      "activityBar.background": palette.bgdarker,
      "activityBar.foreground": palette.comment,
      "badge.background": `${palette.purple}55`,
      "badge.foreground": palette.fg,
      "button.background": palette.purple,
      "button.foreground": palette.bgdarker,
      "dropdown.background": palette.bglight,
      "dropdown.foreground": palette.fg,
      "editor.background": palette.bg,
      "editor.foreground": palette.fg,
      "editor.lineHighlightBackground": palette.bglight,
      "editor.selectionBackground": palette.selection,
      "editor.selectionHighlightBackground": `${palette.selection}aa`,
      "editorCursor.foreground": palette.fg,
      "editorError.foreground": palette.red,
      "editorGutter.addedBackground": palette.green,
      "editorGutter.deletedBackground": palette.red,
      "editorGutter.modifiedBackground": palette.purple,
      "editorIndentGuide.activeBackground1": palette.comment,
      "editorIndentGuide.background1": palette.selection,
      "editorInfo.foreground": palette.cyan,
      "editorLineNumber.activeForeground": palette.comment,
      "editorLineNumber.foreground": palette.selection,
      "editorWarning.foreground": palette.yellow,
      "editorWhitespace.foreground": palette.selection,
      "editorWidget.background": palette.bglight,
      foreground: palette.comment,
      "gitDecoration.addedResourceForeground": palette.green,
      "gitDecoration.deletedResourceForeground": palette.red,
      "gitDecoration.modifiedResourceForeground": palette.purple,
      "input.background": palette.bglight,
      "input.foreground": palette.fg,
      "list.activeSelectionBackground": palette.selection,
      "list.activeSelectionForeground": palette.fg,
      "list.hoverBackground": palette.bglight,
      "list.hoverForeground": palette.fg,
      "panel.background": palette.bgdark,
      "panel.border": palette.bgdarker,
      "scrollbarSlider.activeBackground": `${palette.comment}d1`,
      "scrollbarSlider.background": `${palette.selection}8c`,
      "scrollbarSlider.hoverBackground": `${palette.comment}b8`,
      "sideBar.background": palette.bgdark,
      "sideBar.border": palette.bgdarker,
      "sideBar.foreground": palette.comment,
      "tab.activeBackground": palette.bg,
      "tab.activeForeground": palette.fg,
      "tab.border": palette.bgdarker,
      "tab.inactiveBackground": palette.bgdark,
      "tab.inactiveForeground": palette.comment,
      "terminal.ansiBlack": palette.selection,
      "terminal.ansiBlue": palette.purple,
      "terminal.ansiBrightBlack": palette.comment,
      "terminal.ansiBrightBlue": "#AA99FF",
      "terminal.ansiBrightCyan": "#99FFEE",
      "terminal.ansiBrightGreen": "#A2FF99",
      "terminal.ansiBrightMagenta": "#FF99CC",
      "terminal.ansiBrightRed": "#FFAA99",
      "terminal.ansiBrightWhite": "#FFFFFF",
      "terminal.ansiBrightYellow": "#FFFF99",
      "terminal.ansiCyan": palette.cyan,
      "terminal.ansiGreen": palette.green,
      "terminal.ansiMagenta": palette.pink,
      "terminal.ansiRed": palette.red,
      "terminal.ansiWhite": palette.fg,
      "terminal.ansiYellow": palette.yellow,
      "terminal.background": palette.bg,
      "terminal.foreground": palette.fg,
    },
    tokenColors: [
      {
        settings: {
          background: palette.bg,
          foreground: palette.fg,
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
          foreground: palette.comment,
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
          foreground: palette.orange,
        },
      },
      {
        scope: ["string", "constant.other.symbol", "constant.other.key"],
        settings: {
          foreground: palette.green,
        },
      },
      {
        scope: ["string.regexp", "constant.character.escape"],
        settings: {
          foreground: palette.cyan,
        },
      },
      {
        scope: ["invalid", "invalid.illegal", "token.error-token"],
        settings: {
          foreground: palette.red,
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
          foreground: palette.purple,
        },
      },
      {
        scope: [
          "keyword.operator",
          "punctuation",
          "punctuation.separator",
          "punctuation.terminator",
        ],
        settings: {
          foreground: palette.pink,
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
          foreground: palette.cyan,
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
          foreground: palette.purple,
        },
      },
      {
        scope: ["variable", "support.variable", "meta.definition.variable"],
        settings: {
          foreground: palette.fg,
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
          foreground: palette.orange,
        },
      },
      {
        scope: ["variable.other.property", "support.variable.property", "meta.object-literal.key"],
        settings: {
          foreground: palette.cyan,
        },
      },
      {
        scope: ["entity.name.tag", "meta.tag"],
        settings: {
          foreground: palette.pink,
        },
      },
      {
        scope: ["entity.other.attribute-name", "text.html entity.other.attribute-name"],
        settings: {
          foreground: palette.green,
        },
      },
      {
        scope: ["support.type.property-name", "support.type.vendored.property-name"],
        settings: {
          foreground: palette.cyan,
        },
      },
      {
        scope: ["support.constant.property-value", "meta.property-value"],
        settings: {
          foreground: palette.orange,
        },
      },
      {
        scope: ["markup.heading", "markup.heading entity.name"],
        settings: {
          foreground: palette.yellow,
          fontStyle: "bold",
        },
      },
      {
        scope: ["markup.bold", "markup.bold punctuation"],
        settings: {
          foreground: palette.fg,
          fontStyle: "bold",
        },
      },
      {
        scope: ["markup.italic", "markup.italic punctuation"],
        settings: {
          foreground: palette.fg,
          fontStyle: "italic",
        },
      },
      {
        scope: ["markup.inserted"],
        settings: {
          foreground: palette.green,
        },
      },
      {
        scope: ["markup.deleted"],
        settings: {
          foreground: palette.red,
        },
      },
      {
        scope: ["markup.changed"],
        settings: {
          foreground: palette.purple,
        },
      },
      {
        scope: ["markup.underline.link", "string.other.link"],
        settings: {
          foreground: palette.cyan,
        },
      },
    ],
  };
}

export const DRACULA_PRO_SHIKI_THEMES = Object.fromEntries(
  DRACULA_PRO_VARIANTS.map((variant) => [variant.name, createDraculaProShikiTheme(variant)]),
) as Record<DraculaProThemeName, TextMateTheme>;

export function registerDraculaProDiffThemes() {
  for (const theme of Object.values(DRACULA_PRO_SHIKI_THEMES)) {
    if (RegisteredCustomThemes.has(theme.name)) {
      continue;
    }

    registerCustomTheme(theme.name, async () => theme);
  }
}
