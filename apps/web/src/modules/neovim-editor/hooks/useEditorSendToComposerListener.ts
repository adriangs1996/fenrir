import { useEffect, useRef } from "react";
import { useParams } from "@tanstack/react-router";
import type { EditorSendToComposer } from "@fenrir/contracts";
import { useDesktopBridgeAvailable, useIsMainWindow } from "~/hooks/useDesktopBridge";
import { resolveThreadRouteTarget } from "~/threadRoutes";
import { randomUUID } from "~/lib/utils";
import type { EditorContextDraft } from "../editorContext";
import { useEditorStore } from "../stores/editorStore";

/**
 * Whether the listener should subscribe (both bridge and main window required).
 */
export function shouldSubscribe(bridge: boolean, main: boolean): boolean {
  return bridge && main;
}

/**
 * Pure handler for editor send-to-composer events. Returns the draft if valid,
 * null otherwise. Testable without React.
 */
export function handleSendToComposer(
  ev: EditorSendToComposer,
  threadId: string | null,
): EditorContextDraft | null {
  if (!threadId) return null;
  const text = ev.text?.trim();
  if (!text || !ev.file) return null;
  return {
    id: randomUUID(),
    threadId: threadId as EditorContextDraft["threadId"],
    createdAt: new Date().toISOString(),
    file: ev.file,
    lineStart: ev.lineStart,
    lineEnd: ev.lineEnd,
    text: ev.text,
  };
}

/**
 * Subscribes to nvim → app send-to-composer events from
 * `desktopBridge.editor.onSendToComposer`. Creates an `EditorContextDraft`,
 * pushes it into the editor store, switches to the thread tab, and
 * focuses the composer textarea.
 *
 * Mounted once at the app shell level alongside `useEditorEventListener`.
 */
export function useEditorSendToComposerListener(): void {
  const bridge = useDesktopBridgeAvailable();
  const main = useIsMainWindow();

  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const activeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;

  // Keep a ref so the async callback always reads the latest thread.
  const threadRefRef = useRef(activeThreadRef);
  threadRefRef.current = activeThreadRef;

  useEffect(() => {
    if (!shouldSubscribe(bridge, main)) return;
    const editor = window.desktopBridge?.editor;
    if (!editor) return;

    const off = editor.onSendToComposer((ev: EditorSendToComposer) => {
      const currentRef = threadRefRef.current;
      const threadId = currentRef?.threadId ?? null;
      const draft = handleSendToComposer(ev, threadId as string | null);
      if (!draft) {
        console.warn("[editor] send-to-composer with no active thread; dropping");
        return;
      }

      useEditorStore.getState().addPendingContext(draft);

      // Q12.3 = A: auto-switch to thread tab + focus composer.
      useEditorStore.getState().setActiveChatTab("thread");
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>("[data-composer-textarea]");
        el?.focus();
      });
    });
    return off;
  }, [bridge, main]);
}
