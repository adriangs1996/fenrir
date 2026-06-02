import type {
  CellMetrics,
  CursorEntry,
  DefaultColorsEntry,
  HlAttrEntry,
  WindowEntry,
} from "@fenrir/contracts";
import { findLigatureMatch } from "./ligatures";
import { rasterizeSpecialGlyph } from "./specialGlyphs";

const ATLAS_COLS = 64;
const ATLAS_ROWS = 64;

// Atlas slot layout:
//   (0, 0): EMPTY — fully transparent (alpha 0). Sampled by blank cells.
//   (1, 0): SOLID — fully opaque (alpha 255). Used by the cursor & solid fills.
const EMPTY_AX = 0;
const EMPTY_AY = 0;
const SOLID_AX = 1;
const SOLID_AY = 0;
const EMPTY_SLOT: AtlasSlot = { ax: EMPTY_AX, ay: EMPTY_AY, span: 1 };
const SOLID_SLOT: AtlasSlot = { ax: SOLID_AX, ay: SOLID_AY, span: 1 };

// Per-instance attribute layout (12 bytes / cell):
//   bytes[0..1]   : a_atlas_pos (u8 ax, u8 ay)  — slot index, NOT normalized.
//   bytes[2]      : a_span (u8 cell-span for grid ligatures; 0 hides follower cells).
//   bytes[3]      : padding (4-byte alignment for fg).
//   bytes[4..7]   : a_fg (u8 RGBA, normalized to 0..1 in shader).
//   bytes[8..11]  : a_bg (u8 RGBA, normalized to 0..1 in shader).
const BYTES_PER_INSTANCE = 12;
const FG_U32_OFF = 1; // u32 view offset within a 3-u32 cell.
const BG_U32_OFF = 2;
const HL_REVERSE = 1 << 0;
const HL_BOLD = 1 << 1;
const HL_ITALIC = 1 << 2;

// Codepoints we treat as blank. SPACE_CP covers the literal space sent by nvim;
// 0 is the natural fill value of a fresh Uint32Array.
const SPACE_CP = 0x20;

// Vertex shader (grid path).
//
// `gl_InstanceID` derives the cell's (col, row) from `u_cols`, removing the
// need for a per-instance vec2 attribute. `u_atlas_uv_step = u_cell_size /
// u_atlas_size` is precomputed CPU-side so the shader avoids a per-vertex
// divide. `a_atlas_pos` is read as raw u8 (slot index 0..63), `a_fg` / `a_bg`
// are u8 RGBA normalized to 0..1.
const GRID_VERT = `#version 300 es
in vec2 a_corner;
in vec2 a_atlas_pos;
in float a_span;
in vec4 a_fg;
in vec4 a_bg;

uniform vec2 u_cell_size;
uniform vec2 u_grid_offset;
uniform vec2 u_canvas_size;
uniform vec2 u_atlas_uv_step;
uniform float u_cols;

out vec2 v_atlas_uv;
out vec3 v_fg;
out vec3 v_bg;

void main() {
  float fid = float(gl_InstanceID);
  float col = mod(fid, u_cols);
  float row = floor(fid / u_cols);
  float span = a_span;
  vec2 grid_pos = vec2(col, row);
  vec2 cell_origin = u_grid_offset + grid_pos * u_cell_size;
  vec2 world = cell_origin + a_corner * vec2(u_cell_size.x * span, u_cell_size.y);
  vec2 ndc = world / u_canvas_size * 2.0 - 1.0;
  ndc.y = -ndc.y;
  gl_Position = vec4(ndc, 0.0, 1.0);
  v_atlas_uv = (a_atlas_pos + a_corner * vec2(span, 1.0)) * u_atlas_uv_step;
  v_fg = a_fg.rgb;
  v_bg = a_bg.rgb;
}`;

// Fragment shader (shared between grid and cursor programs).
// Atlas is a single-channel R8 mask; we sample `.r`. Output alpha is constant
// 1.0 — blending is disabled so we write opaque RGB.
const SHARED_FRAG = `#version 300 es
precision highp float;

in vec2 v_atlas_uv;
in vec3 v_fg;
in vec3 v_bg;
uniform sampler2D u_atlas;
out vec4 out_color;

void main() {
  float mask = texture(u_atlas, v_atlas_uv).r;
  out_color = vec4(mix(v_bg, v_fg, mask), 1.0);
}`;

// Cursor program. Single quad, no instancing; pos / size / atlas / colors come
// in via uniforms because the cursor is one quad per frame and avoiding the
// instance VBO update is cheaper than maintaining one.
const CURSOR_VERT = `#version 300 es
in vec2 a_corner;

uniform vec2 u_cell_size;
uniform vec2 u_grid_offset;
uniform vec2 u_canvas_size;
uniform vec2 u_atlas_uv_step;
uniform vec2 u_cursor_pos;
uniform vec2 u_cursor_size;
uniform vec2 u_cursor_atlas;
uniform vec3 u_cursor_fg;
uniform vec3 u_cursor_bg;

out vec2 v_atlas_uv;
out vec3 v_fg;
out vec3 v_bg;

void main() {
  vec2 quad_size = u_cursor_size * u_cell_size;
  vec2 cell_origin = u_grid_offset + u_cursor_pos * u_cell_size;
  vec2 world = cell_origin + a_corner * quad_size;
  vec2 ndc = world / u_canvas_size * 2.0 - 1.0;
  ndc.y = -ndc.y;
  gl_Position = vec4(ndc, 0.0, 1.0);
  v_atlas_uv = (u_cursor_atlas + a_corner * u_cursor_size) * u_atlas_uv_step;
  v_fg = u_cursor_fg;
  v_bg = u_cursor_bg;
}`;

