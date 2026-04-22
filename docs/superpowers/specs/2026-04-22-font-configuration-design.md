# Font Configuration Design

**Date:** 2026-04-22
**Status:** Approved

## Overview

Allow users to configure font-family and font-size independently for UI and Terminal contexts. System fonts are enumerated server-side and presented via a searchable combobox with category grouping.

## Requirements

- 4 independent settings: UI font-family, UI font-size, Terminal font-family, Terminal font-size
- Server-side system font discovery with monospace/sans-serif/serif classification
- Searchable combobox font picker with font names rendered in their own typeface
- Terminal font picker defaults to monospace-only with toggle to show all
- Font list grouped by category (Monospace / Sans-Serif / Serif / Other)
- Settings stored client-side (localStorage), same pattern as `timestampFormat`
- Reset-to-default per setting

## Architecture

### Settings Tier

**Client-side only** (localStorage). Fonts affect rendering — no server persistence needed. Same pattern as `confirmThreadArchive`, `diffWordWrap`, `timestampFormat`.

Font *list* endpoint is server-side (requires system command execution).

### New Settings

| Setting | Type | Default | Range |
|---------|------|---------|-------|
| `uiFontFamily` | `string` | `"Geist Mono"` | Any installed font |
| `uiFontSize` | `number` | `14` | 10–24 |
| `terminalFontFamily` | `string` | `"GeistMono Nerd Font"` | Any installed font (monospace recommended). Fallback chain appended at render time. |
| `terminalFontSize` | `number` | `12` | 8–24 |

## Server: Font Discovery

### Module

`apps/server/src/fonts.ts`

### Behavior

