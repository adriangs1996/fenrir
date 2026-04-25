# Plan: Web NeovimEditor Component + Hooks

## Summary

Implement the main React component and hooks that wire together the bridge, grid state, renderer, and input handlers into a functional embedded neovim editor.

## Motivation

This is the integration layer — takes all the pure modules (protocol, renderer, input) and composes them into a React component with proper lifecycle management.

## Prerequisites

- `neovim-05-web-msgpack-bridge` (NeovimBridge)
- `neovim-06-web-grid-state` (GridStateManager, HighlightManager, FontMetrics)
- `neovim-07-web-renderer` (CanvasRenderer, WebGLCompositor)
- `neovim-08-web-input-handlers` (KeyboardHandler, MouseHandler)

## Scope

- New file: `apps/web/src/modules/neovim-editor/hooks/useNeovimBridge.ts`
- New file: `apps/web/src/modules/neovim-editor/hooks/useNeovimRenderer.ts`
- New file: `apps/web/src/modules/neovim-editor/hooks/useNeovimKeyboard.ts`
- New file: `apps/web/src/modules/neovim-editor/hooks/useNeovimMouse.ts`
- New file: `apps/web/src/modules/neovim-editor/components/NeovimEditor.tsx`
- New file: `apps/web/src/modules/neovim-editor/components/NeovimEditorStatusBar.tsx`
- New file: `apps/web/src/modules/neovim-editor/stores/neovimState.ts`
- New file: `apps/web/src/modules/neovim-editor/index.ts`

## Proposed Changes

### 1. Zustand Store — `stores/neovimState.ts`

```typescript
import { create } from "zustand";

export type NeovimConnectionStatus = "disconnected" | "connecting" | "attached" | "error";

interface NeovimEditorState {
  // View toggle
  editorOpen: boolean;
  toggleEditor: () => void;
  setEditorOpen: (open: boolean) => void;

  // Active project
  activeProjectId: string | null;
  setActiveProjectId: (projectId: string | null) => void;

  // Connection state
  sessionStatus: NeovimConnectionStatus;
  setSessionStatus: (status: NeovimConnectionStatus) => void;

  // Error display
  lastError: string | null;
  setLastError: (message: string | null) => void;

  // Editor metadata (from neovim events)
  title: string;
  setTitle: (title: string) => void;
  modeName: string;
  setModeName: (mode: string) => void;
  cursorPosition: { row: number; col: number };
  setCursorPosition: (pos: { row: number; col: number }) => void;
}

export const useNeovimEditorStore = create<NeovimEditorState>((set) => ({
  editorOpen: false,
  toggleEditor: () => set((s) => ({ editorOpen: !s.editorOpen })),
  setEditorOpen: (open) => set({ editorOpen: open }),

  activeProjectId: null,
  setActiveProjectId: (projectId) => set({ activeProjectId: projectId }),

  sessionStatus: "disconnected",
  setSessionStatus: (sessionStatus) => set({ sessionStatus }),

  lastError: null,
  setLastError: (lastError) => set({ lastError }),

  title: "",
  setTitle: (title) => set({ title }),
  modeName: "normal",
  setModeName: (modeName) => set({ modeName }),
  cursorPosition: { row: 0, col: 0 },
  setCursorPosition: (cursorPosition) => set({ cursorPosition }),
}));
```

### 2. useNeovimBridge Hook — `hooks/useNeovimBridge.ts`

```typescript
import { useRef, useEffect, useCallback } from "react";
import { NeovimBridge } from "../protocol/NeovimBridge";
import type { RedrawEvent } from "../protocol/RedrawParser";
import { useNeovimEditorStore } from "../stores/neovimState";

interface UseNeovimBridgeOptions {
  projectId: string;
  onRedraw: (events: RedrawEvent[]) => void;
  getAuthToken: () => string;
  serverBaseUrl: string;
}

export function useNeovimBridge(options: UseNeovimBridgeOptions) {
  const bridgeRef = useRef<NeovimBridge | null>(null);
  const { setSessionStatus, setLastError } = useNeovimEditorStore();

  // Create bridge on mount
  useEffect(() => {
    const bridge = new NeovimBridge({
      projectId: options.projectId,
      getUrl: () => {
        const wsUrl = options.serverBaseUrl.replace(/^http/, "ws");
        return `${wsUrl}/ws/neovim?projectId=${encodeURIComponent(options.projectId)}&token=${options.getAuthToken()}`;
      },
      onRedraw: options.onRedraw,
      onStatusChange: setSessionStatus,
      onError: (msg) => {
        setLastError(msg);
        setSessionStatus("error");
      },
    });
    bridgeRef.current = bridge;

    return () => {
      bridge.dispose();
      bridgeRef.current = null;
    };
  }, [options.projectId]);

  const connect = useCallback((cols: number, rows: number) => {
    bridgeRef.current?.connect(cols, rows);
  }, []);

  const disconnect = useCallback(() => {
    bridgeRef.current?.disconnect();
  }, []);

  const sendInput = useCallback((keys: string) => {
    bridgeRef.current?.sendInput(keys);
  }, []);

  const sendMouse = useCallback((
    button: string, action: string, modifier: string,
    grid: number, row: number, col: number,
  ) => {
    bridgeRef.current?.sendMouse(button, action, modifier, grid, row, col);
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    bridgeRef.current?.resize(cols, rows);
  }, []);

  return { connect, disconnect, sendInput, sendMouse, resize };
}
```

