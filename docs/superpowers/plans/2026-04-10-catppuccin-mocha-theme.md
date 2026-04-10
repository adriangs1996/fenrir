# Catppuccin Mocha Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Catppuccin Mocha as a fourth selectable theme option (alongside System, Light, Dark) with green accent and custom mauve override.

**Architecture:** CSS class variant (`.catppuccin-mocha`) with full semantic variable definitions in `index.css`. Theme hook extended to handle the new theme value and map it to `"dark"` for all downstream consumers. Bootstrap script updated to prevent flash of wrong colors.

**Tech Stack:** CSS custom properties, Tailwind CSS v4 `@custom-variant`, React (`useSyncExternalStore`), TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-04-10-catppuccin-mocha-theme-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `apps/web/src/index.css` | Modify | Add `@custom-variant`, Catppuccin Mocha CSS variables, scrollbar styles |
| `apps/web/src/hooks/useTheme.ts` | Modify | Extend Theme type, applyTheme, resolvedTheme, desktop bridge mapping |
| `apps/web/src/components/settings/SettingsPanels.tsx` | Modify | Add Catppuccin Mocha to THEME_OPTIONS and type guard |
| `apps/web/index.html` | Modify | Handle catppuccin-mocha in bootstrap script and inline styles |

---

### Task 1: Add Catppuccin Mocha CSS Variables

**Files:**
- Modify: `apps/web/src/index.css:3` (add custom variant declaration)
- Modify: `apps/web/src/index.css:98-126` (add variant block inside `:root`)
- Modify: `apps/web/src/index.css:200-207` (add scrollbar styles after `.dark` scrollbar rules)

- [ ] **Step 1: Add the custom variant declaration**

In `apps/web/src/index.css`, add a new line after line 3 (`@custom-variant dark ...`):

```css
@custom-variant catppuccin-mocha (&:is(.catppuccin-mocha, .catppuccin-mocha *));
```

- [ ] **Step 2: Add the Catppuccin Mocha variable block**

Inside the `:root` block, after the closing `}` of `@variant dark { ... }` (after line 126), add:

```css
  @variant catppuccin-mocha {
    color-scheme: dark;
    --background: #1e1e2e;
    --app-chrome-background: #1e1e2e;
    --foreground: #cdd6f4;
    --card: #181825;
    --card-foreground: #cdd6f4;
    --popover: #181825;
    --popover-foreground: #cdd6f4;
    --primary: #a6e3a1;
    --primary-foreground: #1e1e2e;
    --secondary: #313244;
    --secondary-foreground: #cdd6f4;
    --muted: #313244;
    --muted-foreground: #a6adc8;
    --accent: #313244;
    --accent-foreground: #cdd6f4;
    --destructive: #f38ba8;
    --destructive-foreground: #f38ba8;
    --border: #45475a;
    --input: #585b70;
    --ring: #a6e3a1;
    --info: #89b4fa;
    --info-foreground: #89b4fa;
    --success: #a6e3a1;
    --success-foreground: #a6e3a1;
    --warning: #f9e2af;
    --warning-foreground: #f9e2af;
    --catppuccin-mauve: rgb(152, 125, 210);
  }
```

- [ ] **Step 3: Add Catppuccin scrollbar styles**

After the existing `.dark ::-webkit-scrollbar-thumb:hover` rule (after line 207), add:

```css
.catppuccin-mocha ::-webkit-scrollbar-thumb {
  background: rgba(69, 71, 90, 0.6);
}

.catppuccin-mocha ::-webkit-scrollbar-thumb:hover {
  background: rgba(88, 91, 112, 0.7);
}
```

- [ ] **Step 4: Verify CSS parses correctly**

Run: `cd apps/web && npx vite build --mode development 2>&1 | head -20`
Expected: Build starts without CSS parse errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/index.css
git commit -m "feat: add Catppuccin Mocha CSS variables and custom variant"
```

---

### Task 2: Extend the Theme Hook

**Files:**
- Modify: `apps/web/src/hooks/useTheme.ts:3` (Theme type)
- Modify: `apps/web/src/hooks/useTheme.ts:26-28` (getStored)
- Modify: `apps/web/src/hooks/useTheme.ts:80-97` (applyTheme)
- Modify: `apps/web/src/hooks/useTheme.ts:99-111` (syncDesktopTheme)
- Modify: `apps/web/src/hooks/useTheme.ts:155-173` (useTheme hook — resolvedTheme)

- [ ] **Step 1: Extend the Theme type**

On line 3, change:
```typescript
type Theme = "light" | "dark" | "system";
```
to:
```typescript
type Theme = "light" | "dark" | "system" | "catppuccin-mocha";
```

- [ ] **Step 2: Update getStored()**

On line 27, change:
```typescript
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
```
to:
```typescript
  if (raw === "light" || raw === "dark" || raw === "system" || raw === "catppuccin-mocha") return raw;
