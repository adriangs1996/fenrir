# Plan: Web Input Handlers (Keyboard + Mouse)

## Summary

Implement keyboard and mouse input translation from DOM events to neovim's input notation. Keyboard maps `KeyboardEvent` to neovim key strings. Mouse maps `MouseEvent`/`WheelEvent` to `nvim_input_mouse` parameters.

## Motivation

Input handling is the primary user interaction path. Must be accurate (every key combo maps correctly), fast (no perceptible latency), and handle edge cases (IME, dead keys, special keys across platforms).

## Prerequisites

- `neovim-05-web-msgpack-bridge` (NeovimBridge.sendInput / sendMouse)

## Scope

- New file: `apps/web/src/modules/neovim-editor/input/KeyboardHandler.ts`
- New file: `apps/web/src/modules/neovim-editor/input/MouseHandler.ts`
- New file: `apps/web/src/modules/neovim-editor/__tests__/KeyboardHandler.test.ts`
- New file: `apps/web/src/modules/neovim-editor/__tests__/MouseHandler.test.ts`

## Proposed Changes

### 1. KeyboardHandler — `input/KeyboardHandler.ts`

```typescript
/**
 * Translates DOM KeyboardEvent into Neovim key notation.
 *
 * Neovim key notation reference:
 * - Regular chars: "a", "B", "1", "/"
 * - Special keys: <CR>, <Esc>, <Tab>, <BS>, <Del>, <Space>
 * - Arrow keys: <Up>, <Down>, <Left>, <Right>
 * - Function keys: <F1>-<F12>
 * - Modifiers: <C-a> (Ctrl), <A-a> (Alt), <S-Tab> (Shift), <D-a> (Cmd/Super)
 * - Combined: <C-S-a> (Ctrl+Shift), <C-A-S-a> (Ctrl+Alt+Shift)
 * - Literal <: <LT>
 */

// ── Special Key Map ──

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
  F1: "F1", F2: "F2", F3: "F3", F4: "F4",
  F5: "F5", F6: "F6", F7: "F7", F8: "F8",
  F9: "F9", F10: "F10", F11: "F11", F12: "F12",
};

// Keys that should only be sent when modified
const MODIFIER_ONLY_KEYS = new Set([
  "Shift", "Control", "Alt", "Meta",
  "CapsLock", "NumLock", "ScrollLock",
]);

/**
 * Convert a KeyboardEvent to neovim input string.
 * Returns null if the event should be ignored (modifier-only key, IME).
 */
export function keyEventToNeovimInput(event: KeyboardEvent): string | null {
  // Ignore modifier-only keys
  if (MODIFIER_ONLY_KEYS.has(event.key)) return null;

  // Ignore IME composition events
  if (event.isComposing || event.keyCode === 229) return null;

  const key = event.key;
  const ctrl = event.ctrlKey;
  const alt = event.altKey;
  const shift = event.shiftKey;
  const meta = event.metaKey;

  // Check if it's a special key
  const special = SPECIAL_KEYS[key];

  if (special) {
    return formatKeyWithModifiers(special, ctrl, alt, shift, meta);
  }

  // Literal "<"
  if (key === "<") {
    return formatKeyWithModifiers("LT", ctrl, alt, shift, meta);
  }

  // Regular character with modifiers
  if (ctrl || alt || meta) {
    // For ctrl/alt/meta + letter, use the lowercase key name
    const keyName = key.length === 1 ? key.toLowerCase() : key;
    return formatKeyWithModifiers(keyName, ctrl, alt, shift, meta);
  }

  // Plain character — send as-is
  if (key.length === 1) {
    return key;
  }

  // Unknown special key — ignore
  return null;
}

/**
 * Format a key name with modifier prefixes in neovim notation.
 *
 * Order: S- (Shift), C- (Ctrl), A- (Alt), D- (Cmd/Super)
 * Only include Shift for special keys, not for regular shifted characters
 * (e.g., "A" is already shifted, don't send <S-a>)
 */
function formatKeyWithModifiers(
  keyName: string,
  ctrl: boolean,
  alt: boolean,
  shift: boolean,
  meta: boolean,
): string {
  // For single printable chars, shift is implicit in the character itself
  const isSpecialKey = keyName.length > 1;
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

/**
 * Handle compositionend for IME input.
 * When IME finalizes, send the composed text directly.
 */
export function compositionEndToNeovimInput(data: string): string {
  // Send each character individually — neovim handles multi-byte correctly
  return data;
}
```