1. On first request, run platform-specific command to enumerate installed fonts
2. Parse output, deduplicate by font family name
3. Classify each font: `monospace | sans-serif | serif | other`
4. Cache result in memory (font list doesn't change during session)
5. Return sorted array

### Platform Commands

| Platform | Command | Classification Source |
|----------|---------|---------------------|
| macOS | `system_profiler SPFontsDataType -json` or `fc-list` | spacing metadata / name heuristics |
| Linux | `fc-list --format="%{family}:%{style}:%{spacing}\n"` | `spacing` field (100=monospace) |
| Windows | PowerShell: `[System.Drawing.Text.InstalledFontCollection]` or registry query | Name heuristics |

### Performance Note

On macOS, `system_profiler SPFontsDataType -json` can take 3-5+ seconds. Prefer `fc-list` when available (faster). The in-memory cache ensures this cost is paid only once per session. The client handles slow first load via `isLoading` state from the TanStack Query hook.

### Response Schema

Defined in `packages/contracts/src/fonts.ts` (new file) as an Effect Schema for consistency with existing contract patterns:

```typescript
export const SystemFontSchema = Schema.Struct({
  family: Schema.String,
  category: Schema.Literal("monospace", "sans-serif", "serif", "other"),
});
export type SystemFont = typeof SystemFontSchema.Type;

export const SystemFontListSchema = Schema.Array(SystemFontSchema);
```

### HTTP Endpoint

`GET /api/fonts` — new route layer `fontsRouteLayer` added to `apps/server/src/http.ts`.

**Route ordering:** In `apps/server/src/server.ts`, `fontsRouteLayer` must be added to `makeRoutesLayer`'s `Layer.mergeAll(...)` call *before* `staticAndDevRouteLayer` (which is a `GET *` catch-all for SPA fallback). Otherwise the catch-all intercepts the request.

Returns `SystemFont[]`. Auth required (same middleware as other endpoints). Response is cacheable.

## Client: Settings Schema

### Changes to `packages/contracts/src/settings.ts`

Extend `ClientSettingsSchema` with 4 new fields:

```typescript
export const ClientSettingsSchema = Schema.Struct({
  // ... existing fields ...
  uiFontFamily: Schema.String.pipe(
    Schema.withDecodingDefault(() => "Geist Mono")
  ),
  uiFontSize: Schema.transform(Schema.Number, Schema.Number, {
    decode: (n) => Math.min(Math.max(n, 10), 24),
    encode: (n) => n,
  }).pipe(Schema.withDecodingDefault(() => 14)),
  terminalFontFamily: Schema.String.pipe(
    Schema.withDecodingDefault(() => "GeistMono Nerd Font")
  ),
  terminalFontSize: Schema.transform(Schema.Number, Schema.Number, {
    decode: (n) => Math.min(Math.max(n, 8), 24),
    encode: (n) => n,
  }).pipe(Schema.withDecodingDefault(() => 12)),
});
```

**Note on font-size validation:** `Schema.transform` with `Math.min/Math.max` clamps values to range (not rejected). UI stepper also enforces min/max bounds.

`DEFAULT_CLIENT_SETTINGS` auto-derives from schema (existing pattern).

## Client: Font List Hook

### New file: `apps/web/src/hooks/useFonts.ts`

```typescript
export function useFonts(): {
  fonts: SystemFont[];
  monospaceFonts: SystemFont[];
  isLoading: boolean;
}
```

- TanStack Query: `useQuery({ queryKey: ["fonts"], queryFn: fetchFonts, staleTime: Infinity })`
- Fetches `GET /api/fonts` via standard fetch (not RPC — simple HTTP)
- Derives `monospaceFonts` as filtered subset
- `staleTime: Infinity` — fonts don't change during session

## Client: Font Picker Component

### New file: `apps/web/src/components/settings/FontPicker.tsx`

Built on existing `Combobox` component from `components/ui/combobox.tsx`.

### Props

```typescript
interface FontPickerProps {
  value: string;
  onChange: (fontFamily: string) => void;
  fonts: SystemFont[];
  filterMonospace?: boolean; // default false
}
```

### Behavior

- Searchable combobox — substring match on font family name
- Each item renders font name in its own typeface: `<span style={{ fontFamily: font.family }}>{font.family}</span>`
- Grouped by category using `ComboboxGroup` + `ComboboxGroupLabel`
- When `filterMonospace=true`:
  - Shows only monospace fonts by default
  - Toggle/link to "Show all fonts" expands to full list
  - Visual indicator when non-monospace font selected ("Not monospace — may cause display issues in terminal")
- Empty state: "No matching fonts found"

## Client: Settings UI

### Location

`apps/web/src/components/settings/SettingsPanels.tsx` — new "Fonts" section within `GeneralSettingsPanel`.

### Layout

4 rows using existing `SettingsSection` / `SettingsRow` pattern:

| Row | Label | Control | Notes |
|-----|-------|---------|-------|
| 1 | UI Font | `FontPicker` combobox | All font categories shown |
| 2 | UI Font Size | Number input with +/- stepper | Range 10–24, step 1 |
| 3 | Terminal Font | `FontPicker` combobox | `filterMonospace=true` |
| 4 | Terminal Font Size | Number input with +/- stepper | Range 8–24, step 1 |

Each row includes reset-to-default button (existing `SettingResetButton` component).

Settings changes applied immediately (no save button — matches existing pattern).

### Restore Defaults Integration

Add font settings to `useSettingsRestore()` tracking in `SettingsPanels.tsx`:
- Add 4 new entries to `changedSettingLabels` comparisons: "UI Font", "UI Font Size", "Terminal Font", "Terminal Font Size"
- Add to `useMemo` dependency array
- `resetSettings()` already resets via `updateSettings(DEFAULT_UNIFIED_SETTINGS)`, so data flow is covered

## Client: Applying Font Settings

### UI Font

**Mechanism:** CSS custom properties on `:root`.

In `apps/web/src/routes/__root.tsx` (inside `RootRouteView()`, alongside existing theme sync effect):
1. Read `uiFontFamily` and `uiFontSize` from `useSettings()`
2. Set `document.documentElement.style.setProperty('--fenrir-font-family', `"${value}", -apple-system, ...`)`
3. Set `document.documentElement.style.setProperty('--fenrir-font-size', value + 'px')`

CSS custom properties use `--fenrir-` prefix to avoid collision with Tailwind's `--font-*` namespace.

CSS in `index.css`:
```css
body {
  font-family: var(--fenrir-font-family, "Geist Mono", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, monospace);
  font-size: var(--fenrir-font-size, 14px);
}
```

**Scope note:** This affects elements that inherit body font without an explicit Tailwind size class (`text-sm`, `text-xs`, etc.). Components using Tailwind size utilities keep their sizes. This is intentional — `uiFontSize` sets the base, not an override for all text.

### Terminal Font

**Mechanism:** Direct xterm.js options.

**Fallback chain:** The user-selected font family is stored as a bare family name (e.g., `"Fira Code"`). When applying to xterm, a standard monospace fallback chain is always appended:

```typescript
const TERMINAL_FONT_FALLBACKS = '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace';

// Applied as:
const fontFamily = `"${settings.terminalFontFamily}", ${TERMINAL_FONT_FALLBACKS}`;
```

This ensures terminal rendering never breaks even if the selected font is unavailable.

**Files affected:**
- `ThreadTerminalDrawer.tsx` — primary terminal component
- `apps/web/src/components/hack/TargetShellTab.tsx` — also hardcodes terminal fonts, must be updated

In both files:
1. Read `terminalFontFamily` and `terminalFontSize` from settings
2. Build full fontFamily string with fallback chain
3. Pass to `new Terminal({ fontFamily, fontSize })` on creation
4. On settings change: update `terminal.options.fontFamily` and `terminal.options.fontSize`, then call `fitAddon.fit()` to recalculate dimensions
5. Existing `MutationObserver` pattern handles theme; font changes handled via settings subscription (React effect or `useSyncExternalStore` listener)

## Files Changed

| File | Change |
|------|--------|
| `packages/contracts/src/settings.ts` | Add 4 font fields to `ClientSettingsSchema` with clamp validation |
| `packages/contracts/src/fonts.ts` | **New** — `SystemFontSchema`, `SystemFontListSchema` Effect schemas |
| `apps/server/src/fonts.ts` | **New** — font discovery module (platform-specific enumeration + cache) |
| `apps/server/src/http.ts` | Add `fontsRouteLayer` with `GET /api/fonts` |
| `apps/server/src/server.ts` | Add `fontsRouteLayer` to `makeRoutesLayer` merge (before `staticAndDevRouteLayer`) |
| `apps/web/src/hooks/useFonts.ts` | **New** — TanStack Query hook for font list |
| `apps/web/src/components/settings/FontPicker.tsx` | **New** — combobox font picker with category grouping |
| `apps/web/src/components/settings/SettingsPanels.tsx` | Add Fonts section with 4 rows + restore defaults entries |
| `apps/web/src/components/ThreadTerminalDrawer.tsx` | Read font settings, apply to xterm with fallback chain |
| `apps/web/src/components/hack/TargetShellTab.tsx` | Read font settings, apply to xterm (same as above) |
| `apps/web/src/index.css` | Add `--fenrir-font-family` / `--fenrir-font-size` CSS custom properties |
| `apps/web/src/routes/__root.tsx` | Effect in `RootRouteView()` to sync font settings → CSS custom properties |

## Non-Goals

- Custom font upload/installation
- Per-project font settings
- Font weight/style configuration
- Web font loading (Google Fonts, etc.)
- Server-side font persistence
