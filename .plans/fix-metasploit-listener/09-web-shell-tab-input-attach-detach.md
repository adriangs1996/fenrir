---
depends_on:
  - 02-server-emit-session-output-and-attach-rpc
---

# Plan 09: Web — Wire Shell Tab Input + Attach/Detach Lifecycle

## Goal

Bug #1 (web side): typing in the shell tab does nothing because `terminal.onData` is a no-op placeholder. Wire it to the new attach/detach RPCs and to `sessionWrite` for keystrokes. Resize too.

## Scope

- Modify: `apps/web/src/rpc/wsRpcClient.ts` — add `sessionAttach` / `sessionDetach` to the `metasploit` namespace (interface + impl).
- Modify: `apps/web/src/components/hack/TargetShellTab.tsx` — wire input, attach on mount, detach on unmount, resize on terminal resize.

## Steps

### Step 1. Extend `WsRpcClient` interface

In `apps/web/src/rpc/wsRpcClient.ts`, locate the `metasploit` block in the `WsRpcClient` interface (around L65–76). Add two methods after `sessionClose`:

```typescript
  readonly metasploit: {
    readonly status: RpcUnaryNoArgMethod<typeof WS_METHODS.metasploitStatus>;
    readonly createListener: RpcUnaryMethod<typeof WS_METHODS.metasploitCreateListener>;
    readonly stopListener: RpcUnaryMethod<typeof WS_METHODS.metasploitStopListener>;
    readonly listListeners: RpcUnaryNoArgMethod<typeof WS_METHODS.metasploitListListeners>;
    readonly listSessions: RpcUnaryNoArgMethod<typeof WS_METHODS.metasploitListSessions>;
    readonly sessionWrite: RpcUnaryMethod<typeof WS_METHODS.metasploitSessionWrite>;
    readonly sessionResize: RpcUnaryMethod<typeof WS_METHODS.metasploitSessionResize>;
    readonly sessionUpgrade: RpcUnaryMethod<typeof WS_METHODS.metasploitSessionUpgrade>;
    readonly sessionClose: RpcUnaryMethod<typeof WS_METHODS.metasploitSessionClose>;
    readonly sessionAttach: RpcUnaryMethod<typeof WS_METHODS.metasploitSessionAttach>;   // NEW
    readonly sessionDetach: RpcUnaryMethod<typeof WS_METHODS.metasploitSessionDetach>;   // NEW
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeMetasploitEvents>;
  };
```

### Step 2. Extend `createWsRpcClient` impl

In the same file, find the `metasploit: {...}` block in the `createWsRpcClient` return value (around L191–215). Add the two new methods right after `sessionClose`:

```typescript
    metasploit: {
      status: () => transport.request((client) => client[WS_METHODS.metasploitStatus]({})),
      createListener: (input) =>
        transport.request((client) => client[WS_METHODS.metasploitCreateListener](input)),
      stopListener: (input) =>
        transport.request((client) => client[WS_METHODS.metasploitStopListener](input)),
      listListeners: () =>
        transport.request((client) => client[WS_METHODS.metasploitListListeners]({})),
      listSessions: () =>
        transport.request((client) => client[WS_METHODS.metasploitListSessions]({})),
      sessionWrite: (input) =>
        transport.request((client) => client[WS_METHODS.metasploitSessionWrite](input)),
      sessionResize: (input) =>
        transport.request((client) => client[WS_METHODS.metasploitSessionResize](input)),
      sessionUpgrade: (input) =>
        transport.request((client) => client[WS_METHODS.metasploitSessionUpgrade](input)),
      sessionClose: (input) =>
        transport.request((client) => client[WS_METHODS.metasploitSessionClose](input)),
      sessionAttach: (input) =>
        transport.request((client) => client[WS_METHODS.metasploitSessionAttach](input)),
      sessionDetach: (input) =>
        transport.request((client) => client[WS_METHODS.metasploitSessionDetach](input)),
      onEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeMetasploitEvents]({}),
          listener,
          options,
        ),
    },
```

### Step 3. Update `TargetShellTab.tsx`

In `apps/web/src/components/hack/TargetShellTab.tsx`:

#### 3a. Add imports at the top

After the existing imports:

```typescript
import { useMemo, useEffect, useRef } from "react";
// ... existing xterm + addon + contracts imports stay ...
import { useMetasploitSessionTerminalStore } from "../../metasploitSessionTerminalStore";
import { useSettings } from "../../hooks/useSettings";
import { getPrimaryEnvironmentConnection } from "../../environmentApi"; // NEW
```

