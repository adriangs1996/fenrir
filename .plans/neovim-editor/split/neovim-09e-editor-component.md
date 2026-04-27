---
depends_on:
  - neovim-09b-bridge-hook
  - neovim-09c-renderer-hook
  - neovim-09d-keyboard-mouse-hooks
---

# Plan 09e: NeovimEditor Component

## Goal

The main React component that composes all hooks, renders the canvas + status bar, handles spawn/connect lifecycle and ResizeObserver.

## Scope

- New file: `apps/web/src/modules/neovim-editor/components/NeovimEditor.tsx`

## Steps

### Step 1. Imports + props

```typescript
import { useRef, useEffect } from "react";
import { useNeovimBridge } from "../hooks/useNeovimBridge";
import { useNeovimRenderer } from "../hooks/useNeovimRenderer";
import { useNeovimKeyboard } from "../hooks/useNeovimKeyboard";
import { useNeovimMouse } from "../hooks/useNeovimMouse";
import { useNeovimEditorStore } from "../stores/neovimState";
import { NeovimEditorStatusBar } from "./NeovimEditorStatusBar";
import type { ResolvedKeybindingsConfig } from "@fenrir/contracts"; // adjust path

interface NeovimEditorProps {
  projectId: string;
  cwd: string;
  getAuthToken: () => string;
  serverBaseUrl: string;
  keybindings: ResolvedKeybindingsConfig;
  /** Spawn neovim via JSON RPC if not running. Caller injects from environmentApi. */
  spawnNeovim: (input: { projectId: string; cwd: string }) => Promise<unknown>;
}
```

### Step 2. Component body

```typescript
export function NeovimEditor(props: NeovimEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const sessionStatus = useNeovimEditorStore((s) => s.sessionStatus);
  const modeName = useNeovimEditorStore((s) => s.modeName);
  const cursorPosition = useNeovimEditorStore((s) => s.cursorPosition);
  const title = useNeovimEditorStore((s) => s.title);
  const setTitle = useNeovimEditorStore((s) => s.setTitle);
  const setModeName = useNeovimEditorStore((s) => s.setModeName);
  const setCursorPosition = useNeovimEditorStore((s) => s.setCursorPosition);
  const setLastError = useNeovimEditorStore((s) => s.setLastError);

  const fontFamily = "monospace";
  const fontSize = 14;
  const lineHeight = 1.25;

  const { processRedraw, getGridDimensions, cellDimensions } = useNeovimRenderer({
    canvasRef,
    fontFamily,
    fontSize,
    lineHeight,
  });

  const { connect, disconnect, sendInput, sendMouse, resize } = useNeovimBridge({
    projectId: props.projectId,
    onRedraw: (events) => {
      processRedraw(events);
      // Mirror useful surface state into the store
      for (const event of events) {
        if (event.type === "mode_change") setModeName(event.modeName);
        else if (event.type === "set_title") setTitle(event.title);
        else if (event.type === "grid_cursor_goto") {
          setCursorPosition({ row: event.row, col: event.col });
        }
      }
    },
    getAuthToken: props.getAuthToken,
    serverBaseUrl: props.serverBaseUrl,
  });

  useNeovimKeyboard({
    sendInput,
    editorFocused: sessionStatus === "attached",
    canvasRef,
    keybindings: props.keybindings,
  });

  useNeovimMouse({
    sendMouse,
    canvasRef,
    cellDimensions,
    mouseEnabled: sessionStatus === "attached",
  });

  // Spawn + connect on mount / projectId change
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    (async () => {
      try {
        await props.spawnNeovim({
          projectId: props.projectId,
          cwd: props.cwd,
        });
      } catch (err) {
        setLastError(err instanceof Error ? err.message : String(err));
        return;
      }
      if (cancelled) return;
      const { cols, rows } = getGridDimensions(
        container.clientWidth,
        container.clientHeight,
      );
      connect(cols, rows);
    })();

    return () => {
      cancelled = true;
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.projectId, props.cwd]);

  // ResizeObserver → resize on the bridge
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
  }, [getGridDimensions, resize]);
```

### Step 3. JSX

```typescript
  return (
    <div ref={containerRef} className="flex min-h-0 min-w-0 flex-1 flex-col bg-black">
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
                type="button"
                onClick={() => {
                  const container = containerRef.current;
                  if (!container) return;
                  const { cols, rows } = getGridDimensions(
                    container.clientWidth,
                    container.clientHeight,
                  );
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
            <p className="text-gray-400">Connecting to Neovim…</p>
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

### Step 4. Selector usage

Note in JSDoc that the component uses narrow selectors against the zustand store to avoid full re-renders on unrelated state changes.

## Validation

- `bun typecheck`
- `bun lint`
- `bun fmt`

## Done Criteria

- Component composes all 4 hooks
- Spawns neovim before connecting (awaited; error sets `lastError`)
- ResizeObserver triggers `resize` with new (cols, rows)
- Reconnect button visible on `error` status
- Connecting overlay visible on `connecting` status
- Status bar rendered below canvas (component imported, written in 09f)
