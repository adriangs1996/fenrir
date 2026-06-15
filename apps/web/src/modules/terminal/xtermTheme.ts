import { type ITheme } from "@xterm/xterm";
import {
  DRACULA_PRO_THEME_NAMES,
  DRACULA_PRO_VARIANTS,
  type DraculaProPalette,
  type DraculaProThemeName,
} from "../../lib/draculaProThemeData";

type TerminalThemePalette = Omit<ITheme, "background" | "foreground">;
type CustomTerminalThemeClassName =
  | "pierre-dark"
  | "pierre-dark-soft"
  | "catppuccin-mocha"
  | "rose-pine"
  | "kanagawa"
  | "kanagawa-dragon"
  | "tokyonight-moon"
  | DraculaProThemeName
  | "nord";

const CUSTOM_TERMINAL_THEME_CLASS_NAMES = [
  "pierre-dark",
  "pierre-dark-soft",
  "catppuccin-mocha",
  "rose-pine",
  "kanagawa",
  "kanagawa-dragon",
  "tokyonight-moon",
  ...DRACULA_PRO_THEME_NAMES,
  "nord",
] as const satisfies readonly CustomTerminalThemeClassName[];

const DEFAULT_DARK_TERMINAL_PALETTE: TerminalThemePalette = {
  cursor: "rgb(180, 203, 255)",
  selectionBackground: "rgba(180, 203, 255, 0.25)",
  scrollbarSliderBackground: "rgba(255, 255, 255, 0.1)",
  scrollbarSliderHoverBackground: "rgba(255, 255, 255, 0.18)",
  scrollbarSliderActiveBackground: "rgba(255, 255, 255, 0.22)",
  black: "rgb(24, 30, 38)",
  red: "rgb(255, 122, 142)",
  green: "rgb(134, 231, 149)",
  yellow: "rgb(244, 205, 114)",
  blue: "rgb(137, 190, 255)",
  magenta: "rgb(208, 176, 255)",
  cyan: "rgb(124, 232, 237)",
  white: "rgb(210, 218, 230)",
  brightBlack: "rgb(110, 120, 136)",
  brightRed: "rgb(255, 168, 180)",
  brightGreen: "rgb(176, 245, 186)",
  brightYellow: "rgb(255, 224, 149)",
  brightBlue: "rgb(174, 210, 255)",
  brightMagenta: "rgb(229, 203, 255)",
  brightCyan: "rgb(167, 244, 247)",
  brightWhite: "rgb(244, 247, 252)",
};

const DEFAULT_LIGHT_TERMINAL_PALETTE: TerminalThemePalette = {
  cursor: "rgb(38, 56, 78)",
  selectionBackground: "rgba(37, 63, 99, 0.2)",
  scrollbarSliderBackground: "rgba(0, 0, 0, 0.15)",
  scrollbarSliderHoverBackground: "rgba(0, 0, 0, 0.25)",
  scrollbarSliderActiveBackground: "rgba(0, 0, 0, 0.3)",
  black: "rgb(44, 53, 66)",
  red: "rgb(191, 70, 87)",
  green: "rgb(60, 126, 86)",
  yellow: "rgb(146, 112, 35)",
  blue: "rgb(72, 102, 163)",
  magenta: "rgb(132, 86, 149)",
  cyan: "rgb(53, 127, 141)",
  white: "rgb(210, 215, 223)",
  brightBlack: "rgb(112, 123, 140)",
  brightRed: "rgb(212, 95, 112)",
  brightGreen: "rgb(85, 148, 111)",
  brightYellow: "rgb(173, 133, 45)",
  brightBlue: "rgb(91, 124, 194)",
  brightMagenta: "rgb(153, 107, 172)",
  brightCyan: "rgb(70, 149, 164)",
  brightWhite: "rgb(236, 240, 246)",
};

