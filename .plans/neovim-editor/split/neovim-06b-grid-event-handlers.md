---
depends_on:
  - neovim-06a-grid-state-skeleton
  - neovim-06d-highlight-manager
---

# Plan 06b: Grid Event Handlers

## Goal

Implement handlers for `grid_resize`, `grid_line`, `grid_scroll`, `grid_clear`, `grid_cursor_goto`, `grid_destroy`, `hl_attr_define`, `default_colors_set`. Append to GridStateManager.

## Scope

- Modify: `apps/web/src/modules/neovim-editor/renderer/GridState.ts`

## Steps

### Step 1. Update imports in `GridState.ts`

Replace the partial `RedrawEvent` import with:

```typescript
import type {
  RedrawEvent, ModeInfo,
  GridResizeEvent, GridLineEvent, GridScrollEvent,
  GridClearEvent, GridCursorGotoEvent, GridDestroyEvent,
  HlAttrDefineEvent, DefaultColorsSetEvent,
} from "../protocol/RedrawParser";
```

### Step 2. Extend `processEvent` switch

Replace the stub switch with cases for grid + highlight:

```typescript
private processEvent(event: RedrawEvent): void {
  switch (event.type) {
    case "grid_resize":      this.handleGridResize(event); break;
    case "grid_line":        this.handleGridLine(event); break;
    case "grid_scroll":      this.handleGridScroll(event); break;
    case "grid_clear":       this.handleGridClear(event); break;
    case "grid_cursor_goto": this.handleGridCursorGoto(event); break;
    case "grid_destroy":     this.handleGridDestroy(event); break;
    case "hl_attr_define":   this.handleHlAttrDefine(event); break;
    case "default_colors_set": this.handleDefaultColorsSet(event); break;
    // 06c will add the rest
    default: break;
  }
}
```

### Step 3. Append private handlers

Inside `GridStateManager`:

```typescript
private handleGridResize(event: GridResizeEvent): void {
  let grid = this.grids.get(event.grid);
  if (!grid) {
    grid = this.createGrid(event.grid, event.width, event.height);
    this.grids.set(event.grid, grid);
    for (let r = 0; r < grid.height; r++) grid.dirtyRows.add(r);
  } else {
    this.resizeGrid(grid, event.width, event.height);
  }
}

private handleGridLine(event: GridLineEvent): void {
  const grid = this.grids.get(event.grid);
  if (!grid) return;
  const row = grid.cells[event.row];
  if (!row) return;

  let col = event.colStart;
  for (const cell of event.cells) {
    for (let r = 0; r < cell.repeat; r++) {
      if (col < grid.width) {
        row[col] = { text: cell.text, hlId: cell.hlId };
        col++;
      }
    }
  }
  grid.dirtyRows.add(event.row);
}

private handleGridScroll(event: GridScrollEvent): void {
  const grid = this.grids.get(event.grid);
  if (!grid) return;
  const { top, bot, left, right, rows: scrollRows } = event;

  if (scrollRows > 0) {
    // Scroll up — content shifts up; bottom rows uncovered
    for (let row = top; row < bot - scrollRows; row++) {
      for (let col = left; col < right; col++) {
        grid.cells[row][col] = { ...grid.cells[row + scrollRows][col] };
      }
    }
  } else if (scrollRows < 0) {
    // Scroll down — content shifts down; top rows uncovered
    for (let row = bot - 1; row >= top - scrollRows; row--) {
      for (let col = left; col < right; col++) {
        grid.cells[row][col] = { ...grid.cells[row + scrollRows][col] };
      }
    }
  }
  for (let row = top; row < bot; row++) grid.dirtyRows.add(row);
}

private handleGridClear(event: GridClearEvent): void {
  const grid = this.grids.get(event.grid);
  if (!grid) return;
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      grid.cells[row][col] = { text: " ", hlId: 0 };
    }
    grid.dirtyRows.add(row);
  }
}

private handleGridCursorGoto(event: GridCursorGotoEvent): void {
  const oldGrid = this.grids.get(this.cursor.grid);
  if (oldGrid) oldGrid.dirtyRows.add(this.cursor.row);
  this.cursor.grid = event.grid;
  this.cursor.row = event.row;
  this.cursor.col = event.col;
  const newGrid = this.grids.get(event.grid);
  if (newGrid) newGrid.dirtyRows.add(event.row);
}

private handleGridDestroy(event: GridDestroyEvent): void {
  this.grids.delete(event.grid);
}

private handleHlAttrDefine(event: HlAttrDefineEvent): void {
  this.highlights.defineAttr(event.id, event.rgbAttr);
}

private handleDefaultColorsSet(event: DefaultColorsSetEvent): void {
  this.highlights.setDefaultColors(event.rgbFg, event.rgbBg, event.rgbSp);
}
```

### Step 4. Notes

- `grid_scroll` `scrollRows > 0` means content scrolls UP (i.e. lines disappear off the top, new lines appear at the bottom — but neovim only signals the move; new content arrives as separate `grid_line` events).
- All cells written via `handleGridLine` use struct copy `{ ...cell }` to avoid aliasing.

## Validation

- `bun typecheck`

## Done Criteria

- 8 handler methods implemented
- Dispatcher updated
- Cursor goto marks both old and new grid rows dirty
- Scroll implementation moves cells correctly in both directions
- Clear fills cells with `{ text: " ", hlId: 0 }`
