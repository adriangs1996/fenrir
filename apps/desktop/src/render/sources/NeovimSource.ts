import * as ChildProcess from "node:child_process";
import * as FS from "node:fs";
import * as Path from "node:path";

import type {
  CellRun,
  CursorEntry,
  EditorFontMetrics,
  Frame,
  GridDelta,
  HlAttrEntry,
  InputEvent,
  ResizedGrid,
  RowDelta,
  WindowEntry,
} from "@fenrir/contracts";

import { FENRIR_INIT_LUA } from "../../neovimLua";
import type { SceneSource } from "../RenderLoop";

const DEFAULT_FONT = "14px ui-monospace, Menlo, Consolas, monospace";
const DEFAULT_CELL_W = 9;
const DEFAULT_CELL_H = 18;
const DEFAULT_TEXT_ASCENT = 14;
const DEFAULT_FONT_WEIGHT = 400;

interface HlAttr {
  fg: number | undefined;
  bg: number | undefined;
  sp: number | undefined;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  reverse: boolean;
}

interface Cell {
  ch: string;
  hl: number;
}

interface Grid {
  id: number;
  w: number;
  h: number;
  cells: Cell[][];
}

interface Win {
  gridId: number;
  kind: "default" | "float" | "external" | "msg";
  row: number;
  col: number;
  zIndex: number;
  hidden: boolean;
}

interface Mods {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export class NeovimSource implements SceneSource {
  readonly kind = "neovim";

  private cwd: string;
  private proc: ChildProcess.ChildProcessWithoutNullStreams | null = null;
  private client: any = null;

  private viewport = { w: 800, h: 600 };
  private starting = false;
  private started = false;
  private shutdownRequested = false;

  private grids = new Map<number, Grid>();
  private windows = new Map<number, Win>();
  private hl = new Map<number, HlAttr>();
  private defaultColors = { fg: 0xe8e8ea, bg: 0x0e0f13, sp: 0xff453a };
  private cursor = { gridId: 1, row: 0, col: 0 };
  private modeInfo: Array<Record<string, unknown>> = [];
  private modeIdx = 0;
  private seq = 0;

  private cellW = DEFAULT_CELL_W;
  private cellH = DEFAULT_CELL_H;
  private cellAscent = DEFAULT_TEXT_ASCENT;
  private fontCss = DEFAULT_FONT;
  private fontWeight = DEFAULT_FONT_WEIGHT;
  private ligatures = true;

  // Damage tracking
  private flushPending = false;
  private dirtyRows = new Map<number, Set<number>>();
  private hlPending: HlAttrEntry[] = [];
  private defaultColorsChanged = false;
  private resizedGrids: ResizedGrid[] = [];
  private closedGrids = new Set<number>();
  private windowsChanged = false;
  private cursorChanged = false;
  private metricsSent = false;

  private readonly textBuffer: string[] = [];

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  shutdown(): void {
    this.shutdownRequested = true;
    if (this.proc) {
      try {
        this.proc.kill("SIGTERM");
      } catch (e) {
        console.warn("[neovimSource] kill failed:", e);
      }
    }
    this.client = null;
    this.proc = null;
    this.started = false;
  }

  setEditorFontMetrics(m: EditorFontMetrics): void {
    const sameMetrics =
      m.width === this.cellW &&
      m.height === this.cellH &&
      m.ascent === this.cellAscent &&
      m.font === this.fontCss &&
      m.fontWeight === this.fontWeight &&
      m.ligatures === this.ligatures;
    if (sameMetrics) return;
    this.cellW = Math.max(1, m.width);
    this.cellH = Math.max(1, m.height);
    this.cellAscent = m.ascent;
    this.fontCss = m.font;
    this.fontWeight = m.fontWeight;
    this.ligatures = m.ligatures;
    this.metricsSent = false;
    if (this.client) {
      const cols = Math.max(1, Math.floor(this.viewport.w / this.cellW));
      const rows = Math.max(1, Math.floor(this.viewport.h / this.cellH));
      this.client.request("nvim_ui_try_resize", [cols, rows]).catch((e: unknown) => {
        console.warn("[neovimSource] try_resize on metrics change failed:", e);
      });
    }
    this.flushPending = true;
  }

