---
depends_on:
  - neovim-05b-redraw-types
---

# Plan 05c: Redraw Batch Parser

## Goal

Append `parseRedrawBatch` and per-event parser functions to `RedrawParser.ts`. Converts neovim's array-of-arrays redraw payload into typed `RedrawEvent` objects.

## Scope

- Modify: `apps/web/src/modules/neovim-editor/protocol/RedrawParser.ts` (extend file from 05b)

## Steps

### Step 1. Append batch parser

```typescript
// ─── Parser ──────────────────────────────────────────────────────

/**
 * Parse a "redraw" notification's params array into typed events.
 *
 * Wire format from neovim:
 *   [2, "redraw", [[eventName, ...paramSets], ...]]
 *
 * The OUTER array is the batch.
 * Each inner element is `[eventName, paramSet1, paramSet2, ...]`.
 * One event group can carry multiple parameter sets (e.g. multiple
 * `grid_line` calls share one group head).
 */
export function parseRedrawBatch(batch: unknown[]): RedrawEvent[] {
  const events: RedrawEvent[] = [];

  for (const eventGroup of batch) {
    const group = eventGroup as unknown[];
    const name = group[0] as string;

    for (let i = 1; i < group.length; i++) {
      const params = group[i] as unknown[];
      const event = parseEvent(name, params);
      if (event) events.push(event);
    }
  }

  return events;
}
```

### Step 2. Append `parseEvent` dispatcher

```typescript
function parseEvent(name: string, params: unknown[]): RedrawEvent | null {
  switch (name) {
    case "grid_line":
      return parseGridLine(params);
    case "grid_resize":
      return {
        type: "grid_resize",
        grid: params[0] as number,
        width: params[1] as number,
        height: params[2] as number,
      };
    case "grid_scroll":
      return {
        type: "grid_scroll",
        grid: params[0] as number,
        top: params[1] as number,
        bot: params[2] as number,
        left: params[3] as number,
        right: params[4] as number,
        rows: params[5] as number,
        cols: params[6] as number,
      };
    case "grid_clear":
      return { type: "grid_clear", grid: params[0] as number };
    case "grid_cursor_goto":
      return {
        type: "grid_cursor_goto",
        grid: params[0] as number,
        row: params[1] as number,
        col: params[2] as number,
      };
    case "grid_destroy":
      return { type: "grid_destroy", grid: params[0] as number };
    case "hl_attr_define":
      return parseHlAttrDefine(params);
    case "default_colors_set":
      return {
        type: "default_colors_set",
        rgbFg: params[0] as number,
        rgbBg: params[1] as number,
        rgbSp: params[2] as number,
        ctermFg: params[3] as number,
        ctermBg: params[4] as number,
      };
    case "mode_info_set":
      return parseModeInfoSet(params);
    case "mode_change":
      return {
        type: "mode_change",
        modeName: params[0] as string,
        modeIdx: params[1] as number,
      };
    case "flush":
      return { type: "flush" };
    case "option_set":
      return { type: "option_set", name: params[0] as string, value: params[1] };
    case "win_pos":
      return {
        type: "win_pos",
        grid: params[0] as number,
        win: params[1] as number,
        startRow: params[2] as number,
        startCol: params[3] as number,
        width: params[4] as number,
        height: params[5] as number,
      };
    case "win_float_pos":
      return {
        type: "win_float_pos",
        grid: params[0] as number,
        win: params[1] as number,
        anchor: params[2] as string,
        anchorGrid: params[3] as number,
        anchorRow: params[4] as number,
        anchorCol: params[5] as number,
        focusable: params[6] as boolean,
        zindex: params[7] as number,
      };
    case "win_hide":
      return { type: "win_hide", grid: params[0] as number };
    case "win_close":
      return { type: "win_close", grid: params[0] as number };
    case "win_viewport":
      return {
        type: "win_viewport",
        grid: params[0] as number,
        win: params[1] as number,
        topline: params[2] as number,
        botline: params[3] as number,
        curline: params[4] as number,
        curcol: params[5] as number,
        lineCount: params[6] as number,
        scrollDelta: params[7] as number,
      };
    case "msg_set_pos":
      return {
        type: "msg_set_pos",
        grid: params[0] as number,
        row: params[1] as number,
        scrolled: params[2] as boolean,
        sepChar: params[3] as string,
      };
    case "set_title":
      return { type: "set_title", title: params[0] as string };
    case "busy_start":
      return { type: "busy_start" };
    case "busy_stop":
      return { type: "busy_stop" };
    case "bell":
      return { type: "bell" };
    case "mouse_on":
      return { type: "mouse_on" };
    case "mouse_off":
      return { type: "mouse_off" };
    case "chdir":
      return { type: "chdir", path: params[0] as string };
    default:
      return null; // Forward-compatible
  }
}
```

### Step 3. Append `parseGridLine` (cell hl_id inheritance + repeat)

```typescript
function parseGridLine(params: unknown[]): GridLineEvent {
  const rawCells = params[3] as unknown[][];
  let lastHlId = 0;
  const cells: GridLineCell[] = [];

  for (const cell of rawCells) {
    const text = cell[0] as string;
    const hlId = cell.length >= 2 ? (cell[1] as number) : lastHlId;
    const repeat = cell.length >= 3 ? (cell[2] as number) : 1;
    lastHlId = hlId;
    cells.push({ text, hlId, repeat });
  }

  return {
    type: "grid_line",
    grid: params[0] as number,
    row: params[1] as number,
    colStart: params[2] as number,
    cells,
    wrap: (params[4] as boolean) ?? false,
  };
}
```

### Step 4. Append `parseHlAttrDefine`

```typescript
function parseHlAttrDefine(params: unknown[]): HlAttrDefineEvent {
  return {
    type: "hl_attr_define",
    id: params[0] as number,
    rgbAttr: (params[1] ?? {}) as HlAttr,
    ctermAttr: (params[2] ?? {}) as Record<string, unknown>,
    info: (params[3] ?? []) as unknown[],
  };
}
```

### Step 5. Append `parseModeInfoSet`

```typescript
function parseModeInfoSet(params: unknown[]): ModeInfoSetEvent {
  const cursorStyleEnabled = params[0] as boolean;
  const rawModes = params[1] as Array<Record<string, unknown>>;
  const modeInfo: ModeInfo[] = rawModes.map((m) => ({
    cursorShape: (m.cursor_shape as ModeInfo["cursorShape"]) ?? "block",
    cellPercentage: (m.cell_percentage as number) ?? 100,
    blinkwait: (m.blinkwait as number) ?? 0,
    blinkon: (m.blinkon as number) ?? 0,
    blinkoff: (m.blinkoff as number) ?? 0,
    attrId: (m.attr_id as number) ?? 0,
    attrIdLm: (m.attr_id_lm as number) ?? 0,
    shortName: (m.short_name as string) ?? "",
    name: (m.name as string) ?? "",
  }));
  return { type: "mode_info_set", cursorStyleEnabled, modeInfo };
}
```

## Validation

- `bun typecheck`
- Tests come in 05e

## Done Criteria

- `parseRedrawBatch` exported
- `parseEvent` dispatch covers 25 event types
- `parseGridLine` inherits hl_id from previous cell when omitted; expands repeat
- `parseHlAttrDefine` and `parseModeInfoSet` snake_case → camelCase
- Unknown events return `null` (forward compatible)
