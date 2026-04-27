---
depends_on:
  - neovim-06b-grid-event-handlers
---

# Plan 06c: Window + Mode + Global Event Handlers

## Goal

Append handlers for `mode_info_set`, `mode_change`, `option_set`, `flush`, `win_pos`, `win_float_pos`, `win_hide`, `win_close`, `win_viewport`, `set_title`, `busy_start`, `busy_stop`, `bell`, `mouse_on`, `mouse_off`, `chdir` to GridStateManager.

## Scope

- Modify: `apps/web/src/modules/neovim-editor/renderer/GridState.ts`

## Steps

### Step 1. Extend imports

Add to existing event-type import:

```typescript
import type {
  // ...existing...
  ModeInfoSetEvent, ModeChangeEvent, OptionSetEvent,
  WinPosEvent, WinFloatPosEvent, WinHideEvent, WinCloseEvent, WinViewportEvent,
  SetTitleEvent,
} from "../protocol/RedrawParser";
```

### Step 2. Extend dispatcher switch

Add cases (alongside grid cases from 06b):

```typescript
case "mode_info_set":  this.handleModeInfoSet(event); break;
case "mode_change":    this.handleModeChange(event); break;
case "option_set":     this.handleOptionSet(event); break;
case "flush":          this.handleFlush(); break;
case "win_pos":        this.handleWinPos(event); break;
case "win_float_pos":  this.handleWinFloatPos(event); break;
case "win_hide":       this.handleWinHide(event); break;
case "win_close":      this.handleWinClose(event); break;
case "win_viewport":   /* no-op for now; reserved for smooth scroll */ break;
case "set_title":      this.title = event.title; break;
case "busy_start":     this.cursor.visible = false; break;
case "busy_stop":      this.cursor.visible = true; break;
case "bell":           this.onBell?.(); break;
case "mouse_on":       this.mouseEnabled = true; break;
case "mouse_off":      this.mouseEnabled = false; break;
case "chdir":          /* opt-in: store cwd if needed */ break;
```

### Step 3. Append handler methods

```typescript
private handleModeInfoSet(event: ModeInfoSetEvent): void {
  this.modeInfo = event.modeInfo;
}

private handleModeChange(event: ModeChangeEvent): void {
  this.currentModeIdx = event.modeIdx;
}

private handleOptionSet(_event: OptionSetEvent): void {
  // Hook for guifont, etc. Renderer reads from outside if needed.
  // No-op for state mgmt.
}

private handleFlush(): void {
  this.onFlush?.();
}

private handleWinPos(event: WinPosEvent): void {
  const grid = this.grids.get(event.grid);
  if (!grid) return;
  grid.winId = event.win;
  grid.startRow = event.startRow;
  grid.startCol = event.startCol;
  grid.isFloat = false;
  grid.hidden = false;
  grid.zindex = 0;
  // Resize if changed
  if (grid.width !== event.width || grid.height !== event.height) {
    this.resizeGrid(grid, event.width, event.height);
  }
}

private handleWinFloatPos(event: WinFloatPosEvent): void {
  const grid = this.grids.get(event.grid);
  if (!grid) return;
  grid.winId = event.win;
  grid.isFloat = true;
  grid.hidden = false;
  grid.zindex = event.zindex;

  // Compute float position from anchorGrid + anchorRow/Col + anchor (NW/NE/SW/SE)
  const anchorGrid = this.grids.get(event.anchorGrid);
  let baseRow = 0;
  let baseCol = 0;
  if (anchorGrid) {
    baseRow = anchorGrid.startRow;
    baseCol = anchorGrid.startCol;
  }

  let row = baseRow + event.anchorRow;
  let col = baseCol + event.anchorCol;
  if (event.anchor === "NE" || event.anchor === "SE") col -= grid.width;
  if (event.anchor === "SW" || event.anchor === "SE") row -= grid.height;
  grid.startRow = Math.round(row);
  grid.startCol = Math.round(col);
}

private handleWinHide(event: WinHideEvent): void {
  const grid = this.grids.get(event.grid);
  if (!grid) return;
  grid.hidden = true;
}

private handleWinClose(event: WinCloseEvent): void {
  this.grids.delete(event.grid);
}
```

### Step 4. `option_set` extension hook (optional)

If renderer needs to react to `guifont` or similar, expose via callback:

```typescript
// In options bag (constructor):
onOptionSet?: (name: string, value: unknown) => void;
```

Then call `this.onOptionSet?.(event.name, event.value)` in `handleOptionSet`. Skip if YAGNI for first implementation.

## Validation

- `bun typecheck`

## Done Criteria

- All 16 dispatcher cases handled (or explicit no-op with comment)
- Window position math handles all 4 anchors (NW/NE/SW/SE) for `win_float_pos`
- `busy_start` / `busy_stop` toggle cursor visibility
- `bell` invokes `onBell` callback
- `mouse_on` / `mouse_off` toggle `mouseEnabled` flag
- `flush` invokes `onFlush` callback