  handleInput(event: InputEvent): void {
    if (event.kind === "resize") {
      this.viewport = { w: event.w, h: event.h };
      const cols = Math.max(1, Math.floor(event.w / this.cellW));
      const rows = Math.max(1, Math.floor(event.h / this.cellH));
      if (this.client) {
        this.client.request("nvim_ui_try_resize", [cols, rows]).catch((e: unknown) => {
          console.warn("[neovimSource] try_resize failed:", e);
        });
      }
      return;
    }

    if (!this.started) {
      void this.ensureStarted();
      return;
    }

    if (event.kind === "key" && event.type === "down") {
      const keys = domKeyToVimNotation(event.key, event.mods);
      if (keys && this.client) {
        this.client.input(keys).catch((e: unknown) => {
          console.warn("[neovimSource] input failed:", e);
        });
      }
      return;
    }

    if (event.kind === "mouse" && this.client) {
      this.dispatchMouse(event);
    }
  }

  render(_dtMs: number): Frame | null {
    if (!this.started && !this.starting && !this.shutdownRequested) {
      void this.ensureStarted();
    }
    if (!this.flushPending && this.metricsSent) return null;
    this.flushPending = false;
    return this.buildFrame();
  }

  private async ensureStarted(): Promise<void> {
    if (this.started || this.starting || this.shutdownRequested) return;
    this.starting = true;
    try {
      const { attach } = await import("neovim");
      const nvimBin =
        process.env.PATH?.split(":")
          .map((p) => Path.join(p, "nvim"))
          .find((p) => FS.existsSync(p)) ?? "nvim";

      const proc = ChildProcess.spawn(nvimBin, ["--embed", "--cmd", "tnoremap <Esc> <C-\\><C-n>"], {
        cwd: this.cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });
      proc.on("error", (err) => console.error("[neovimSource] proc error:", err));
      proc.on("exit", (code, signal) => {
        console.log("[neovimSource] proc exit:", code, signal);
        this.started = false;
      });
      proc.stderr.on("data", (chunk) => {
        console.log("[neovimSource] stderr:", chunk.toString());
      });

      const client = attach({ proc });
      client.on("notification", (method: string, args: unknown) => {
        if (method === "redraw" && Array.isArray(args)) {
          this.applyRedraw(args as unknown[][]);
        }
      });

      this.proc = proc;
      this.client = client;

      const cols = Math.max(1, Math.floor(this.viewport.w / this.cellW));
      const rows = Math.max(1, Math.floor(this.viewport.h / this.cellH));
      const attachViewport = { w: this.viewport.w, h: this.viewport.h };

      await client.request("nvim_ui_attach", [
        cols,
        rows,
        { rgb: true, ext_linegrid: true, ext_multigrid: true },
      ]);
      try {
        await client.request("nvim_set_var", ["fenrir", true]);
      } catch (e) {
        console.warn("[neovimSource] set_var failed:", e);
      }
      try {
        await client.request("nvim_set_client_info", [
          "fenrir",
          { major: 0, minor: 1, patch: 0 },
          "ui",
          {},
          {},
        ]);
      } catch (e) {
        console.warn("[neovimSource] set_client_info failed:", e);
      }
      try {
        await client.request("nvim_exec_lua", [FENRIR_INIT_LUA, []]);
      } catch (e) {
        console.warn("[neovimSource] init lua failed:", e);
      }

      this.started = true;

      if (this.viewport.w !== attachViewport.w || this.viewport.h !== attachViewport.h) {
        const newCols = Math.max(1, Math.floor(this.viewport.w / this.cellW));
        const newRows = Math.max(1, Math.floor(this.viewport.h / this.cellH));
        client.request("nvim_ui_try_resize", [newCols, newRows]).catch((e: unknown) => {
          console.warn("[neovimSource] post-attach try_resize failed:", e);
        });
      }

      try {
        await client.command("redraw!");
      } catch (e) {
        console.warn("[neovimSource] initial redraw failed:", e);
      }
    } catch (err) {
      console.error("[neovimSource] start failed:", err);
    } finally {
      this.starting = false;
    }
  }

