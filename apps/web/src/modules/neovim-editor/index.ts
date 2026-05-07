// Public API barrel — exports populated by subsequent plans.

/** Module identifier for the neovim-editor feature module. */
export const MODULE_ID = "neovim-editor" as const;

export { useEditorStore, type ChatTab } from "./stores/editorStore";
export { useActiveEditorCwd } from "./hooks/useActiveEditorCwd";
export { useEditorCwdSync } from "./hooks/useEditorCwdSync";
export { useEditorEventListener } from "./hooks/useEditorEventListener";
export { useEditorSendToComposerListener } from "./hooks/useEditorSendToComposerListener";

// Editor context
export type {
  EditorContextSelection,
  EditorContextDraft,
  ExtractedEditorContexts,
  ParsedEditorContextEntry,
} from "./editorContext";
export {
  normalizeEditorContextText,
  hasEditorContextText,
  isEditorContextExpired,
  filterEditorContextsWithText,
  normalizeEditorContextSelection,
  formatEditorContextRange,
  formatEditorContextLabel,
  formatInlineEditorContextLabel,
  buildEditorContextPreviewTitle,
  buildEditorContextBlock,
  appendEditorContextsToPrompt,
  extractTrailingEditorContexts,
} from "./editorContext";

// Components
export {
  ComposerPendingEditorContextChip,
  ComposerPendingEditorContexts,
} from "./components/ComposerPendingEditorContexts";
export { EditorContextInlineChip } from "./components/EditorContextInlineChip";
export { EditorPane } from "./components/EditorPane";
export { ChatTabBar } from "./components/ChatTabBar";
