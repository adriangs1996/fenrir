---
depends_on: []
---

# Plan 05b: Redraw Event Types

## Goal

Define all TypeScript types for parsed neovim redraw events. Pure type module — no runtime code. Consumed by parser (05c), grid state (06), and renderer (07).

## Scope

- New file: `apps/web/src/modules/neovim-editor/protocol/RedrawParser.ts` (types section only — parser fns added in 05c)

## Steps

### Step 1. Create file with cell + grid event types

```typescript
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
```

### Step 2. Append highlight + mode types

```typescript
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
```

### Step 3. Append global + multigrid + misc events

```typescript
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
export interface BusyStartEvent { type: "busy_start"; }
export interface BusyStopEvent { type: "busy_stop"; }
export interface BellEvent { type: "bell"; }
export interface MouseOnEvent { type: "mouse_on"; }
export interface MouseOffEvent { type: "mouse_off"; }
export interface ChdirEvent {
  type: "chdir";
  path: string;
}
```

### Step 4. Union type

```typescript
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
```

## Validation

- `bun typecheck`

## Done Criteria

- All event interfaces exported
- `RedrawEvent` union covers 25 event types
- `HlAttr`, `ModeInfo`, `GridLineCell` helper types exported
- File contains zero runtime code (types/interfaces only)