  private dispatchMouse(event: Extract<InputEvent, { kind: "mouse" }>): void {
    const grid = this.cursor.gridId;
    const win = this.windows.get(grid);
    const baseRow = win?.row ?? 0;
    const baseCol = win?.col ?? 0;
    const col = Math.max(0, Math.floor(event.x / this.cellW) - baseCol);
    const row = Math.max(0, Math.floor(event.y / this.cellH) - baseRow);
    const mod = modString(event.mods);

    if (event.type === "wheel") {
      const dy = event.deltaY ?? 0;
      const dx = event.deltaX ?? 0;
      let action: "up" | "down" | "left" | "right" | null = null;
      if (Math.abs(dy) >= Math.abs(dx)) {
        if (dy > 0) action = "down";
        else if (dy < 0) action = "up";
      } else {
        if (dx > 0) action = "right";
        else if (dx < 0) action = "left";
      }
      if (!action) return;
      this.client
        .request("nvim_input_mouse", ["wheel", action, mod, grid, row, col])
        .catch((e: unknown) => console.warn("[neovimSource] mouse wheel failed:", e));
      return;
    }

    let action: "press" | "release" | "drag" | null = null;
    if (event.type === "down") action = "press";
    else if (event.type === "up") action = "release";
    else if (event.type === "move") {
      if (event.button === undefined) return;
      action = "drag";
    }
    if (!action) return;

    const button = event.button === 1 ? "middle" : event.button === 2 ? "right" : "left";
    this.client
      .request("nvim_input_mouse", [button, action, mod, grid, row, col])
      .catch((e: unknown) => console.warn("[neovimSource] mouse failed:", e));
  }

  private buildFrame(): Frame | null {
    const frame: Frame = { kind: "neovim", seq: this.seq };
    let any = false;

    if (!this.metricsSent) {
      frame.cellMetrics = {
        width: this.cellW,
        height: this.cellH,
        ascent: this.cellAscent,
        font: this.fontCss,
        fontWeight: this.fontWeight,
        ligatures: this.ligatures,
      };
      this.metricsSent = true;
      any = true;
    }
    if (this.defaultColorsChanged) {
      frame.defaultColors = { ...this.defaultColors };
      this.defaultColorsChanged = false;
      any = true;
    }
    if (this.hlPending.length > 0) {
      frame.hl = this.hlPending;
      this.hlPending = [];
      any = true;
    }
    if (this.resizedGrids.length > 0) {
      frame.resizedGrids = this.resizedGrids;
      this.resizedGrids = [];
      any = true;
    }
    if (this.closedGrids.size > 0) {
      frame.closedGrids = [...this.closedGrids];
      this.closedGrids.clear();
      any = true;
    }

    const gridDeltas: GridDelta[] = [];
    for (const [gridId, rows] of this.dirtyRows) {
      if (rows.size === 0) continue;
      const grid = this.grids.get(gridId);
      if (!grid) {
        rows.clear();
        continue;
      }
      const rowDeltas: RowDelta[] = [];
      for (const r of rows) {
        if (r >= grid.h) continue;
        rowDeltas.push({ row: r, runs: this.buildRowRuns(grid, r) });
      }
      rows.clear();
      if (rowDeltas.length > 0) {
        gridDeltas.push({ gridId, rows: rowDeltas });
      }
    }
    if (gridDeltas.length > 0) {
      frame.gridDeltas = gridDeltas;
      any = true;
    }

    if (this.windowsChanged) {
      frame.windows = [...this.windows.values()].map((w) => ({
        gridId: w.gridId,
        kind: w.kind,
        row: w.row,
        col: w.col,
        zIndex: w.zIndex,
        hidden: w.hidden,
      })) satisfies WindowEntry[];
      this.windowsChanged = false;
      any = true;
    }

    if (this.cursorChanged) {
      const mode = this.modeInfo[this.modeIdx];
      const rawShape = (mode?.["cursor_shape"] as string | undefined) ?? "block";
      const shape = rawShape === "vertical" || rawShape === "horizontal" ? rawShape : "block";
      const cursorEntry: CursorEntry = {
        gridId: this.cursor.gridId,
        row: this.cursor.row,
        col: this.cursor.col,
        shape,
      };
      if (shape === "block") {
        const grid = this.grids.get(this.cursor.gridId);
        const cell = grid?.cells[this.cursor.row]?.[this.cursor.col];
        if (cell?.ch && cell.ch.length > 0) cursorEntry.text = cell.ch;
      }
      frame.cursor = cursorEntry;
      this.cursorChanged = false;
      any = true;
    }

    if (!any) return null;
    this.seq++;
    return frame;
  }