### 3. useNeovimRenderer Hook — `hooks/useNeovimRenderer.ts`

```typescript
import { useRef, useEffect, useCallback } from "react";
import { GridStateManager } from "../renderer/GridState";
import { CanvasRenderer } from "../renderer/CanvasRenderer";
import { WebGLCompositor } from "../renderer/WebGLCompositor";
import { CursorRenderer } from "../renderer/CursorRenderer";
import { measureCellDimensions, calculateGridDimensions } from "../renderer/FontMetrics";
import type { RedrawEvent } from "../protocol/RedrawParser";

interface UseNeovimRendererOptions {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
}

export function useNeovimRenderer(options: UseNeovimRendererOptions) {
  const gridStateRef = useRef<GridStateManager | null>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const compositorRef = useRef<WebGLCompositor | null>(null);
  const cursorRendererRef = useRef<CursorRenderer | null>(null);
  const cellDimensionsRef = useRef(measureCellDimensions(options.fontFamily, options.fontSize, options.lineHeight));
  const rafRef = useRef<number>(0);

  // Initialize on canvas mount
  useEffect(() => {
    const canvas = options.canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const cellDim = cellDimensionsRef.current;

    const gridState = new GridStateManager({
      onFlush: () => scheduleRender(),
    });

    const renderer = new CanvasRenderer({
      canvas,
      highlightManager: gridState.highlights,
      cellDimensions: cellDim,
      fontFamily: options.fontFamily,
      fontSize: options.fontSize,
      devicePixelRatio: dpr,
    });

    const compositor = new WebGLCompositor(canvas);
    const cursorRenderer = new CursorRenderer({
      onBlinkToggle: () => scheduleRender(),
    });

    gridStateRef.current = gridState;
    rendererRef.current = renderer;
    compositorRef.current = compositor;
    cursorRendererRef.current = cursorRenderer;

    return () => {
      cancelAnimationFrame(rafRef.current);
      compositor.dispose();
      cursorRenderer.dispose();
      gridState.reset();
    };
  }, [options.canvasRef.current]);

  // Schedule render on next animation frame (coalesce multiple flushes)
  const scheduleRender = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(render);
  }, []);

  const render = useCallback(() => {
    const gridState = gridStateRef.current;
    const renderer = rendererRef.current;
    if (!gridState || !renderer) return;

    const snapshot = gridState.getSnapshot();

    // Render each grid with dirty rows
    for (const [gridId, grid] of snapshot.grids) {
      if (grid.dirtyRows.size > 0) {
        renderer.renderGrid(grid);
      }
    }

    // Render cursor
    const mode = gridState.getCurrentMode();
    if (snapshot.cursor.visible && cursorRendererRef.current?.isVisible()) {
      renderer.renderCursor(snapshot.cursor, mode);
    }

    gridState.clearDirty();
  }, []);

  // Process redraw events (called by bridge)
  const processRedraw = useCallback((events: RedrawEvent[]) => {
    gridStateRef.current?.processEvents(events);
  }, []);

  // Get grid dimensions for current container size
  const getGridDimensions = useCallback((containerWidth: number, containerHeight: number) => {
    return calculateGridDimensions(containerWidth, containerHeight, cellDimensionsRef.current);
  }, []);

  return { processRedraw, getGridDimensions, cellDimensions: cellDimensionsRef.current };
}
```

### 4. useNeovimKeyboard Hook — `hooks/useNeovimKeyboard.ts`

