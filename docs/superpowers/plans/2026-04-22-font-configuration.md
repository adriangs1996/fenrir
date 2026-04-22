# Font Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users configure font-family and font-size independently for UI and Terminal, with a searchable font picker populated from system fonts.

**Architecture:** Server-side font discovery via platform commands (`fc-list`/PowerShell), exposed as HTTP endpoint. Four new client-side settings (localStorage). Combobox-based font picker with category grouping. CSS custom properties for UI fonts, direct xterm.js options for terminal fonts.

**Tech Stack:** Effect Schema (contracts), Effect HttpRouter (server), TanStack Query + React (client), xterm.js (terminal), Base UI Combobox (picker), Tailwind CSS 4 (styling), Vitest (tests)

**Spec:** `docs/superpowers/specs/2026-04-22-font-configuration-design.md`

---

## File Structure

| File | Responsibility | Status |
|------|---------------|--------|
| `packages/contracts/src/fonts.ts` | `SystemFontSchema`, `SystemFontListSchema` Effect schemas + types | Create |
| `packages/contracts/src/index.ts` | Re-export fonts module | Modify |
| `packages/contracts/src/settings.ts` | Add 4 font fields to `ClientSettingsSchema` | Modify |
| `apps/server/src/fonts.ts` | Platform font discovery + in-memory cache | Create |
| `apps/server/src/fonts.test.ts` | Tests for font parsing/classification | Create |
| `apps/server/src/http.ts` | Add `fontsRouteLayer` HTTP endpoint | Modify |
| `apps/server/src/server.ts` | Wire `fontsRouteLayer` into `makeRoutesLayer` | Modify |
| `apps/web/src/hooks/useFonts.ts` | TanStack Query hook for font list | Create |
| `apps/web/src/components/settings/FontPicker.tsx` | Combobox font picker with category grouping | Create |
| `apps/web/src/components/settings/SettingsPanels.tsx` | Add Fonts section + restore defaults entries | Modify |
| `apps/web/src/components/ThreadTerminalDrawer.tsx` | Read font settings for xterm | Modify |
| `apps/web/src/components/hack/TargetShellTab.tsx` | Read font settings for xterm | Modify |
| `apps/web/src/index.css` | CSS custom properties for UI font | Modify |
| `apps/web/src/routes/__root.tsx` | Effect to sync font settings → CSS vars | Modify |

---

### Task 1: Font Schema Contracts

**Files:**
- Create: `packages/contracts/src/fonts.ts`
- Modify: `packages/contracts/src/index.ts` (add `export * from "./fonts"`)

- [ ] **Step 1: Create font schema file**

Create `packages/contracts/src/fonts.ts`:

```typescript
import * as Schema from "effect/Schema";

export const SystemFontSchema = Schema.Struct({
  family: Schema.String,
  category: Schema.Literal("monospace", "sans-serif", "serif", "other"),
});

export type SystemFont = typeof SystemFontSchema.Type;

export const SystemFontListSchema = Schema.Array(SystemFontSchema);
export type SystemFontList = typeof SystemFontListSchema.Type;
```

- [ ] **Step 2: Add barrel export**

In `packages/contracts/src/index.ts`, add after the existing exports:

```typescript
export * from "./fonts";
```

- [ ] **Step 3: Verify build**

Run: `cd packages/contracts && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/fonts.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add SystemFont schema for font configuration"
```

---

### Task 2: Client Settings Schema — Add Font Fields

**Files:**
- Modify: `packages/contracts/src/settings.ts:26-40`
- Test: `packages/contracts/src/settings.test.ts` (create if not exists)

- [ ] **Step 1: Write test for new settings defaults**

Create or append to `packages/contracts/src/settings.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { DEFAULT_CLIENT_SETTINGS } from "./settings";

describe("ClientSettings font defaults", () => {
  it("has correct default uiFontFamily", () => {
    expect(DEFAULT_CLIENT_SETTINGS.uiFontFamily).toBe("Geist Mono");
  });

  it("has correct default uiFontSize", () => {
    expect(DEFAULT_CLIENT_SETTINGS.uiFontSize).toBe(14);
  });

  it("has correct default terminalFontFamily", () => {
    expect(DEFAULT_CLIENT_SETTINGS.terminalFontFamily).toBe("GeistMono Nerd Font");
  });

  it("has correct default terminalFontSize", () => {
    expect(DEFAULT_CLIENT_SETTINGS.terminalFontSize).toBe(12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/contracts && npx vitest run src/settings.test.ts`