interface AtlasSlot {
  ax: number;
  ay: number;
  span: number;
}

class GlyphAtlas {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  readonly metrics: CellMetrics;
  readonly dpr: number;
  // Numeric key: (codepoint << 2) | (italic << 1) | bold. Covers the full
  // U+10FFFF Unicode range in 23 bits, fits comfortably in a JS number,
  // hashes faster than strings, and avoids the per-cell template-literal
  // allocation that dominated the old `${bold}${italic}|${ch}` path.
  private map = new Map<number, AtlasSlot>();
  private textMap = new Map<number, AtlasSlot>();
  private nextAx = 2;
  private nextAy = 0;
  // Pending-upload bbox, in atlas-slot units. New glyphs are rasterized into
  // adjacent slots so a single `texSubImage2D` over the bbox is tight.
  private pendMinX = Infinity;
  private pendMinY = Infinity;
  private pendMaxX = -1;
  private pendMaxY = -1;
  hasPending = false;
  // Reusable scratch for alpha extraction during flush. Sized to the largest
  // bbox we have seen; never freed.
  private scratch: Uint8Array | null = null;

  constructor(metrics: CellMetrics, dpr: number) {
    this.metrics = metrics;
    this.dpr = dpr;
    this.canvas = document.createElement("canvas");
    this.canvas.width = ATLAS_COLS * metrics.width * dpr;
    this.canvas.height = ATLAS_ROWS * metrics.height * dpr;
    // willReadFrequently hints Chrome to keep the backing store CPU-resident,
    // which makes the per-flush getImageData much cheaper than the default
    // GPU-accelerated 2D context.
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("atlas ctx");
    this.ctx = ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textBaseline = "alphabetic";
    const c = ctx as CanvasRenderingContext2D & { fontKerning?: string };
    c.fontKerning = "normal";
    // Note: we deliberately DO NOT set `textRendering = "geometricPrecision"`.
    // It is the slowest text path in Chromium; for monospace cell glyphs the
    // visual difference is negligible.

    // Solid slot at (1, 0): opaque white, used by the cursor & solid fills.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(metrics.width, 0, metrics.width, metrics.height);
    // EMPTY at (0,0) is left transparent (fresh canvas) — alpha 0 is correct.
    // Mark both as pending so the initial flush seeds them.
    this.markPending(EMPTY_AX, EMPTY_AY);
    this.markPending(SOLID_AX, SOLID_AY);
  }

  get atlasWidth(): number {
    return this.canvas.width;
  }
  get atlasHeight(): number {
    return this.canvas.height;
  }

  private markPending(ax: number, ay: number, span = 1): void {
    if (ax < this.pendMinX) this.pendMinX = ax;
    if (ay < this.pendMinY) this.pendMinY = ay;
    const maxAx = ax + span - 1;
    if (maxAx > this.pendMaxX) this.pendMaxX = maxAx;
    if (ay > this.pendMaxY) this.pendMaxY = ay;
    this.hasPending = true;
  }

  ensureCp(cp: number, bold: boolean, italic: boolean): AtlasSlot {
    if (cp === 0 || cp === SPACE_CP) return EMPTY_SLOT;
    const key = (cp << 2) | (italic ? 2 : 0) | (bold ? 1 : 0);
    const cached = this.map.get(key);
    if (cached) return cached;
    const slot = this.allocateSlot(1);
    if (!slot) return EMPTY_SLOT;
    this.rasterizeText(slot, String.fromCodePoint(cp), bold, italic, cp);
    this.map.set(key, slot);
    return slot;
  }

  ensureText(
    ligatureId: number,
    text: string,
    span: number,
    bold: boolean,
    italic: boolean,
  ): AtlasSlot {
    if (span <= 1) return this.ensureCp(text.codePointAt(0) ?? 0, bold, italic);
    const key = (ligatureId << 2) | (italic ? 2 : 0) | (bold ? 1 : 0);
    const cached = this.textMap.get(key);
    if (cached) return cached;
    const slot = this.allocateSlot(span);
    if (!slot) return EMPTY_SLOT;
    this.rasterizeText(slot, text, bold, italic);
    this.textMap.set(key, slot);
    return slot;
  }

  private allocateSlot(span: number): AtlasSlot | null {
    if (span <= 0 || span > ATLAS_COLS) return null;
    if (this.nextAx + span > ATLAS_COLS) {
      this.nextAx = 0;
      this.nextAy += 1;
    }
    if (this.nextAy >= ATLAS_ROWS) return null;
    const slot: AtlasSlot = { ax: this.nextAx, ay: this.nextAy, span };
    this.nextAx += span;
    if (this.nextAx >= ATLAS_COLS) {
      this.nextAx = 0;
      this.nextAy += 1;
    }
    return slot;
  }

