---
depends_on:
  - neovim-06e-font-metrics-tests
---

# Plan 08b: MouseHandler

## Goal

Pure functions that translate DOM `MouseEvent` / `WheelEvent` into `nvim_input_mouse` parameters, plus multigrid coordinate resolution.

## Scope

- New file: `apps/web/src/modules/neovim-editor/input/MouseHandler.ts`

## Steps

### Step 1. Types + helpers

```typescript
import type { CellDimensions } from "../renderer/FontMetrics";

export interface NeovimMouseParams {
  button: string;   // "left" | "right" | "middle" | "wheel" | "move"
  action: string;   // "press" | "drag" | "release" | "up" | "down" | "left" | "right"
  modifier: string; // "" or combo of "C-", "A-", "S-"
  grid: number;
  row: number;
  col: number;
}

export function pixelToCell(
  pixelX: number,
  pixelY: number,
  cell: CellDimensions,
): { row: number; col: number } {
  return {
    col: Math.floor(pixelX / cell.width),
    row: Math.floor(pixelY / cell.height),
  };
}

export function mouseModifiers(event: MouseEvent): string {
  let mod = "";
  if (event.ctrlKey) mod += "C-";
  if (event.altKey) mod += "A-";
  if (event.shiftKey) mod += "S-";
  return mod;
}

function buttonName(button: number): string {
  switch (button) {
    case 0: return "left";
    case 1: return "middle";
    case 2: return "right";
    default: return "left";
  }
}
```

### Step 2. Down / Move (drag) / Up

```typescript
export function mouseDownToNeovim(
  event: MouseEvent,
  cell: CellDimensions,
  rect: DOMRect,
  grid: number = 0,
): NeovimMouseParams {
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const { row, col } = pixelToCell(x, y, cell);
  return {
    button: buttonName(event.button),
    action: "press",
    modifier: mouseModifiers(event),
    grid, row, col,
  };
}

export function mouseMoveToNeovim(
  event: MouseEvent,
  cell: CellDimensions,
  rect: DOMRect,
  activeButton: string,
  grid: number = 0,
): NeovimMouseParams {
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const { row, col } = pixelToCell(x, y, cell);
  return {
    button: activeButton,
    action: "drag",
    modifier: mouseModifiers(event),
    grid, row, col,
  };
}

export function mouseUpToNeovim(
  event: MouseEvent,
  cell: CellDimensions,
  rect: DOMRect,
  grid: number = 0,
): NeovimMouseParams {
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const { row, col } = pixelToCell(x, y, cell);
  return {
    button: buttonName(event.button),
    action: "release",
    modifier: mouseModifiers(event),
    grid, row, col,
  };
}
```

### Step 3. Wheel

```typescript
export function wheelToNeovim(
  event: WheelEvent,
  cell: CellDimensions,
  rect: DOMRect,
  grid: number = 0,
): NeovimMouseParams {
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const { row, col } = pixelToCell(x, y, cell);

  let action: NeovimMouseParams["action"];
  if (event.deltaY < 0) action = "up";
  else if (event.deltaY > 0) action = "down";
  else if (event.deltaX < 0) action = "left";
  else action = "right";

  return {
    button: "wheel",
    action,
    modifier: mouseModifiers(event),
    grid, row, col,
  };
}
```

### Step 4. Multigrid resolver

```typescript
export interface GridLayoutEntry {
  startRow: number;
  startCol: number;
  width: number;
  height: number;
  isFloat: boolean;
  hidden: boolean;
  zindex: number;
}

/**
 * Resolve which grid is under a pixel coordinate. Floats first (highest zindex).
 * Falls back to grid 0 (global grid) if no specific match.
 */
export function resolveGridAtPixel(
  pixelX: number,
  pixelY: number,
  cell: CellDimensions,
  grids: Map<number, GridLayoutEntry>,
): { grid: number; row: number; col: number } {
  const globalCol = Math.floor(pixelX / cell.width);
  const globalRow = Math.floor(pixelY / cell.height);

  // Floats first, highest zindex first
  const floats = [...grids.entries()]
    .filter(([_, g]) => g.isFloat && !g.hidden)
    .sort((a, b) => b[1].zindex - a[1].zindex);

  for (const [gridId, g] of floats) {
    const localCol = globalCol - g.startCol;
    const localRow = globalRow - g.startRow;
    if (
      localCol >= 0 && localCol < g.width &&
      localRow >= 0 && localRow < g.height
    ) {
      return { grid: gridId, row: localRow, col: localCol };
    }
  }

  // Regular split windows (excluding default grid 1)
  const windows = [...grids.entries()].filter(
    ([id, g]) => !g.isFloat && !g.hidden && id !== 1,
  );
  for (const [gridId, g] of windows) {
    const localCol = globalCol - g.startCol;
    const localRow = globalRow - g.startRow;
    if (
      localCol >= 0 && localCol < g.width &&
      localRow >= 0 && localRow < g.height
    ) {
      return { grid: gridId, row: localRow, col: localCol };
    }
  }

  // Default
  return { grid: 0, row: globalRow, col: globalCol };
}
```

## Validation

- `bun typecheck`
- Tests in 08c

## Done Criteria

- `pixelToCell`, `mouseModifiers`, `buttonName` helpers
- `mouseDownToNeovim`, `mouseMoveToNeovim`, `mouseUpToNeovim`, `wheelToNeovim`
- `resolveGridAtPixel` honors zindex order, returns grid-local coords, falls back to grid 0
- Pure functions — no DOM dependency beyond event types
