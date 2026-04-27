---
depends_on:
  - neovim-07a-canvas-renderer-row
---

# Plan 07b: CanvasRenderer Cursor + Resize

## Goal

Append `renderCursor` (block/vertical/horizontal shapes), `resize` (DPR-aware), `setFont` (cache invalidation) to `CanvasRenderer`.

## Scope

- Modify: `apps/web/src/modules/neovim-editor/renderer/CanvasRenderer.ts`

## Steps

### Step 1. Update imports

```typescript
import type { CursorState, Grid } from "./GridState";
import type { ModeInfo } from "../protocol/RedrawParser";
```

### Step 2. `renderCursor`

The cursor needs the grid's cell content for block-mode inversion. Caller passes the grid:

```typescript
renderCursor(
  cursor: CursorState,
  modeInfo: ModeInfo | undefined,
  grid: Grid | undefined,
): void {
  if (!cursor.visible || !modeInfo || !grid) return;

  const ctx = this.ctx;
  const x = cursor.col * this.cell.width;
  const y = cursor.row * this.cell.height;

  const cursorHl = modeInfo.attrId > 0
    ? this.highlightManager.resolve(modeInfo.attrId)
    : null;

  switch (modeInfo.cursorShape) {
    case "block": {
      const cell = grid.cells[cursor.row]?.[cursor.col];
      const cellHl = cell ? this.highlightManager.resolve(cell.hlId) : null;
      ctx.fillStyle = cursorHl?.fg ?? cellHl?.fg ?? "#FFFFFF";
      ctx.fillRect(x, y, this.cell.width, this.cell.height);
      if (cell?.text && cell.text !== " " && cell.text !== "") {
        ctx.fillStyle = cursorHl?.bg ?? cellHl?.bg ?? "#000000";
        ctx.font = this.buildFont(cellHl?.bold ?? false, cellHl?.italic ?? false);
        ctx.fillText(cell.text, x, y + this.cell.baseline);
      }
      break;
    }
    case "vertical": {
      const widthPx = Math.max(1, Math.round(
        this.cell.width * (modeInfo.cellPercentage / 100),
      ));
      ctx.fillStyle = cursorHl?.fg ?? "#FFFFFF";
      ctx.fillRect(x, y, widthPx, this.cell.height);
      break;
    }
    case "horizontal": {
      const heightPx = Math.max(1, Math.round(
        this.cell.height * (modeInfo.cellPercentage / 100),
      ));
      ctx.fillStyle = cursorHl?.fg ?? "#FFFFFF";
      ctx.fillRect(x, y + this.cell.height - heightPx, this.cell.width, heightPx);
      break;
    }
  }
}
```

### Step 3. `resize`

```typescript
resize(widthPx: number, heightPx: number): void {
  const canvas = this.ctx.canvas;
  canvas.style.width = `${widthPx}px`;
  canvas.style.height = `${heightPx}px`;
  canvas.width = widthPx * this.dpr;
  canvas.height = heightPx * this.dpr;
  // Reapply scaling after canvas size change (resets transform)
  this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  this.ctx.scale(this.dpr, this.dpr);
}
```

Note: `setTransform(1,0,0,1,0,0)` resets to identity before re-applying DPR scale. Setting `canvas.width` already resets context state, but explicit reset is safer.

### Step 4. `setFont`

```typescript
setFont(family: string, size: number): void {
  this.fontFamily = family;
  this.fontSize = size;
  this.fontCache.clear();
}
```

### Step 5. Update `CanvasRendererOptions` JSDoc

Note in JSDoc that `renderCursor` now requires the cursor's grid. Update consumers (07c integrates into pipeline).

## Validation

- `bun typecheck`

## Done Criteria

- `renderCursor` handles 3 shapes (block, vertical, horizontal)
- Block cursor inverts cell colors and re-renders glyph in inverted color
- Vertical/horizontal use `cellPercentage` for size; `Math.max(1, ...)` floor
- `resize` updates CSS size, backing store size, and re-applies DPR scale
- `setFont` invalidates font cache
