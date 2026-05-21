import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveStorage } from "~/lib/storage";
import type { EditorContextDraft } from "../editorContext";

export type ChatTab = "thread" | "review" | "terminal" | "editor";

interface EditorState {
  /** Currently active chat tab. Global — same across thread switches. */
  activeChatTab: ChatTab;
  setActiveChatTab: (tab: ChatTab) => void;
  toggleChatTab: () => void;

  /** Current file path open in nvim (from BufEnter rpcnotify). null when no buffer. */
  currentFile: string | null;
  setCurrentFile: (file: string | null) => void;

  /** Set of file paths currently modified in nvim (BufModifiedSet). */
  dirtyFiles: Set<string>;
  setDirty: (file: string, modified: boolean) => void;

  /** Pending editor context drafts awaiting send with the next message. */
  pendingContexts: EditorContextDraft[];
  addPendingContext: (draft: EditorContextDraft) => void;
  removePendingContext: (id: string) => void;
  clearPendingContexts: () => void;

  /** Reset volatile state on respawn. Tab choice is preserved. */
  resetVolatile: () => void;
}

function createEditorStorage() {
  return resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined);
}

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => ({
      activeChatTab: "thread",
      setActiveChatTab: (tab) => set({ activeChatTab: tab }),
      toggleChatTab: () =>
        set({ activeChatTab: get().activeChatTab === "editor" ? "thread" : "editor" }),

      currentFile: null,
      setCurrentFile: (file) => set({ currentFile: file }),

      dirtyFiles: new Set(),
      setDirty: (file, modified) =>
        set((state) => {
          const next = new Set(state.dirtyFiles);
          if (modified) next.add(file);
          else next.delete(file);
          return { dirtyFiles: next };
        }),

      pendingContexts: [],
      addPendingContext: (draft) =>
        set((s) => ({ pendingContexts: [...s.pendingContexts, draft] })),
      removePendingContext: (id) =>
        set((s) => ({ pendingContexts: s.pendingContexts.filter((d) => d.id !== id) })),
      clearPendingContexts: () => set({ pendingContexts: [] }),

      resetVolatile: () => set({ currentFile: null, dirtyFiles: new Set(), pendingContexts: [] }),
    }),
    {
      name: "fenrir:editor",
      storage: createJSONStorage(createEditorStorage),
      // Persist only the tab choice. currentFile / dirtyFiles are nvim-runtime
      // and rebuild from autocmd events on next attach.
      partialize: (s) => ({ activeChatTab: s.activeChatTab }),
    },
  ),
);
