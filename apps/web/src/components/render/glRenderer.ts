import type {
  CellMetrics,
  CursorEntry,
  DefaultColorsEntry,
  HlAttrEntry,
  RowDelta,
  WindowEntry,
} from "@fenrir/contracts";

const ATLAS_COLS = 64;
const ATLAS_ROWS = 64;
const EMPTY_SLOT = { ax: 0, ay: 0 } as const;
const SOLID_SLOT = { ax: 1, ay: 0 } as const;
const FLOATS_PER_INSTANCE = 14;

const VERT_SRC = `#version 300 es
in vec2 a_corner;
in vec2 a_grid_pos;
in vec2 a_size;
in vec2 a_atlas_pos;
in vec4 a_fg;
in vec4 a_bg;

uniform vec2 u_cell_size;
uniform vec2 u_grid_offset;
uniform vec2 u_canvas_size;
uniform vec2 u_atlas_size;

out vec2 v_atlas_uv;
out vec4 v_fg;
out vec4 v_bg;

void main() {
  vec2 cell_origin = u_grid_offset + a_grid_pos * u_cell_size;
  vec2 quad_size = a_size * u_cell_size;
  vec2 world = cell_origin + a_corner * quad_size;
  vec2 ndc = world / u_canvas_size * 2.0 - 1.0;
  ndc.y = -ndc.y;
  gl_Position = vec4(ndc, 0.0, 1.0);

  vec2 atlas_origin = a_atlas_pos * u_cell_size / u_atlas_size;
  v_atlas_uv = atlas_origin + a_corner * (a_size * u_cell_size) / u_atlas_size;
  v_fg = a_fg;
  v_bg = a_bg;
}`;

const FRAG_SRC = `#version 300 es
precision highp float;

in vec2 v_atlas_uv;
in vec4 v_fg;
in vec4 v_bg;
uniform sampler2D u_atlas;
out vec4 out_color;

void main() {
  vec4 mask = texture(u_atlas, v_atlas_uv);
  out_color = mix(v_bg, vec4(v_fg.rgb, 1.0), mask.a);
}`;

interface AtlasSlot {
  ax: number;
  ay: number;
}

class GlyphAtlas {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  readonly metrics: CellMetrics;
  private dpr: number;
  private map = new Map<string, AtlasSlot>();
  private nextAx = 2;
  private nextAy = 0;
  dirty = true;

  constructor(metrics: CellMetrics, dpr: number) {
    this.metrics = metrics;
    this.dpr = dpr;
    this.canvas = document.createElement("canvas");
    this.canvas.width = ATLAS_COLS * metrics.width * dpr;
    this.canvas.height = ATLAS_ROWS * metrics.height * dpr;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("atlas ctx");
    this.ctx = ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textBaseline = "alphabetic";
    const c = ctx as CanvasRenderingContext2D & {
      textRendering?: string;
      fontKerning?: string;
    };
    c.textRendering = "geometricPrecision";
    c.fontKerning = "normal";
    // Slot (1,0): solid white opaque, used for cursor and other solid shapes.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(metrics.width, 0, metrics.width, metrics.height);
  }

  ensure(ch: string, bold: boolean, italic: boolean): AtlasSlot {
    if (!ch || ch === " ") return EMPTY_SLOT;
    const key = `${bold ? "b" : ""}${italic ? "i" : ""}|${ch}`;
    const cached = this.map.get(key);
    if (cached) return cached;
    if (this.nextAy >= ATLAS_ROWS) return EMPTY_SLOT;
    const slot: AtlasSlot = { ax: this.nextAx, ay: this.nextAy };
    this.nextAx += 1;
    if (this.nextAx >= ATLAS_COLS) {
      this.nextAx = 0;
      this.nextAy += 1;
    }
    const m = this.metrics;
    // Compose CSS font shorthand: [italic] <weight> <size>px <family>.
    // m.font carries only `<size>px <family>` so the weight token never collides.
    const weight = bold ? 700 : m.fontWeight;
    const fontParts: string[] = [];
    if (italic) fontParts.push("italic");
    fontParts.push(String(weight));
    fontParts.push(m.font);
    this.ctx.font = fontParts.join(" ");
    this.ctx.fillStyle = "#ffffff";
    this.ctx.clearRect(slot.ax * m.width, slot.ay * m.height, m.width, m.height);
    this.ctx.fillText(ch, slot.ax * m.width, slot.ay * m.height + m.ascent);
    this.map.set(key, slot);
    this.dirty = true;
    return slot;
  }
}

