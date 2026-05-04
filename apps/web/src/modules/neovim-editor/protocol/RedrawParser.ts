// ── Grid cell ──

export interface GridLineCell {
  text: string;
  hlId: number;
  repeat: number;
}

// ── Grid events ──

export interface GridLineEvent {
  type: "grid_line";
  grid: number;
  row: number;
  colStart: number;
  cells: GridLineCell[];
  wrap: boolean;
}

export interface GridResizeEvent {
  type: "grid_resize";
  grid: number;
  width: number;
  height: number;
}

export interface GridScrollEvent {
  type: "grid_scroll";
  grid: number;
  top: number;
  bot: number;
  left: number;
  right: number;
  rows: number;
  cols: number;
}

export interface GridClearEvent {
  type: "grid_clear";
  grid: number;
}

export interface GridCursorGotoEvent {
  type: "grid_cursor_goto";
  grid: number;
  row: number;
  col: number;
}

export interface GridDestroyEvent {
  type: "grid_destroy";
  grid: number;
}

// ── Highlight attributes ──

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
  altfont?: boolean;
  dim?: boolean;
  blend?: number;
  url?: string;
}

export interface HlAttrDefineEvent {
  type: "hl_attr_define";
  id: number;
  rgbAttr: HlAttr;
  ctermAttr: Record<string, unknown>;
  info: unknown[];
}

export interface DefaultColorsSetEvent {
  type: "default_colors_set";
  rgbFg: number;
  rgbBg: number;
  rgbSp: number;
  ctermFg: number;
  ctermBg: number;
}

// ── Mode info ──

export interface ModeInfo {
  cursorShape: "block" | "horizontal" | "vertical";
  cellPercentage: number;
  blinkwait: number;
  blinkon: number;
  blinkoff: number;
  attrId: number;
  attrIdLm: number;
  shortName: string;
  name: string;
}

export interface ModeInfoSetEvent {
  type: "mode_info_set";
  cursorStyleEnabled: boolean;
  modeInfo: ModeInfo[];
}

export interface ModeChangeEvent {
  type: "mode_change";
  modeName: string;
  modeIdx: number;
}

// ── Global ──

export interface FlushEvent {
  type: "flush";
}

export interface OptionSetEvent {
  type: "option_set";
  name: string;
  value: unknown;
}

// ── Multigrid window events ──

export interface WinPosEvent {
  type: "win_pos";
  grid: number;
  win: number;
  startRow: number;
  startCol: number;
  width: number;
  height: number;
}

export interface WinFloatPosEvent {
  type: "win_float_pos";
  grid: number;
  win: number;
  anchor: string;
  anchorGrid: number;
  anchorRow: number;
  anchorCol: number;
  focusable: boolean;
  zindex: number;
}

export interface WinHideEvent {
  type: "win_hide";
  grid: number;
}

export interface WinCloseEvent {
  type: "win_close";
  grid: number;
}

export interface WinViewportEvent {
  type: "win_viewport";
  grid: number;
  win: number;
  topline: number;
  botline: number;
  curline: number;
  curcol: number;
  lineCount: number;
  scrollDelta: number;
}

export interface MsgSetPosEvent {
  type: "msg_set_pos";
  grid: number;
  row: number;
  scrolled: boolean;
  sepChar: string;
}

// ── Misc ──

export interface SetTitleEvent {
  type: "set_title";
  title: string;
}
export interface BusyStartEvent {
  type: "busy_start";
}
export interface BusyStopEvent {
  type: "busy_stop";
}
export interface BellEvent {
  type: "bell";
}
export interface MouseOnEvent {
  type: "mouse_on";
}
export interface MouseOffEvent {
  type: "mouse_off";
}
export interface ChdirEvent {
  type: "chdir";
  path: string;
}

// ── Union ──

export type RedrawEvent =
  | GridLineEvent
  | GridResizeEvent
  | GridScrollEvent
  | GridClearEvent
  | GridCursorGotoEvent
  | GridDestroyEvent
  | HlAttrDefineEvent
  | DefaultColorsSetEvent
  | ModeInfoSetEvent
  | ModeChangeEvent
  | FlushEvent
  | OptionSetEvent
  | WinPosEvent
  | WinFloatPosEvent
  | WinHideEvent
  | WinCloseEvent
  | WinViewportEvent
  | MsgSetPosEvent
  | SetTitleEvent
  | BusyStartEvent
  | BusyStopEvent
  | BellEvent
  | MouseOnEvent
  | MouseOffEvent
  | ChdirEvent;

// ── Parser ──

