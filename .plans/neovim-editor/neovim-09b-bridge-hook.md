---
depends_on:
  - neovim-05d-bridge
  - neovim-09a-zustand-store
---

# Plan 09b: useNeovimBridge Hook

## Goal

React hook that owns a `NeovimBridge` instance for a given `projectId`, exposes `connect`, `disconnect`, `sendInput`, `sendMouse`, `resize`. Wires status + error to zustand store.

## Scope

- New file: `apps/web/src/modules/neovim-editor/hooks/useNeovimBridge.ts`

## Steps

### Step 1. Hook

```typescript
import { useRef, useEffect, useCallback } from "react";
import { NeovimBridge } from "../protocol/NeovimBridge";
import type { RedrawEvent } from "../protocol/RedrawParser";
import { useNeovimEditorStore } from "../stores/neovimState";

interface UseNeovimBridgeOptions {
  projectId: string;
  onRedraw: (events: RedrawEvent[]) => void;
  /** Called per connect — must include auth token. */
  getAuthToken: () => string;
  /** Server base URL, e.g., "http://localhost:3000". Hook converts to ws/wss. */
  serverBaseUrl: string;
}

export function useNeovimBridge(options: UseNeovimBridgeOptions) {
  const bridgeRef = useRef<NeovimBridge | null>(null);
  const setSessionStatus = useNeovimEditorStore((s) => s.setSessionStatus);
  const setLastError = useNeovimEditorStore((s) => s.setLastError);

  // Re-create bridge when projectId changes
  useEffect(() => {
    const bridge = new NeovimBridge({
      projectId: options.projectId,
      getUrl: () => {
        const wsUrl = options.serverBaseUrl.replace(/^http/, "ws");
        const token = options.getAuthToken();
        return `${wsUrl}/ws/neovim?projectId=${encodeURIComponent(options.projectId)}&token=${encodeURIComponent(token)}`;
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
    // Intentionally only depending on projectId — `onRedraw` etc. must be stable
    // (callers should memoize). Not depending on serverBaseUrl/getAuthToken
    // because reconnects re-call them on each connect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const sendMouse = useCallback(
    (
      button: string,
      action: string,
      modifier: string,
      grid: number,
      row: number,
      col: number,
    ) => {
      bridgeRef.current?.sendMouse(button, action, modifier, grid, row, col);
    },
    [],
  );

  const resize = useCallback((cols: number, rows: number) => {
    bridgeRef.current?.resize(cols, rows);
  }, []);

  return { connect, disconnect, sendInput, sendMouse, resize };
}
```

### Step 2. Caller contract

Document in JSDoc:
- `onRedraw` and `getAuthToken` MUST be stable (memoized) — otherwise the bridge is recreated on each render.
- `serverBaseUrl` should be a stable value (env var or context).

## Validation

- `bun typecheck`
- `bun lint`

## Done Criteria

- Hook creates bridge on mount, disposes on unmount/projectId change
- Returns 5 stable callbacks: `connect`, `disconnect`, `sendInput`, `sendMouse`, `resize`
- Status updates flow into zustand store
- Errors set both `lastError` and status `"error"`
- URL construction wraps token via `encodeURIComponent`