function hexToRgba(hex: string, alpha: number): string {
  const numericColor = Number.parseInt(hex.slice(1), 16);
  const red = (numericColor >> 16) & 255;
  const green = (numericColor >> 8) & 255;
  const blue = numericColor & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function createDraculaProTerminalPalette(palette: DraculaProPalette): TerminalThemePalette {
  return {
    cursor: palette.fg,
    cursorAccent: palette.bg,
    selectionBackground: palette.selection,
    selectionForeground: palette.fg,
    scrollbarSliderBackground: hexToRgba(palette.selection, 0.55),
    scrollbarSliderHoverBackground: hexToRgba(palette.comment, 0.72),
    scrollbarSliderActiveBackground: hexToRgba(palette.comment, 0.82),
    black: palette.selection,
    red: palette.red,
    green: palette.green,
    yellow: palette.yellow,
    blue: palette.purple,
    magenta: palette.pink,
    cyan: palette.cyan,
    white: palette.fg,
    brightBlack: palette.comment,
    brightRed: "#FFAA99",
    brightGreen: "#A2FF99",
    brightYellow: "#FFFF99",
    brightBlue: "#AA99FF",
    brightMagenta: "#FF99CC",
    brightCyan: "#99FFEE",
    brightWhite: "#FFFFFF",
  };
}

const DRACULA_PRO_TERMINAL_THEME_PALETTES = Object.fromEntries(
  DRACULA_PRO_VARIANTS.map((variant) => [
    variant.name,
    createDraculaProTerminalPalette(variant.palette),
  ]),
) as Record<DraculaProThemeName, TerminalThemePalette>;

const CUSTOM_TERMINAL_THEME_PALETTES = {
  "pierre-dark": {
    cursor: "#009fff",
    selectionBackground: "rgba(0, 159, 255, 0.3)",
    scrollbarSliderBackground: "rgba(38, 38, 38, 0.72)",
    scrollbarSliderHoverBackground: "rgba(54, 54, 54, 0.82)",
    scrollbarSliderActiveBackground: "rgba(64, 64, 64, 0.88)",
    black: "#171717",
    red: "#ff2e3f",
    green: "#0dbe4e",
    yellow: "#ffca00",
    blue: "#009fff",
    magenta: "#e130ac",
    cyan: "#08c0ef",
    white: "#bcbcbc",
    brightBlack: "#171717",
    brightRed: "#ff2e3f",
    brightGreen: "#86c427",
    brightYellow: "#ffca00",
    brightBlue: "#009fff",
    brightMagenta: "#e130ac",
    brightCyan: "#08c0ef",
    brightWhite: "#bcbcbc",
  },
  "pierre-dark-soft": {
    cursor: "#69b1ff",
    selectionBackground: "rgba(105, 177, 255, 0.28)",
    scrollbarSliderBackground: "rgba(44, 44, 44, 0.72)",
    scrollbarSliderHoverBackground: "rgba(64, 64, 64, 0.82)",
    scrollbarSliderActiveBackground: "rgba(82, 82, 82, 0.88)",
    black: "#171717",
    red: "#ff2e3f",
    green: "#0dbe4e",
    yellow: "#ffca00",
    blue: "#009fff",
    magenta: "#e130ac",
    cyan: "#08c0ef",
    white: "#bcbcbc",
    brightBlack: "#171717",
    brightRed: "#ff2e3f",
    brightGreen: "#86c427",
    brightYellow: "#ffca00",
    brightBlue: "#009fff",
    brightMagenta: "#e130ac",
    brightCyan: "#08c0ef",
    brightWhite: "#bcbcbc",
  },
  "catppuccin-mocha": {
    cursor: "#f5e0dc",
    selectionBackground: "rgba(245, 224, 220, 0.25)",
    scrollbarSliderBackground: "rgba(49, 50, 68, 0.6)",
    scrollbarSliderHoverBackground: "rgba(69, 71, 90, 0.7)",
    scrollbarSliderActiveBackground: "rgba(88, 91, 112, 0.82)",
    black: "#45475a",
    red: "#f38ba8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    blue: "#89b4fa",
    magenta: "#f5c2e7",
    cyan: "#94e2d5",
    white: "#bac2de",
    brightBlack: "#585b70",
    brightRed: "#f38ba8",
    brightGreen: "#a6e3a1",
    brightYellow: "#f9e2af",
    brightBlue: "#89b4fa",
    brightMagenta: "#f5c2e7",
    brightCyan: "#94e2d5",
    brightWhite: "#a6adc8",
  },
  "rose-pine": {
    cursor: "#e0def4",
    selectionBackground: "rgba(196, 167, 231, 0.25)",
    scrollbarSliderBackground: "rgba(82, 79, 103, 0.55)",
    scrollbarSliderHoverBackground: "rgba(110, 106, 134, 0.72)",
    scrollbarSliderActiveBackground: "rgba(110, 106, 134, 0.82)",
    black: "#26233a",
    red: "#eb6f92",
    green: "#31748f",
    yellow: "#f6c177",
    blue: "#9ccfd8",
    magenta: "#c4a7e7",
    cyan: "#ebbcba",
    white: "#e0def4",
    brightBlack: "#6e6a86",
    brightRed: "#eb6f92",
    brightGreen: "#31748f",
    brightYellow: "#f6c177",
    brightBlue: "#9ccfd8",
    brightMagenta: "#c4a7e7",
    brightCyan: "#ebbcba",
    brightWhite: "#e0def4",
  },
  kanagawa: {
    cursor: "#c8c093",
    selectionBackground: "rgba(126, 156, 216, 0.25)",
    scrollbarSliderBackground: "rgba(84, 84, 109, 0.4)",
    scrollbarSliderHoverBackground: "rgba(84, 84, 109, 0.5)",
    scrollbarSliderActiveBackground: "rgba(84, 84, 109, 0.65)",
    black: "#16161d",
    red: "#c34043",
    green: "#76946a",
    yellow: "#c0a36e",
    blue: "#7e9cd8",
    magenta: "#957fb8",
    cyan: "#6a9589",
    white: "#c8c093",
    brightBlack: "#727169",
    brightRed: "#e82424",
    brightGreen: "#98bb6c",
    brightYellow: "#e6c384",
    brightBlue: "#7fb4ca",
    brightMagenta: "#938aa9",
    brightCyan: "#7aa89f",
    brightWhite: "#dcd7ba",
  },
  "kanagawa-dragon": {
    cursor: "#c5c9c5",
    selectionBackground: "rgba(139, 164, 176, 0.24)",
    scrollbarSliderBackground: "rgba(98, 94, 90, 0.4)",
    scrollbarSliderHoverBackground: "rgba(98, 94, 90, 0.5)",
    scrollbarSliderActiveBackground: "rgba(98, 94, 90, 0.65)",
    black: "#0d0c0c",
    red: "#c4746e",
    green: "#8a9a7b",
    yellow: "#c4b28a",
    blue: "#8ba4b0",
    magenta: "#a292a3",
    cyan: "#8ea4a2",
    white: "#c8c093",
    brightBlack: "#737c73",
    brightRed: "#e46876",
    brightGreen: "#87a987",
    brightYellow: "#e6c384",
    brightBlue: "#7fb4ca",
    brightMagenta: "#938aa9",
    brightCyan: "#7aa89f",
    brightWhite: "#c5c9c5",
  },
  "tokyonight-moon": {
    cursor: "#c8d3f5",
    cursorAccent: "#222436",
    selectionBackground: "#2d3f76",
    selectionForeground: "#c8d3f5",
    scrollbarSliderBackground: "rgba(68, 74, 115, 0.55)",
    scrollbarSliderHoverBackground: "rgba(84, 92, 126, 0.72)",
    scrollbarSliderActiveBackground: "rgba(115, 122, 162, 0.82)",
    black: "#1b1d2b",
    red: "#ff757f",
    green: "#c3e88d",
    yellow: "#ffc777",
    blue: "#82aaff",
    magenta: "#c099ff",
    cyan: "#86e1fc",
    white: "#828bb8",
    brightBlack: "#444a73",
    brightRed: "#ff8d94",
    brightGreen: "#c7fb6d",
    brightYellow: "#ffd8ab",
    brightBlue: "#9ab8ff",
    brightMagenta: "#caabff",
    brightCyan: "#b2ebff",
    brightWhite: "#c8d3f5",
  },
  ...DRACULA_PRO_TERMINAL_THEME_PALETTES,
  nord: {
    cursor: "#d8dee9",
    selectionBackground: "rgba(136, 192, 208, 0.25)",
    scrollbarSliderBackground: "rgba(76, 86, 106, 0.65)",
    scrollbarSliderHoverBackground: "rgba(94, 129, 172, 0.72)",
    scrollbarSliderActiveBackground: "rgba(94, 129, 172, 0.82)",
    black: "#3b4252",
    red: "#bf616a",
    green: "#a3be8c",
    yellow: "#ebcb8b",
    blue: "#81a1c1",
    magenta: "#b48ead",
    cyan: "#88c0d0",
    white: "#e5e9f0",
    brightBlack: "#4c566a",
    brightRed: "#bf616a",
    brightGreen: "#a3be8c",
    brightYellow: "#ebcb8b",
    brightBlue: "#5e81ac",
    brightMagenta: "#b48ead",
    brightCyan: "#8fbcbb",
    brightWhite: "#eceff4",
  },
} as const satisfies Record<CustomTerminalThemeClassName, TerminalThemePalette>;

function normalizeComputedColor(value: string | null | undefined, fallback: string): string {
  const normalizedValue = value?.trim().toLowerCase();
  if (
    !normalizedValue ||
    normalizedValue === "transparent" ||
    normalizedValue === "rgba(0, 0, 0, 0)" ||
    normalizedValue === "rgba(0 0 0 / 0)"
  ) {
    return fallback;
  }
  return value ?? fallback;
}

function getCustomTerminalThemeClassName(): CustomTerminalThemeClassName | null {
  for (const className of CUSTOM_TERMINAL_THEME_CLASS_NAMES) {
    if (document.documentElement.classList.contains(className)) {
      return className;
    }
  }
  return null;
}

export function terminalThemeFromApp(mountElement?: HTMLElement | null): ITheme {
  const isDark = document.documentElement.classList.contains("dark");
  const fallbackBackground = isDark ? "rgb(14, 18, 24)" : "rgb(255, 255, 255)";
  const fallbackForeground = isDark ? "rgb(237, 241, 247)" : "rgb(28, 33, 41)";
  const themeSurface =
    mountElement?.closest("[data-xterm-theme-surface]") ??
    mountElement?.closest(".thread-terminal-drawer") ??
    mountElement ??
    document.querySelector(".thread-terminal-drawer") ??
    document.body;
  const surfaceStyles = getComputedStyle(themeSurface);
  const bodyStyles = getComputedStyle(document.body);
  const background = normalizeComputedColor(
    surfaceStyles.backgroundColor,
    normalizeComputedColor(bodyStyles.backgroundColor, fallbackBackground),
  );
  const foreground = normalizeComputedColor(
    surfaceStyles.color,
    normalizeComputedColor(bodyStyles.color, fallbackForeground),
  );
  const customThemeClassName = getCustomTerminalThemeClassName();
  const palette =
    customThemeClassName == null
      ? isDark
        ? DEFAULT_DARK_TERMINAL_PALETTE
        : DEFAULT_LIGHT_TERMINAL_PALETTE
      : CUSTOM_TERMINAL_THEME_PALETTES[customThemeClassName];

  return {
    background,
    foreground,
    ...palette,
  };
}