  private buildRowRuns(grid: Grid, r: number): CellRun[] {
    const row = grid.cells[r];
    if (!row) return [];
    const runs: CellRun[] = [];
    let c = 0;
    while (c < grid.w) {
      const cell = row[c]!;
      const hlId = cell.hl;
      let runEnd = c;
      const buf = this.textBuffer;
      buf.length = 0;
      while (runEnd < grid.w) {
        const ce = row[runEnd]!;
        if (ce.hl !== hlId) break;
        buf.push(ce.ch.length > 0 ? ce.ch : " ");
        runEnd++;
      }
      runs.push({ col: c, len: runEnd - c, text: buf.join(""), hlId });
      c = runEnd;
    }
    return runs;
  }

  private markRowDirty(gridId: number, row: number): void {
    let set = this.dirtyRows.get(gridId);
    if (!set) {
      set = new Set();
      this.dirtyRows.set(gridId, set);
    }
    set.add(row);
  }

  private markAllRowsDirty(gridId: number): void {
    const grid = this.grids.get(gridId);
    if (!grid) return;
    let set = this.dirtyRows.get(gridId);
    if (!set) {
      set = new Set();
      this.dirtyRows.set(gridId, set);
    }
    for (let r = 0; r < grid.h; r++) set.add(r);
  }

  private markEverythingDirty(): void {
    for (const id of this.grids.keys()) this.markAllRowsDirty(id);
  }

  private applyRedraw(batches: unknown[][]): void {
    for (const batch of batches) {
      if (!Array.isArray(batch) || batch.length === 0) continue;
      const name = batch[0];
      if (typeof name !== "string") continue;
      for (let i = 1; i < batch.length; i++) {
        const args = batch[i];
        if (Array.isArray(args)) this.applyEvent(name, args);
      }
    }
  }