Expected: FAIL — `uiFontFamily` property does not exist on DEFAULT_CLIENT_SETTINGS

- [ ] **Step 3: Add font fields to ClientSettingsSchema**

In `packages/contracts/src/settings.ts`, inside `ClientSettingsSchema = Schema.Struct({...})`, add after the `timestampFormat` field:

```typescript
  uiFontFamily: Schema.String.pipe(Schema.withDecodingDefault(() => "Geist Mono")),
  uiFontSize: Schema.transform(Schema.Number, Schema.Number, {
    decode: (n) => Math.min(Math.max(n, 10), 24),
    encode: (n) => n,
  }).pipe(Schema.withDecodingDefault(() => 14)),
  terminalFontFamily: Schema.String.pipe(
    Schema.withDecodingDefault(() => "GeistMono Nerd Font"),
  ),
  terminalFontSize: Schema.transform(Schema.Number, Schema.Number, {
    decode: (n) => Math.min(Math.max(n, 8), 24),
    encode: (n) => n,
  }).pipe(Schema.withDecodingDefault(() => 12)),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/contracts && npx vitest run src/settings.test.ts`
Expected: PASS

- [ ] **Step 5: Write test for font-size clamping**

Append to the same test file:

```typescript
import * as Schema from "effect/Schema";
import { ClientSettingsSchema } from "./settings";

describe("ClientSettings font-size clamping", () => {
  it("clamps uiFontSize below minimum to 10", () => {
    const result = Schema.decodeSync(ClientSettingsSchema)({ uiFontSize: 5 });
    expect(result.uiFontSize).toBe(10);
  });

  it("clamps uiFontSize above maximum to 24", () => {
    const result = Schema.decodeSync(ClientSettingsSchema)({ uiFontSize: 50 });
    expect(result.uiFontSize).toBe(24);
  });

  it("clamps terminalFontSize below minimum to 8", () => {
    const result = Schema.decodeSync(ClientSettingsSchema)({ terminalFontSize: 3 });
    expect(result.terminalFontSize).toBe(8);
  });

  it("clamps terminalFontSize above maximum to 24", () => {
    const result = Schema.decodeSync(ClientSettingsSchema)({ terminalFontSize: 99 });
    expect(result.terminalFontSize).toBe(24);
  });

  it("passes through valid font sizes unchanged", () => {
    const result = Schema.decodeSync(ClientSettingsSchema)({
      uiFontSize: 16,
      terminalFontSize: 14,
    });
    expect(result.uiFontSize).toBe(16);
    expect(result.terminalFontSize).toBe(14);
  });
});
```

- [ ] **Step 6: Run all settings tests**

Run: `cd packages/contracts && npx vitest run src/settings.test.ts`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/settings.ts packages/contracts/src/settings.test.ts
git commit -m "feat(contracts): add font-family and font-size client settings with clamping"
```

---

### Task 3: Server Font Discovery Module

**Files:**
- Create: `apps/server/src/fonts.ts`
- Create: `apps/server/src/fonts.test.ts`

- [ ] **Step 1: Write tests for font parsing**

Create `apps/server/src/fonts.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseFcListOutput, classifyFontByName } from "./fonts";

describe("parseFcListOutput", () => {
  it("parses fc-list colon-separated output", () => {
    const output = [
      "Fira Code:Regular:100",
      "Helvetica:Bold:0",
      "Times New Roman:Regular:0",
    ].join("\n");

    const result = parseFcListOutput(output);
    expect(result).toContainEqual({ family: "Fira Code", category: "monospace" });
    expect(result).toContainEqual({ family: "Helvetica", category: "sans-serif" });
    expect(result).toContainEqual({ family: "Times New Roman", category: "serif" });
  });

  it("deduplicates font families", () => {
    const output = [
      "Arial:Regular:0",
      "Arial:Bold:0",
      "Arial:Italic:0",
    ].join("\n");

    const result = parseFcListOutput(output);
    const arialEntries = result.filter((f) => f.family === "Arial");
    expect(arialEntries).toHaveLength(1);
  });

  it("sorts alphabetically by family name", () => {
    const output = ["Zebra:Regular:0", "Apple:Regular:100", "Mango:Regular:0"].join("\n");
    const result = parseFcListOutput(output);
    expect(result.map((f) => f.family)).toEqual(["Apple", "Mango", "Zebra"]);
  });

  it("handles empty output", () => {
    expect(parseFcListOutput("")).toEqual([]);
    expect(parseFcListOutput("\n\n")).toEqual([]);
  });
});

