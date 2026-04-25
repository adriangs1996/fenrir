# Plan: Web Canvas2D + WebGL Renderer

## Summary

Implement the rendering pipeline that draws neovim's grid state onto an HTML canvas. Uses Canvas2D for text rendering with WebGL for compositing and effects. Supports dirty-rect optimization, cursor rendering, and all highlight attributes.

## Motivation

The renderer is the visual core of the editor. Must be fast enough to handle rapid redraw batches (typing, scrolling, completion popups) at 60fps. Canvas2D handles text well; WebGL enables efficient compositing of multiple grids (multigrid).

## Prerequisites

- `neovim-06-web-grid-state` (GridStateManager, HighlightManager, FontMetrics)

## Scope

- New file: `apps/web/src/modules/neovim-editor/renderer/CanvasRenderer.ts`
- New file: `apps/web/src/modules/neovim-editor/renderer/CursorRenderer.ts`
- New file: `apps/web/src/modules/neovim-editor/renderer/WebGLCompositor.ts`
- New file: `apps/web/src/modules/neovim-editor/__tests__/CanvasRenderer.test.ts`

## Proposed Changes

### 1. CanvasRenderer — `renderer/CanvasRenderer.ts`

Core Canvas2D text renderer that draws a single grid onto a canvas:

```typescript
import type { Grid, CursorState } from "./GridState";
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
  private ctx: CanvasRenderingContext2D;
  private cell: CellDimensions;
  private dpr: number;
  private fontFamily: string;
  private fontSize: number;
  private highlightManager: HighlightManager;

  constructor(options: CanvasRendererOptions) {
    this.ctx = options.canvas.getContext("2d", {
      alpha: false,            // Opaque background — faster
      desynchronized: true,    // Reduce latency
    })!;
    this.cell = options.cellDimensions;
    this.dpr = options.devicePixelRatio;
    this.fontFamily = options.fontFamily;
    this.fontSize = options.fontSize;
    this.highlightManager = options.highlightManager;

    // Set up HiDPI scaling
    const canvas = options.canvas;
    canvas.width = canvas.clientWidth * this.dpr;
    canvas.height = canvas.clientHeight * this.dpr;
    this.ctx.scale(this.dpr, this.dpr);
  }

  /**
   * Render a grid. Only repaints dirty rows.
   * Call clearDirty() on GridStateManager after all grids rendered.
   */
  renderGrid(grid: Grid, fullRepaint = false): void {
    const ctx = this.ctx;
    const { width, height } = this.cell;

    const rowsToRender = fullRepaint
      ? Array.from({ length: grid.height }, (_, i) => i)
      : Array.from(grid.dirtyRows);

    if (rowsToRender.length === 0) return;

    // Set font once per render call
    ctx.textBaseline = "top";

    for (const row of rowsToRender) {
      this.renderRow(grid, row);
    }
  }

  /**
   * Render cursor overlay.
   * Called after grid rendering.
   */
  renderCursor(cursor: CursorState, modeInfo: ModeInfo | undefined): void {
    if (!cursor.visible || !modeInfo) return;

    const ctx = this.ctx;
    const x = cursor.col * this.cell.width;
    const y = cursor.row * this.cell.height;

    const cursorHl = modeInfo.attrId > 0
      ? this.highlightManager.resolve(modeInfo.attrId)
      : null;

    switch (modeInfo.cursorShape) {
      case "block": {
        // Invert fg/bg for block cursor
        const grid = /* get grid by cursor.grid */;
        const cell = grid?.cells[cursor.row]?.[cursor.col];
        const cellHl = cell ? this.highlightManager.resolve(cell.hlId) : null;

        ctx.fillStyle = cursorHl?.fg ?? cellHl?.fg ?? "#FFFFFF";
        ctx.fillRect(x, y, this.cell.width, this.cell.height);

        // Draw character in inverted color
        if (cell?.text && cell.text !== " ") {
          ctx.fillStyle = cursorHl?.bg ?? cellHl?.bg ?? "#000000";
          ctx.font = this.buildFont(cellHl?.bold ?? false, cellHl?.italic ?? false);
          ctx.fillText(cell.text, x, y + this.cell.baseline);
        }
        break;
      }
      case "vertical": {
        const widthPx = Math.max(1, Math.round(
          this.cell.width * (modeInfo.cellPercentage / 100)
        ));
        ctx.fillStyle = cursorHl?.fg ?? "#FFFFFF";
        ctx.fillRect(x, y, widthPx, this.cell.height);
        break;
      }
      case "horizontal": {
        const heightPx = Math.max(1, Math.round(
          this.cell.height * (modeInfo.cellPercentage / 100)
        ));
        ctx.fillStyle = cursorHl?.fg ?? "#FFFFFF";
        ctx.fillRect(x, y + this.cell.height - heightPx, this.cell.width, heightPx);
        break;
      }
    }
  }

  /** Update canvas size (call on container resize) */
  resize(widthPx: number, heightPx: number): void {
    const canvas = this.ctx.canvas;
    canvas.style.width = `${widthPx}px`;
    canvas.style.height = `${heightPx}px`;
    canvas.width = widthPx * this.dpr;
    canvas.height = heightPx * this.dpr;
    this.ctx.scale(this.dpr, this.dpr);
  }

  /** Update font (e.g., from option_set guifont) */
  setFont(family: string, size: number): void {
    this.fontFamily = family;
    this.fontSize = size;
  }

  // ── Private ──

  private renderRow(grid: Grid, rowIdx: number): void {
    const ctx = this.ctx;
    const row = grid.cells[rowIdx];
    if (!row) return;

    const y = rowIdx * this.cell.height;
    let col = 0;

    while (col < grid.width) {
      const cell = row[col];
      const hl = this.highlightManager.resolve(cell.hlId);

      // Find run of cells with same highlight (batch for performance)
      let runEnd = col + 1;
      while (runEnd < grid.width && row[runEnd].hlId === cell.hlId) {
        runEnd++;
      }
      const runLen = runEnd - col;

      // Draw background for the run
      const x = col * this.cell.width;
      const runWidth = runLen * this.cell.width;

      ctx.fillStyle = hl.bg;
      ctx.fillRect(x, y, runWidth, this.cell.height);

      // Draw text for the run
      ctx.fillStyle = hl.fg;
      ctx.font = this.buildFont(hl.bold, hl.italic);

      for (let i = col; i < runEnd; i++) {
        const c = row[i];
        if (c.text && c.text !== " " && c.text !== "") {
          ctx.fillText(c.text, i * this.cell.width, y + this.cell.baseline);
        }
      }

      // Draw decorations
      if (hl.underline || hl.undercurl || hl.underdouble || hl.underdotted || hl.underdashed) {
        this.renderUnderline(hl, x, y, runWidth);
      }
      if (hl.strikethrough) {
        ctx.fillStyle = hl.fg;
        const strikeY = y + this.cell.height * 0.5;
        ctx.fillRect(x, strikeY, runWidth, 1);
      }

      col = runEnd;
    }
  }

  private renderUnderline(hl: ResolvedHighlight, x: number, y: number, width: number): void {
    const ctx = this.ctx;
    const underY = y + this.cell.height - 2;
    ctx.strokeStyle = hl.sp;
    ctx.lineWidth = 1;

    if (hl.undercurl) {
      // Wavy line using bezier curves
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
      // Regular underline
      ctx.fillRect(x, underY, width, 1);
    }
  }

  private buildFont(bold: boolean, italic: boolean): string {
    const weight = bold ? "bold " : "";
    const style = italic ? "italic " : "";
    return `${style}${weight}${this.fontSize}px ${this.fontFamily}`;
  }
}
```

