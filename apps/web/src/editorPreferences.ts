import { EDITORS, EditorId, LocalApi } from "@fenrir/contracts";
import { getLocalStorageItem, setLocalStorageItem, useLocalStorage } from "./hooks/useLocalStorage";
import { useMemo } from "react";
import { useEditorStore } from "~/modules/neovim-editor";

const LAST_EDITOR_KEY = "fenrir:last-editor";

interface PreferredEditorOptions {
  readonly allowEmbedded?: boolean;
}

export function usePreferredEditor(availableEditors: ReadonlyArray<EditorId>) {
  const [lastEditor, setLastEditor] = useLocalStorage(LAST_EDITOR_KEY, null, EditorId);

  const effectiveEditor = useMemo(() => {
    if (lastEditor && availableEditors.includes(lastEditor)) return lastEditor;
    return EDITORS.find((editor) => availableEditors.includes(editor.id))?.id ?? null;
  }, [lastEditor, availableEditors]);

  return [effectiveEditor, setLastEditor] as const;
}

export function resolveAndPersistPreferredEditor(
  availableEditors: readonly EditorId[],
  options: PreferredEditorOptions = {},
): EditorId | null {
  const allowEmbedded = options.allowEmbedded ?? true;
  const filteredEditors = allowEmbedded
    ? availableEditors
    : availableEditors.filter((editorId) => editorId !== "fenrir-embedded");
  const availableEditorIds = new Set(filteredEditors);
  const stored = getLocalStorageItem(LAST_EDITOR_KEY, EditorId);
  if (stored && availableEditorIds.has(stored)) return stored;
  const editor = EDITORS.find((entry) => availableEditorIds.has(entry.id))?.id ?? null;
  if (editor) setLocalStorageItem(LAST_EDITOR_KEY, editor, EditorId);
  return editor ?? null;
}

export async function openInPreferredEditor(
  api: LocalApi,
  targetPath: string,
  options: PreferredEditorOptions = {},
): Promise<EditorId> {
  const { availableEditors } = await api.server.getConfig();
  const editor = resolveAndPersistPreferredEditor(availableEditors, options);
  if (!editor) throw new Error("No available editors found.");

  if (editor === "fenrir-embedded") {
    await openInEmbeddedEditor(targetPath);
    return editor;
  }

  await api.shell.openInEditor(targetPath, editor);
  return editor;
}

/**
 * Open a target path in the embedded neovim editor and switch to the editor tab.
 *
 * Parses `path:line:col` if present, calls `desktopBridge.editor.openFile`,
 * and sets the active chat tab to "editor".
 */
export async function openInEmbeddedEditor(target: string): Promise<void> {
  const bridge = window.desktopBridge?.editor;
  if (!bridge) throw new Error("desktop bridge unavailable");

  const { path, line, col } = parseTargetPath(target);
  await bridge.openFile({
    path,
    ...(line !== null && { line }),
    ...(col !== null && { col }),
  });

  // Auto-switch to editor tab (Q11.2 = A).
  useEditorStore.getState().setActiveChatTab("editor");
}

/**
 * Parse a target string that may contain an optional `:line` or `:line:col` suffix.
 *
 * Supports:
 *  - `/path/to/file.ts`
 *  - `/path/to/file.ts:42`
 *  - `/path/to/file.ts:42:7`
 */
export function parseTargetPath(target: string): {
  path: string;
  line: number | null;
  col: number | null;
} {
  const match = /^(.*?)(?::(\d+))?(?::(\d+))?$/.exec(target);
  if (!match) return { path: target, line: null, col: null };
  return {
    path: match[1] ?? target,
    line: match[2] ? Number(match[2]) : null,
    col: match[3] ? Number(match[3]) : null,
  };
}
