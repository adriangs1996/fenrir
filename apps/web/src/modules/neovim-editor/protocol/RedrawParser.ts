/**
 * Neovim `redraw` notification parser. Single-grid scope (no ext_multigrid):
 * grid is always 1 and the field is dropped from the parsed shape.
 *
 * Spec: https://neovim.io/doc/user/ui.html
 *
 * The `redraw` notification's payload is an array of event groups:
 *   [["event_name", arg_set_1, arg_set_2, ...], ...]
 *
 * Each `arg_set_N` is one independent invocation of the same event. Some
 * events (`flush`, `bell`, `mouse_on`, ...) take no args and arrive with a
 * single empty arg set.
 */
const PRIMARY_GRID = 1;

// ── Cell + highlight ──────────────────────────────────────────────────────

export interface GridLineCell {
  /** Glyph text. Empty string means "continuation cell of the previous wide char". */
  text: string;
  hlId: number;
  /** Repeat the previous cell n-1 more times. Defaults to 1. */
  repeat: number;
}

export interface HlAttr {
  foreground?: number;
  background?: number;
  special?: number;
  reverse?: boolean;
  italic?: boolean;
  bold?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  undercurl?: boolean;
  underdouble?: boolean;
  underdotted?: boolean;
  underdashed?: boolean;
  blend?: number;
  url?: string;
}

// ── Mode info ─────────────────────────────────────────────────────────────

export interface ModeInfo {
  cursorShape: "block" | "horizontal" | "vertical";
  cellPercentage: number;
  blinkwait: number;
  blinkon: number;
  blinkoff: number;
  /** Highlight id to colour the cursor with; 0 = use default (reverse). */
  attrId: number;
  name: string;
}

// ── Events (only those emitted in single-grid mode) ───────────────────────

export type RedrawEvent =
  | { type: "grid_resize"; width: number; height: number }
  | { type: "grid_clear" }
  | { type: "grid_cursor_goto"; row: number; col: number }
  | { type: "grid_line"; row: number; colStart: number; cells: GridLineCell[] }
  | {
      type: "grid_scroll";
      top: number;
      bot: number;
      left: number;
      right: number;
      rows: number;
    }
  | { type: "hl_attr_define"; id: number; rgbAttr: HlAttr }
  | { type: "default_colors_set"; rgbFg: number; rgbBg: number; rgbSp: number }
  | { type: "mode_info_set"; modeInfo: ModeInfo[] }
  | { type: "mode_change"; modeIdx: number; modeName: string }
  | { type: "flush" }
  | { type: "set_title"; title: string }
  | { type: "busy_start" }
  | { type: "busy_stop" }
  | { type: "bell" };

// ── Parser ────────────────────────────────────────────────────────────────

export function parseRedrawBatch(rawEvents: unknown[]): RedrawEvent[] {
  const result: RedrawEvent[] = [];
  for (const raw of rawEvents) {
    if (!Array.isArray(raw) || raw.length === 0) continue;
    const [type, ...argSets] = raw as [string, ...unknown[][]];
    if (typeof type !== "string") continue;
    if (argSets.length === 0) {
      const ev = parseOne(type, []);
      if (ev) result.push(ev);
      continue;
    }
    for (const a of argSets) {
      const ev = parseOne(type, Array.isArray(a) ? a : []);
      if (ev) result.push(ev);
    }
  }
  return result;
}

function parseOne(type: string, a: unknown[]): RedrawEvent | null {
  switch (type) {
    case "grid_resize": {
      if (asNumber(a[0]) !== PRIMARY_GRID) return null;
      return { type: "grid_resize", width: asNumber(a[1]), height: asNumber(a[2]) };
    }

    case "grid_clear": {
      if (asNumber(a[0]) !== PRIMARY_GRID) return null;
      return { type: "grid_clear" };
    }

    case "grid_cursor_goto": {
      if (asNumber(a[0]) !== PRIMARY_GRID) return null;
      return { type: "grid_cursor_goto", row: asNumber(a[1]), col: asNumber(a[2]) };
    }

    case "grid_line": {
      if (asNumber(a[0]) !== PRIMARY_GRID) return null;
      const rawCells = (a[3] ?? []) as unknown[][];
      const cells: GridLineCell[] = [];
      let lastHlId = 0;
      for (const c of rawCells) {
        if (!Array.isArray(c)) continue;
        const text = typeof c[0] === "string" ? c[0] : "";
        // Per spec: hl_id is omitted when unchanged from previous cell.
        // `typeof === "number"` catches both omitted (undefined) and
        // null/garbage values; in all those cases we want the default.
        const hlId = typeof c[1] === "number" ? c[1] : lastHlId;
        lastHlId = hlId;
        const repeat = typeof c[2] === "number" && c[2] >= 1 ? c[2] : 1;
        cells.push({ text, hlId, repeat });
      }
      return {
        type: "grid_line",
        row: asNumber(a[1]),
        colStart: asNumber(a[2]),
        cells,
      };
    }

    case "grid_scroll": {
      if (asNumber(a[0]) !== PRIMARY_GRID) return null;
      return {
        type: "grid_scroll",
        top: asNumber(a[1]),
        bot: asNumber(a[2]),
        left: asNumber(a[3]),
        right: asNumber(a[4]),
        rows: asNumber(a[5]),
      };
    }

    case "hl_attr_define":
      return {
        type: "hl_attr_define",
        id: asNumber(a[0]),
        rgbAttr: (a[1] ?? {}) as HlAttr,
      };

    case "default_colors_set":
      return {
        type: "default_colors_set",
        rgbFg: asNumber(a[0]),
        rgbBg: asNumber(a[1]),
        rgbSp: asNumber(a[2]),
      };

    case "mode_info_set": {
      const rawModes = (a[1] ?? []) as Record<string, unknown>[];
      const modeInfo = rawModes.map((m) => ({
        cursorShape: (m["cursor_shape"] as ModeInfo["cursorShape"] | undefined) ?? "block",
        cellPercentage: asNumber(m["cell_percentage"], 100),
        blinkwait: asNumber(m["blinkwait"], 0),
        blinkon: asNumber(m["blinkon"], 0),
        blinkoff: asNumber(m["blinkoff"], 0),
        attrId: asNumber(m["attr_id"], 0),
        name: typeof m["name"] === "string" ? (m["name"] as string) : "",
      }));
      return { type: "mode_info_set", modeInfo };
    }

    case "mode_change":
      return {
        type: "mode_change",
        modeName: typeof a[0] === "string" ? a[0] : "",
        modeIdx: asNumber(a[1]),
      };

    case "flush":
      return { type: "flush" };

    case "set_title":
      return { type: "set_title", title: typeof a[0] === "string" ? a[0] : "" };

    case "busy_start":
      return { type: "busy_start" };
    case "busy_stop":
      return { type: "busy_stop" };
    case "bell":
    case "visual_bell":
      return { type: "bell" };

    // Events we deliberately ignore in single-grid mode:
    //   grid_destroy, win_*, msg_*, win_viewport*, mouse_on, mouse_off,
    //   chdir, option_set, set_icon, hl_group_set, suspend, update_*
    default:
      return null;
  }
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