describe("classifyFontByName", () => {
  it("classifies known monospace font names", () => {
    expect(classifyFontByName("Courier New")).toBe("monospace");
    expect(classifyFontByName("Consolas")).toBe("monospace");
    expect(classifyFontByName("SF Mono")).toBe("monospace");
    expect(classifyFontByName("Fira Code")).toBe("monospace");
    expect(classifyFontByName("JetBrains Mono")).toBe("monospace");
  });

  it("classifies fonts with 'mono' in the name", () => {
    expect(classifyFontByName("SomethingMono")).toBe("monospace");
    expect(classifyFontByName("My Mono Font")).toBe("monospace");
  });

  it("classifies known serif font names", () => {
    expect(classifyFontByName("Times New Roman")).toBe("serif");
    expect(classifyFontByName("Georgia")).toBe("serif");
  });

  it("classifies known sans-serif font names", () => {
    expect(classifyFontByName("Arial")).toBe("sans-serif");
    expect(classifyFontByName("Helvetica")).toBe("sans-serif");
  });

  it("returns 'other' for unknown fonts", () => {
    expect(classifyFontByName("MyCustomFont")).toBe("other");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/server && npx vitest run src/fonts.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create font discovery module**

Create `apps/server/src/fonts.ts`:

```typescript
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { SystemFont } from "@fenrir/contracts";

const execAsync = promisify(exec);

// In-memory cache — fonts don't change during session
let cachedFonts: SystemFont[] | null = null;

const MONOSPACE_KEYWORDS = [
  "mono",
  "consolas",
  "courier",
  "menlo",
  "code",
  "terminal",
  "fixed",
  "nerd font",
  "nfm",
  "hack",
  "iosevka",
  "inconsolata",
  "source code",
  "droid sans mono",
  "liberation mono",
  "dejavu sans mono",
  "ubuntu mono",
  "roboto mono",
  "jetbrains",
  "sf mono",
  "cascadia",
  "anonymous pro",
  "pragmata",
];

const SERIF_KEYWORDS = [
  "times",
  "georgia",
  "garamond",
  "baskerville",
  "bodoni",
  "didot",
  "palatino",
  "cambria",
  "bookman",
  "century",
  "charter",
  "cochin",
  "hoefler",
  "caslon",
  "minion",
  "sabon",
  "serif",
];

const SANS_SERIF_KEYWORDS = [
  "arial",
  "helvetica",
  "verdana",
  "tahoma",
  "trebuchet",
  "segoe ui",
  "roboto",
  "open sans",
  "lato",
  "noto sans",
  "inter",
  "poppins",
  "montserrat",
  "raleway",
  "ubuntu",
  "nunito",
  "work sans",
  "source sans",
  "fira sans",
  "pt sans",
  "gill sans",
  "franklin gothic",
  "futura",
  "avenir",
  "proxima",
  "sf pro",
  "san francisco",
  "system-ui",
  "geist",
  "sans",
];

export function classifyFontByName(
  name: string,
): "monospace" | "sans-serif" | "serif" | "other" {
  const lower = name.toLowerCase();
  if (MONOSPACE_KEYWORDS.some((kw) => lower.includes(kw))) return "monospace";
  if (SERIF_KEYWORDS.some((kw) => lower.includes(kw))) return "serif";
  if (SANS_SERIF_KEYWORDS.some((kw) => lower.includes(kw))) return "sans-serif";
  return "other";
}

export function parseFcListOutput(output: string): SystemFont[] {
  const familyMap = new Map<string, SystemFont>();

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(":");
    const family = parts[0]?.trim();
    if (!family) continue;

    if (familyMap.has(family)) continue;

    // fc-list spacing field: 100 = monospace, 0/90 = proportional
    const spacing = parts[2]?.trim();
    let category: SystemFont["category"];
    if (spacing === "100") {
      category = "monospace";
    } else {
      category = classifyFontByName(family);
    }

    familyMap.set(family, { family, category });
  }

  return Array.from(familyMap.values()).sort((a, b) =>
    a.family.localeCompare(b.family),
  );
}

function parsePowerShellOutput(output: string): SystemFont[] {
  const familyMap = new Map<string, SystemFont>();

  for (const line of output.split("\n")) {
    const family = line.trim();
    if (!family) continue;
    if (familyMap.has(family)) continue;
    familyMap.set(family, { family, category: classifyFontByName(family) });
  }

  return Array.from(familyMap.values()).sort((a, b) =>
    a.family.localeCompare(b.family),
  );
}

async function discoverFonts(): Promise<SystemFont[]> {
  const platform = process.platform;

  try {
    if (platform === "darwin" || platform === "linux") {
      // fc-list is available on both macOS (via Homebrew/XQuartz) and Linux
      // Falls back to system_profiler on macOS if fc-list unavailable
      try {
        const { stdout } = await execAsync(
          'fc-list --format="%{family}:%{style}:%{spacing}\\n"',
          { timeout: 10_000 },
        );
        return parseFcListOutput(stdout);
      } catch {
        if (platform === "darwin") {
          // Fallback: use system_profiler (slower but always available on macOS)
          const { stdout } = await execAsync(
            "system_profiler SPFontsDataType -json",
            { timeout: 15_000 },
          );
          const data = JSON.parse(stdout);
          const fonts = data?.SPFontsDataType ?? [];
          const familyMap = new Map<string, SystemFont>();
          for (const font of fonts) {
            const family = font._name ?? font.family;
            if (!family || familyMap.has(family)) continue;
            familyMap.set(family, {
              family,
              category: classifyFontByName(family),
            });
          }
          return Array.from(familyMap.values()).sort((a, b) =>
            a.family.localeCompare(b.family),
          );
        }
        return [];
      }
    }

    if (platform === "win32") {
      const { stdout } = await execAsync(
        'powershell -NoProfile -Command "Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }"',
        { timeout: 15_000 },
      );
      return parsePowerShellOutput(stdout);
    }

    return [];
  } catch {
    console.error("[fonts] Failed to enumerate system fonts");
    return [];
  }
}

export async function getSystemFonts(): Promise<SystemFont[]> {
  if (cachedFonts) return cachedFonts;
  cachedFonts = await discoverFonts();
  return cachedFonts;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/server && npx vitest run src/fonts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/fonts.ts apps/server/src/fonts.test.ts
git commit -m "feat(server): add system font discovery with platform-specific enumeration"
```

---

### Task 4: Server HTTP Endpoint

**Files:**
- Modify: `apps/server/src/http.ts` (add `fontsRouteLayer` after existing route layers)
- Modify: `apps/server/src/server.ts:280-297` (add to `makeRoutesLayer`)

- [ ] **Step 1: Add fonts route layer to http.ts**

In `apps/server/src/http.ts`, add the import at the top with the other imports:

```typescript
import { getSystemFonts } from "./fonts";
```

Then add a new route layer. Place it before `staticAndDevRouteLayer` definition. Follow the exact same pattern as `serverEnvironmentRouteLayer`:

```typescript
export const fontsRouteLayer = HttpRouter.add(
  "GET",
  "/api/fonts",
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const fonts = yield* Effect.tryPromise(() => getSystemFonts());
    return HttpServerResponse.jsonUnsafe(fonts, {
      status: 200,
      headers: { "cache-control": "private, max-age=3600" },
    });
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);
```

This follows the exact same pattern as `otlpTracesProxyRouteLayer` and `attachmentsRouteLayer`: `HttpRouter.add("GET", ...)`, `requireAuthenticatedRequest` (not `authenticateHttpRequest`), `HttpServerResponse.jsonUnsafe` (not `.json`), and `.pipe(Effect.catchTag("AuthError", respondToAuthError))` for auth error handling.

- [ ] **Step 2: Wire into makeRoutesLayer in server.ts**

In `apps/server/src/server.ts`, add import:

```typescript
import { fontsRouteLayer } from "./http";
```

In the `makeRoutesLayer` `Layer.mergeAll(...)` call, add `fontsRouteLayer` before `staticAndDevRouteLayer`:

```typescript
export const makeRoutesLayer = Layer.mergeAll(
  // ... existing route layers ...
  projectFaviconRouteLayer,
  serverEnvironmentRouteLayer,
  fontsRouteLayer,              // <-- add here
  staticAndDevRouteLayer,
  websocketRpcRouteLayer,
).pipe(Layer.provide(browserApiCorsLayer));
```

- [ ] **Step 3: Verify server builds**

Run: `cd apps/server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/http.ts apps/server/src/server.ts
git commit -m "feat(server): add GET /api/fonts endpoint with auth and caching"
```

---

### Task 5: Client Font List Hook

**Files:**
- Create: `apps/web/src/hooks/useFonts.ts`

- [ ] **Step 1: Create the useFonts hook**

Create `apps/web/src/hooks/useFonts.ts`:

```typescript
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { SystemFont } from "@fenrir/contracts";
import { resolvePrimaryEnvironmentHttpUrl } from "../environments/primary/target";

async function fetchFonts(): Promise<SystemFont[]> {
  const url = resolvePrimaryEnvironmentHttpUrl("/api/fonts");
  const response = await fetch(url, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch fonts: ${response.status}`);
  }

  return response.json();
}

export function useFonts() {
  const { data: fonts = [], isLoading } = useQuery({
    queryKey: ["system-fonts"],
    queryFn: fetchFonts,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: 2,
  });

  const monospaceFonts = useMemo(
    () => fonts.filter((f) => f.category === "monospace"),
    [fonts],
  );

  return { fonts, monospaceFonts, isLoading };
}
```

This uses the same auth pattern as all other HTTP fetch calls in the codebase (see `apps/web/src/environments/primary/auth.ts`): `resolvePrimaryEnvironmentHttpUrl(path)` to build the URL + `credentials: "include"` for cookie-based auth.

- [ ] **Step 2: Verify types**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors (or only pre-existing errors)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useFonts.ts
git commit -m "feat(web): add useFonts hook with TanStack Query"
```

---

### Task 6: FontPicker Component

**Files:**
- Create: `apps/web/src/components/settings/FontPicker.tsx`

- [ ] **Step 1: Create FontPicker component**

Create `apps/web/src/components/settings/FontPicker.tsx`:

```typescript
import { useComboboxFilter } from "../ui/combobox";
import { useState } from "react";
import type { SystemFont } from "@fenrir/contracts";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxGroup,
  ComboboxGroupLabel,
} from "../ui/combobox";

interface FontPickerProps {
  value: string;
  onChange: (fontFamily: string) => void;
  fonts: SystemFont[];
  filterMonospace?: boolean;
  isLoading?: boolean;
}

const CATEGORY_LABELS: Record<SystemFont["category"], string> = {
  monospace: "Monospace",
  "sans-serif": "Sans-Serif",
  serif: "Serif",
  other: "Other",
};

const CATEGORY_ORDER: SystemFont["category"][] = [
  "monospace",
  "sans-serif",
  "serif",
  "other",
];

export function FontPicker({
  value,
  onChange,
  fonts,
  filterMonospace = false,
  isLoading = false,
}: FontPickerProps) {
  const [showAllFonts, setShowAllFonts] = useState(false);

  const visibleFonts =
    filterMonospace && !showAllFonts
      ? fonts.filter((f) => f.category === "monospace")
      : fonts;

  const filterResult = useComboboxFilter(visibleFonts, {
    getString: (font) => font.family,
  });

  // Group fonts by category
  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    fonts: filterResult.filter((f) => f.category === category),
  })).filter((group) => group.fonts.length > 0);

  // Check if current value is non-monospace in terminal mode
  const selectedFont = fonts.find((f) => f.family === value);
  const showMonospaceWarning =
    filterMonospace && selectedFont && selectedFont.category !== "monospace";

  return (
    <div className="w-full sm:w-64">
      <Combobox
        value={value}
        onValueChange={(newValue) => {
          if (typeof newValue === "string") {
            onChange(newValue);
          }
        }}
      >
        <ComboboxInput
          placeholder={isLoading ? "Loading fonts..." : "Select font..."}
          size="default"
        />
        <ComboboxPopup sideOffset={4} align="end">
          <ComboboxList className="max-h-64">
            {grouped.map((group) => (
              <ComboboxGroup key={group.category}>
                <ComboboxGroupLabel>{group.label}</ComboboxGroupLabel>
                {group.fonts.map((font) => (
                  <ComboboxItem key={font.family} value={font.family}>
                    <span style={{ fontFamily: `"${font.family}"` }}>
                      {font.family}
                    </span>
                  </ComboboxItem>
                ))}
              </ComboboxGroup>
            ))}
            <ComboboxEmpty>No matching fonts found</ComboboxEmpty>
          </ComboboxList>
          {filterMonospace && !showAllFonts && (
            <button
              type="button"
              className="w-full border-t border-border/60 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onMouseDown={(e) => {
                e.preventDefault();
                setShowAllFonts(true);
              }}
            >
              Show all fonts
            </button>
          )}
          {filterMonospace && showAllFonts && (
            <button
              type="button"
              className="w-full border-t border-border/60 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onMouseDown={(e) => {
                e.preventDefault();
                setShowAllFonts(false);
              }}
            >
              Show monospace only
            </button>
          )}
        </ComboboxPopup>
      </Combobox>
      {showMonospaceWarning && (
        <p className="mt-1 text-xs text-warning">
          Not monospace — may cause display issues in terminal
        </p>
      )}
    </div>
  );
}
```

**Note for implementor:** The Combobox API props (`value`, `onValueChange`, `ComboboxGroup`, `ComboboxGroupLabel`, etc.) must match the actual exports from `components/ui/combobox.tsx`. Read the file to verify the exact prop names — the Base UI Combobox may use different naming (e.g., `selectedValue` instead of `value`). Adapt accordingly.

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors (or only pre-existing errors)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/settings/FontPicker.tsx
git commit -m "feat(web): add FontPicker combobox component with category grouping"
```

---

### Task 7: Settings UI — Font Section in SettingsPanels

**Files:**
- Modify: `apps/web/src/components/settings/SettingsPanels.tsx`

- [ ] **Step 1: Add imports**

At the top of `SettingsPanels.tsx`, add these imports:

```typescript
import { FontPicker } from "./FontPicker";
import { useFonts } from "../../hooks/useFonts";
```

- [ ] **Step 2: Add font settings to useSettingsRestore**

In `useSettingsRestore()`, add to the `changedSettingLabels` useMemo array (after the existing entries, before the closing `]`):

```typescript
      ...(settings.uiFontFamily !== DEFAULT_UNIFIED_SETTINGS.uiFontFamily
        ? ["UI Font"]
        : []),
      ...(settings.uiFontSize !== DEFAULT_UNIFIED_SETTINGS.uiFontSize
        ? ["UI Font Size"]
        : []),
      ...(settings.terminalFontFamily !== DEFAULT_UNIFIED_SETTINGS.terminalFontFamily
        ? ["Terminal Font"]
        : []),
      ...(settings.terminalFontSize !== DEFAULT_UNIFIED_SETTINGS.terminalFontSize
        ? ["Terminal Font Size"]
        : []),
