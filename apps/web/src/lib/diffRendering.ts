import type { SyntaxTheme } from "./theme";
import { DRACULA_PRO_THEME_NAMES, type DraculaProThemeName } from "./draculaProThemeData";
import { registerDraculaProDiffThemes } from "./draculaProShikiThemes";
import {
  registerTokyonightMoonDiffTheme,
  TOKYONIGHT_MOON_DIFF_THEME_NAME,
} from "./tokyonightMoonShikiTheme";

registerTokyonightMoonDiffTheme();
registerDraculaProDiffThemes();

const DRACULA_PRO_DIFF_THEME_NAMES = Object.fromEntries(
  DRACULA_PRO_THEME_NAMES.map((themeName) => [themeName, themeName]),
) as { readonly [ThemeName in DraculaProThemeName]: ThemeName };

export const DIFF_THEME_NAMES = {
  light: "pierre-light",
  dark: "pierre-dark",
  "pierre-dark": "pierre-dark",
  "pierre-dark-soft": "pierre-dark-soft",
  "catppuccin-mocha": "catppuccin-mocha",
  "rose-pine": "rose-pine",
  "kanagawa-wave": "kanagawa-wave",
  "kanagawa-dragon": "kanagawa-dragon",
  "tokyonight-moon": TOKYONIGHT_MOON_DIFF_THEME_NAME,
  ...DRACULA_PRO_DIFF_THEME_NAMES,
  nord: "nord",
} as const;

export type DiffThemeName = (typeof DIFF_THEME_NAMES)[keyof typeof DIFF_THEME_NAMES];

export const DIFF_HIGHLIGHTER_THEME_NAMES = [
  DIFF_THEME_NAMES.dark,
  DIFF_THEME_NAMES.light,
  DIFF_THEME_NAMES["pierre-dark-soft"],
  DIFF_THEME_NAMES["catppuccin-mocha"],
  DIFF_THEME_NAMES["rose-pine"],
  DIFF_THEME_NAMES["kanagawa-wave"],
  DIFF_THEME_NAMES["kanagawa-dragon"],
  DIFF_THEME_NAMES["tokyonight-moon"],
  ...DRACULA_PRO_THEME_NAMES,
  DIFF_THEME_NAMES.nord,
] as const satisfies readonly DiffThemeName[];

export type DiffThemeInput = SyntaxTheme;

export const DIFF_CHANGE_HIGHLIGHT_UNSAFE_CSS = `
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-addition-color-override: var(--success-foreground);
  --diffs-deletion-color-override: var(--destructive-foreground);
  --diffs-bg-addition-override: var(--success-foreground);
  --diffs-bg-addition-number-override: var(--success-foreground);
  --diffs-bg-addition-emphasis-override: color-mix(in srgb, var(--background) 48%, var(--success-foreground));
  --diffs-bg-deletion-override: var(--destructive-foreground);
  --diffs-bg-deletion-number-override: var(--destructive-foreground);
  --diffs-bg-deletion-emphasis-override: color-mix(in srgb, var(--background) 48%, var(--destructive-foreground));
}

[data-line-type="change-addition"]:is([data-line], [data-no-newline]) {
  --mix-light: 78%;
  --mix-dark: 68%;
}

[data-line-type="change-addition"]:is([data-column-number], [data-gutter-buffer]) {
  --mix-light: 70%;
  --mix-dark: 56%;
}

[data-line-type="change-deletion"]:is([data-line], [data-no-newline]) {
  --mix-light: 78%;
  --mix-dark: 68%;
}

[data-line-type="change-deletion"]:is([data-column-number], [data-gutter-buffer]) {
  --mix-light: 70%;
  --mix-dark: 56%;
}
`;

export function resolveDiffThemeName(theme: DiffThemeInput): DiffThemeName {
  return DIFF_THEME_NAMES[theme];
}

const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;
const SECONDARY_HASH_SEED = 0x9e3779b9;
const SECONDARY_HASH_MULTIPLIER = 0x85ebca6b;

export function fnv1a32(
  input: string,
  seed = FNV_OFFSET_BASIS_32,
  multiplier = FNV_PRIME_32,
): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, multiplier) >>> 0;
  }
  return hash >>> 0;
}

export function buildPatchCacheKey(patch: string, scope = "diff-panel"): string {
  const normalizedPatch = patch.trim();
  const primary = fnv1a32(normalizedPatch, FNV_OFFSET_BASIS_32, FNV_PRIME_32).toString(36);
  const secondary = fnv1a32(
    normalizedPatch,
    SECONDARY_HASH_SEED,
    SECONDARY_HASH_MULTIPLIER,
  ).toString(36);
  return `${scope}:${normalizedPatch.length}:${primary}:${secondary}`;
}