export function parseRedrawBatch(rawEvents: unknown[]): RedrawEvent[] {
  const result: RedrawEvent[] = [];

  for (const raw of rawEvents) {
    if (!Array.isArray(raw) || raw.length === 0) continue;
    const [type, ...argSets] = raw as [string, ...unknown[][]];

    // Zero-parameter events always arrive with one empty argSet, but guard
    // defensively so they're never silently dropped if argSets is empty.
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
    case "grid_resize":
      return { type: "grid_resize", grid: a[0] as number, width: a[1] as number, height: a[2] as number };

    case "grid_line": {
      const rawCells = (a[3] ?? []) as unknown[][];
      const cells: GridLineCell[] = [];
      let lastHlId = 0;
      for (const c of rawCells) {
        if (!Array.isArray(c)) continue;
        const hlId = c[1] !== undefined ? (c[1] as number) : lastHlId;
        lastHlId = hlId;
        cells.push({ text: c[0] as string, hlId, repeat: (c[2] as number | undefined) ?? 1 });
      }
      return { type: "grid_line", grid: a[0] as number, row: a[1] as number, colStart: a[2] as number, cells, wrap: (a[4] as boolean | undefined) ?? false };
    }

    case "grid_clear":
      return { type: "grid_clear", grid: a[0] as number };

    case "grid_destroy":
      return { type: "grid_destroy", grid: a[0] as number };

    case "grid_cursor_goto":
      return { type: "grid_cursor_goto", grid: a[0] as number, row: a[1] as number, col: a[2] as number };

    case "grid_scroll":
      return { type: "grid_scroll", grid: a[0] as number, top: a[1] as number, bot: a[2] as number, left: a[3] as number, right: a[4] as number, rows: a[5] as number, cols: (a[6] as number | undefined) ?? 0 };

    case "hl_attr_define":
      return { type: "hl_attr_define", id: a[0] as number, rgbAttr: (a[1] ?? {}) as HlAttr, ctermAttr: (a[2] ?? {}) as Record<string, unknown>, info: (a[3] ?? []) as unknown[] };

    case "default_colors_set":
      return { type: "default_colors_set", rgbFg: a[0] as number, rgbBg: a[1] as number, rgbSp: a[2] as number, ctermFg: a[3] as number, ctermBg: a[4] as number };

    case "mode_info_set": {
      const rawModes = (a[1] ?? []) as Record<string, unknown>[];
      const modeInfo: ModeInfo[] = rawModes.map((m) => ({
        cursorShape: (m["cursor_shape"] as ModeInfo["cursorShape"]) ?? "block",
        cellPercentage: (m["cell_percentage"] as number | undefined) ?? 100,
        blinkwait: (m["blinkwait"] as number | undefined) ?? 0,
        blinkon: (m["blinkon"] as number | undefined) ?? 0,
        blinkoff: (m["blinkoff"] as number | undefined) ?? 0,
        attrId: (m["attr_id"] as number | undefined) ?? 0,
        attrIdLm: (m["attr_id_lm"] as number | undefined) ?? 0,
        shortName: (m["short_name"] as string | undefined) ?? "",
        name: (m["name"] as string | undefined) ?? "",
      }));
      return { type: "mode_info_set", cursorStyleEnabled: a[0] as boolean, modeInfo };
    }

    case "mode_change":
      return { type: "mode_change", modeName: a[0] as string, modeIdx: a[1] as number };

    case "flush":
      return { type: "flush" };

    case "option_set":
      return { type: "option_set", name: a[0] as string, value: a[1] };

    case "set_title":
      return { type: "set_title", title: a[0] as string };

    case "busy_start":
      return { type: "busy_start" };

    case "busy_stop":
      return { type: "busy_stop" };

    case "bell":
    case "visual_bell":
      return { type: "bell" };

    case "mouse_on":
      return { type: "mouse_on" };

    case "mouse_off":
      return { type: "mouse_off" };

    case "chdir":
      return { type: "chdir", path: a[0] as string };

    case "win_pos":
      return { type: "win_pos", grid: a[0] as number, win: a[1] as number, startRow: a[2] as number, startCol: a[3] as number, width: a[4] as number, height: a[5] as number };

    case "win_float_pos":
      return { type: "win_float_pos", grid: a[0] as number, win: a[1] as number, anchor: a[2] as string, anchorGrid: a[3] as number, anchorRow: a[4] as number, anchorCol: a[5] as number, focusable: a[6] as boolean, zindex: a[7] as number };

    case "win_hide":
      return { type: "win_hide", grid: a[0] as number };

    case "win_close":
      return { type: "win_close", grid: a[0] as number };

    case "win_viewport":
      return { type: "win_viewport", grid: a[0] as number, win: a[1] as number, topline: a[2] as number, botline: a[3] as number, curline: a[4] as number, curcol: a[5] as number, lineCount: a[6] as number, scrollDelta: a[7] as number };

    case "msg_set_pos":
      return { type: "msg_set_pos", grid: a[0] as number, row: a[1] as number, scrolled: a[2] as boolean, sepChar: a[3] as string };

    default:
      return null;
  }
}
