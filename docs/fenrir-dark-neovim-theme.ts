type Hex = `#${string}`;

type FenrirDarkTokens = {
  background: string;
  appChromeBackground: string;
  foreground: Hex;
  card: string;
  cardForeground: Hex;
  popover: string;
  popoverForeground: Hex;
  primary: string;
  primaryForeground: Hex;
  secondary: string;
  secondaryForeground: Hex;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: Hex;
  destructive: string;
  destructiveForeground: Hex;
  border: string;
  borderStrong: Hex;
  input: string;
  ring: string;
  info: Hex;
  infoForeground: Hex;
  success: Hex;
  successForeground: Hex;
  warning: Hex;
  warningForeground: Hex;
};

type NvimPalette = {
  editor: string;
  editorAlt: string;
  panel: string;
  float: string;
  gutter: string;
  split: string;
  cursorLine: string;
  visual: string;
  search: string;
  matchParen: string;
  statusline: string;
  statuslineInactive: string;
  tabline: string;
  cursor: Hex;
  lineNumber: string;
  lineNumberActive: string;
};

type NvimSyntax = {
  normal: string;
  comment: string;
  keyword: string;
  string: Hex;
  number: Hex;
  function: Hex;
  type: string;
  constant: string;
  operator: string;
  error: Hex;
  warning: Hex;
  info: Hex;
  hint: Hex;
};

type NvimThemeSnippet = {
  fenrirDarkTokens: FenrirDarkTokens;
  neovimPalette: NvimPalette;
  syntax: NvimSyntax;
  highlights: Record<string, Record<string, string>>;
};

