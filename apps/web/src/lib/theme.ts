import { DRACULA_PRO_CUSTOM_THEME_CONFIG, DRACULA_PRO_THEME_OPTIONS } from "./draculaProThemeData";

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
    value: "pierre-dark",
    label: "Pierre Dark",
  },
  {
    value: "pierre-dark-soft",
    label: "Pierre Dark Soft",
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
    value: "kanagawa",
    label: "Kanagawa",
  },
  {
    value: "kanagawa-dragon",
    label: "Kanagawa Dragon",
  },
  {
    value: "tokyonight-moon",
    label: "Tokyonight Moon",
  },
  ...DRACULA_PRO_THEME_OPTIONS,
  {
    value: "nord",
    label: "Nord",
  },
] as const;

export type Theme = (typeof THEME_OPTIONS)[number]["value"];

const CUSTOM_THEME_CONFIG = {
  "pierre-dark": {
    className: "pierre-dark",
    syntaxTheme: "pierre-dark",
  },
  "pierre-dark-soft": {
    className: "pierre-dark-soft",
    syntaxTheme: "pierre-dark-soft",
  },
  "catppuccin-mocha": {
    className: "catppuccin-mocha",
    syntaxTheme: "catppuccin-mocha",
  },
  "rose-pine": {
    className: "rose-pine",
    syntaxTheme: "rose-pine",
  },
  kanagawa: {
    className: "kanagawa",
    syntaxTheme: "kanagawa-wave",
  },
  "kanagawa-dragon": {
    className: "kanagawa-dragon",
    syntaxTheme: "kanagawa-dragon",
  },
  "tokyonight-moon": {
    className: "tokyonight-moon",
    syntaxTheme: "tokyonight-moon",
  },
  ...DRACULA_PRO_CUSTOM_THEME_CONFIG,
  nord: {
    className: "nord",
    syntaxTheme: "nord",
  },
} as const;

type CustomTheme = keyof typeof CUSTOM_THEME_CONFIG;
type CustomSyntaxTheme = (typeof CUSTOM_THEME_CONFIG)[CustomTheme]["syntaxTheme"];
export type SyntaxTheme = "light" | "dark" | CustomSyntaxTheme;

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