```typescript
import { useEffect, useCallback } from "react";
import { keyEventToNeovimInput, compositionEndToNeovimInput } from "../input/KeyboardHandler";
import { resolveShortcutCommand } from "~/keybindings";

interface UseNeovimKeyboardOptions {
  sendInput: (keys: string) => void;
  editorFocused: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  keybindings: ResolvedKeybindingsConfig;
}

export function useNeovimKeyboard(options: UseNeovimKeyboardOptions) {
  useEffect(() => {
    if (!options.editorFocused) return;

    const canvas = options.canvasRef.current;
    if (!canvas) return;

    const onKeyDown = (event: KeyboardEvent) => {
      // Check if this is an app-level keybinding (e.g., Cmd+E)
      const appCommand = resolveShortcutCommand(event, options.keybindings, {
        context: { neovimFocus: true },
      });
      if (appCommand) return; // Let app handler process it

      // Translate to neovim input
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

    // Attach to canvas element for scoped keyboard capture
    canvas.addEventListener("keydown", onKeyDown);
    canvas.addEventListener("compositionend", onCompositionEnd);

    return () => {
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("compositionend", onCompositionEnd);
    };
  }, [options.editorFocused, options.sendInput, options.keybindings]);
}
```

### 5. useNeovimMouse Hook — `hooks/useNeovimMouse.ts`

```typescript
import { useEffect, useRef } from "react";
import {
  mouseDownToNeovim, mouseMoveToNeovim, mouseUpToNeovim,
  wheelToNeovim, resolveGridAtPixel,
} from "../input/MouseHandler";
import type { CellDimensions } from "../renderer/FontMetrics";

interface UseNeovimMouseOptions {
  sendMouse: (button: string, action: string, modifier: string, grid: number, row: number, col: number) => void;
  canvasRef: React.RefObject<HTMLCanvasElement>;
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
      canvas.focus(); // Ensure keyboard focus
      const params = mouseDownToNeovim(event, options.cellDimensions, getRect());
      activeButtonRef.current = params.button;
      options.sendMouse(params.button, params.action, params.modifier, params.grid, params.row, params.col);
    };

    const onMouseMove = (event: MouseEvent) => {
      if (!activeButtonRef.current) return; // Only during drag
      const params = mouseMoveToNeovim(event, options.cellDimensions, getRect(), activeButtonRef.current);
      options.sendMouse(params.button, params.action, params.modifier, params.grid, params.row, params.col);
    };

    const onMouseUp = (event: MouseEvent) => {
      if (!activeButtonRef.current) return;
      const params = mouseUpToNeovim(event, options.cellDimensions, getRect());
      activeButtonRef.current = null;
      options.sendMouse(params.button, params.action, params.modifier, params.grid, params.row, params.col);
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const params = wheelToNeovim(event, options.cellDimensions, getRect());
      options.sendMouse(params.button, params.action, params.modifier, params.grid, params.row, params.col);
    };

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault(); // Prevent browser context menu
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
  }, [options.mouseEnabled, options.cellDimensions, options.sendMouse]);
}
```

### 6. NeovimEditor Component — `components/NeovimEditor.tsx`

