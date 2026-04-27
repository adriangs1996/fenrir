---
depends_on: []
---

# Plan 08a: KeyboardHandler

## Goal

Pure functions that translate `KeyboardEvent` and `compositionend` data into neovim key notation strings.

## Scope

- New file: `apps/web/src/modules/neovim-editor/input/KeyboardHandler.ts`

## Steps

### Step 1. Special key map + ignore set

```typescript
/**
 * Translates DOM KeyboardEvent into Neovim key notation.
 *
 * Examples:
 *  - "a" → "a"
 *  - "A" → "A"             (shift implicit in char)
 *  - "Enter" → "<CR>"
 *  - "Ctrl+a" → "<C-a>"
 *  - "Cmd+s" → "<D-s>"
 *  - "Shift+Tab" → "<S-Tab>"
 *  - "<" literal → "<LT>"
 *
 * Modifier order in output: S-, C-, A-, D-
 */

const SPECIAL_KEYS: Record<string, string> = {
  Enter: "CR",
  Escape: "Esc",
  Tab: "Tab",
  Backspace: "BS",
  Delete: "Del",
  " ": "Space",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Insert: "Insert",
  F1: "F1", F2: "F2", F3: "F3", F4: "F4", F5: "F5", F6: "F6",
  F7: "F7", F8: "F8", F9: "F9", F10: "F10", F11: "F11", F12: "F12",
};

const MODIFIER_ONLY_KEYS = new Set([
  "Shift", "Control", "Alt", "Meta",
  "CapsLock", "NumLock", "ScrollLock",
]);
```

### Step 2. `keyEventToNeovimInput`

```typescript
export function keyEventToNeovimInput(event: KeyboardEvent): string | null {
  if (MODIFIER_ONLY_KEYS.has(event.key)) return null;
  // IME composition in progress
  if (event.isComposing || event.keyCode === 229) return null;

  const key = event.key;
  const ctrl = event.ctrlKey;
  const alt = event.altKey;
  const shift = event.shiftKey;
  const meta = event.metaKey;

  const special = SPECIAL_KEYS[key];
  if (special) {
    return formatKeyWithModifiers(special, ctrl, alt, shift, meta);
  }

  if (key === "<") {
    return formatKeyWithModifiers("LT", ctrl, alt, shift, meta);
  }

  if (ctrl || alt || meta) {
    const keyName = key.length === 1 ? key.toLowerCase() : key;
    return formatKeyWithModifiers(keyName, ctrl, alt, shift, meta);
  }

  if (key.length === 1) {
    return key;
  }

  return null;
}
```

### Step 3. `formatKeyWithModifiers`

```typescript
function formatKeyWithModifiers(
  keyName: string,
  ctrl: boolean,
  alt: boolean,
  shift: boolean,
  meta: boolean,
): string {
  const isSpecialKey = keyName.length > 1;
  // Shift only meaningful for special keys; for printable chars,
  // shift is already encoded in the character itself.
  const includeShift = shift && isSpecialKey;

  const hasModifiers = ctrl || alt || includeShift || meta;

  if (!hasModifiers && keyName.length === 1) {
    return keyName;
  }

  let mod = "";
  if (includeShift) mod += "S-";
  if (ctrl) mod += "C-";
  if (alt) mod += "A-";
  if (meta) mod += "D-";

  return `<${mod}${keyName}>`;
}
```

### Step 4. IME helper

```typescript
/**
 * For compositionend events. Returns the composed text as-is.
 * Neovim handles multi-byte input correctly.
 */
export function compositionEndToNeovimInput(data: string): string {
  return data;
}
```

### Step 5. Platform helpers

```typescript
export function isMacPlatform(): boolean {
  return (
    navigator.platform?.startsWith("Mac") ||
    navigator.userAgent?.includes("Mac")
  );
}
```

(Kept for callers that need to display platform-appropriate hints.)

## Validation

- `bun typecheck`
- Tests in 08c

## Done Criteria

- `keyEventToNeovimInput` handles letters, special keys, modifier combos, IME, `<` literal
- Returns `null` for modifier-only keys and IME-in-progress events
- Modifier order S-C-A-D- in output
- `compositionEndToNeovimInput` returns the composed string verbatim
- `isMacPlatform` exported
