import { useEffect } from "react";
import type { EditorEvent } from "@fenrir/contracts";
import { useDesktopBridgeAvailable, useIsMainWindow } from "~/hooks/useDesktopBridge";
import { useEditorStore } from "../stores/editorStore";

/** Window CustomEvent name fired on `buf_write_post`. */
export const BUF_WRITE_POST_EVENT = "fenrir:editor:bufWritePost" as const;

/** Whether the listener should subscribe (both bridge and main window required). */
export function shouldSubscribe(bridge: boolean, main: boolean): boolean {
  return bridge && main;
}

/**
 * Pure event handler — dispatches editor events to the store / window.
 *
 * - `buf_enter`        → `setCurrentFile`
 * - `buf_write_post`   → window CustomEvent
 * - `buf_modified_set` → `setDirty`
 */
export function handleEditorEvent(
  ev: EditorEvent,
  store: { setCurrentFile: (f: string) => void; setDirty: (f: string, m: boolean) => void },
  dispatch: (event: Event) => void,
): void {
  switch (ev.kind) {
    case "buf_enter":
      store.setCurrentFile(ev.file);
      break;
    case "buf_write_post":
      dispatch(new CustomEvent(BUF_WRITE_POST_EVENT, { detail: { file: ev.file } }));
      break;
    case "buf_modified_set":
      store.setDirty(ev.file, ev.modified);
      break;
  }
}

/**
 * Subscribes to nvim → app events from desktopBridge.editor.onEvent.
 * Mounted once at the app shell level so events are captured regardless
 * of the current route.
 */
export function useEditorEventListener(): void {
  const bridge = useDesktopBridgeAvailable();
  const main = useIsMainWindow();

  useEffect(() => {
    if (!shouldSubscribe(bridge, main)) return;
    const editor = window.desktopBridge?.editor;
    if (!editor) return;

    const off = editor.onEvent((ev: EditorEvent) => {
      handleEditorEvent(ev, useEditorStore.getState(), (e) => window.dispatchEvent(e));
    });
    return off;
  }, [bridge, main]);
}