```

- [ ] **Step 3: Update applyTheme()**

Replace the `applyTheme` function (lines 80-97) with:

```typescript
function applyTheme(theme: Theme, suppressTransitions = false) {
  if (typeof document === "undefined") return;
  if (suppressTransitions) {
    document.documentElement.classList.add("no-transitions");
  }
  const isCatppuccin = theme === "catppuccin-mocha";
  const isDark = isCatppuccin || theme === "dark" || (theme === "system" && getSystemDark());
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.classList.toggle("catppuccin-mocha", isCatppuccin);
  syncBrowserChromeTheme();
  syncDesktopTheme(theme);
  if (suppressTransitions) {
    // Force a reflow so the no-transitions class takes effect before removal
    // oxlint-disable-next-line no-unused-expressions
    document.documentElement.offsetHeight;
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("no-transitions");
    });
  }
}
```

- [ ] **Step 4: Update syncDesktopTheme()**

Replace the `syncDesktopTheme` function (lines 99-111) with:

```typescript
function syncDesktopTheme(theme: Theme) {
  const bridge = window.desktopBridge;
  if (!bridge || lastDesktopTheme === theme) {
    return;
  }

  lastDesktopTheme = theme;
  const bridgeTheme = theme === "catppuccin-mocha" ? "dark" : theme;
  void bridge.setTheme(bridgeTheme).catch(() => {
    if (lastDesktopTheme === theme) {
      lastDesktopTheme = null;
    }
  });
}
```

- [ ] **Step 5: Update resolvedTheme in useTheme()**

In the `useTheme()` function (around line 159), change:
```typescript
  const resolvedTheme: "light" | "dark" =
    theme === "system" ? (snapshot.systemDark ? "dark" : "light") : theme;
```
to:
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

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/hooks/useTheme.ts
git commit -m "feat: extend theme hook to support catppuccin-mocha"
```

---

### Task 3: Add Catppuccin Mocha to Settings UI

**Files:**
- Modify: `apps/web/src/components/settings/SettingsPanels.tsx:80-93` (THEME_OPTIONS)
- Modify: `apps/web/src/components/settings/SettingsPanels.tsx:700` (onValueChange guard)

- [ ] **Step 1: Add option to THEME_OPTIONS**

In `SettingsPanels.tsx`, after the `"dark"` entry in `THEME_OPTIONS` (after line 92), add:

```typescript
  {
    value: "catppuccin-mocha",
    label: "Catppuccin Mocha",
  },
```

- [ ] **Step 2: Update the onValueChange type guard**

Around line 700, change:
```typescript
        if (value === "system" || value === "light" || value === "dark") {
```
to:
```typescript
        if (value === "system" || value === "light" || value === "dark" || value === "catppuccin-mocha") {
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/settings/SettingsPanels.tsx
git commit -m "feat: add Catppuccin Mocha option to theme settings dropdown"
```

---

### Task 4: Update Bootstrap Script and Inline Styles

**Files:**
- Modify: `apps/web/index.html:11-33` (bootstrap script)
- Modify: `apps/web/index.html:56-59` (add catppuccin-mocha body style)

- [ ] **Step 1: Update the bootstrap script**

Replace the inline `<script>` block (lines 11-34) with:

```html
    <script>
      (() => {
        const LIGHT_BACKGROUND = "#ffffff";
        const DARK_BACKGROUND = "#161616";
        const CATPPUCCIN_BACKGROUND = "#1e1e2e";
        const themeColorMeta = document.querySelector('meta[name="theme-color"]');
        try {
          const storedTheme = window.localStorage.getItem("t3code:theme");
          const theme =
            storedTheme === "light" || storedTheme === "dark" || storedTheme === "system" || storedTheme === "catppuccin-mocha"
              ? storedTheme
              : "system";
          const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
          const isCatppuccin = theme === "catppuccin-mocha";
          const isDark = isCatppuccin || theme === "dark" || (theme === "system" && prefersDark);
          document.documentElement.classList.toggle("dark", isDark);
          document.documentElement.classList.toggle("catppuccin-mocha", isCatppuccin);
          const chromeColor = isCatppuccin ? CATPPUCCIN_BACKGROUND : isDark ? DARK_BACKGROUND : LIGHT_BACKGROUND;
          document.documentElement.style.backgroundColor = chromeColor;
          themeColorMeta?.setAttribute("content", chromeColor);
        } catch {
          document.documentElement.classList.add("dark");
          document.documentElement.style.backgroundColor = DARK_BACKGROUND;
          themeColorMeta?.setAttribute("content", DARK_BACKGROUND);
        }
      })();
    </script>
```

- [ ] **Step 2: Add the catppuccin-mocha body style**

After the `html.dark body` rule (after line 59), add:

```css
      html.catppuccin-mocha body {
        background: #1e1e2e;
        color: #cdd6f4;
      }
```

- [ ] **Step 3: Verify the page loads without errors**

Run: `cd apps/web && npx vite build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/web/index.html
git commit -m "feat: handle catppuccin-mocha in bootstrap script and inline styles"
```

---

### Task 5: Final Verification

- [ ] **Step 1: Run TypeScript check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Run unit tests**

Run: `cd apps/web && npx vitest run --passWithNoTests`
Expected: All tests pass.

- [ ] **Step 3: Run full build**

Run: `cd apps/web && npx vite build`
Expected: Build completes successfully with no warnings about the new CSS.

- [ ] **Step 4: Manual smoke test checklist**

If running the dev server (`npx vite`), verify:
1. Settings > General > Theme dropdown shows four options: System, Light, Dark, Catppuccin Mocha
2. Selecting "Catppuccin Mocha" applies dark purple-blue background (`#1e1e2e`)
3. Primary/accent elements appear in green (`#a6e3a1`)
4. Switching back to "Dark" shows the original neutral dark theme (`#161616` background)
5. Switching to "Light" shows the light theme
6. Refreshing the page with Catppuccin Mocha selected does not flash a wrong background color
7. The "Reset" button next to Theme appears and resets to "System"
