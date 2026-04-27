---
depends_on:
  - neovim-08a-keyboard-handler
  - neovim-08b-mouse-handler
  - neovim-09b-bridge-hook
---

# Plan 09d: useNeovimKeyboard + useNeovimMouse Hooks

## Goal

Two React hooks that bind DOM keyboard/mouse listeners to the canvas and forward translated events through the bridge.

## Scope

- New file: `apps/web/src/modules/neovim-editor/hooks/useNeovimKeyboard.ts`
- New file: `apps/web/src/modules/neovim-editor/hooks/useNeovimMouse.ts`

## Steps

### Step 1. useNeovimKeyboard.ts

```typescript
import { useEffect } from "react";
import type { RefObject } from "react";
import {
  keyEventToNeovimInput,
  compositionEndToNeovimInput,
} from "../input/KeyboardHandler";
import { resolveShortcutCommand } from "~/keybindings"; // path may differ
import type { ResolvedKeybindingsConfig } from "@fenrir/contracts"; // adjust import

interface UseNeovimKeyboardOptions {
  sendInput: (keys: string) => void;
  editorFocused: boolean;
  canvasRef: RefObject<HTMLCanvasElement>;
  keybindings: ResolvedKeybindingsConfig;
}

export function useNeovimKeyboard(options: UseNeovimKeyboardOptions) {
  useEffect(() => {
    if (!options.editorFocused) return;
    const canvas = options.canvasRef.current;
    if (!canvas) return;

    const onKeyDown = (event: KeyboardEvent) => {
      // App-level keybinding wins (e.g., Cmd+E toggles editor)
      const appCommand = resolveShortcutCommand(event, options.keybindings, {
        context: { neovimFocus: true },
      });
      if (appCommand) return;

      const nvimKey = keyEventToNeovimInput(event);
      if (nvimKey === null) return;
      event.preventDefault();
      event.stopPropagation();
      options.sendInput(nvimKey);
    };

    const onCompositionEnd = (event: CompositionEvent) => {
      if (event.data) {
        options.sendInput(compositionEndToNeovimInput(event.data));
      }
    };

    canvas.addEventListener("keydown", onKeyDown);
    canvas.addEventListener("compositionend", onCompositionEnd);
    return () => {
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("compositionend", onCompositionEnd);
    };
  }, [
    options.editorFocused,
    options.sendInput,
    options.keybindings,
    options.canvasRef,
  ]);
}
```

If `resolveShortcutCommand` import path differs, look at how `terminal.toggle` is wired in existing hooks/components and mirror that.

### Step 2. useNeovimMouse.ts

```typescript
import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import {
  mouseDownToNeovim,
  mouseMoveToNeovim,
  mouseUpToNeovim,
  wheelToNeovim,
} from "../input/MouseHandler";
import type { CellDimensions } from "../renderer/FontMetrics";

interface UseNeovimMouseOptions {
  sendMouse: (
    button: string,
    action: string,
    modifier: string,
    grid: number,
    row: number,
    col: number,
  ) => void;
  canvasRef: RefObject<HTMLCanvasElement>;
  cellDimensions: CellDimensions;
  mouseEnabled: boolean;
}

export function useNeovimMouse(options: UseNeovimMouseOptions) {
  const activeButtonRef = useRef<string | null>(null);

  useEffect(() => {
    const canvas = options.canvasRef.current;
    if (!canvas || !options.mouseEnabled) return;

    const getRect = () => canvas.getBoundingClientRect();

    const onMouseDown = (event: MouseEvent) => {
      event.preventDefault();
      canvas.focus(); // ensure subsequent keystrokes route here
      const params = mouseDownToNeovim(event, options.cellDimensions, getRect());
      activeButtonRef.current = params.button;
      options.sendMouse(
        params.button, params.action, params.modifier,
        params.grid, params.row, params.col,
      );
    };

    const onMouseMove = (event: MouseEvent) => {
      if (!activeButtonRef.current) return;
      const params = mouseMoveToNeovim(
        event, options.cellDimensions, getRect(), activeButtonRef.current,
      );
      options.sendMouse(
        params.button, params.action, params.modifier,
        params.grid, params.row, params.col,
      );
    };

    const onMouseUp = (event: MouseEvent) => {
      if (!activeButtonRef.current) return;
      const params = mouseUpToNeovim(event, options.cellDimensions, getRect());
      activeButtonRef.current = null;
      options.sendMouse(
        params.button, params.action, params.modifier,
        params.grid, params.row, params.col,
      );
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const params = wheelToNeovim(event, options.cellDimensions, getRect());
      options.sendMouse(
        params.button, params.action, params.modifier,
        params.grid, params.row, params.col,
      );
    };

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);

    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
    };
  }, [options.mouseEnabled, options.cellDimensions, options.sendMouse, options.canvasRef]);
}
```

### Step 3. Multigrid awareness

For first iteration `grid=0` is sent (default global grid). When 09c adds multigrid composition, this hook should consult `gridStateRef` to call `resolveGridAtPixel`. Document with `// TODO(multigrid)`.

## Validation

- `bun typecheck`
- `bun lint`

## Done Criteria

- `useNeovimKeyboard` binds keydown + compositionend on canvas, defers app keybindings, forwards keys
- `useNeovimMouse` binds mousedown on canvas, mousemove/up on window (so drags continue out-of-canvas)
- `wheel` listener uses `passive: false` to allow `preventDefault`
- `contextmenu` suppressed
- Cleanup on effect teardown removes all listeners
- TODO marker for multigrid resolution
