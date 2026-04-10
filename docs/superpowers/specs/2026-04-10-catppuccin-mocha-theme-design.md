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

## Files to Change

### 1. `apps/web/src/index.css`

Add a custom variant and full variable block:

```css
@custom-variant catppuccin-mocha (&:is(.catppuccin-mocha, .catppuccin-mocha *));
```

Then inside `:root`, add a `@variant catppuccin-mocha { ... }` block defining all semantic variables from the mapping above. Also add `.catppuccin-mocha` scrollbar styles matching the Catppuccin palette.

### 2. `apps/web/src/hooks/useTheme.ts`

- Extend `Theme` type to `"light" | "dark" | "system" | "catppuccin-mocha"`
- Update `getStored()` to recognize `"catppuccin-mocha"` as a valid stored value
- Update `applyTheme()`:
  - Remove both `.dark` and `.catppuccin-mocha` classes first
  - For `"catppuccin-mocha"`: add both `.catppuccin-mocha` and `.dark` (so `dark:` Tailwind utilities still apply)
  - For `"dark"` or `"system"` resolving to dark: add `.dark` only (unchanged behavior)
  - Set `color-scheme` accordingly
- `resolvedTheme` remains `"light" | "dark"` — Catppuccin Mocha resolves to `"dark"` so all consumers (DiffPanel, ChatView, ChatMarkdown) continue working without changes

### 3. `apps/web/src/components/settings/SettingsPanels.tsx`

- Add `{ value: "catppuccin-mocha", label: "Catppuccin Mocha" }` to `THEME_OPTIONS`
- Extend the `onValueChange` type guard to accept `"catppuccin-mocha"`

### 4. `apps/web/index.html`

Update the inline bootstrap script to handle `"catppuccin-mocha"` from localStorage:
- Apply both `.catppuccin-mocha` and `.dark` classes to `<html>`
- Set initial background color to `#1e1e2e` (Catppuccin Base)

## Files NOT Changed

- `DiffPanel.tsx`, `ChatView.tsx`, `ChatMarkdown.tsx`, `DiffWorkerPoolProvider.tsx` — these consume `resolvedTheme` which stays `"light" | "dark"`. Catppuccin Mocha resolves to `"dark"`, so no changes needed.

## Custom Mauve Usage

The overridden mauve `rgb(152, 125, 210)` is defined as a CSS custom property `--catppuccin-mauve` within the `.catppuccin-mocha` variant block, available for use in components but not mapped to any existing semantic slot. It exists as a palette-level token for future use or direct reference.

## Edge Cases

- **System preference changes:** When theme is `"catppuccin-mocha"`, system dark/light changes are ignored — the user explicitly chose this theme.
- **Other-tab sync:** `storage` event listener handles `"catppuccin-mocha"` like any other theme value.
- **Desktop bridge:** `syncDesktopTheme()` passes `"catppuccin-mocha"` to Electron. If Electron doesn't recognize it, it falls back gracefully (no crash). The native window chrome won't change, but the web content will render correctly.
- **Reset button:** The settings panel reset button restores to `"system"`, removing Catppuccin Mocha.