  private rasterizeText(
    slot: AtlasSlot,
    text: string,
    bold: boolean,
    italic: boolean,
    cp?: number,
  ): void {
    const m = this.metrics;
    const weight = bold ? 700 : m.fontWeight;
    // Compose the CSS font shorthand. m.font carries `<size>px <family>`
    // only; we prepend italic/weight here so the user's chosen weight does
    // not collide with the bold/italic variants.
    this.ctx.font = italic ? `italic ${weight} ${m.font}` : `${weight} ${m.font}`;
    this.ctx.fillStyle = "#ffffff";
    const slotX = slot.ax * m.width;
    const slotY = slot.ay * m.height;
    const slotWidth = slot.span * m.width;
    this.ctx.clearRect(slotX, slotY, slotWidth, m.height);
    // Clip fillText to the slot rect. Italic / tall glyphs (e.g. `{`, italic
    // `f`, ligatures, glyphs with side bearings) can otherwise draw outside
    // the slot and corrupt adjacent glyphs in the atlas. Cold path — runs
    // once per new (cp, bold, italic) tuple, so the save/clip/restore cost
    // is irrelevant.
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(slotX, slotY, slotWidth, m.height);
    this.ctx.clip();
    // Iterate by codepoint, not UTF-16 unit. fillText accepts strings, so
    // we materialize the glyph string only here (cold path: once per new
    // glyph), keeping the hot row-build loop string-free.
    if (cp === undefined || !rasterizeSpecialGlyph(this.ctx, cp, slotX, slotY, m.width, m.height)) {
      this.ctx.fillText(text, slotX, slotY + m.ascent);
    }
    this.ctx.restore();
    this.markPending(slot.ax, slot.ay, slot.span);
  }

  // Upload the pending bbox to the GPU. R8 single-channel, alpha extracted
  // from the RGBA Canvas2D backing store. Replaces the previous full-atlas
  // `texImage2D(canvas)` reupload (which transferred up to ~8 MB on every
  // new glyph and forced a Canvas2D → GPU sync).
  flush(gl: WebGL2RenderingContext, tex: WebGLTexture): void {
    if (!this.hasPending) return;
    const m = this.metrics;
    const dpr = this.dpr;
    const px = this.pendMinX * m.width * dpr;
    const py = this.pendMinY * m.height * dpr;
    const pw = (this.pendMaxX - this.pendMinX + 1) * m.width * dpr;
    const ph = (this.pendMaxY - this.pendMinY + 1) * m.height * dpr;
    // getImageData ignores the canvas transform; coords are in backing px.
    const img = this.ctx.getImageData(px, py, pw, ph);
    const need = pw * ph;
    if (!this.scratch || this.scratch.length < need) {
      this.scratch = new Uint8Array(need);
    }
    const dst = this.scratch;
    const src = img.data;
    // Hot inner loop: extract alpha channel from RGBA into R8.
    for (let i = 0, j = 3; i < need; i++, j += 4) dst[i] = src[j]!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    // 11-arg ES 3.0 form: srcOffset = 0, length is implicit from w * h.
    // Allows reusing an oversized scratch buffer with no subarray alloc.
    gl.texSubImage2D(gl.TEXTURE_2D, 0, px, py, pw, ph, gl.RED, gl.UNSIGNED_BYTE, dst, 0);
    this.pendMinX = Infinity;
    this.pendMinY = Infinity;
    this.pendMaxX = -1;
    this.pendMaxY = -1;
    this.hasPending = false;
  }
}

interface GridState {
  cols: number;
  rows: number;
  // Codepoints as u32 (covers full Unicode). Replaces string[] — no V8 heap
  // string per cell, no double indirection in the hot loop.
  cellChars: Uint32Array;
  cellHl: Uint32Array;
  // Single backing buffer with two views. `instanceBytes` writes atlas slot
  // indices (u8); `instanceU32` writes packed RGBA colors (u32). One VBO,
  // one bufferSubData per dirty range.
  instanceBuffer: ArrayBuffer;
  instanceBytes: Uint8Array;
  instanceU32: Uint32Array;
  vbo: WebGLBuffer;
  vao: WebGLVertexArrayObject;
  dirtyRows: Set<number>;
  uploaded: boolean;
}

export interface ResolvedCursorGlyph {
  cp: number;
  bold: boolean;
  italic: boolean;
}