### 2. CursorRenderer — `renderer/CursorRenderer.ts`

Extracted cursor rendering with blink support:

```typescript
export class CursorRenderer {
  private blinkVisible = true;
  private blinkTimer: ReturnType<typeof setInterval> | null = null;
  private onBlinkToggle: (() => void) | null = null;

  constructor(options: { onBlinkToggle: () => void }) {
    this.onBlinkToggle = options.onBlinkToggle;
  }

  /** Update blink timing from mode_info */
  setBlinkParams(blinkwait: number, blinkon: number, blinkoff: number): void {
    this.stopBlink();
    if (blinkon === 0 && blinkoff === 0) {
      // No blink
      this.blinkVisible = true;
      return;
    }

    // Start blink cycle
    setTimeout(() => {
      this.blinkTimer = setInterval(() => {
        this.blinkVisible = !this.blinkVisible;
        this.onBlinkToggle?.();
      }, this.blinkVisible ? blinkon : blinkoff);
    }, blinkwait);
  }

  stopBlink(): void {
    if (this.blinkTimer) {
      clearInterval(this.blinkTimer);
      this.blinkTimer = null;
    }
    this.blinkVisible = true;
  }

  isVisible(): boolean {
    return this.blinkVisible;
  }

  dispose(): void {
    this.stopBlink();
    this.onBlinkToggle = null;
  }
}
```

### 3. WebGLCompositor — `renderer/WebGLCompositor.ts`

WebGL layer for compositing multiple grids (multigrid) and effects:

