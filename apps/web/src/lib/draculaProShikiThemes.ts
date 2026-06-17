import {
  AttachedThemes,
  RegisteredCustomThemes,
  ResolvedThemes,
  ResolvingThemes,
} from "@pierre/diffs";
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

const DRACULA_PRO_ANSI = {
  brightBlue: "#AA99FF",
  brightCyan: "#99FFEE",
  brightGreen: "#A2FF99",
  brightMagenta: "#FF99CC",
  brightRed: "#FFAA99",
  brightYellow: "#FFFF99",
} as const;

function createDraculaProShikiTheme(variant: DraculaProVariant): TextMateTheme {
  const palette: DraculaProPalette = variant.palette;
  const syntax = {
    comment: palette.comment,
    string: palette.yellow,
    number: palette.purple,
    keyword: palette.pink,
    regexp: palette.red,
    func: palette.green,
    method: DRACULA_PRO_ANSI.brightGreen,
    type: palette.cyan,
    interface: DRACULA_PRO_ANSI.brightBlue,
    variable: palette.fg,
    operator: palette.pink,
    punctuation: palette.comment,
    constant: DRACULA_PRO_ANSI.brightBlue,
    parameter: palette.orange,
    property: palette.orange,
    namespace: DRACULA_PRO_ANSI.brightCyan,
    decorator: DRACULA_PRO_ANSI.brightMagenta,
    escape: DRACULA_PRO_ANSI.brightRed,
    invalid: palette.red,
    tag: palette.cyan,
    attribute: DRACULA_PRO_ANSI.brightGreen,
  } as const;

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
      "editorGutter.modifiedBackground": palette.orange,
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
      "gitDecoration.modifiedResourceForeground": palette.orange,
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
      "terminal.ansiBrightBlue": DRACULA_PRO_ANSI.brightBlue,
      "terminal.ansiBrightCyan": DRACULA_PRO_ANSI.brightCyan,
      "terminal.ansiBrightGreen": DRACULA_PRO_ANSI.brightGreen,
      "terminal.ansiBrightMagenta": DRACULA_PRO_ANSI.brightMagenta,
      "terminal.ansiBrightRed": DRACULA_PRO_ANSI.brightRed,
      "terminal.ansiBrightWhite": "#FFFFFF",
      "terminal.ansiBrightYellow": DRACULA_PRO_ANSI.brightYellow,
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
          foreground: syntax.comment,
          fontStyle: "italic",
        },
      },
      {
        scope: ["constant.numeric"],
        settings: {
          foreground: syntax.number,
        },
      },
      {
        scope: ["constant", "constant.language", "support.constant", "variable.other.constant"],
        settings: {
          foreground: syntax.constant,
        },
      },
      {
        scope: ["string", "constant.other.symbol"],
        settings: {
          foreground: syntax.string,
        },
      },
      {
        scope: ["string.regexp"],
        settings: {
          foreground: syntax.regexp,
        },
      },
      {
        scope: ["constant.character.escape", "string.escape"],
        settings: {
          foreground: syntax.escape,
        },
      },
      {
        scope: ["invalid", "invalid.illegal", "token.error-token"],
        settings: {
          foreground: syntax.invalid,
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
          foreground: syntax.keyword,
        },
      },
      {
        scope: ["keyword.operator"],
        settings: {
          foreground: syntax.operator,
        },
      },
      {
        scope: [
          "punctuation",
          "punctuation.definition",
          "punctuation.section",
          "punctuation.separator",
          "punctuation.terminator",
        ],
        settings: {
          foreground: syntax.punctuation,
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
          foreground: syntax.func,
        },
      },
      {
        scope: ["entity.name.function.member", "meta.method-call", "support.function.method"],
        settings: {
          foreground: syntax.method,
        },
      },
      {
        scope: ["entity.name.type.interface", "support.type.interface"],
        settings: {
          foreground: syntax.interface,
          fontStyle: "italic",
        },
      },
      {
        scope: [
          "entity.name.type",
          "support.class",
          "support.type",
          "entity.other.inherited-class",
          "storage.type.primitive",
          "meta.type.annotation",
        ],
        settings: {
          foreground: syntax.type,
          fontStyle: "italic",
        },
      },
      {
        scope: ["entity.name.namespace", "support.type.namespace", "support.namespace"],
        settings: {
          foreground: syntax.namespace,
        },
      },
      {
        scope: ["variable", "support.variable", "meta.definition.variable"],
        settings: {
          foreground: syntax.variable,
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
          foreground: syntax.parameter,
        },
      },
      {
        scope: [
          "constant.other.key",
          "variable.other.property",
          "support.variable.property",
          "meta.object-literal.key",
          "meta.object.type variable.other.readwrite",
          "meta.type.literal variable.other.readwrite",
          "variable.object.property",
          "variable.other.object.property",
          "support.type.property-name",
          "support.type.vendored.property-name",
        ],
        settings: {
          foreground: syntax.property,
        },
      },
      {
        scope: ["entity.name.tag", "meta.tag"],
        settings: {
          foreground: syntax.tag,
        },
      },
      {
        scope: ["entity.other.attribute-name", "text.html entity.other.attribute-name"],
        settings: {
          foreground: syntax.attribute,
        },
      },
      {
        scope: ["support.constant.property-value", "meta.property-value"],
        settings: {
          foreground: syntax.property,
        },
      },
      {
        scope: ["markup.heading", "markup.heading entity.name"],
        settings: {
          foreground: syntax.string,
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
          foreground: syntax.string,
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
          foreground: palette.orange,
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
  for (const [themeName, theme] of Object.entries(DRACULA_PRO_SHIKI_THEMES) as [
    DraculaProThemeName,
    TextMateTheme,
  ][]) {
    RegisteredCustomThemes.set(themeName, async () => theme);
    ResolvedThemes.delete(themeName);
    ResolvingThemes.delete(themeName);
    AttachedThemes.delete(themeName);
  }
}
