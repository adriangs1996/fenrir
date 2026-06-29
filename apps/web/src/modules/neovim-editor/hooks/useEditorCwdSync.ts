import { useEffect, useRef } from "react";
import {
  getDesktopHostAdapter,
  useDesktopBridgeAvailable,
  useIsMainWindow,
} from "~/hooks/useDesktopBridge";
import { useActiveEditorCwd } from "./useActiveEditorCwd";
import { useEditorStore } from "../stores/editorStore";

// ---------------------------------------------------------------------------
// Pure decision logic — exported for tests
// ---------------------------------------------------------------------------

/** Whether the effect should attempt a push at all. */
export function shouldPush(opts: {
  bridgeAvailable: boolean;
  main: boolean;
  cwd: string | null;
  lastPushed: string | null;
}): boolean {
  if (!opts.bridgeAvailable || !opts.main || !opts.cwd) return false;
  return opts.cwd !== opts.lastPushed;
}

/**
 * Whether a dirty-buffer confirmation dialog is needed before respawn.
 * First push (lastPushed === null) is initial spawn — no confirm.
 */
export function needsDirtyConfirm(dirtyCount: number, lastPushed: string | null): boolean {
  return dirtyCount > 0 && lastPushed !== null;
}

/** Build the confirmation message shown when dirty buffers exist. */
export function dirtyConfirmMessage(dirtyCount: number): string {
  return `Switching projects will save and close ${dirtyCount} buffer(s) with unsaved changes. Continue?`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Pushes the active thread's cwd to the desktop host adapter whenever it changes.
 * Mounted at the app shell so it runs across route changes — keeps nvim
 * warmed against the active project even when the editor tab is hidden or
 * the user is on a non-chat route.
 *
 * When dirty buffers exist, asks user before respawning.
 */
export function useEditorCwdSync(): void {
  const bridgeAvailable = useDesktopBridgeAvailable();
  const main = useIsMainWindow();
  const cwd = useActiveEditorCwd();
  const dirtyFiles = useEditorStore((s) => s.dirtyFiles);
  const lastPushedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!shouldPush({ bridgeAvailable, main, cwd, lastPushed: lastPushedRef.current })) return;

    const bridge = getDesktopHostAdapter()?.bridge;
    if (!bridge) return;

    const performPush = async () => {
      if (needsDirtyConfirm(dirtyFiles.size, lastPushedRef.current)) {
        const confirmed = await bridge.confirm(dirtyConfirmMessage(dirtyFiles.size));
        if (!confirmed) return;
      }
      try {
        await bridge.neovimSetCwd(cwd!);
        lastPushedRef.current = cwd;
        useEditorStore.getState().resetVolatile();
      } catch (err) {
        console.warn("[editor] neovimSetCwd failed:", err);
      }
    };

    void performPush();
  }, [bridgeAvailable, main, cwd, dirtyFiles]);
}
