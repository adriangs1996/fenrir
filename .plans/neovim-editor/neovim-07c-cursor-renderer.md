---
depends_on:
  - neovim-07b-canvas-renderer-cursor
---

# Plan 07c: CursorRenderer (Blink State)

## Goal

Standalone `CursorRenderer` class that owns blink state (timer + visibility) and notifies on toggle.

## Scope

- New file: `apps/web/src/modules/neovim-editor/renderer/CursorRenderer.ts`

## Steps

### Step 1. Class

```typescript
export interface CursorRendererOptions {
  onBlinkToggle: () => void;
}

export class CursorRenderer {
  private blinkVisible = true;
  private blinkTimer: ReturnType<typeof setInterval> | null = null;
  private blinkWaitTimeout: ReturnType<typeof setTimeout> | null = null;
  private onBlinkToggle: (() => void) | null;

  constructor(options: CursorRendererOptions) {
    this.onBlinkToggle = options.onBlinkToggle;
  }

  /** Update blink params from current ModeInfo. */
  setBlinkParams(blinkwait: number, blinkon: number, blinkoff: number): void {
    this.stopBlink();
    if (blinkon === 0 && blinkoff === 0) {
      this.blinkVisible = true;
      return;
    }
    // After blinkwait ms of cursor activity, start the on/off cycle.
    this.blinkWaitTimeout = setTimeout(() => {
      this.blinkWaitTimeout = null;
      const tick = () => {
        this.blinkVisible = !this.blinkVisible;
        this.onBlinkToggle?.();
      };
      // Schedule the first toggle relative to current visibility:
      // visible → off after blinkon, hidden → on after blinkoff.
      const next = () => {
        const delay = this.blinkVisible ? blinkon : blinkoff;
        this.blinkTimer = setTimeout(() => {
          tick();
          next();
        }, delay);
      };
      next();
    }, blinkwait);
  }

  stopBlink(): void {
    if (this.blinkTimer) {
      clearTimeout(this.blinkTimer);
      this.blinkTimer = null;
    }
    if (this.blinkWaitTimeout) {
      clearTimeout(this.blinkWaitTimeout);
      this.blinkWaitTimeout = null;
    }
    this.blinkVisible = true;
  }

  isVisible(): boolean {
    return this.blinkVisible;
  }

  dispose(): void {
    this.stopBlink();
    this.onBlinkToggle = null;
  }
}
```

### Step 2. Note on usage

The hook integration (09c) reads `cursorRenderer.isVisible()` AND `gridState.cursor.visible` (busy_start/stop) when deciding whether to call `renderer.renderCursor`. Both must be true.

### Step 3. Refinement: chained timers vs setInterval

The original spec used `setInterval`, but `blinkon` and `blinkoff` differ. A chained `setTimeout` (as written) is the correct shape. Document this.

## Validation

- `bun typecheck`

## Done Criteria

- `CursorRenderer` exported with `setBlinkParams` / `stopBlink` / `isVisible` / `dispose`
- `blinkon === 0 && blinkoff === 0` → no blink (always visible)
- Chained timers honor distinct on/off durations
- `blinkwait` delays first toggle
- `dispose()` is idempotent and clears callback ref