```typescript
import { useRef, useEffect, useCallback } from "react";
import { useNeovimBridge } from "../hooks/useNeovimBridge";
import { useNeovimRenderer } from "../hooks/useNeovimRenderer";
import { useNeovimKeyboard } from "../hooks/useNeovimKeyboard";
import { useNeovimMouse } from "../hooks/useNeovimMouse";
import { useNeovimEditorStore } from "../stores/neovimState";
import { NeovimEditorStatusBar } from "./NeovimEditorStatusBar";

interface NeovimEditorProps {
  projectId: string;
  cwd: string;
  getAuthToken: () => string;
  serverBaseUrl: string;
  keybindings: ResolvedKeybindingsConfig;
}

export function NeovimEditor(props: NeovimEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { sessionStatus, modeName, cursorPosition, title, setTitle, setModeName, setCursorPosition } = useNeovimEditorStore();

  // Default font — will be updated from neovim's guifont option
  const fontFamily = "monospace";
  const fontSize = 14;
  const lineHeight = 1.25;

  // Renderer
  const { processRedraw, getGridDimensions, cellDimensions } = useNeovimRenderer({
    canvasRef,
    fontFamily,
    fontSize,
    lineHeight,
  });

  // Bridge
  const { connect, disconnect, sendInput, sendMouse, resize } = useNeovimBridge({
    projectId: props.projectId,
    onRedraw: (events) => {
      processRedraw(events);

      // Extract metadata from events for status bar
      for (const event of events) {
        if (event.type === "mode_change") setModeName(event.modeName);
        if (event.type === "set_title") setTitle(event.title);
        if (event.type === "grid_cursor_goto") setCursorPosition({ row: event.row, col: event.col });
      }
    },
    getAuthToken: props.getAuthToken,
    serverBaseUrl: props.serverBaseUrl,
  });

  // Keyboard
  useNeovimKeyboard({
    sendInput,
    editorFocused: sessionStatus === "attached",
    canvasRef,
    keybindings: props.keybindings,
  });

  // Mouse
  useNeovimMouse({
    sendMouse,
    canvasRef,
    cellDimensions,
    mouseEnabled: sessionStatus === "attached",
  });

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // First: spawn neovim via JSON RPC (call from environmentApi)
    // Then: connect binary WebSocket
    const { cols, rows } = getGridDimensions(container.clientWidth, container.clientHeight);
    connect(cols, rows);

    return () => {
      disconnect();
    };
  }, [props.projectId]);

  // Handle container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const { cols, rows } = getGridDimensions(width, height);
        resize(cols, rows);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="flex flex-1 flex-col bg-black">
      <div className="relative flex-1">
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          tabIndex={0}
          style={{ outline: "none", cursor: "text" }}
        />
        {sessionStatus === "error" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <div className="text-center text-red-400">
              <p>Neovim connection lost</p>
              <button
                onClick={() => {
                  const container = containerRef.current;
                  if (!container) return;
                  const { cols, rows } = getGridDimensions(container.clientWidth, container.clientHeight);
                  connect(cols, rows);
                }}
                className="mt-2 rounded bg-gray-700 px-4 py-1 text-white hover:bg-gray-600"
              >
                Reconnect
              </button>
            </div>
          </div>
        )}
        {sessionStatus === "connecting" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <p className="text-gray-400">Connecting to Neovim...</p>
          </div>
        )}
      </div>
      <NeovimEditorStatusBar
        sessionStatus={sessionStatus}
        modeName={modeName}
        cursorPosition={cursorPosition}
        title={title}
      />
    </div>
  );
}
```

### 7. NeovimEditorStatusBar — `components/NeovimEditorStatusBar.tsx`

```typescript
export function NeovimEditorStatusBar(props: {
  sessionStatus: NeovimConnectionStatus;
  modeName: string;
  cursorPosition: { row: number; col: number };
  title: string;
}) {
  const modeColors: Record<string, string> = {
    normal: "bg-blue-600",
    insert: "bg-green-600",
    visual: "bg-purple-600",
    replace: "bg-red-600",
    command: "bg-yellow-600",
  };

  const modeColor = modeColors[props.modeName] ?? "bg-gray-600";

  return (
    <div className="flex h-6 items-center border-t border-gray-700 bg-gray-900 px-2 text-xs text-gray-300">
      {/* Mode badge */}
      <span className={`rounded px-1.5 py-0.5 font-bold text-white uppercase ${modeColor}`}>
        {props.modeName}
      </span>

      {/* Title / filename */}
      <span className="ml-2 truncate">{props.title}</span>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Cursor position */}
      <span className="mr-3">
        Ln {props.cursorPosition.row + 1}, Col {props.cursorPosition.col + 1}
      </span>

      {/* Connection status */}
      <span className={
        props.sessionStatus === "attached" ? "text-green-400"
        : props.sessionStatus === "connecting" ? "text-yellow-400"
        : props.sessionStatus === "error" ? "text-red-400"
        : "text-gray-500"
      }>
        ●
      </span>
    </div>
  );
}
```

### 8. Barrel Export — `index.ts`

```typescript
export { NeovimEditor } from "./components/NeovimEditor";
export { NeovimEditorStatusBar } from "./components/NeovimEditorStatusBar";
export { useNeovimEditorStore } from "./stores/neovimState";
export type { NeovimConnectionStatus } from "./stores/neovimState";
```

## Validation

- `bun typecheck`
- Manual: render NeovimEditor in browser, connect to server with running nvim, type and verify text appears

## Done Criteria

- NeovimEditor component renders canvas and status bar
- useNeovimBridge manages WebSocket lifecycle
- useNeovimRenderer processes redraw events and renders on flush
- useNeovimKeyboard captures keyboard input and sends to neovim
- useNeovimMouse captures mouse events and sends to neovim
- ResizeObserver detects container resize and updates grid dimensions
- Status bar shows mode, cursor position, file title, connection status
- Error/connecting overlays display appropriately
- Barrel export exposes clean public API