```

Also add to the `useMemo` dependency array:

```typescript
      settings.uiFontFamily,
      settings.uiFontSize,
      settings.terminalFontFamily,
      settings.terminalFontSize,
```

- [ ] **Step 3: Add Fonts section to GeneralSettingsPanel**

In `GeneralSettingsPanel()`, add the `useFonts` hook call near the top (alongside existing hooks):

```typescript
  const { fonts, monospaceFonts, isLoading: fontsLoading } = useFonts();
```

Then add a new `SettingsSection` titled "Fonts" after the "General" section (after the closing `</SettingsSection>` of the General block, before the Provider settings section). Use the exact same `SettingsRow` pattern as existing rows:

```tsx
      <SettingsSection title="Fonts">
        <SettingsRow
          title="UI Font"
          description="Font family used across the application interface."
          resetAction={
            settings.uiFontFamily !== DEFAULT_UNIFIED_SETTINGS.uiFontFamily ? (
              <SettingResetButton
                label="UI font"
                onClick={() =>
                  updateSettings({
                    uiFontFamily: DEFAULT_UNIFIED_SETTINGS.uiFontFamily,
                  })
                }
              />
            ) : null
          }
          control={
            <FontPicker
              value={settings.uiFontFamily}
              onChange={(value) => updateSettings({ uiFontFamily: value })}
              fonts={fonts}
              isLoading={fontsLoading}
            />
          }
        />

        <SettingsRow
          title="UI Font Size"
          description="Base font size for the application interface (10–24px)."
          resetAction={
            settings.uiFontSize !== DEFAULT_UNIFIED_SETTINGS.uiFontSize ? (
              <SettingResetButton
                label="UI font size"
                onClick={() =>
                  updateSettings({
                    uiFontSize: DEFAULT_UNIFIED_SETTINGS.uiFontSize,
                  })
                }
              />
            ) : null
          }
          control={
            <input
              type="number"
              min={10}
              max={24}
              step={1}
              value={settings.uiFontSize}
              onChange={(e) => {
                const val = Number.parseInt(e.target.value, 10);
                if (!Number.isNaN(val)) {
                  updateSettings({ uiFontSize: Math.min(Math.max(val, 10), 24) });
                }
              }}
              className="w-20 rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm"
              aria-label="UI font size"
            />
          }
        />

        <SettingsRow
          title="Terminal Font"
          description="Font family used in the terminal emulator. Monospace fonts recommended."
          resetAction={
            settings.terminalFontFamily !==
            DEFAULT_UNIFIED_SETTINGS.terminalFontFamily ? (
              <SettingResetButton
                label="terminal font"
                onClick={() =>
                  updateSettings({
                    terminalFontFamily:
                      DEFAULT_UNIFIED_SETTINGS.terminalFontFamily,
                  })
                }
              />
            ) : null
          }
          control={
            <FontPicker
              value={settings.terminalFontFamily}
              onChange={(value) =>
                updateSettings({ terminalFontFamily: value })
              }
              fonts={fonts}
              filterMonospace
              isLoading={fontsLoading}
            />
          }
        />

        <SettingsRow
          title="Terminal Font Size"
          description="Font size for the terminal emulator (8–24px)."
          resetAction={
            settings.terminalFontSize !==
            DEFAULT_UNIFIED_SETTINGS.terminalFontSize ? (
              <SettingResetButton
                label="terminal font size"
                onClick={() =>
                  updateSettings({
                    terminalFontSize:
                      DEFAULT_UNIFIED_SETTINGS.terminalFontSize,
                  })
                }
              />
            ) : null
          }
          control={
            <input
              type="number"
              min={8}
              max={24}
              step={1}
              value={settings.terminalFontSize}
              onChange={(e) => {
                const val = Number.parseInt(e.target.value, 10);
                if (!Number.isNaN(val)) {
                  updateSettings({
                    terminalFontSize: Math.min(Math.max(val, 8), 24),
                  });
                }
              }}
              className="w-20 rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm"
              aria-label="Terminal font size"
            />
          }
        />
      </SettingsSection>
