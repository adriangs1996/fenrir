// Lightweight debug instrumentation for the neovim-editor module.
//
// Enable with `?nvimDebug=1` in the URL or `localStorage.setItem("nvimDebug","1")`.
// All public APIs no-op when disabled, so wiring them in is cheap.

import type { GridState, ModeInfo } from "../protocol/RedrawParser";

export interface KeyEntry {
  raw: string;
  translated: string;
  ts: number;
  hadHandle: boolean;
}

export interface GridSummary {
  id: number;
  width: number;
  height: number;
  startRow: number;
  startCol: number;
  hasCursor: boolean;
  hidden: boolean;
  isFloat: boolean;
  zindex: number;
  compindex: number;
}

export interface DebugStats {
  bridgePresent: boolean;
  attached: boolean;
  attachError: string | null;
  containerFocused: boolean;
  cwd: string;
  cols: number;
  rows: number;
  defaultFg: string;
  defaultBg: string;
  activeModeIdx: number;
  modeName: string;
  cursorShape: string;
  cellPercentage: number;
  cursorGrid: number;
  cursorRow: number;
  cursorCol: number;
  eventCounts: Record<string, number>;
  rawEventCounts: Record<string, number>;
  keys: KeyEntry[];
  grids: GridSummary[];
  lastFlushAt: number;
  lastScroll: {
    grid: number;
    top: number;
    bot: number;
    left: number;
    right: number;
    rows: number;
  } | null;
  framesDrawn: number;
  lastDrawAt: number;
  canvasWidth: number;
  canvasHeight: number;
  canvasResizes: number;
}

const stats: DebugStats = {
  bridgePresent: false,
  attached: false,
  attachError: null,
  containerFocused: false,
  cwd: "",
  cols: 0,
  rows: 0,
  defaultFg: "",
  defaultBg: "",
  activeModeIdx: 0,
  modeName: "",
  cursorShape: "",
  cellPercentage: 0,
  cursorGrid: 0,
  cursorRow: 0,
  cursorCol: 0,
  eventCounts: {},
  rawEventCounts: {},
  keys: [],
  grids: [],
  lastFlushAt: 0,
  lastScroll: null,
  framesDrawn: 0,
  lastDrawAt: 0,
  canvasWidth: 0,
  canvasHeight: 0,
  canvasResizes: 0,
};

const listeners = new Set<() => void>();
let cachedEnabled: boolean | null = null;

// Module-instance fingerprint. If the same `import "../debug/debug"` ends up
// loaded twice (Vite optimizeDeps quirk, etc.) the HUD and the setters would
// see different `stats` objects. Display this in the overlay so we can verify
// at a glance that there's only one instance.
export const moduleId = Math.random().toString(36).slice(2, 8);
let setterCount = 0;
export function getSetterCount() {
  return setterCount;
}

export function debugEnabled(): boolean {
  if (cachedEnabled !== null) return cachedEnabled;
  if (typeof window === "undefined") {
    cachedEnabled = false;
    return false;
  }
  let on = false;
  try {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("nvimDebug") === "1") on = true;
  } catch {
    // ignore
  }
  if (!on) {
    try {
      on = window.localStorage.getItem("nvimDebug") === "1";
    } catch {
      // ignore
    }
  }
  cachedEnabled = on;
  return on;
}

export function debugLog(channel: string, ...args: unknown[]) {
  if (!debugEnabled()) return;
  console.log(`[nvim:${channel}]`, ...args);
}

export function debugWarn(channel: string, ...args: unknown[]) {
  if (!debugEnabled()) return;
  console.warn(`[nvim:${channel}]`, ...args);
}

export function getDebugStats(): DebugStats {
  return stats;
}

export function subscribeDebug(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify() {
  setterCount++;
  if (!debugEnabled()) return;
  // Diagnostic: prove notify is actually running in the same module the HUD reads.
  if (setterCount <= 5 || setterCount % 25 === 0) {
    console.log(`[nvim:notify] #${setterCount} mod=${moduleId} listeners=${listeners.size}`);
  }
  for (const fn of listeners) fn();
}

export function recordEvent(type: string) {
  if (!debugEnabled()) return;
  stats.eventCounts[type] = (stats.eventCounts[type] ?? 0) + 1;
}

export function recordRawEvent(type: string) {
  if (!debugEnabled()) return;
  stats.rawEventCounts[type] = (stats.rawEventCounts[type] ?? 0) + 1;
}

export function recordKey(raw: string, translated: string, hadHandle: boolean) {
  if (!debugEnabled()) return;
  stats.keys.unshift({ raw, translated, ts: Date.now(), hadHandle });
  if (stats.keys.length > 20) stats.keys.length = 20;
  notify();
}

export function setBridge(present: boolean) {
  stats.bridgePresent = present;
  notify();
}

export function setAttached(ok: boolean, err: string | null = null) {
  stats.attached = ok;
  stats.attachError = err;
  notify();
}

export function setFocus(focused: boolean) {
  stats.containerFocused = focused;
  notify();
}

export function setCwd(cwd: string) {
  stats.cwd = cwd;
  notify();
}

export function setDims(cols: number, rows: number) {
  stats.cols = cols;
  stats.rows = rows;
  notify();
}

export function setDefaultColors(fg: string, bg: string) {
  stats.defaultFg = fg;
  stats.defaultBg = bg;
  notify();
}

export function setMode(idx: number, info: ModeInfo | undefined) {
  stats.activeModeIdx = idx;
  stats.modeName = info?.name ?? "";
  stats.cursorShape = info?.cursorShape ?? "";
  stats.cellPercentage = info?.cellPercentage ?? 0;
  notify();
}

export function setCursor(grid: number, row: number, col: number) {
  stats.cursorGrid = grid;
  stats.cursorRow = row;
  stats.cursorCol = col;
  notify();
}

export function recordScroll(
  grid: number,
  top: number,
  bot: number,
  left: number,
  right: number,
  rows: number,
) {
  if (!debugEnabled()) return;
  stats.lastScroll = { grid, top, bot, left, right, rows };
  notify();
}

export function recordDraw(canvasW: number, canvasH: number) {
  if (!debugEnabled()) return;
  stats.framesDrawn++;
  stats.lastDrawAt = Date.now();
  if (stats.canvasWidth !== canvasW || stats.canvasHeight !== canvasH) {
    if (stats.canvasWidth !== 0 || stats.canvasHeight !== 0) {
      stats.canvasResizes++;
    }
    stats.canvasWidth = canvasW;
    stats.canvasHeight = canvasH;
  }
}

export function snapshotGrids(grids: (GridState | undefined)[]) {
  if (!debugEnabled()) return;
  const out: GridSummary[] = [];
  for (let id = 0; id < grids.length; id++) {
    const g = grids[id];
    if (!g) continue;
    out.push({
      id,
      width: g.width,
      height: g.height,
      startRow: g.startRow,
      startCol: g.startCol,
      hasCursor: g.hasCursor,
      hidden: g.hidden,
      isFloat: g.isFloat,
      zindex: g.zindex,
      compindex: g.compindex,
    });
  }
  stats.grids = out;
  stats.lastFlushAt = Date.now();
  notify();
}
