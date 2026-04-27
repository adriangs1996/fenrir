---
depends_on:
  - neovim-06d-highlight-manager
  - neovim-06e-font-metrics-tests
---

# Plan 07a: CanvasRenderer Constructor + Row Rendering

## Goal

Create `CanvasRenderer` class with constructor (HiDPI scaling), `renderGrid` (dirty-row optimization + run batching), `renderRow`, `renderUnderline` (5 variants), `renderStrikethrough`, `buildFont` cache.

## Scope

- New file: `apps/web/src/modules/neovim-editor/renderer/CanvasRenderer.ts` (constructor + renderGrid + row helpers; cursor + resize come in 07b)

## Steps

### Step 1. File scaffold

```typescript
import type { Grid } from "./GridState";
import type { HighlightManager, ResolvedHighlight } from "./HighlightManager";
import type { CellDimensions } from "./FontMetrics";

export interface CanvasRendererOptions {
  canvas: HTMLCanvasElement;
  highlightManager: HighlightManager;
  cellDimensions: CellDimensions;
  fontFamily: string;
  fontSize: number;
  devicePixelRatio: number;
}

export class CanvasRenderer {
  protected ctx: CanvasRenderingContext2D;
  protected cell: CellDimensions;
  protected dpr: number;
  protected fontFamily: string;
  protected fontSize: number;
  protected highlightManager: HighlightManager;

  // Font string cache: 4 variants (regular, bold, italic, bold+italic)
  private fontCache = new Map<string, string>();

  constructor(options: CanvasRendererOptions) {
    const ctx = options.canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });
    if (!ctx) throw new Error("CanvasRenderer: 2D context unavailable");
    this.ctx = ctx;
    this.cell = options.cellDimensions;
    this.dpr = options.devicePixelRatio;
    this.fontFamily = options.fontFamily;
    this.fontSize = options.fontSize;
    this.highlightManager = options.highlightManager;

    // HiDPI scaling
    const canvas = options.canvas;
    canvas.width = canvas.clientWidth * this.dpr;
    canvas.height = canvas.clientHeight * this.dpr;
    this.ctx.scale(this.dpr, this.dpr);
  }
}
```

### Step 2. `renderGrid` + dirty-row decision

Append in class:

```typescript
renderGrid(grid: Grid, fullRepaint = false): void {
  const rowsToRender = fullRepaint
    ? Array.from({ length: grid.height }, (_, i) => i)
    : Array.from(grid.dirtyRows);

  if (rowsToRender.length === 0) return;

  this.ctx.textBaseline = "top";
  for (const row of rowsToRender) this.renderRow(grid, row);
}
```

### Step 3. `renderRow` with run batching

```typescript
protected renderRow(grid: Grid, rowIdx: number): void {
  const ctx = this.ctx;
  const row = grid.cells[rowIdx];
  if (!row) return;

  const y = rowIdx * this.cell.height;
  let col = 0;

  while (col < grid.width) {
    const cell = row[col];
    const hl = this.highlightManager.resolve(cell.hlId);

    // Find run of cells with same highlight
    let runEnd = col + 1;
    while (runEnd < grid.width && row[runEnd].hlId === cell.hlId) runEnd++;
    const runLen = runEnd - col;

    const x = col * this.cell.width;
    const runWidth = runLen * this.cell.width;

    // Background for run
    ctx.fillStyle = hl.bg;
    ctx.fillRect(x, y, runWidth, this.cell.height);

    // Glyphs
    ctx.fillStyle = hl.fg;
    ctx.font = this.buildFont(hl.bold, hl.italic);
    for (let i = col; i < runEnd; i++) {
      const c = row[i];
      if (c.text && c.text !== " " && c.text !== "") {
        ctx.fillText(c.text, i * this.cell.width, y + this.cell.baseline);
      }
    }

    // Decorations
    if (hl.underline || hl.undercurl || hl.underdouble || hl.underdotted || hl.underdashed) {
      this.renderUnderline(hl, x, y, runWidth);
    }
    if (hl.strikethrough) {
      ctx.fillStyle = hl.fg;
      const strikeY = y + Math.floor(this.cell.height * 0.5);
      ctx.fillRect(x, strikeY, runWidth, 1);
    }

    col = runEnd;
  }
}
```

### Step 4. Underline variants

```typescript
protected renderUnderline(
  hl: ResolvedHighlight,
  x: number,
  y: number,
  width: number,
): void {
  const ctx = this.ctx;
  const underY = y + this.cell.height - 2;
  ctx.strokeStyle = hl.sp;
  ctx.fillStyle = hl.sp;
  ctx.lineWidth = 1;

  if (hl.undercurl) {
    ctx.beginPath();
    const segWidth = this.cell.width / 2;
    for (let cx = x; cx < x + width; cx += segWidth * 2) {
      ctx.moveTo(cx, underY);
      ctx.bezierCurveTo(
        cx + segWidth * 0.5, underY - 2,
        cx + segWidth * 1.5, underY + 2,
        cx + segWidth * 2, underY,
      );
    }
    ctx.stroke();
  } else if (hl.underdouble) {
    ctx.fillRect(x, underY - 2, width, 1);
    ctx.fillRect(x, underY, width, 1);
  } else if (hl.underdotted) {
    ctx.setLineDash([1, 2]);
    ctx.beginPath();
    ctx.moveTo(x, underY);
    ctx.lineTo(x + width, underY);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (hl.underdashed) {
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(x, underY);
    ctx.lineTo(x + width, underY);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.fillRect(x, underY, width, 1);
  }
}
```

### Step 5. `buildFont` with cache

```typescript
protected buildFont(bold: boolean, italic: boolean): string {
  const key = `${bold ? "1" : "0"}${italic ? "1" : "0"}`;
  const cached = this.fontCache.get(key);
  if (cached) return cached;
  const weight = bold ? "bold " : "";
  const style = italic ? "italic " : "";
  const font = `${style}${weight}${this.fontSize}px ${this.fontFamily}`;
  this.fontCache.set(key, font);
  return font;
}
```

### Step 6. Note for 07b

`renderCursor`, `resize`, `setFont` (font invalidation) come in 07b. Constructor and font cache already in place.

## Validation

- `bun typecheck`

## Done Criteria

- `CanvasRenderer` class exported with constructor + `renderGrid` + `renderRow`
- HiDPI: canvas backing-store sized by DPR; ctx scaled by DPR
- Run-batching merges consecutive same-hl cells into single fill
- 5 underline variants implemented (single, double, curl, dotted, dashed)
- `buildFont` caches max 4 entries
- File compiles