```

- [ ] **Step 4: Verify it compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/settings/SettingsPanels.tsx
git commit -m "feat(web): add Fonts settings section with font picker and size controls"
```

---

### Task 8: Apply UI Font via CSS Custom Properties

**Files:**
- Modify: `apps/web/src/index.css:190-201`
- Modify: `apps/web/src/routes/__root.tsx:66-102`

- [ ] **Step 1: Update CSS body font declaration**

In `apps/web/src/index.css`, replace the body font-family block (lines 190-201):

```css
body {
  font-family: var(
    --fenrir-font-family,
    "Geist Mono",
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    system-ui,
    monospace
  );
  font-size: var(--fenrir-font-size, 14px);
  margin: 0;
  padding: 0;
  min-height: 100vh;
}
```

- [ ] **Step 2: Add FontSettingsSync component to RootRouteView**

In `apps/web/src/routes/__root.tsx`, add import:

```typescript
import { useSettings } from "../hooks/useSettings";
```

Create a `FontSettingsSync` component **outside** `RootRouteView` (above it or below it):

```typescript
function FontSettingsSync() {
  const { uiFontFamily, uiFontSize } = useSettings((s) => ({
    uiFontFamily: s.uiFontFamily,
    uiFontSize: s.uiFontSize,
  }));

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(
      "--fenrir-font-family",
      `"${uiFontFamily}", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, monospace`,
    );
    root.style.setProperty("--fenrir-font-size", `${uiFontSize}px`);

    return () => {
      root.style.removeProperty("--fenrir-font-family");
      root.style.removeProperty("--fenrir-font-size");
    };
  }, [uiFontFamily, uiFontSize]);

  return null;
}
```

