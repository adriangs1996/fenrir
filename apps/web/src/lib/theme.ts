export const THEME_OPTIONS = [
  {
    value: "system",
    label: "System",
  },
  {
    value: "light",
    label: "Light",
  },
  {
    value: "dark",
    label: "Dark",
  },
  {
    value: "catppuccin-mocha",
    label: "Catppuccin Mocha",
  },
  {
    value: "rose-pine",
    label: "Rose Pine",
  },
  {
    value: "nord",
    label: "Nord",
  },
] as const;

export type Theme = (typeof THEME_OPTIONS)[number]["value"];

const CUSTOM_THEME_CONFIG = {
  "catppuccin-mocha": {
    className: "catppuccin-mocha",
    syntaxTheme: "catppuccin-mocha",
  },
  "rose-pine": {
    className: "rose-pine",
    syntaxTheme: "rose-pine",
  },
  nord: {
    className: "nord",
    syntaxTheme: "nord",
  },
} as const;

type CustomTheme = keyof typeof CUSTOM_THEME_CONFIG;
export type SyntaxTheme = "light" | "dark" | CustomTheme;

const THEME_VALUES = new Set<string>(THEME_OPTIONS.map((option) => option.value));

export const CUSTOM_THEME_CLASS_NAMES = Object.values(CUSTOM_THEME_CONFIG).map(
  (theme) => theme.className,
);

export function isTheme(value: string | null | undefined): value is Theme {
  return value != null && THEME_VALUES.has(value);
}

function isCustomTheme(theme: Theme): theme is CustomTheme {
  return theme in CUSTOM_THEME_CONFIG;
}

export function resolveThemeState(theme: Theme, systemDark: boolean) {
  if (isCustomTheme(theme)) {
    const customTheme = CUSTOM_THEME_CONFIG[theme];
    return {
      customThemeClassName: customTheme.className,
      resolvedTheme: "dark" as const,
      syntaxTheme: customTheme.syntaxTheme,
    };
  }

  const resolvedTheme =
    theme === "system" ? (systemDark ? "dark" : "light") : (theme as "light" | "dark");

  return {
    customThemeClassName: null,
    resolvedTheme,
    syntaxTheme: resolvedTheme,
  };
}

export function resolveDesktopTheme(theme: Theme): "light" | "dark" | "system" {
  return isCustomTheme(theme) ? "dark" : theme;
}
