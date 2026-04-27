---
depends_on:
  - neovim-07d-webgl-init
---

# Plan 07e: WebGLCompositor — Composite + Resize + Dispose

## Goal

Append `composite`, `compositeWebGL`, `compositeFallback` (Canvas2D), `resize`, `dispose` to `WebGLCompositor`.

## Scope

- Modify: `apps/web/src/modules/neovim-editor/renderer/WebGLCompositor.ts`

## Steps

### Step 1. `composite` dispatcher

```typescript
composite(layers: CompositeLayer[]): void {
  // Stable sort by zindex (background first, floats on top)
  const sorted = [...layers].sort((a, b) => a.zindex - b.zindex);
  if (this.gl) this.compositeWebGL(sorted);
  else this.compositeFallback(sorted);
}
```

### Step 2. `compositeWebGL`

```typescript
private compositeWebGL(layers: CompositeLayer[]): void {
  const gl = this.gl!;
  if (!this.program) return;

  gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  gl.useProgram(this.program);
  gl.uniform2f(this.uViewportLoc, this.canvas.width, this.canvas.height);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, this.texture);

  for (const layer of layers) {
    // Upload layer canvas as texture
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA,
      gl.RGBA, gl.UNSIGNED_BYTE,
      // Both OffscreenCanvas and HTMLCanvasElement are TexImageSource
      layer.canvas as TexImageSource,
    );

    // Note: layer.x/y/width/height are in CSS pixels.
    // The viewport is in backing-store pixels (scaled by DPR).
    // The vertex shader maps using u_viewport — pass DPR-scaled values.
    const dpr = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    gl.uniform2f(this.uPositionLoc, layer.x * dpr, layer.y * dpr);
    gl.uniform2f(this.uSizeLoc, layer.width * dpr, layer.height * dpr);
    gl.uniform1f(this.uAlphaLoc, 1 - layer.blend / 100);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
```

### Step 3. `compositeFallback` (Canvas2D)

```typescript
private compositeFallback(layers: CompositeLayer[]): void {
  const ctx = this.fallback2d;
  if (!ctx) return;

  // Note: fallback path runs in unscaled canvas coordinates.
  // Caller is responsible for canvas sizing matching DPR.
  ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

  for (const layer of layers) {
    if (layer.blend > 0) ctx.globalAlpha = 1 - layer.blend / 100;
    else ctx.globalAlpha = 1;
    ctx.drawImage(
      layer.canvas as CanvasImageSource,
      layer.x, layer.y, layer.width, layer.height,
    );
  }
  ctx.globalAlpha = 1;
}
```

### Step 4. `resize`

```typescript
resize(widthPx: number, heightPx: number, dpr: number): void {
  this.canvas.style.width = `${widthPx}px`;
  this.canvas.style.height = `${heightPx}px`;
  this.canvas.width = widthPx * dpr;
  this.canvas.height = heightPx * dpr;
  if (this.gl) {
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }
}
```

### Step 5. `dispose`

```typescript
dispose(): void {
  const gl = this.gl;
  if (gl && this.program) {
    gl.deleteProgram(this.program);
    if (this.posBuffer) gl.deleteBuffer(this.posBuffer);
    if (this.texBuffer) gl.deleteBuffer(this.texBuffer);
    if (this.texture) gl.deleteTexture(this.texture);
    this.program = null;
    this.posBuffer = null;
    this.texBuffer = null;
    this.texture = null;
  }
  this.gl = null;
  this.fallback2d = null;
}
```

### Step 6. Texture-reuse optimization (note)

For now, `texImage2D` is called per layer per frame. A future optimization is to keep one texture per grid id and only re-upload when `grid.dirtyRows` is non-empty. Defer to perf pass.

## Validation

- `bun typecheck`

## Done Criteria

- `composite` sorts by zindex stably
- WebGL path uploads layer canvases as `RGBA` textures and draws via 6-vertex quad
- Alpha = `1 - blend/100`; correct blend func
- Fallback path uses `drawImage` with `globalAlpha`
- `resize` updates CSS size, backing store, and viewport
- `dispose` releases GL resources and is idempotent