Then render it **inside the authenticated branch** of `RootRouteView`, alongside other bootstrap components like `AuthenticatedTracingBootstrap`:

```tsx
  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <AuthenticatedTracingBootstrap />
        <FontSettingsSync />           {/* <-- add here */}
        <ServerStateBootstrap />
        ...
```

This avoids calling `useSettings()` in `RootRouteView` directly (which has early returns for unauthenticated states — hooks can't be called conditionally). The component only mounts when authenticated.

- [ ] **Step 3: Verify it compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/index.css apps/web/src/routes/__root.tsx
git commit -m "feat(web): apply UI font settings via CSS custom properties"
```

---

### Task 9: Apply Terminal Font Settings

**Files:**
- Modify: `apps/web/src/components/ThreadTerminalDrawer.tsx:355-363`
- Modify: `apps/web/src/components/hack/TargetShellTab.tsx:21-32`

- [ ] **Step 1: Define shared terminal font fallback constant**

Create a shared constant to avoid duplication between `ThreadTerminalDrawer.tsx` and `TargetShellTab.tsx`. Add to `packages/contracts/src/fonts.ts` (alongside schemas):

```typescript
/** Standard monospace fallback chain appended to user-selected terminal font */
export const TERMINAL_FONT_FALLBACKS =
  '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace';
```

Then import in both terminal files:

```typescript
import { TERMINAL_FONT_FALLBACKS } from "@fenrir/contracts";
```

- [ ] **Step 2: Update ThreadTerminalDrawer terminal constructor**

Find the Terminal constructor (around line 355). The current hardcoded values:

```typescript
fontSize: 12,
fontFamily:
  '"GeistMono Nerd Font", "GeistMono NFM", "Geist Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
```

Replace with settings-driven values. This requires getting the settings. Since this code is inside a `useEffect`, you cannot call hooks directly. Instead, read the settings at the component level and pass them in.

At the component level (where other hooks are called), add:

```typescript
const { terminalFontFamily, terminalFontSize } = useSettings((s) => ({
  terminalFontFamily: s.terminalFontFamily,
  terminalFontSize: s.terminalFontSize,
}));
```

Then in the Terminal constructor, replace the font lines:

```typescript
fontSize: terminalFontSize,
fontFamily: `"${terminalFontFamily}", ${TERMINAL_FONT_FALLBACKS}`,
```

- [ ] **Step 3: Add effect to update terminal on settings change**

After the terminal creation `useEffect`, add a new effect that updates the terminal when font settings change:

```typescript
useEffect(() => {
  const terminal = terminalRef.current;
  const fitAddon = fitAddonRef.current;
  if (!terminal) return;

  terminal.options.fontFamily = `"${terminalFontFamily}", ${TERMINAL_FONT_FALLBACKS}`;
  terminal.options.fontSize = terminalFontSize;
  fitAddon?.fit();
}, [terminalFontFamily, terminalFontSize]);
```

**Note for implementor:** Verify that `terminalRef` and `fitAddonRef` are the correct ref names by reading the component. The actual names may differ. Also ensure the effect doesn't fire before the terminal is created.

- [ ] **Step 4: Update TargetShellTab.tsx**

In `apps/web/src/components/hack/TargetShellTab.tsx`, apply the same pattern.

Add imports:

```typescript
import { useSettings } from "../../hooks/useSettings";
import { TERMINAL_FONT_FALLBACKS } from "@fenrir/contracts";
```

Read settings at component level:

```typescript
const { terminalFontFamily, terminalFontSize } = useSettings((s) => ({
  terminalFontFamily: s.terminalFontFamily,
  terminalFontSize: s.terminalFontSize,
}));
```

Replace the hardcoded Terminal constructor font values:

```typescript
fontSize: terminalFontSize,
fontFamily: `"${terminalFontFamily}", ${TERMINAL_FONT_FALLBACKS}`,
```

- [ ] **Step 5: Add reactive font update effect to TargetShellTab**

After the terminal creation `useEffect` in `TargetShellTab.tsx`, add a separate effect for font changes (same pattern as ThreadTerminalDrawer):

```typescript
useEffect(() => {
  const terminal = terminalRef.current;
  if (!terminal) return;

  terminal.options.fontFamily = `"${terminalFontFamily}", ${TERMINAL_FONT_FALLBACKS}`;
  terminal.options.fontSize = terminalFontSize;
}, [terminalFontFamily, terminalFontSize]);
```

**Note:** Verify the ref name (`terminalRef`) by reading the component. `TargetShellTab` is simpler than `ThreadTerminalDrawer` and may not have a `fitAddon` — if it does, call `fitAddon.fit()` after updating options.

- [ ] **Step 7: Verify it compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/ThreadTerminalDrawer.tsx apps/web/src/components/hack/TargetShellTab.tsx
git commit -m "feat(web): apply terminal font settings to xterm with fallback chain"
```

---

### Task 10: Integration Verification

- [ ] **Step 1: Run full test suite**

Run: `npm run test`
Expected: All existing tests pass, new settings tests pass

- [ ] **Step 2: Run type check across all packages**

Run: `npx turbo run typecheck` (or equivalent — check `package.json` scripts for the correct command)
Expected: No type errors

- [ ] **Step 3: Build the app**

Run: `npm run build` (or equivalent — check `package.json` scripts)
Expected: Successful build

- [ ] **Step 4: Manual verification checklist**

If running the app locally:
- [ ] Settings page shows "Fonts" section with 4 rows
- [ ] Font picker dropdown populates with system fonts
- [ ] Font picker search filters results
- [ ] Terminal font picker shows monospace by default, "Show all fonts" toggle works
- [ ] Font names render in their own typeface in dropdown
- [ ] Changing UI font updates app interface immediately
- [ ] Changing UI font size updates base text size
- [ ] Changing terminal font updates terminal text
- [ ] Changing terminal font size updates terminal and triggers refit
- [ ] Reset-to-default buttons appear when settings differ from defaults
- [ ] "Restore Defaults" in settings header resets all font settings
- [ ] Settings persist across page refresh (localStorage)

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: integration fixes for font configuration"
```
