# Catppuccin Mocha Theme for T3 Code

## Goal

Add Catppuccin Mocha as a selectable theme option alongside the existing light, dark, and system themes. The accent color is green (`#a6e3a1`) and the standard Catppuccin mauve (`#cba6f7`) is overridden with `rgb(152, 125, 210)`.

## Approach

**CSS Class Variant** — add a `.catppuccin-mocha` class that works like the existing `.dark` class. All Catppuccin color variables are defined in `index.css`. The theme hook and settings UI are extended to support the new option.

## Catppuccin Mocha Palette Reference

Standard Catppuccin Mocha colors used in this design:

| Name | Hex | Notes |
|---|---|---|
| Base | `#1e1e2e` | Background |
| Mantle | `#181825` | Card/popover surfaces |
| Crust | `#11111b` | Deepest surface |
| Surface0 | `#313244` | Muted/secondary/accent surfaces |
| Surface1 | `#45475a` | Borders |
| Surface2 | `#585b70` | Inputs |
| Overlay0 | `#6c7086` | — |
| Overlay1 | `#7f849c` | — |
| Overlay2 | `#9399b2` | — |
| Subtext0 | `#a6adc8` | Muted foreground text |
| Subtext1 | `#bac2de` | — |
| Text | `#cdd6f4` | Primary foreground text |
| Green | `#a6e3a1` | **Accent / primary** |
| Red | `#f38ba8` | Destructive |
| Blue | `#89b4fa` | Info |
| Yellow | `#f9e2af` | Warning |
| Mauve | `rgb(152, 125, 210)` | **Custom override** (standard is `#cba6f7`) |

## Semantic Variable Mapping

| Semantic Variable | Catppuccin Source | Value |
|---|---|---|
| `color-scheme` | — | `dark` |
| `--background` | Base | `#1e1e2e` |
| `--app-chrome-background` | Base | `#1e1e2e` |
| `--foreground` | Text | `#cdd6f4` |
| `--card` | Mantle | `#181825` |
| `--card-foreground` | Text | `#cdd6f4` |
| `--popover` | Mantle | `#181825` |
| `--popover-foreground` | Text | `#cdd6f4` |
| `--primary` | Green (accent) | `#a6e3a1` |
| `--primary-foreground` | Base | `#1e1e2e` |
| `--secondary` | Surface0 | `#313244` |
| `--secondary-foreground` | Text | `#cdd6f4` |
| `--muted` | Surface0 | `#313244` |
| `--muted-foreground` | Subtext0 | `#a6adc8` |
| `--accent` | Surface0 | `#313244` |
| `--accent-foreground` | Text | `#cdd6f4` |
| `--destructive` | Red | `#f38ba8` |
| `--destructive-foreground` | Red | `#f38ba8` |
| `--border` | Surface1 | `#45475a` |
| `--input` | Surface2 | `#585b70` |
| `--ring` | Green (accent) | `#a6e3a1` |
| `--info` | Blue | `#89b4fa` |
| `--info-foreground` | Blue | `#89b4fa` |
| `--success` | Green | `#a6e3a1` |
| `--success-foreground` | Green | `#a6e3a1` |
| `--warning` | Yellow | `#f9e2af` |
| `--warning-foreground` | Yellow | `#f9e2af` |

`--radius` is inherited unchanged from `:root` (`0.625rem`).

## Files to Change

### 1. `apps/web/src/index.css`

Add a custom variant declaration at the top, alongside the existing `dark` variant:

```css
@custom-variant catppuccin-mocha (&:is(.catppuccin-mocha, .catppuccin-mocha *));
```

Inside the existing `:root` block, add a `@variant catppuccin-mocha { ... }` block that:
- Sets `color-scheme: dark` (matching the existing dark variant pattern)
- Defines every semantic variable from the mapping table above
- Defines `--catppuccin-mauve: rgb(152, 125, 210)` as a palette-level token (accessible via `var(--catppuccin-mauve)` in custom CSS only — no `@theme inline` entry, so no Tailwind utility class generated)

Add Catppuccin scrollbar styles after the existing `.dark` scrollbar rules:

```css
.catppuccin-mocha ::-webkit-scrollbar-thumb {
  background: rgba(69, 71, 90, 0.6);  /* Surface1 at 60% */
}
.catppuccin-mocha ::-webkit-scrollbar-thumb:hover {
  background: rgba(88, 91, 112, 0.7); /* Surface2 at 70% */
}
```

### 2. `apps/web/src/hooks/useTheme.ts`

**Type extension:**
```typescript
type Theme = "light" | "dark" | "system" | "catppuccin-mocha";
```

**`getStored()` update:** Add `"catppuccin-mocha"` to the valid value check:
```typescript
if (raw === "light" || raw === "dark" || raw === "system" || raw === "catppuccin-mocha") return raw;
```

**`applyTheme()` update:**
- Always remove both `.dark` and `.catppuccin-mocha` from `document.documentElement` first
- For `"catppuccin-mocha"`: add both `.catppuccin-mocha` and `.dark` (so existing `dark:` Tailwind utilities still apply)
- For `"dark"` or `"system"` resolving to dark: add `.dark` only (unchanged)