### 2. Platform-specific Considerations

```typescript
/**
 * Detect platform for modifier key mapping.
 * On macOS: Meta = Cmd (primary modifier), Ctrl = Ctrl
 * On Windows/Linux: Ctrl = primary modifier, Meta = Super/Win
 *
 * Neovim convention:
 * - <C-x> = Ctrl+x
 * - <A-x> = Alt+x
 * - <D-x> = Cmd/Super+x (only meaningful on macOS GUI)
 */
export function isMacPlatform(): boolean {
  return navigator.platform?.startsWith("Mac") ||
    navigator.userAgent?.includes("Mac");
}

/**
 * Some key combos should NOT be forwarded to neovim because
 * they're handled by the app's keybinding system (e.g., Cmd+E for toggle).
 *
 * The NeovimEditor component should check this before forwarding.
 */
export function isAppKeybinding(event: KeyboardEvent): boolean {
  // Cmd+E — editor toggle (handled by app)
  // Cmd+, — settings (handled by app)
  // Cmd+W — close (handled by app)
  // These are checked against the app's keybinding system, not hardcoded here.
  // This function is a placeholder — actual filtering happens in the component.
  return false;
}
```

### 3. MouseHandler — `input/MouseHandler.ts`

```typescript
import type { CellDimensions } from "../renderer/FontMetrics";

/**
 * Parameters for nvim_input_mouse call.
 */
export interface NeovimMouseParams {
  button: string;    // "left" | "right" | "middle" | "wheel" | "move"
  action: string;    // "press" | "drag" | "release" | "up" | "down" | "left" | "right"
  modifier: string;  // "" or combo of "C-", "A-", "S-"
  grid: number;      // Grid number (0 for default, or specific grid for multigrid)
  row: number;       // Zero-based grid row
  col: number;       // Zero-based grid col
}

/**
 * Translate pixel coordinates to grid cell coordinates.
 */
export function pixelToCell(
  pixelX: number,
  pixelY: number,
  cellDimensions: CellDimensions,
): { row: number; col: number } {
  return {
    col: Math.floor(pixelX / cellDimensions.width),
    row: Math.floor(pixelY / cellDimensions.height),
  };
}

/**
 * Extract modifier string from mouse event.
 */
export function mouseModifiers(event: MouseEvent): string {
  let mod = "";
  if (event.ctrlKey) mod += "C-";
  if (event.altKey) mod += "A-";
  if (event.shiftKey) mod += "S-";
  return mod;
}

/**
 * Convert mousedown event to neovim mouse params.
 */
export function mouseDownToNeovim(
  event: MouseEvent,
  cellDimensions: CellDimensions,
  canvasRect: DOMRect,
  grid: number = 0,
): NeovimMouseParams {
  const x = event.clientX - canvasRect.left;
  const y = event.clientY - canvasRect.top;
  const { row, col } = pixelToCell(x, y, cellDimensions);

  const button = event.button === 0 ? "left"
    : event.button === 1 ? "middle"
    : event.button === 2 ? "right"
    : "left";

  return {
    button,
    action: "press",
    modifier: mouseModifiers(event),
    grid,
    row,
    col,
  };
}

/**
 * Convert mousemove during drag to neovim mouse params.
 */
export function mouseMoveToNeovim(
  event: MouseEvent,
  cellDimensions: CellDimensions,
  canvasRect: DOMRect,
  activeButton: string,
  grid: number = 0,
): NeovimMouseParams {
  const x = event.clientX - canvasRect.left;
  const y = event.clientY - canvasRect.top;
  const { row, col } = pixelToCell(x, y, cellDimensions);

  return {
    button: activeButton,
    action: "drag",
    modifier: mouseModifiers(event),
    grid,
    row,
    col,
  };
}

/**
 * Convert mouseup event to neovim mouse params.
 */
export function mouseUpToNeovim(
  event: MouseEvent,
  cellDimensions: CellDimensions,
  canvasRect: DOMRect,
  grid: number = 0,
): NeovimMouseParams {
  const x = event.clientX - canvasRect.left;
  const y = event.clientY - canvasRect.top;
  const { row, col } = pixelToCell(x, y, cellDimensions);

  const button = event.button === 0 ? "left"
    : event.button === 1 ? "middle"
    : event.button === 2 ? "right"
    : "left";

  return {
    button,
    action: "release",
    modifier: mouseModifiers(event),
    grid,
    row,
    col,
  };
}

/**
 * Convert wheel event to neovim mouse params.
 */
export function wheelToNeovim(
  event: WheelEvent,
  cellDimensions: CellDimensions,
  canvasRect: DOMRect,
  grid: number = 0,
): NeovimMouseParams {
  const x = event.clientX - canvasRect.left;
  const y = event.clientY - canvasRect.top;
  const { row, col } = pixelToCell(x, y, cellDimensions);

  // Determine scroll direction
  const action = event.deltaY < 0 ? "up"
    : event.deltaY > 0 ? "down"
    : event.deltaX < 0 ? "left"
    : "right";

  return {
    button: "wheel",
    action,
    modifier: mouseModifiers(event),
    grid,
    row,
    col,
  };
}

/**
 * Grid-aware coordinate translation for multigrid.
 * Given global pixel coordinates, find which grid the mouse is over
 * and compute grid-local cell coordinates.
 */
export function resolveGridAtPixel(
  pixelX: number,
  pixelY: number,
  cellDimensions: CellDimensions,
  grids: Map<number, { startRow: number; startCol: number; width: number; height: number; isFloat: boolean; hidden: boolean; zindex: number }>,
): { grid: number; row: number; col: number } {
  // Check floating windows first (highest zindex first)
  const floats = [...grids.entries()]
    .filter(([_, g]) => g.isFloat && !g.hidden)
    .sort((a, b) => b[1].zindex - a[1].zindex);

  const globalCol = Math.floor(pixelX / cellDimensions.width);
  const globalRow = Math.floor(pixelY / cellDimensions.height);

  for (const [gridId, g] of floats) {
    const localCol = globalCol - g.startCol;
    const localRow = globalRow - g.startRow;
    if (localCol >= 0 && localCol < g.width && localRow >= 0 && localRow < g.height) {
      return { grid: gridId, row: localRow, col: localCol };
    }
  }

  // Check regular windows
  const windows = [...grids.entries()]
    .filter(([id, g]) => !g.isFloat && !g.hidden && id !== 1);

  for (const [gridId, g] of windows) {
    const localCol = globalCol - g.startCol;
    const localRow = globalRow - g.startRow;
    if (localCol >= 0 && localCol < g.width && localRow >= 0 && localRow < g.height) {
      return { grid: gridId, row: localRow, col: localCol };
    }
  }

  // Default to grid 1 (global grid)
  return { grid: 0, row: globalRow, col: globalCol };
}
```