interface GridState {
  cols: number;
  rows: number;
  cellChars: string[];
  cellHl: Uint16Array;
  instanceData: Float32Array;
  vbo: WebGLBuffer;
  vao: WebGLVertexArrayObject;
  dirtyRows: Set<number>;
  uploaded: boolean;
}

export class GLRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly quadVbo: WebGLBuffer;
  private readonly atlasTexture: WebGLTexture;
  private readonly cursorVbo: WebGLBuffer;
  private readonly cursorVao: WebGLVertexArrayObject;
  private readonly cursorScratch = new Float32Array(FLOATS_PER_INSTANCE);

  private readonly locCorner: number;
  private readonly locGridPos: number;
  private readonly locSize: number;
  private readonly locAtlasPos: number;
  private readonly locFg: number;
  private readonly locBg: number;
  private readonly locCellSize: WebGLUniformLocation | null;
  private readonly locGridOffset: WebGLUniformLocation | null;
  private readonly locCanvasSize: WebGLUniformLocation | null;
  private readonly locAtlasSize: WebGLUniformLocation | null;
  private readonly locAtlasSampler: WebGLUniformLocation | null;

  private atlas: GlyphAtlas | null = null;
  private metrics: CellMetrics | null = null;
  // Hl entries are keyed by dense small integer ids assigned sequentially by
  // nvim. Array indexing avoids hash lookups in the hot per-cell loop.
  private hl: Array<HlAttrEntry | undefined> = [];
  private defaultColors: DefaultColorsEntry = { fg: 0xe8e8ea, bg: 0x0e0f13, sp: 0xff453a };
  private grids = new Map<number, GridState>();
  private windows: WindowEntry[] = [];
  private visibleSorted: WindowEntry[] = [];
  private cursor: CursorEntry | null = null;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      premultipliedAlpha: true,
    });
    if (!gl) throw new Error("WebGL2 not supported");
    this.gl = gl;

    this.program = compileProgram(gl, VERT_SRC, FRAG_SRC);
    this.locCellSize = gl.getUniformLocation(this.program, "u_cell_size");
    this.locGridOffset = gl.getUniformLocation(this.program, "u_grid_offset");
    this.locCanvasSize = gl.getUniformLocation(this.program, "u_canvas_size");
    this.locAtlasSize = gl.getUniformLocation(this.program, "u_atlas_size");
    this.locAtlasSampler = gl.getUniformLocation(this.program, "u_atlas");

    this.locCorner = gl.getAttribLocation(this.program, "a_corner");
    this.locGridPos = gl.getAttribLocation(this.program, "a_grid_pos");
    this.locSize = gl.getAttribLocation(this.program, "a_size");
    this.locAtlasPos = gl.getAttribLocation(this.program, "a_atlas_pos");
    this.locFg = gl.getAttribLocation(this.program, "a_fg");
    this.locBg = gl.getAttribLocation(this.program, "a_bg");

    const quadVbo = gl.createBuffer();
    if (!quadVbo) throw new Error("createBuffer failed");
    this.quadVbo = quadVbo;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

    const tex = gl.createTexture();
    if (!tex) throw new Error("createTexture failed");
    this.atlasTexture = tex;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const cursorVbo = gl.createBuffer();
    if (!cursorVbo) throw new Error("createBuffer failed");
    this.cursorVbo = cursorVbo;
    gl.bindBuffer(gl.ARRAY_BUFFER, cursorVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(FLOATS_PER_INSTANCE), gl.DYNAMIC_DRAW);
    this.cursorVao = this.makeInstanceVao(cursorVbo);

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
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
    for (const grid of this.grids.values()) {
      for (let r = 0; r < grid.rows; r++) grid.dirtyRows.add(r);
      grid.uploaded = false;
    }
  }

  upsertHl(entries: HlAttrEntry[]): void {
    // Only redefinitions of existing ids can invalidate already-rendered cells.
    // New ids haven't been used yet, so we can update the table without scanning.
    const redefined = new Set<number>();
    for (const e of entries) {
      if (this.hl[e.id] !== undefined) redefined.add(e.id);
      this.hl[e.id] = e;
    }
    if (redefined.size === 0) return;
    for (const grid of this.grids.values()) {
      for (let r = 0; r < grid.rows; r++) {
        if (grid.dirtyRows.has(r)) continue;
        const base = r * grid.cols;
        for (let c = 0; c < grid.cols; c++) {
          if (redefined.has(grid.cellHl[base + c]!)) {
            grid.dirtyRows.add(r);
            break;
          }
        }
      }
    }
  }

  setDefaultColors(c: DefaultColorsEntry): void {
    this.defaultColors = c;
    for (const grid of this.grids.values()) {
      for (let r = 0; r < grid.rows; r++) grid.dirtyRows.add(r);
    }
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
    const instanceData = new Float32Array(cellCount * FLOATS_PER_INSTANCE);
    const vbo = gl.createBuffer();
    if (!vbo) throw new Error("createBuffer failed");
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, instanceData.byteLength, gl.DYNAMIC_DRAW);
    const vao = this.makeInstanceVao(vbo);
    const cellChars: string[] = Array.from({ length: cellCount }, () => " ");
    const cellHl = new Uint16Array(cellCount);
    const dirtyRows = new Set<number>();
    for (let r = 0; r < rows; r++) dirtyRows.add(r);
    this.grids.set(id, {
      cols,
      rows,
      cellChars,
      cellHl,
      instanceData,
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

  updateRow(gridId: number, row: number, runs: RowDelta["runs"]): void {
    const grid = this.grids.get(gridId);
    if (!grid || row >= grid.rows) return;
    const base = row * grid.cols;
    for (let c = 0; c < grid.cols; c++) {
      grid.cellChars[base + c] = " ";
      grid.cellHl[base + c] = 0;
    }
    for (const run of runs) {
      // Iterate by code points, not UTF-16 units. Nerd Font icons in the
      // supplementary planes (U+10000+) are surrogate pairs in JS strings;
      // indexing by UTF-16 unit splits them and produces tofu glyphs.
      let c = run.col;
      const end = Math.min(grid.cols, run.col + run.len);
      for (const cp of run.text) {
        if (c >= end) break;
        grid.cellChars[base + c] = cp;
        grid.cellHl[base + c] = run.hlId;
        c += 1;
      }
    }
    grid.dirtyRows.add(row);
  }

  setWindows(windows: WindowEntry[]): void {
    this.windows = windows;
    this.visibleSorted = windows.filter((w) => !w.hidden).toSorted((a, b) => a.zIndex - b.zIndex);
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

    // 1. Pre-rasterize: rebuild instance data for dirty rows (calls atlas.ensure).
    for (const win of visible) {
      const grid = this.grids.get(win.gridId);
      if (!grid) continue;
      if (grid.dirtyRows.size === 0) continue;
      for (const r of grid.dirtyRows) {
        this.buildRowInstances(grid, r);
      }
    }
    if (this.cursor?.shape === "block" && this.cursor.text && this.cursor.text !== " ") {
      atlas.ensure(this.cursor.text, false, false);
    }

    // 2. Upload atlas if dirty.
    if (atlas.dirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
      atlas.dirty = false;
    }

    // 3. Upload changed instance buffers in a single bufferSubData call per
    //    grid, covering the contiguous range from minDirtyRow..maxDirtyRow.
    //    With heavy redraws (e.g. relativenumber on a full screen), this turns
    //    N small uploads + GL command-buffer round-trips into 1.
    for (const win of visible) {
      const grid = this.grids.get(win.gridId);
      if (!grid) continue;
      if (grid.dirtyRows.size === 0) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, grid.vbo);
      if (!grid.uploaded) {
        gl.bufferData(gl.ARRAY_BUFFER, grid.instanceData, gl.DYNAMIC_DRAW);
        grid.uploaded = true;
      } else {
        let minR = Infinity;
        let maxR = -1;
        for (const r of grid.dirtyRows) {
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
        }
        const stride = grid.cols * FLOATS_PER_INSTANCE;
        gl.bufferSubData(
          gl.ARRAY_BUFFER,
          minR * stride * 4,
          grid.instanceData.subarray(minR * stride, (maxR + 1) * stride),
        );
      }
      grid.dirtyRows.clear();
    }

    // 4. Draw.
    const bg = unpackColor(this.defaultColors.bg);
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
    gl.uniform1i(this.locAtlasSampler, 0);
    const dpr = this.dpr;
    gl.uniform2f(this.locCellSize, m.width * dpr, m.height * dpr);
    gl.uniform2f(this.locCanvasSize, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.locAtlasSize, atlas.canvas.width, atlas.canvas.height);

    for (const win of this.visibleSorted) {
      const grid = this.grids.get(win.gridId);
      if (!grid) continue;
      gl.uniform2f(this.locGridOffset, win.col * m.width * dpr, win.row * m.height * dpr);
      gl.bindVertexArray(grid.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, grid.cols * grid.rows);
    }

    if (this.cursor) {
      this.drawCursor();
    }

    gl.bindVertexArray(null);
  }

  private buildRowInstances(grid: GridState, row: number): void {
    const m = this.metrics;
    const atlas = this.atlas;
    if (!m || !atlas) return;
    const defFg = this.defaultColors.fg;
    const defBg = this.defaultColors.bg;
    const base = row * grid.cols;
    const data = grid.instanceData;
    const hlTable = this.hl;
    let off = base * FLOATS_PER_INSTANCE;
    for (let c = 0; c < grid.cols; c++) {
      const ch = grid.cellChars[base + c]!;
      const hl = hlTable[grid.cellHl[base + c]!];
      const reverse = hl !== undefined && hl.reverse === true;
      const fgN = (reverse ? hl?.bg : hl?.fg) ?? defFg;
      const bgN = (reverse ? hl?.fg : hl?.bg) ?? defBg;
      // Skip the atlas ensure() call for blank cells — the empty slot is
      // already known and the call would otherwise allocate a key string and
      // hit Map.get for every space (most line-numbers / margin cells).
      let ax = 0;
      let ay = 0;
      if (ch !== " " && ch !== "" && ch !== undefined) {
        const slot = atlas.ensure(ch, hl?.bold === true, hl?.italic === true);
        ax = slot.ax;
        ay = slot.ay;
      }
      data[off++] = c;
      data[off++] = row;
      data[off++] = 1;
      data[off++] = 1;
      data[off++] = ax;
      data[off++] = ay;
      data[off++] = ((fgN >> 16) & 0xff) / 255;
      data[off++] = ((fgN >> 8) & 0xff) / 255;
      data[off++] = (fgN & 0xff) / 255;
      data[off++] = 1;
      data[off++] = ((bgN >> 16) & 0xff) / 255;
      data[off++] = ((bgN >> 8) & 0xff) / 255;
      data[off++] = (bgN & 0xff) / 255;
      data[off++] = 1;
    }
  }

  private drawCursor(): void {
    const gl = this.gl;
    const m = this.metrics;
    const atlas = this.atlas;
    if (!m || !atlas || !this.cursor) return;
    const win = this.windows.find((w) => w.gridId === this.cursor!.gridId);
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
      atlasPos =
        cursor.text && cursor.text !== " " ? atlas.ensure(cursor.text, false, false) : EMPTY_SLOT;
      fgN = this.defaultColors.bg;
      bgN = this.defaultColors.fg;
    }

    const fg = unpackColor(fgN);
    const bg = unpackColor(bgN);
    const data = this.cursorScratch;
    let off = 0;
    data[off++] = posX;
    data[off++] = posY;
    data[off++] = sizeX;
    data[off++] = sizeY;
    data[off++] = atlasPos.ax;
    data[off++] = atlasPos.ay;
    data[off++] = fg[0];
    data[off++] = fg[1];
    data[off++] = fg[2];
    data[off++] = 1;
    data[off++] = bg[0];
    data[off++] = bg[1];
    data[off++] = bg[2];
    data[off++] = 1;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.cursorVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    const dpr = this.dpr;
    gl.uniform2f(this.locGridOffset, win.col * m.width * dpr, win.row * m.height * dpr);
    gl.bindVertexArray(this.cursorVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1);
  }

  private makeInstanceVao(instanceVbo: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("createVertexArray failed");
    gl.bindVertexArray(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.enableVertexAttribArray(this.locCorner);
    gl.vertexAttribPointer(this.locCorner, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, instanceVbo);
    const stride = FLOATS_PER_INSTANCE * 4;
    let offset = 0;
    const setup = (loc: number, size: number) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
      gl.vertexAttribDivisor(loc, 1);
      offset += size * 4;
    };
    setup(this.locGridPos, 2);
    setup(this.locSize, 2);
    setup(this.locAtlasPos, 2);
    setup(this.locFg, 4);
    setup(this.locBg, 4);

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

function unpackColor(n: number): [number, number, number] {
  if (typeof n !== "number" || n < 0) return [0, 0, 0];
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  return [r, g, b];
}