If `useMemo` is not currently imported from `react`, add it.

> ⚠️ Verify the import path for `getPrimaryEnvironmentConnection`. Existing usage: `apps/web/src/components/hack/HackSidebar.tsx:28` does `import { getPrimaryEnvironmentConnection } from "../../environmentApi"` — match that.

#### 3b. Get rpcClient inside the component body

After the destructuring of `useSettings(...)` (around L18–22), add:

```typescript
  const rpcClient = useMemo(() => getPrimaryEnvironmentConnection().client, []);
```

#### 3c. Replace the no-op `onData` handler

Find the current placeholder (L70–73):

```typescript
    // Handle user input -- send to session via RPC
    const inputDisposable = terminal.onData((_data) => {
      // Will be wired to environmentApi.metasploit.sessionWrite
      // once the RPC bridge for hack sessions is connected.
    });
```

Replace with:

```typescript
    // Handle user input — forward keystrokes to MSF session.
    const inputDisposable = terminal.onData((data) => {
      void rpcClient.metasploit.sessionWrite({ sessionId, data }).catch((err) => {
        console.warn(`[shell] sessionWrite failed for ${sessionId}:`, err);
      });
    });
```

#### 3d. Wire `terminal.onResize` → `sessionResize`

Inside the same `useEffect` (after the `terminal.onData` wiring), add:

```typescript
    // Forward terminal size changes to MSF.
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      void rpcClient.metasploit
        .sessionResize({ sessionId, cols, rows })
        .catch((err) => {
          console.warn(`[shell] sessionResize failed for ${sessionId}:`, err);
        });
    });
```

Then in the cleanup function (`return () => { ... }` at the bottom of the effect), add `resizeDisposable.dispose();` alongside the existing `inputDisposable.dispose();`:

```typescript
    return () => {
      inputDisposable.dispose();
      resizeDisposable.dispose();
      themeObserver.disconnect();
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      serializeAddonRef.current = null;
    };
```

#### 3e. Add a separate effect for attach/detach lifecycle

After the existing `useEffect` that sets up the terminal (the one keyed on `[sessionId]` ending around L111), add a new effect:

```typescript
  // Attach to MSF session on mount; detach on unmount or sessionId change.
  useEffect(() => {
    rpcClient.metasploit.sessionAttach({ sessionId }).catch((err) => {
      console.warn(`[shell] sessionAttach failed for ${sessionId}:`, err);
    });

    return () => {
      rpcClient.metasploit.sessionDetach({ sessionId }).catch(() => {
        // Detach errors are non-fatal; session may already be gone.
      });
    };
  }, [rpcClient, sessionId]);
```

### Step 4. Confirm `metasploitSessionTerminalStore` already wires output

The output rendering already exists (the second `useEffect` around L114–126 subscribes to `useMetasploitSessionTerminalStore`). Verify it's untouched. Output flow:

```
adapter.onData → service.emitSessionOutput → emitEvent("session.output")
  → ws stream → web onEvent handler (useMetasploitSync, plan 11)
  → metasploitSessionTerminalStore.appendOutput
  → TargetShellTab subscription writes to xterm
```

No changes needed in plan 09 for this path.

## Validation

```bash
bun typecheck
bun lint
bun fmt
```

Grep checks:

```bash
grep -n "sessionAttach\|sessionDetach" apps/web/src/rpc/wsRpcClient.ts
# Expect: 2 interface entries + 2 impl entries.

grep -n "sessionAttach\|sessionDetach\|sessionWrite\|sessionResize" apps/web/src/components/hack/TargetShellTab.tsx
# Expect: at least 1 of each.

grep -n "_data\|placeholder" apps/web/src/components/hack/TargetShellTab.tsx
# Expect: 0 matches (placeholder gone).
```

## Done Criteria

- [ ] `WsRpcClient.metasploit` interface declares `sessionAttach` and `sessionDetach`.
- [ ] `createWsRpcClient` returns implementations for both.
- [ ] `TargetShellTab` imports `getPrimaryEnvironmentConnection` and resolves `rpcClient` via `useMemo`.
- [ ] `terminal.onData` forwards keystrokes via `sessionWrite` (errors logged, non-fatal).
- [ ] `terminal.onResize` forwards size changes via `sessionResize` (errors logged, non-fatal).
- [ ] A dedicated `useEffect` keyed on `[rpcClient, sessionId]` calls `sessionAttach` on mount, `sessionDetach` on cleanup.
- [ ] Existing terminal-output subscription path (via `metasploitSessionTerminalStore`) untouched and still operational.
- [ ] `bun typecheck` clean.