export class GLRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;

  // Two programs: grid (instanced, attrib-driven) and cursor (single quad,
  // uniform-driven). Splitting lets the grid shader stay minimal.
  private readonly gridProgram: WebGLProgram;
  private readonly cursorProgram: WebGLProgram;
  private readonly quadVbo: WebGLBuffer;
  private readonly atlasTexture: WebGLTexture;
  private readonly cursorVao: WebGLVertexArrayObject;

  private readonly locGridCorner: number;
  private readonly locGridAtlasPos: number;
  private readonly locGridSpan: number;
  private readonly locGridFg: number;
  private readonly locGridBg: number;
  private readonly locGridCellSize: WebGLUniformLocation | null;
  private readonly locGridGridOffset: WebGLUniformLocation | null;
  private readonly locGridCanvasSize: WebGLUniformLocation | null;
  private readonly locGridAtlasUvStep: WebGLUniformLocation | null;
  private readonly locGridCols: WebGLUniformLocation | null;

  private readonly locCurCorner: number;
  private readonly locCurCellSize: WebGLUniformLocation | null;
  private readonly locCurGridOffset: WebGLUniformLocation | null;
  private readonly locCurCanvasSize: WebGLUniformLocation | null;
  private readonly locCurAtlasUvStep: WebGLUniformLocation | null;
  private readonly locCurCursorPos: WebGLUniformLocation | null;
  private readonly locCurCursorSize: WebGLUniformLocation | null;
  private readonly locCurCursorAtlas: WebGLUniformLocation | null;
  private readonly locCurCursorFg: WebGLUniformLocation | null;
  private readonly locCurCursorBg: WebGLUniformLocation | null;

  private atlas: GlyphAtlas | null = null;
  private metrics: CellMetrics | null = null;
  // Hl is keyed by dense small ids assigned sequentially by nvim. Store packed
  // fields in typed arrays so the per-cell loop avoids object allocation and
  // object-property reads. Keep original entries alongside so entries that
  // omitted fg/bg can be re-packed when default colors change.
  private hlEntries: Array<HlAttrEntry | undefined> = [];
  private hlFg = new Uint32Array(0);
  private hlBg = new Uint32Array(0);
  private hlFlags = new Uint8Array(0);
  private hlDefined = new Uint8Array(0);
  private defaultColors: DefaultColorsEntry = { fg: 0xe8e8ea, bg: 0x0e0f13, sp: 0xff453a };
  private defFgU32 = 0;
  private defBgU32 = 0;
  private grids = new Map<number, GridState>();
  private windowsById = new Map<number, WindowEntry>();
  private visibleSorted: WindowEntry[] = [];
  private cursor: CursorEntry | null = null;
  private readonly cursorGlyphScratch: ResolvedCursorGlyph = { cp: 0, bold: false, italic: false };
  private redefinedHlEpochs = new Uint32Array(0);
  private redefinedHlEpoch = 0;
  private redefinedHlCount = 0;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      // We always write opaque pixels; flag is inert. Set false to avoid any
      // implicit premultiply path on canvas readback.
      premultipliedAlpha: false,
    });
    if (!gl) throw new Error("WebGL2 not supported");
    this.gl = gl;

    // Grid program.
    this.gridProgram = compileProgram(gl, GRID_VERT, SHARED_FRAG);
    this.locGridCellSize = gl.getUniformLocation(this.gridProgram, "u_cell_size");
    this.locGridGridOffset = gl.getUniformLocation(this.gridProgram, "u_grid_offset");
    this.locGridCanvasSize = gl.getUniformLocation(this.gridProgram, "u_canvas_size");
    this.locGridAtlasUvStep = gl.getUniformLocation(this.gridProgram, "u_atlas_uv_step");
    this.locGridCols = gl.getUniformLocation(this.gridProgram, "u_cols");
    const locGridSampler = gl.getUniformLocation(this.gridProgram, "u_atlas");
    this.locGridCorner = gl.getAttribLocation(this.gridProgram, "a_corner");
    this.locGridAtlasPos = gl.getAttribLocation(this.gridProgram, "a_atlas_pos");
    this.locGridSpan = gl.getAttribLocation(this.gridProgram, "a_span");
    this.locGridFg = gl.getAttribLocation(this.gridProgram, "a_fg");
    this.locGridBg = gl.getAttribLocation(this.gridProgram, "a_bg");

    // Cursor program.
    this.cursorProgram = compileProgram(gl, CURSOR_VERT, SHARED_FRAG);
    this.locCurCellSize = gl.getUniformLocation(this.cursorProgram, "u_cell_size");
    this.locCurGridOffset = gl.getUniformLocation(this.cursorProgram, "u_grid_offset");
    this.locCurCanvasSize = gl.getUniformLocation(this.cursorProgram, "u_canvas_size");
    this.locCurAtlasUvStep = gl.getUniformLocation(this.cursorProgram, "u_atlas_uv_step");
    this.locCurCursorPos = gl.getUniformLocation(this.cursorProgram, "u_cursor_pos");
    this.locCurCursorSize = gl.getUniformLocation(this.cursorProgram, "u_cursor_size");
    this.locCurCursorAtlas = gl.getUniformLocation(this.cursorProgram, "u_cursor_atlas");
    this.locCurCursorFg = gl.getUniformLocation(this.cursorProgram, "u_cursor_fg");
    this.locCurCursorBg = gl.getUniformLocation(this.cursorProgram, "u_cursor_bg");
    const locCurSampler = gl.getUniformLocation(this.cursorProgram, "u_atlas");
    this.locCurCorner = gl.getAttribLocation(this.cursorProgram, "a_corner");

    // Shared unit quad (per-vertex corners 0..1).
    const quadVbo = gl.createBuffer();
    if (!quadVbo) throw new Error("createBuffer failed");
    this.quadVbo = quadVbo;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

    // Atlas texture: storage allocated on first setCellMetrics (we need
    // metrics + dpr to pick the right size). R8 single-channel; we sample
    // `.r` in the fragment shader. 4× less VRAM/bandwidth vs RGBA.
    const tex = gl.createTexture();
    if (!tex) throw new Error("createTexture failed");
    this.atlasTexture = tex;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // NEAREST: Canvas2D fillText already produces subpixel-AA alpha in the
    // mask. LINEAR would re-filter that mask, doubling blur and bleeding
    // neighbor-slot alpha at slot boundaries (visible as colored halos around
    // glyphs since the fragment shader mixes v_bg → v_fg using the bled mask).
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    // Cursor VAO: just the quad — no instance buffer.
    const cursorVao = gl.createVertexArray();
    if (!cursorVao) throw new Error("createVertexArray failed");
    this.cursorVao = cursorVao;
    gl.bindVertexArray(cursorVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    if (this.locCurCorner >= 0) {
      gl.enableVertexAttribArray(this.locCurCorner);
      gl.vertexAttribPointer(this.locCurCorner, 2, gl.FLOAT, false, 0, 0);
    }
    gl.bindVertexArray(null);

    // One-time uniform setup. Sampler unit never changes; binding the atlas
    // to texture unit 0 is also stable for the renderer's lifetime.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.useProgram(this.gridProgram);
    if (locGridSampler) gl.uniform1i(locGridSampler, 0);
    gl.useProgram(this.cursorProgram);
    if (locCurSampler) gl.uniform1i(locCurSampler, 0);

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    this.defFgU32 = packRgba(this.defaultColors.fg);
    this.defBgU32 = packRgba(this.defaultColors.bg);
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.floor(cssW * dpr));
    this.canvas.height = Math.max(1, Math.floor(cssH * dpr));
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  setCellMetrics(metrics: CellMetrics): void {
    this.metrics = metrics;
    this.atlas = new GlyphAtlas(metrics, this.dpr);
    // (Re)allocate texture storage at the new dimensions. Pass a zeroed
    // buffer so unread regions are well-defined (any cell sampling outside
    // a written slot still gets mask = 0 → bg).
    this.allocateAtlasTexture();
    for (const grid of this.grids.values()) {
      for (let r = 0; r < grid.rows; r++) grid.dirtyRows.add(r);
      grid.uploaded = false;
    }
  }

  private allocateAtlasTexture(): void {
    const gl = this.gl;
    const a = this.atlas;
    if (!a) return;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    // texImage2D with null leaves contents undefined; we pass a zeroed
    // buffer instead. One-time cost per font-size change.
    const zeros = new Uint8Array(a.atlasWidth * a.atlasHeight);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      a.atlasWidth,
      a.atlasHeight,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      zeros,
    );
  }

  upsertHl(entries: HlAttrEntry[]): void {
    // Only redefinitions of existing ids can invalidate already-rendered
    // cells. New ids haven't been used yet, so we update the table without
    // scanning.
    const c = this.defaultColors;
    const epoch = this.beginRedefinedHlPass();
    this.redefinedHlCount = 0;
    for (const e of entries) {
      const wasDefined = e.id < this.hlDefined.length && this.hlDefined[e.id] !== 0;
      this.ensureHlCapacity(e.id);
      if (wasDefined) this.markRedefinedHl(e.id, epoch);
      this.hlEntries[e.id] = e;
      this.writePackedHl(e, c);
    }
    if (this.redefinedHlCount === 0) return;
    for (const grid of this.grids.values()) {
      for (let r = 0; r < grid.rows; r++) {
        if (grid.dirtyRows.has(r)) continue;
        const base = r * grid.cols;
        for (let c2 = 0; c2 < grid.cols; c2++) {
          if (this.redefinedHlEpochs[grid.cellHl[base + c2]!] === epoch) {
            grid.dirtyRows.add(r);
            break;
          }
        }
      }
    }
  }

  setDefaultColors(c: DefaultColorsEntry): void {
    this.defaultColors = c;
    this.defFgU32 = packRgba(c.fg);
    this.defBgU32 = packRgba(c.bg);
    // Re-pack hl entries: any entry that omitted fg/bg inherited the old
    // default at pack time. Cheaper than branching at the per-cell site.
    for (let i = 0; i < this.hlEntries.length; i++) {
      const e = this.hlEntries[i];
      if (!e) continue;
      this.ensureHlCapacity(i);
      this.writePackedHl(e, c);
    }
    for (const grid of this.grids.values()) {
      for (let r = 0; r < grid.rows; r++) grid.dirtyRows.add(r);
    }
  }

  private ensureHlCapacity(id: number): void {
    if (id < this.hlDefined.length) return;
    const nextLength = growCapacity(this.hlDefined.length, id + 1);
    const nextFg = new Uint32Array(nextLength);
    const nextBg = new Uint32Array(nextLength);
    const nextFlags = new Uint8Array(nextLength);
    const nextDefined = new Uint8Array(nextLength);
    const nextEpochs = new Uint32Array(nextLength);
    nextFg.set(this.hlFg);
    nextBg.set(this.hlBg);
    nextFlags.set(this.hlFlags);
    nextDefined.set(this.hlDefined);
    nextEpochs.set(this.redefinedHlEpochs);
    this.hlFg = nextFg;
    this.hlBg = nextBg;
    this.hlFlags = nextFlags;
    this.hlDefined = nextDefined;
    this.redefinedHlEpochs = nextEpochs;
  }

  private writePackedHl(e: HlAttrEntry, c: DefaultColorsEntry): void {
    const id = e.id;
    this.hlFg[id] = packRgba(e.fg ?? c.fg);
    this.hlBg[id] = packRgba(e.bg ?? c.bg);
    this.hlFlags[id] =
      (e.reverse === true ? HL_REVERSE : 0) |
      (e.bold === true ? HL_BOLD : 0) |
      (e.italic === true ? HL_ITALIC : 0);
    this.hlDefined[id] = 1;
  }

  private beginRedefinedHlPass(): number {
    if (this.redefinedHlEpoch === 0xffffffff) {
      this.redefinedHlEpochs.fill(0);
      this.redefinedHlEpoch = 1;
      return this.redefinedHlEpoch;
    }
    this.redefinedHlEpoch += 1;
    return this.redefinedHlEpoch;
  }

  private markRedefinedHl(id: number, epoch: number): void {
    if (this.redefinedHlEpochs[id] === epoch) return;
    this.redefinedHlEpochs[id] = epoch;
    this.redefinedHlCount += 1;
  }

  ensureGrid(id: number, cols: number, rows: number): void {
    const existing = this.grids.get(id);
    if (existing && existing.cols === cols && existing.rows === rows) return;
    const gl = this.gl;
    if (existing) {
      gl.deleteBuffer(existing.vbo);
      gl.deleteVertexArray(existing.vao);
    }
    const cellCount = cols * rows;
    const ab = new ArrayBuffer(cellCount * BYTES_PER_INSTANCE);
    const instanceBytes = new Uint8Array(ab);
    const instanceU32 = new Uint32Array(ab);
    const cellChars = new Uint32Array(cellCount);
    cellChars.fill(SPACE_CP);
    const cellHl = new Uint32Array(cellCount);
    const vbo = gl.createBuffer();
    if (!vbo) throw new Error("createBuffer failed");
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, ab.byteLength, gl.DYNAMIC_DRAW);
    const vao = this.makeInstanceVao(vbo);
    const dirtyRows = new Set<number>();
    for (let r = 0; r < rows; r++) dirtyRows.add(r);
    this.grids.set(id, {
      cols,
      rows,
      cellChars,
      cellHl,
      instanceBuffer: ab,
      instanceBytes,
      instanceU32,
      vbo,
      vao,
      dirtyRows,
      uploaded: false,
    });
  }

  removeGrid(id: number): void {
    const grid = this.grids.get(id);
    if (!grid) return;
    this.gl.deleteBuffer(grid.vbo);
    this.gl.deleteVertexArray(grid.vao);
    this.grids.delete(id);
  }

  updateRows(
    gridId: number,
    rowIndexes: Uint32Array,
    cols: number,
    cellChars: Uint32Array,
    cellHl: Uint32Array,
  ): void {
    const grid = this.grids.get(gridId);
    if (!grid) return;
    const copyCols = Math.min(grid.cols, cols);
    for (let i = 0; i < rowIndexes.length; i++) {
      const row = rowIndexes[i]!;
      if (row >= grid.rows) continue;
      const dstBase = row * grid.cols;
      const srcBase = i * cols;
      if (copyCols < grid.cols) {
        grid.cellChars.fill(SPACE_CP, dstBase, dstBase + grid.cols);
        grid.cellHl.fill(0, dstBase, dstBase + grid.cols);
      }
      copySlice(grid.cellChars, dstBase, cellChars, srcBase, copyCols);
      copySlice(grid.cellHl, dstBase, cellHl, srcBase, copyCols);
      grid.dirtyRows.add(row);
    }
  }

  setWindows(windows: WindowEntry[]): void {
    this.windowsById.clear();
    const visibleSorted = this.visibleSorted;
    visibleSorted.length = 0;
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i]!;
      this.windowsById.set(w.gridId, w);
      if (!w.hidden) visibleSorted.push(w);
    }
    visibleSorted.sort(compareWindowZIndex);
  }

  setCursor(cursor: CursorEntry | null): void {
    this.cursor = cursor;
  }

  composite(): void {
    const gl = this.gl;
    const m = this.metrics;
    const atlas = this.atlas;
    if (!m || !atlas) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }

    const visible = this.visibleSorted;

    // Combined pre-rasterize + upload pass. For each visible window, build
    // dirty-row instance bytes (which calls atlas.ensureCp and may grow the
    // atlas) and upload the contiguous min..max range in one bufferSubData.
    // One Map.get(gridId) per window (down from three).
    for (let wi = 0; wi < visible.length; wi++) {
      const win = visible[wi]!;
      const grid = this.grids.get(win.gridId);
      if (!grid) continue;
      if (grid.dirtyRows.size === 0) continue;
      let minR = Infinity;
      let maxR = -1;
      for (const r of grid.dirtyRows) {
        this.buildRowInstances(grid, r);
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, grid.vbo);
      if (!grid.uploaded) {
        gl.bufferData(gl.ARRAY_BUFFER, grid.instanceBytes, gl.DYNAMIC_DRAW);
        grid.uploaded = true;
      } else {
        const stride = grid.cols * BYTES_PER_INSTANCE;
        const start = minR * stride;
        const len = (maxR + 1) * stride - start;
        gl.bufferSubData(gl.ARRAY_BUFFER, start, grid.instanceBytes, start, len);
      }
      grid.dirtyRows.clear();
    }

    // Cursor's text glyph (if any) must be in the atlas before flushing.
    if (this.cursor?.shape === "block") {
      const glyph = this.resolveCurrentBlockCursorGlyph();
      if (glyph) {
        atlas.ensureCp(glyph.cp, glyph.bold, glyph.italic);
      }
    }

    // Atlas flush: single texSubImage2D over the bbox of all newly-rasterized
    // glyphs since the last flush. No-op when nothing pending.
    atlas.flush(gl, this.atlasTexture);

    // Clear with the default bg.
    const bg = this.defaultColors.bg;
    gl.clearColor(((bg >> 16) & 0xff) / 255, ((bg >> 8) & 0xff) / 255, (bg & 0xff) / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Draw grid pass.
    gl.useProgram(this.gridProgram);
    const dpr = this.dpr;
    const cellPxW = m.width * dpr;
    const cellPxH = m.height * dpr;
    gl.uniform2f(this.locGridCellSize, cellPxW, cellPxH);
    gl.uniform2f(this.locGridCanvasSize, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.locGridAtlasUvStep, cellPxW / atlas.atlasWidth, cellPxH / atlas.atlasHeight);

    for (let wi = 0; wi < visible.length; wi++) {
      const win = visible[wi]!;
      const grid = this.grids.get(win.gridId);
      if (!grid) continue;
      gl.uniform2f(this.locGridGridOffset, win.col * cellPxW, win.row * cellPxH);
      gl.uniform1f(this.locGridCols, grid.cols);
      gl.bindVertexArray(grid.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, grid.cols * grid.rows);
    }

    if (this.cursor) {
      this.drawCursor(cellPxW, cellPxH);
    }

    gl.bindVertexArray(null);
  }

  private buildRowInstances(grid: GridState, row: number): void {
    const m = this.metrics;
    const atlas = this.atlas;
    if (!m || !atlas) return;
    const defFg = this.defFgU32;
    const defBg = this.defBgU32;
    const base = row * grid.cols;
    const bytes = grid.instanceBytes;
    const u32 = grid.instanceU32;
    const cellChars = grid.cellChars;
    const cellHl = grid.cellHl;
    const hlFg = this.hlFg;
    const hlBg = this.hlBg;
    const hlFlags = this.hlFlags;
    const hlDefined = this.hlDefined;
    const cols = grid.cols;
    let byteOff = base * BYTES_PER_INSTANCE;
    let u32Off = base * 3;
    for (let c = 0; c < cols; ) {
      const cp = cellChars[base + c]!;
      const hlId = cellHl[base + c]!;
      let fgU32 = defFg;
      let bgU32 = defBg;
      let bold = false;
      let italic = false;
      if (hlId < hlDefined.length && hlDefined[hlId] !== 0) {
        const flags = hlFlags[hlId]!;
        if ((flags & HL_REVERSE) !== 0) {
          fgU32 = hlBg[hlId]!;
          bgU32 = hlFg[hlId]!;
        } else {
          fgU32 = hlFg[hlId]!;
          bgU32 = hlBg[hlId]!;
        }
        bold = (flags & HL_BOLD) !== 0;
        italic = (flags & HL_ITALIC) !== 0;
      }
      let ax = EMPTY_AX;
      let ay = EMPTY_AY;
      let span = 1;
      // Skip ensureCp for blank cells — by far the common case (line numbers,
      // margins, indentation). Map.get + key compute is avoided entirely.
      if (cp !== 0 && cp !== SPACE_CP) {
        const ligature =
          m.ligatures === true ? findLigatureMatch(cellChars, cellHl, base, cols, c) : null;
        if (ligature !== null) {
          const slot = atlas.ensureText(ligature.id, ligature.text, ligature.span, bold, italic);
          if (slot !== EMPTY_SLOT) {
            ax = slot.ax;
            ay = slot.ay;
            span = ligature.span;
          } else {
            const fallbackSlot = atlas.ensureCp(cp, bold, italic);
            ax = fallbackSlot.ax;
            ay = fallbackSlot.ay;
          }
        } else {
          const fallbackSlot = atlas.ensureCp(cp, bold, italic);
          ax = fallbackSlot.ax;
          ay = fallbackSlot.ay;
        }
      }
      bytes[byteOff] = ax;
      bytes[byteOff + 1] = ay;
      bytes[byteOff + 2] = span;
      // byte 3 is padding; left untouched (initial 0 is fine).
      u32[u32Off + FG_U32_OFF] = fgU32;
      u32[u32Off + BG_U32_OFF] = bgU32;
      if (span > 1) {
        for (let follower = 1; follower < span; follower++) {
          const followerByteOff = byteOff + follower * BYTES_PER_INSTANCE;
          const followerU32Off = u32Off + follower * 3;
          bytes[followerByteOff] = EMPTY_AX;
          bytes[followerByteOff + 1] = EMPTY_AY;
          bytes[followerByteOff + 2] = 0;
          u32[followerU32Off + FG_U32_OFF] = fgU32;
          u32[followerU32Off + BG_U32_OFF] = bgU32;
        }
      }
      const advance = span > 1 ? span : 1;
      c += advance;
      byteOff += advance * BYTES_PER_INSTANCE;
      u32Off += advance * 3;
    }
  }

  private drawCursor(cellPxW: number, cellPxH: number): void {
    const gl = this.gl;
    const m = this.metrics;
    const atlas = this.atlas;
    if (!m || !atlas || !this.cursor) return;
    const win = this.windowsById.get(this.cursor.gridId);
    if (!win) return;
    const cursor = this.cursor;

    let posX = cursor.col;
    let posY = cursor.row;
    let sizeX = 1;
    let sizeY = 1;
    let atlasPos: AtlasSlot = SOLID_SLOT;
    let fgN = this.defaultColors.fg;
    let bgN = this.defaultColors.fg;

    if (cursor.shape === "vertical") {
      sizeX = 2 / m.width;
    } else if (cursor.shape === "horizontal") {
      sizeY = 2 / m.height;
      posY = cursor.row + 1 - sizeY;
    } else {
      const glyph = this.resolveCurrentBlockCursorGlyph();
      atlasPos = glyph ? atlas.ensureCp(glyph.cp, glyph.bold, glyph.italic) : EMPTY_SLOT;
      fgN = this.defaultColors.bg;
      bgN = this.defaultColors.fg;
    }

    gl.useProgram(this.cursorProgram);
    gl.uniform2f(this.locCurCellSize, cellPxW, cellPxH);
    gl.uniform2f(this.locCurCanvasSize, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.locCurAtlasUvStep, cellPxW / atlas.atlasWidth, cellPxH / atlas.atlasHeight);
    gl.uniform2f(this.locCurGridOffset, win.col * cellPxW, win.row * cellPxH);
    gl.uniform2f(this.locCurCursorPos, posX, posY);
    gl.uniform2f(this.locCurCursorSize, sizeX, sizeY);
    gl.uniform2f(this.locCurCursorAtlas, atlasPos.ax, atlasPos.ay);
    gl.uniform3f(
      this.locCurCursorFg,
      ((fgN >> 16) & 0xff) / 255,
      ((fgN >> 8) & 0xff) / 255,
      (fgN & 0xff) / 255,
    );
    gl.uniform3f(
      this.locCurCursorBg,
      ((bgN >> 16) & 0xff) / 255,
      ((bgN >> 8) & 0xff) / 255,
      (bgN & 0xff) / 255,
    );

    gl.bindVertexArray(this.cursorVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private resolveCurrentBlockCursorGlyph(): ResolvedCursorGlyph | null {
    const cursor = this.cursor;
    if (!cursor || cursor.shape !== "block") return null;
    const grid = this.grids.get(cursor.gridId);
    if (
      grid &&
      cursor.row >= 0 &&
      cursor.row < grid.rows &&
      cursor.col >= 0 &&
      cursor.col < grid.cols
    ) {
      const idx = cursor.row * grid.cols + cursor.col;
      const cp = grid.cellChars[idx]!;
      if (cp !== 0 && cp !== SPACE_CP) {
        const hlId = grid.cellHl[idx]!;
        const flags =
          hlId < this.hlDefined.length && this.hlDefined[hlId] !== 0 ? this.hlFlags[hlId]! : 0;
        this.cursorGlyphScratch.cp = cp;
        this.cursorGlyphScratch.bold = (flags & HL_BOLD) !== 0;
        this.cursorGlyphScratch.italic = (flags & HL_ITALIC) !== 0;
        return this.cursorGlyphScratch;
      }
    }
    if (!cursor.text || cursor.text === " ") return null;
    this.cursorGlyphScratch.cp = cursor.text.codePointAt(0)!;
    this.cursorGlyphScratch.bold = false;
    this.cursorGlyphScratch.italic = false;
    return this.cursorGlyphScratch;
  }

  private makeInstanceVao(instanceVbo: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("createVertexArray failed");
    gl.bindVertexArray(vao);

    // Per-vertex unit quad.
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    if (this.locGridCorner >= 0) {
      gl.enableVertexAttribArray(this.locGridCorner);
      gl.vertexAttribPointer(this.locGridCorner, 2, gl.FLOAT, false, 0, 0);
    }

    // Per-instance attribs (12-byte stride; see BYTES_PER_INSTANCE).
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceVbo);

    if (this.locGridAtlasPos >= 0) {
      gl.enableVertexAttribArray(this.locGridAtlasPos);
      // u8 not normalized → shader sees raw 0..63 slot indices as floats.
      gl.vertexAttribPointer(
        this.locGridAtlasPos,
        2,
        gl.UNSIGNED_BYTE,
        false,
        BYTES_PER_INSTANCE,
        0,
      );
      gl.vertexAttribDivisor(this.locGridAtlasPos, 1);
    }

    if (this.locGridSpan >= 0) {
      gl.enableVertexAttribArray(this.locGridSpan);
      gl.vertexAttribPointer(this.locGridSpan, 1, gl.UNSIGNED_BYTE, false, BYTES_PER_INSTANCE, 2);
      gl.vertexAttribDivisor(this.locGridSpan, 1);
    }

    if (this.locGridFg >= 0) {
      gl.enableVertexAttribArray(this.locGridFg);
      // u8 normalized → shader sees 0..1 RGBA. byte0=R per little-endian
      // u32 packing in packRgba().
      gl.vertexAttribPointer(this.locGridFg, 4, gl.UNSIGNED_BYTE, true, BYTES_PER_INSTANCE, 4);
      gl.vertexAttribDivisor(this.locGridFg, 1);
    }

    if (this.locGridBg >= 0) {
      gl.enableVertexAttribArray(this.locGridBg);
      gl.vertexAttribPointer(this.locGridBg, 4, gl.UNSIGNED_BYTE, true, BYTES_PER_INSTANCE, 8);
      gl.vertexAttribDivisor(this.locGridBg, 1);
    }

    gl.bindVertexArray(null);
    return vao;
  }
}

function compileProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  if (!prog) throw new Error("createProgram failed");
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`program link: ${info}`);
  }
  return prog;
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error("createShader failed");
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`shader compile: ${info}`);
  }
  return s;
}

function copySlice(
  dst: Uint32Array,
  dstBase: number,
  src: Uint32Array,
  srcBase: number,
  len: number,
): void {
  for (let i = 0; i < len; i++) {
    dst[dstBase + i] = src[srcBase + i]!;
  }
}

function compareWindowZIndex(a: WindowEntry, b: WindowEntry): number {
  return a.zIndex - b.zIndex;
}

function growCapacity(current: number, required: number): number {
  let next = current === 0 ? 32 : current;
  while (next < required) next *= 2;
  return next;
}

export function resolveBlockCursorGlyph(
  cursor: CursorEntry | null,
  grid:
    | {
        cols: number;
        rows: number;
        cellChars: Uint32Array;
        cellHl: Uint32Array;
      }
    | undefined,
  hlPacked: ReadonlyArray<
    | {
        bold: boolean;
        italic: boolean;
      }
    | undefined
  >,
): ResolvedCursorGlyph | null {
  if (!cursor || cursor.shape !== "block") return null;
  if (
    grid &&
    cursor.row >= 0 &&
    cursor.row < grid.rows &&
    cursor.col >= 0 &&
    cursor.col < grid.cols
  ) {
    const idx = cursor.row * grid.cols + cursor.col;
    const cp = grid.cellChars[idx]!;
    if (cp !== 0 && cp !== SPACE_CP) {
      const hl = hlPacked[grid.cellHl[idx]!];
      return {
        cp,
        bold: hl?.bold ?? false,
        italic: hl?.italic ?? false,
      };
    }
  }
  if (!cursor.text || cursor.text === " ") return null;
  return {
    cp: cursor.text.codePointAt(0)!,
    bold: false,
    italic: false,
  };
}

// Pack a 0xRRGGBB color into a u32 with byte0 = R, matching what
// vertexAttribPointer(UNSIGNED_BYTE, normalized=true) reads from a typed-array
// buffer on little-endian platforms (all WebGL targets we care about).
function packRgba(n: number): number {
  if (typeof n !== "number" || n < 0) return 0xff000000 >>> 0;
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  // (0xff << 24) is negative when interpreted as i32; the |0 / >>>0 makes it
  // an unambiguous u32 bit pattern when stored into a Uint32Array.
  return (r | (g << 8) | (b << 16) | (0xff << 24)) >>> 0;
}