export const fenrirDarkNeovimTheme: NvimThemeSnippet = {
  fenrirDarkTokens: {
    // These preserve Fenrir's actual dark-mode formulas from apps/web/src/index.css.
    background: "color-mix(in srgb, #0a0a0a 95%, #ffffff)",
    appChromeBackground: "color-mix(in srgb, #0a0a0a 95%, #ffffff)",
    foreground: "#f5f5f5",
    card: "color-mix(in srgb, color-mix(in srgb, #0a0a0a 95%, #ffffff) 98%, #ffffff)",
    cardForeground: "#f5f5f5",
    popover: "color-mix(in srgb, color-mix(in srgb, #0a0a0a 95%, #ffffff) 98%, #ffffff)",
    popoverForeground: "#f5f5f5",
    primary: "oklch(0.588 0.217 264)",
    primaryForeground: "#ffffff",
    secondary: "rgb(255 255 255 / 4%)",
    secondaryForeground: "#f5f5f5",
    muted: "rgb(255 255 255 / 4%)",
    mutedForeground: "color-mix(in srgb, #737373 90%, #ffffff)",
    accent: "rgb(255 255 255 / 4%)",
    accentForeground: "#f5f5f5",
    destructive: "color-mix(in srgb, #ef4444 90%, #ffffff)",
    destructiveForeground: "#f87171",
    border: "rgb(255 255 255 / 6%)",
    borderStrong: "#000000",
    input: "rgb(255 255 255 / 8%)",
    ring: "oklch(0.588 0.217 264)",
    info: "#3b82f6",
    infoForeground: "#60a5fa",
    success: "#10b981",
    successForeground: "#34d399",
    warning: "#f59e0b",
    warningForeground: "#fbbf24",
  },
  neovimPalette: {
    editor: "color-mix(in srgb, #0a0a0a 95%, #ffffff)",
    editorAlt: "color-mix(in srgb, color-mix(in srgb, #0a0a0a 95%, #ffffff) 90%, #f5f5f5)",
    panel: "color-mix(in srgb, color-mix(in srgb, #0a0a0a 95%, #ffffff) 98%, #ffffff)",
    float: "color-mix(in srgb, color-mix(in srgb, #0a0a0a 95%, #ffffff) 98%, #ffffff)",
    gutter: "color-mix(in srgb, color-mix(in srgb, #0a0a0a 95%, #ffffff) 92%, #f5f5f5)",
    split: "rgb(255 255 255 / 6%)",
    cursorLine:
      "color-mix(in srgb, rgb(255 255 255 / 4%) 72%, color-mix(in srgb, #0a0a0a 95%, #ffffff))",
    visual:
      "color-mix(in srgb, oklch(0.588 0.217 264) 28%, color-mix(in srgb, #0a0a0a 95%, #ffffff))",
    search: "color-mix(in srgb, #f59e0b 24%, color-mix(in srgb, #0a0a0a 95%, #ffffff))",
    matchParen: "color-mix(in srgb, #3b82f6 24%, color-mix(in srgb, #0a0a0a 95%, #ffffff))",
    statusline:
      "color-mix(in srgb, color-mix(in srgb, color-mix(in srgb, #0a0a0a 95%, #ffffff) 98%, #ffffff) 82%, #000000)",
    statuslineInactive: "color-mix(in srgb, color-mix(in srgb, #0a0a0a 95%, #ffffff) 96%, #f5f5f5)",
    tabline:
      "color-mix(in srgb, color-mix(in srgb, #0a0a0a 95%, #ffffff) 94%, color-mix(in srgb, color-mix(in srgb, #0a0a0a 95%, #ffffff) 98%, #ffffff))",
    cursor: "#60a5fa",
    lineNumber: "color-mix(in srgb, color-mix(in srgb, #737373 90%, #ffffff) 75%, transparent)",
    lineNumberActive: "color-mix(in srgb, #f5f5f5 82%, oklch(0.588 0.217 264))",
  },
  syntax: {
    normal: "#f5f5f5",
    comment: "color-mix(in srgb, #737373 90%, #ffffff)",
    keyword: "oklch(0.588 0.217 264)",
    string: "#34d399",
    number: "#fbbf24",
    function: "#60a5fa",
    type: "color-mix(in srgb, #f5f5f5 80%, #3b82f6)",
    constant: "color-mix(in srgb, #f5f5f5 76%, #f59e0b)",
    operator: "color-mix(in srgb, #f5f5f5 88%, oklch(0.588 0.217 264))",
    error: "#f87171",
    warning: "#fbbf24",
    info: "#60a5fa",
    hint: "#34d399",
  },
  highlights: {
    Normal: {
      fg: "#f5f5f5",
      bg: "color-mix(in srgb, #0a0a0a 95%, #ffffff)",
    },
    NormalFloat: {
      fg: "#f5f5f5",
      bg: "color-mix(in srgb, color-mix(in srgb, #0a0a0a 95%, #ffffff) 98%, #ffffff)",
    },
    FloatBorder: {
      fg: "rgb(255 255 255 / 6%)",
      bg: "color-mix(in srgb, color-mix(in srgb, #0a0a0a 95%, #ffffff) 98%, #ffffff)",
    },
    CursorLine: {
      bg: "color-mix(in srgb, rgb(255 255 255 / 4%) 72%, color-mix(in srgb, #0a0a0a 95%, #ffffff))",
    },
    CursorLineNr: {
      fg: "color-mix(in srgb, #f5f5f5 82%, oklch(0.588 0.217 264))",
      bold: "true",
    },
    LineNr: {
      fg: "color-mix(in srgb, color-mix(in srgb, #737373 90%, #ffffff) 75%, transparent)",
    },
    Visual: {
      bg: "color-mix(in srgb, oklch(0.588 0.217 264) 28%, color-mix(in srgb, #0a0a0a 95%, #ffffff))",
    },
    Search: {
      fg: "#f5f5f5",
      bg: "color-mix(in srgb, #f59e0b 24%, color-mix(in srgb, #0a0a0a 95%, #ffffff))",
    },
    MatchParen: {
      fg: "#f5f5f5",
      bg: "color-mix(in srgb, #3b82f6 24%, color-mix(in srgb, #0a0a0a 95%, #ffffff))",
    },
    StatusLine: {
      fg: "#f5f5f5",
      bg: "color-mix(in srgb, color-mix(in srgb, color-mix(in srgb, #0a0a0a 95%, #ffffff) 98%, #ffffff) 82%, #000000)",
    },
    StatusLineNC: {
      fg: "color-mix(in srgb, #737373 90%, #ffffff)",
      bg: "color-mix(in srgb, color-mix(in srgb, #0a0a0a 95%, #ffffff) 96%, #f5f5f5)",
    },
    TabLineSel: {
      fg: "#f5f5f5",
      bg: "color-mix(in srgb, #0a0a0a 95%, #ffffff)",
    },
    Comment: {
      fg: "color-mix(in srgb, #737373 90%, #ffffff)",
      italic: "true",
    },
    Keyword: {
      fg: "oklch(0.588 0.217 264)",
    },
    String: {
      fg: "#34d399",
    },
    Number: {
      fg: "#fbbf24",
    },
    Function: {
      fg: "#60a5fa",
    },
    Type: {
      fg: "color-mix(in srgb, #f5f5f5 80%, #3b82f6)",
    },
    DiagnosticError: {
      fg: "#f87171",
    },
    DiagnosticWarn: {
      fg: "#fbbf24",
    },
    DiagnosticInfo: {
      fg: "#60a5fa",
    },
    DiagnosticHint: {
      fg: "#34d399",
    },
    GitSignsAdd: {
      fg: "#34d399",
    },
    GitSignsChange: {
      fg: "#fbbf24",
    },
    GitSignsDelete: {
      fg: "#f87171",
    },
  },
};
