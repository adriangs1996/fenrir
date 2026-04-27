---
depends_on:
  - neovim-05b-redraw-types
---

# Plan 06a: GridStateManager Skeleton

## Goal

Create `GridStateManager` class scaffold: types, fields, constructor, `processEvents` dispatcher, snapshot accessors, dirty tracking, reset. Per-event handlers come in 06b/06c.

## Scope

- New file: `apps/web/src/modules/neovim-editor/renderer/GridState.ts`

## Steps

### Step 1. Imports + cell/grid types

```typescript
import type { RedrawEvent, ModeInfo } from "../protocol/RedrawParser";
import { HighlightManager } from "./HighlightManager";

export interface Cell {
  text: string;   // "" for right half of double-width
  hlId: number;
}

export interface Grid {
  id: number;
  width: number;
  height: number;
  cells: Cell[][]; // [row][col]
  dirtyRows: Set<number>;
  winId: number | null;
  startRow: number;
  startCol: number;
  isFloat: boolean;
  zindex: number;
  hidden: boolean;
}

export interface CursorState {
  grid: number;
  row: number;
  col: number;
  visible: boolean;
}

export interface GridStateSnapshot {
  grids: Map<number, Grid>;
  cursor: CursorState;
  currentModeIdx: number;
  modeInfo: ModeInfo[];
  title: string;
  mouseEnabled: boolean;
}
```

### Step 2. Class skeleton

```typescript
export class GridStateManager {
  readonly highlights = new HighlightManager();

  private grids = new Map<number, Grid>();
  private cursor: CursorState = { grid: 1, row: 0, col: 0, visible: true };
  private currentModeIdx = 0;
  private modeInfo: ModeInfo[] = [];
  private title = "";
  private mouseEnabled = true;

  private onFlush: (() => void) | null = null;
  private onBell: (() => void) | null = null;

  constructor(options?: { onFlush?: () => void; onBell?: () => void }) {
    this.onFlush = options?.onFlush ?? null;
    this.onBell = options?.onBell ?? null;
  }

  processEvents(events: RedrawEvent[]): void {
    for (const event of events) this.processEvent(event);
  }

  getSnapshot(): GridStateSnapshot {
    return {
      grids: this.grids,
      cursor: { ...this.cursor },
      currentModeIdx: this.currentModeIdx,
      modeInfo: this.modeInfo,
      title: this.title,
      mouseEnabled: this.mouseEnabled,
    };
  }

  getGrid(id: number): Grid | undefined {
    return this.grids.get(id);
  }

  getCurrentMode(): ModeInfo | undefined {
    return this.modeInfo[this.currentModeIdx];
  }

  clearDirty(): void {
    for (const grid of this.grids.values()) grid.dirtyRows.clear();
  }

  reset(): void {
    this.grids.clear();
    this.cursor = { grid: 1, row: 0, col: 0, visible: true };
    this.currentModeIdx = 0;
    this.modeInfo = [];
    this.title = "";
    this.mouseEnabled = true;
    this.highlights.reset();
  }

  // ── Event dispatcher (filled in by 06b + 06c) ──
  private processEvent(event: RedrawEvent): void {
    // 06b adds: grid_*, hl_attr_define, default_colors_set
    // 06c adds: win_*, mode_*, busy_*, set_title, bell, mouse_*, flush
    switch (event.type) {
      default:
        break;
    }
  }

  // ── Helpers used by handlers ──

  protected createGrid(id: number, width: number, height: number): Grid {
    const cells: Cell[][] = [];
    for (let r = 0; r < height; r++) {
      const row: Cell[] = [];
      for (let c = 0; c < width; c++) row.push({ text: " ", hlId: 0 });
      cells.push(row);
    }
    return {
      id,
      width,
      height,
      cells,
      dirtyRows: new Set(),
      winId: null,
      startRow: 0,
      startCol: 0,
      isFloat: false,
      zindex: 0,
      hidden: false,
    };
  }

  protected resizeGrid(grid: Grid, width: number, height: number): void {
    // Grow/shrink rows
    while (grid.cells.length < height) {
      const row: Cell[] = [];
      for (let c = 0; c < width; c++) row.push({ text: " ", hlId: 0 });
      grid.cells.push(row);
    }
    if (grid.cells.length > height) grid.cells.length = height;
    // Grow/shrink each row to new width
    for (const row of grid.cells) {
      while (row.length < width) row.push({ text: " ", hlId: 0 });
      if (row.length > width) row.length = width;
    }
    grid.width = width;
    grid.height = height;
    for (let r = 0; r < height; r++) grid.dirtyRows.add(r);
  }
}
```

### Step 3. Note for 06b/06c

The empty `switch` body in `processEvent` is a deliberate stub. 06b appends `grid_*` and highlight cases; 06c appends window/mode/global cases.

## Validation

- `bun typecheck` (after `HighlightManager` exists — 06d builds it)
- If 06d hasn't landed yet, stub `HighlightManager` locally:

```typescript
// Temporary stub; 06d implements
class HighlightManager {
  defineAttr(_id: number, _attr: unknown): void {}
  setDefaultColors(_fg: number, _bg: number, _sp: number): void {}
  reset(): void {}
}
```

If using stub, mark `// TODO(06d): replace stub with real HighlightManager`. Otherwise, depend on 06d landing first.

## Done Criteria

- `Cell`, `Grid`, `CursorState`, `GridStateSnapshot` exported
- `GridStateManager` class with constructor, snapshot, dirty mgmt, reset, createGrid, resizeGrid
- `processEvent` dispatcher present (empty switch body for now)
- File compiles