**`resolvedTheme` computation update:**
```typescript
const resolvedTheme: "light" | "dark" =
  theme === "catppuccin-mocha"
    ? "dark"
    : theme === "system"
      ? snapshot.systemDark
        ? "dark"
        : "light"
      : theme;
```

This ensures `DiffPanel.tsx` (which casts `resolvedTheme as DiffThemeType` where `DiffThemeType = "light" | "dark"`) continues to work.

**Desktop bridge mapping:** `syncDesktopTheme()` must map `"catppuccin-mocha"` to `"dark"` before passing to `window.desktopBridge.setTheme()`, because `DesktopTheme` in `packages/contracts/src/ipc.ts` is typed as `"light" | "dark" | "system"`. This avoids a TypeScript compilation error and avoids changes to the contracts package:
```typescript
function syncDesktopTheme(theme: Theme) {
  const bridge = window.desktopBridge;
  if (!bridge || lastDesktopTheme === theme) return;
  lastDesktopTheme = theme;
  const desktopTheme: DesktopTheme =
    theme === "catppuccin-mocha" ? "dark" : theme;
  void bridge.setTheme(desktopTheme).catch(() => {
    if (lastDesktopTheme === theme) lastDesktopTheme = null;
  });
}
```

Note: `DesktopTheme` would need to be imported or the type inlined. Since the current code does not import it explicitly (it calls `bridge.setTheme(theme)` directly and the type is inferred), the simplest approach is to cast or assign the mapped value inline without importing `DesktopTheme`.

### 3. `apps/web/src/components/settings/SettingsPanels.tsx`

Add to `THEME_OPTIONS`:
```typescript
const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "catppuccin-mocha", label: "Catppuccin Mocha" },
] as const;
```

Update the `onValueChange` type guard:
```typescript
onValueChange={(value) => {
  if (value === "system" || value === "light" || value === "dark" || value === "catppuccin-mocha") {
    setTheme(value);
  }
}}
```

### 4. `apps/web/index.html`

**Bootstrap script update:** Extend the inline `<script>` to recognize `"catppuccin-mocha"` from localStorage:
```javascript
const LIGHT_BACKGROUND = "#ffffff";
const DARK_BACKGROUND = "#161616";
const CATPPUCCIN_BACKGROUND = "#1e1e2e";
// ...
const theme =
  storedTheme === "light" || storedTheme === "dark" ||
  storedTheme === "system" || storedTheme === "catppuccin-mocha"
    ? storedTheme
    : "system";
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
const isCatppuccin = theme === "catppuccin-mocha";
const isDark = isCatppuccin || theme === "dark" || (theme === "system" && prefersDark);
document.documentElement.classList.toggle("dark", isDark);
document.documentElement.classList.toggle("catppuccin-mocha", isCatppuccin);
const chromeColor = isCatppuccin
  ? CATPPUCCIN_BACKGROUND
  : isDark
    ? DARK_BACKGROUND
    : LIGHT_BACKGROUND;
```

**Inline `<style>` update:** Add a rule for `.catppuccin-mocha` to prevent a flash of incorrect background (`#161616`) during the boot shell phase, since `html.dark body` would otherwise apply first:
```css
html.catppuccin-mocha body {
  background: #1e1e2e;
  color: #cdd6f4;
}
```

This rule must appear after the `html.dark body` rule so it takes precedence via source order (both selectors have the same specificity).

## Files NOT Changed

- `packages/contracts/src/ipc.ts` — `DesktopTheme` stays `"light" | "dark" | "system"`. The theme hook maps `"catppuccin-mocha"` to `"dark"` before calling the bridge.
- `DiffPanel.tsx`, `ChatView.tsx`, `ChatMarkdown.tsx`, `DiffWorkerPoolProvider.tsx` — these consume `resolvedTheme` which stays `"light" | "dark"`. Catppuccin Mocha resolves to `"dark"`, so no changes needed.

## Custom Mauve Usage

The overridden mauve `rgb(152, 125, 210)` is defined as `--catppuccin-mauve` within the `@variant catppuccin-mocha` block. It is consumed via `var(--catppuccin-mauve)` in custom CSS only. There is no `@theme inline` entry for it, so no Tailwind utility class (e.g. `text-catppuccin-mauve`) is generated. If Tailwind utility access is needed in the future, a `--color-catppuccin-mauve: var(--catppuccin-mauve)` line can be added to the `@theme inline` block at that time.

## Edge Cases

- **System preference changes:** When theme is `"catppuccin-mocha"`, system dark/light changes are ignored — the user explicitly chose this theme.
- **Other-tab sync:** `storage` event listener handles `"catppuccin-mocha"` like any other theme value.
- **Desktop bridge:** `syncDesktopTheme()` maps `"catppuccin-mocha"` to `"dark"` before calling `window.desktopBridge.setTheme()`, so the `DesktopTheme` type contract is satisfied and the native window chrome uses dark appearance.
- **Reset button:** The settings panel reset button restores to `"system"`, removing Catppuccin Mocha.
- **Boot flash prevention:** The inline `<style>` in `index.html` includes `html.catppuccin-mocha body` with the correct background (`#1e1e2e`), preventing a flash of the default dark background (`#161616`).