  private applyEvent(name: string, args: unknown[]): void {
    switch (name) {
      case "default_colors_set": {
        const fg = args[0] as number;
        const bg = args[1] as number;
        const sp = args[2] as number;
        if (typeof fg === "number" && fg >= 0) this.defaultColors.fg = fg;
        if (typeof bg === "number" && bg >= 0) this.defaultColors.bg = bg;
        if (typeof sp === "number" && sp >= 0) this.defaultColors.sp = sp;
        this.defaultColorsChanged = true;
        this.markEverythingDirty();
        return;
      }
      case "hl_attr_define": {
        const id = args[0] as number;
        const a = (args[1] ?? {}) as Record<string, unknown>;
        const attr: HlAttr = {
          fg: typeof a["foreground"] === "number" ? (a["foreground"] as number) : undefined,
          bg: typeof a["background"] === "number" ? (a["background"] as number) : undefined,
          sp: typeof a["special"] === "number" ? (a["special"] as number) : undefined,
          bold: !!a["bold"],
          italic: !!a["italic"],
          underline: !!a["underline"],
          reverse: !!a["reverse"],
        };
        this.hl.set(id, attr);
        const entry: HlAttrEntry = { id };
        if (attr.fg !== undefined) entry.fg = attr.fg;
        if (attr.bg !== undefined) entry.bg = attr.bg;
        if (attr.sp !== undefined) entry.sp = attr.sp;
        if (attr.bold) entry.bold = true;
        if (attr.italic) entry.italic = true;
        if (attr.underline) entry.underline = true;
        if (attr.reverse) entry.reverse = true;
        this.hlPending.push(entry);
        return;
      }
      case "mode_info_set": {
        const list = args[1];
        this.modeInfo = Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
        this.cursorChanged = true;
        return;
      }
      case "mode_change": {
        const idx = args[1];
        if (typeof idx === "number") this.modeIdx = idx;
        this.cursorChanged = true;
        return;
      }
      case "grid_resize": {
        const id = args[0] as number;
        const w = args[1] as number;
        const h = args[2] as number;
        const existing = this.grids.get(id);
        const cells: Cell[][] = [];
        for (let r = 0; r < h; r++) {
          const row: Cell[] = [];
          for (let c = 0; c < w; c++) {
            const prev = existing?.cells[r]?.[c];
            row.push(prev ?? { ch: " ", hl: 0 });
          }
          cells.push(row);
        }
        this.grids.set(id, { id, w, h, cells });
        this.resizedGrids.push({ id, w, h });
        if (id === 1 && !this.windows.has(1)) {
          this.windows.set(1, {
            gridId: 1,
            kind: "default",
            row: 0,
            col: 0,
            zIndex: 0,
            hidden: false,
          });
          this.windowsChanged = true;
        }
        this.markAllRowsDirty(id);
        return;
      }
      case "grid_clear": {
        const id = args[0] as number;
        const grid = this.grids.get(id);
        if (!grid) return;
        for (let r = 0; r < grid.h; r++) {
          const row = grid.cells[r]!;
          for (let c = 0; c < grid.w; c++) {
            const cell = row[c]!;
            cell.ch = " ";
            cell.hl = 0;
          }
        }
        this.markAllRowsDirty(id);
        return;
      }
      case "grid_destroy": {
        const id = args[0] as number;
        this.grids.delete(id);
        this.windows.delete(id);
        this.dirtyRows.delete(id);
        this.closedGrids.add(id);
        this.windowsChanged = true;
        return;
      }
      case "grid_line": {
        const id = args[0] as number;
        const row = args[1] as number;
        const colStart = args[2] as number;
        const cells = args[3] as Array<[string, number?, number?]>;
        const grid = this.grids.get(id);
        if (!grid || !Array.isArray(cells)) return;
        const targetRow = grid.cells[row];
        if (!targetRow) return;
        let col = colStart;
        let lastHl = 0;
        for (let t = 0; t < cells.length; t++) {
          const triplet = cells[t];
          if (!Array.isArray(triplet)) continue;
          const ch = triplet[0] ?? " ";
          const hl = typeof triplet[1] === "number" ? triplet[1] : lastHl;
          lastHl = hl;
          const reps = typeof triplet[2] === "number" ? triplet[2] : 1;
          for (let i = 0; i < reps; i++) {
            if (col < grid.w) {
              const cell = targetRow[col]!;
              cell.ch = ch;
              cell.hl = hl;
            }
            col++;
          }
        }
        this.markRowDirty(id, row);
        return;
      }
      case "grid_scroll": {
        const id = args[0] as number;
        const top = args[1] as number;
        const bot = args[2] as number;
        const rows = args[5] as number;
        const grid = this.grids.get(id);
        if (!grid || rows === 0) return;
        if (rows > 0) {
          for (let r = top; r < bot - rows; r++) {
            const src = grid.cells[r + rows];
            const dst = grid.cells[r];
            if (!src || !dst) continue;
            for (let c = 0; c < grid.w; c++) {
              const s = src[c]!;
              const d = dst[c]!;
              d.ch = s.ch;
              d.hl = s.hl;
            }
          }
        } else {
          for (let r = bot - 1; r >= top - rows; r--) {
            const src = grid.cells[r + rows];
            const dst = grid.cells[r];
            if (!src || !dst) continue;
            for (let c = 0; c < grid.w; c++) {
              const s = src[c]!;
              const d = dst[c]!;
              d.ch = s.ch;
              d.hl = s.hl;
            }
          }
        }
        for (let r = top; r < bot; r++) this.markRowDirty(id, r);
        return;
      }
      case "grid_cursor_goto": {
        const id = args[0] as number;
        const row = args[1] as number;
        const col = args[2] as number;
        this.cursor = { gridId: id, row, col };
        this.cursorChanged = true;
        return;
      }
      case "win_pos": {
        const gridId = args[0] as number;
        const row = args[2] as number;
        const col = args[3] as number;
        const w = args[4] as number;
        const h = args[5] as number;
        const grid = this.grids.get(gridId);
        if (grid) {
          grid.w = w;
          grid.h = h;
        }
        this.windows.set(gridId, {
          gridId,
          kind: "default",
          row,
          col,
          zIndex: 1,
          hidden: false,
        });
        this.windowsChanged = true;
        return;
      }
      case "win_float_pos": {
        const gridId = args[0] as number;
        const anchor = args[2] as string;
        const anchorGrid = args[3] as number;
        const anchorRow = args[4] as number;
        const anchorCol = args[5] as number;
        const zindex = (args[7] as number) ?? 0;
        const anchorWin = this.windows.get(anchorGrid);
        const grid = this.grids.get(gridId);
        let row = (anchorWin?.row ?? 0) + anchorRow;
        let col = (anchorWin?.col ?? 0) + anchorCol;
        if (grid) {
          if (anchor === "NE" || anchor === "SE") col -= grid.w;
          if (anchor === "SW" || anchor === "SE") row -= grid.h;
        }
        this.windows.set(gridId, {
          gridId,
          kind: "float",
          row,
          col,
          zIndex: 50 + zindex,
          hidden: false,
        });
        this.windowsChanged = true;
        return;
      }
      case "win_external_pos": {
        const gridId = args[0] as number;
        this.windows.set(gridId, {
          gridId,
          kind: "external",
          row: 0,
          col: 0,
          zIndex: 25,
          hidden: false,
        });
        this.windowsChanged = true;
        return;
      }
      case "win_hide": {
        const gridId = args[0] as number;
        const win = this.windows.get(gridId);
        if (win) {
          win.hidden = true;
          this.windowsChanged = true;
        }
        return;
      }
      case "win_close": {
        const gridId = args[0] as number;
        if (this.windows.delete(gridId)) {
          this.windowsChanged = true;
        }
        return;
      }
      case "msg_set_pos": {
        const gridId = args[0] as number;
        const row = args[1] as number;
        this.windows.set(gridId, {
          gridId,
          kind: "msg",
          row,
          col: 0,
          zIndex: 100,
          hidden: false,
        });
        this.windowsChanged = true;
        return;
      }
      case "flush":
        this.flushPending = true;
        return;
      default:
        return;
    }
  }
}

function modString(mods: Mods): string {
  let s = "";
  if (mods.shift) s += "S";
  if (mods.ctrl) s += "C";
  if (mods.alt) s += "A";
  if (mods.meta) s += "M";
  return s;
}

const NAMED_KEYS: Record<string, string> = {
  Backspace: "BS",
  Delete: "Del",
  Tab: "Tab",
  Enter: "CR",
  Escape: "Esc",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Insert: "Insert",
  F1: "F1",
  F2: "F2",
  F3: "F3",
  F4: "F4",
  F5: "F5",
  F6: "F6",
  F7: "F7",
  F8: "F8",
  F9: "F9",
  F10: "F10",
  F11: "F11",
  F12: "F12",
};

function domKeyToVimNotation(key: string, mods: Mods): string | null {
  const named = NAMED_KEYS[key];
  const isPrintable = !named && key.length === 1;

  if (!named && (key === "Shift" || key === "Control" || key === "Alt" || key === "Meta")) {
    return null;
  }
  if (!named && !isPrintable) return null;

  const hasNonShiftMod = mods.ctrl || mods.alt || mods.meta;

  if (isPrintable && !hasNonShiftMod) {
    if (key === "<") return "<lt>";
    if (key === " ") return "<Space>";
    return key;
  }

  let prefix = "";
  if (mods.ctrl) prefix += "C-";
  if (mods.alt) prefix += "A-";
  if (mods.meta) prefix += "D-";
  if (mods.shift && named) prefix += "S-";

  const keyPart = named ?? (key === " " ? "Space" : key);
  return `<${prefix}${keyPart}>`;
}