### 4. Tests

**KeyboardHandler.test.ts**:
1. Regular letter "a" → "a"
2. Capital "A" → "A" (no `<S-a>`)
3. Enter → `<CR>`
4. Escape → `<Esc>`
5. Tab → `<Tab>`
6. Backspace → `<BS>`
7. ArrowUp → `<Up>`
8. F1 → `<F1>`
9. Ctrl+a → `<C-a>`
10. Alt+x → `<A-x>`
11. Shift+Tab → `<S-Tab>`
12. Ctrl+Shift+a → `<S-C-a>`
13. Meta+s (Cmd+s) → `<D-s>`
14. `<` literal → `<LT>`
15. Space → `<Space>`
16. Modifier-only keys (Shift, Control, Alt) → null
17. IME composing → null
18. compositionEndToNeovimInput("你好") → "你好"

**MouseHandler.test.ts**:
1. Left click at (100, 50) with 10px cells → row=5, col=10, button="left", action="press"
2. Right click → button="right"
3. Middle click → button="middle"
4. Mouse drag → action="drag", correct button
5. Mouse up → action="release"
6. Wheel scroll down → button="wheel", action="down"
7. Wheel scroll up → button="wheel", action="up"
8. Ctrl+click → modifier="C-"
9. Shift+Alt+click → modifier="A-S-"
10. resolveGridAtPixel: floating window gets priority over regular
11. resolveGridAtPixel: correct grid-local coordinates

## Validation

- `bun test apps/web/src/modules/neovim-editor/__tests__/KeyboardHandler.test.ts`
- `bun test apps/web/src/modules/neovim-editor/__tests__/MouseHandler.test.ts`
- `bun typecheck`

## Done Criteria

- All neovim special keys mapped correctly
- Modifier combinations produce correct notation (order: S-C-A-D-)
- IME composition handled (compositionend sends text)
- Mouse events translate to correct grid cells
- Multigrid-aware: mouse resolves to correct grid with local coordinates
- All 29 test cases pass
- Pure functions — no DOM dependency in tests