```typescript
/**
 * WebGL compositor for layering multiple grid canvases.
 *
 * Architecture:
 * - Each grid is rendered to its own OffscreenCanvas via CanvasRenderer (Canvas2D)
 * - WebGLCompositor takes these as textures and composites them
 *   at their win_pos/win_float_pos coordinates onto the final canvas
 * - Floating windows are drawn on top with correct z-order
 * - blend attribute enables alpha transparency for floating windows
 *
 * Fallback: If WebGL unavailable, composite via Canvas2D drawImage().
 */
export class WebGLCompositor {
  private gl: WebGL2RenderingContext | null;
  private canvas: HTMLCanvasElement;
  private fallback2d: CanvasRenderingContext2D | null = null;

  // Shader program for textured quad rendering
  private program: WebGLProgram | null = null;
  private posBuffer: WebGLBuffer | null = null;
  private texBuffer: WebGLBuffer | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", {
      alpha: false,
      premultipliedAlpha: false,
      antialias: false,
      desynchronized: true,
    });

    if (this.gl) {
      this.initShaders();
      this.initBuffers();
    } else {
      // Fallback to Canvas2D compositing
      console.warn("[WebGLCompositor] WebGL2 not available, falling back to Canvas2D");
      this.fallback2d = canvas.getContext("2d")!;
    }
  }

  /**
   * Composite grid canvases onto the output canvas.
   *
   * @param layers Array of { canvas, x, y, width, height, zindex, blend }
   *   sorted by zindex ascending (background first, floating on top)
   */
  composite(layers: CompositeLayer[]): void {
    if (this.gl) {
      this.compositeWebGL(layers);
    } else {
      this.compositeFallback(layers);
    }
  }

  resize(width: number, height: number, dpr: number): void {
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    if (this.gl) {
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  dispose(): void {
    if (this.gl && this.program) {
      this.gl.deleteProgram(this.program);
      this.gl.deleteBuffer(this.posBuffer);
      this.gl.deleteBuffer(this.texBuffer);
    }
  }

  // ── WebGL Implementation ──

  private initShaders(): void {
    // Vertex shader: position + tex coords
    // Fragment shader: texture sample with alpha blend
    // Standard textured quad rendering
  }

  private compositeWebGL(layers: CompositeLayer[]): void {
    const gl = this.gl!;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    for (const layer of layers) {
      // Upload layer canvas as texture
      // Set uniforms: position, size, alpha (from blend)
      // Draw textured quad
    }
  }

  // ── Canvas2D Fallback ──

  private compositeFallback(layers: CompositeLayer[]): void {
    const ctx = this.fallback2d!;
    // Clear
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (const layer of layers) {
      if (layer.blend > 0) {
        ctx.globalAlpha = 1 - layer.blend / 100;
      }
      ctx.drawImage(layer.canvas, layer.x, layer.y, layer.width, layer.height);
      ctx.globalAlpha = 1;
    }
  }
}

export interface CompositeLayer {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  x: number;       // Pixel position
  y: number;
  width: number;
  height: number;
  zindex: number;
  blend: number;   // 0-100 transparency
}
```

### 4. Rendering Pipeline Overview

The full render path on each `flush`:

```
1. RedrawParser emits events
2. GridStateManager processes events, marks dirty rows
3. For each grid with dirty rows:
   a. Get or create OffscreenCanvas for this grid
   b. CanvasRenderer.renderGrid(grid) — draws dirty rows onto grid's OffscreenCanvas
   c. CanvasRenderer.renderCursor() — draws cursor on the cursor's grid canvas
4. Build composite layer list:
   a. Grid 1 (default) at (0,0) — background
   b. win_pos grids at their positions
   c. win_float_pos grids at their positions, sorted by zindex
   d. Skip hidden grids
5. WebGLCompositor.composite(layers) — final output to visible canvas
6. GridStateManager.clearDirty()
```

### 5. Performance Considerations

- **Batch background fills**: Merge consecutive cells with same hlId into single fillRect
- **Font caching**: `buildFont()` result cached per (bold, italic) pair (4 variants max)
- **Texture reuse**: Only re-upload grid texture to WebGL if grid has dirty rows
- **requestAnimationFrame**: Render on rAF, not on every flush (coalesce multiple flushes per frame)
- **OffscreenCanvas per grid**: Each grid has its own canvas, only re-rendered when dirty
- **Avoid measureText**: Cell width is fixed (monospace), measured once in FontMetrics

### 6. Tests

**CanvasRenderer.test.ts** (using OffscreenCanvas or jest-canvas-mock):
1. renderGrid draws characters at correct pixel positions
2. Background color fills correctly per highlight
3. Bold/italic font applied correctly
4. Underline variants render (straight, wavy, dotted, dashed, double)
5. Strikethrough renders at vertical center
6. Dirty-row optimization: only dirty rows repainted
7. Cursor block inverts colors
8. Cursor vertical bar renders at correct width
9. Cursor horizontal bar renders at correct height
10. Resize updates canvas dimensions with DPR scaling

## Validation

- `bun test apps/web/src/modules/neovim-editor/__tests__/CanvasRenderer.test.ts`
- `bun typecheck`
- Visual: open neovim, type text, verify rendering matches terminal neovim

## Done Criteria

- CanvasRenderer draws text with correct colors, styles, and positions
- All underline variants render visually distinct
- Cursor renders in block/vertical/horizontal shapes per mode
- WebGLCompositor layers multiple grids with correct z-order
- Fallback to Canvas2D compositing when WebGL unavailable
- Dirty-row optimization: only changed rows repainted
- 60fps rendering achievable with typical neovim usage
