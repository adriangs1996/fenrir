---
depends_on:
  - neovim-08a-keyboard-handler
  - neovim-08b-mouse-handler
---

# Plan 08c: Input Handler Tests

## Goal

Vitest suites for `KeyboardHandler` and `MouseHandler`. Pure-function tests, no DOM beyond constructed event objects.

## Scope

- New file: `apps/web/src/modules/neovim-editor/__tests__/KeyboardHandler.test.ts`
- New file: `apps/web/src/modules/neovim-editor/__tests__/MouseHandler.test.ts`

## Steps

### Step 1. KeyboardHandler.test.ts

```typescript
import { describe, it, expect } from "vitest";
import {
  keyEventToNeovimInput,
  compositionEndToNeovimInput,
} from "../input/KeyboardHandler";

function evt(init: Partial<KeyboardEvent>): KeyboardEvent {
  return new KeyboardEvent("keydown", init as KeyboardEventInit);
}
```

18 cases (one per neovim key form). Each case constructs a `KeyboardEvent` and asserts the output:

| Input | Expected |
|---|---|
| `{ key: "a" }` | `"a"` |
| `{ key: "A" }` | `"A"` |
| `{ key: "Enter" }` | `"<CR>"` |
| `{ key: "Escape" }` | `"<Esc>"` |
| `{ key: "Tab" }` | `"<Tab>"` |
| `{ key: "Backspace" }` | `"<BS>"` |
| `{ key: "ArrowUp" }` | `"<Up>"` |
| `{ key: "F1" }` | `"<F1>"` |
| `{ key: "a", ctrlKey: true }` | `"<C-a>"` |
| `{ key: "x", altKey: true }` | `"<A-x>"` |
| `{ key: "Tab", shiftKey: true }` | `"<S-Tab>"` |
| `{ key: "a", ctrlKey: true, shiftKey: true }` | `"<C-a>"` (shift implicit in 'A' if shifted; with explicit shift the spec puts S- first only for special keys — here special is false so output is `<C-a>`) |
| `{ key: "s", metaKey: true }` | `"<D-s>"` |
| `{ key: "<" }` | `"<LT>"` |
| `{ key: " " }` | `"<Space>"` |
| `{ key: "Shift" }` | `null` |
| `{ key: "a", isComposing: true }` | `null` |
| `compositionEndToNeovimInput("你好")` | `"你好"` |

For Ctrl+Shift+special (e.g., Ctrl+Shift+Tab), assert `<S-C-Tab>` ordering.

### Step 2. MouseHandler.test.ts

```typescript
import { describe, it, expect } from "vitest";
import {
  mouseDownToNeovim,
  mouseMoveToNeovim,
  mouseUpToNeovim,
  wheelToNeovim,
  resolveGridAtPixel,
  type GridLayoutEntry,
} from "../input/MouseHandler";

const cell = { width: 10, height: 16, baseline: 12 };
const rect = { left: 0, top: 0, right: 800, bottom: 600 } as DOMRect;
```

11 cases:

1. Left click at clientX=100, clientY=50 → row=3 (50/16 floored), col=10 (100/10), button="left", action="press"
2. Right click → button="right"
3. Middle click → button="middle"
4. Mouse drag with active button "left" → action="drag"
5. Mouse up → action="release"
6. Wheel deltaY=10 → button="wheel", action="down"
7. Wheel deltaY=-10 → action="up"
8. Wheel deltaX=10 → action="right"
9. Ctrl+click → modifier="C-"
10. Shift+Alt+click → modifier="A-S-" (per `mouseModifiers` order: C-, A-, S- — actual output for shift+alt is "A-S-")
11. `resolveGridAtPixel`: float grid at startRow=5, startCol=20, w=10, h=5, zindex=10 over background grid → click at (col=22, row=6) returns float gridId, local row=1 col=2

### Step 3. resolveGridAtPixel cases

- Float wins over regular when both contain the point
- Float with higher zindex wins over float with lower zindex
- Hidden grids excluded
- No match → returns `{ grid: 0, row: globalRow, col: globalCol }`

### Step 4. Notes

- Construct `WheelEvent` with `new WheelEvent("wheel", { deltaY: -10, clientX: ..., clientY: ... })`.
- Construct `MouseEvent` with `new MouseEvent("mousedown", { button: 0, clientX: ..., clientY: ..., ctrlKey: true })`.
- jsdom is required (default for vitest in apps/web — verify).

## Validation

- `bun run test apps/web/src/modules/neovim-editor/__tests__/KeyboardHandler.test.ts`
- `bun run test apps/web/src/modules/neovim-editor/__tests__/MouseHandler.test.ts`
- `bun typecheck`

## Done Criteria

- 18 keyboard tests passing
- 11+ mouse tests passing
- Modifier order asserted in at least one keyboard test
- Multigrid resolver edge cases covered
