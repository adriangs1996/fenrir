// Terminal module barrel export

// Store
export {
  migratePersistedTerminalStateStoreState,
  selectTerminalEventEntries,
  selectThreadTerminalState,
  useTerminalStateStore,
  type ThreadTerminalLaunchContext,
  type TerminalEventEntry,
} from "./stores/terminalState";

// Activity
export { terminalRunningSubprocessFromEvent } from "./terminalActivity";

// Links
export {
  extractTerminalLinks,
  isTerminalLinkActivation,
  resolvePathLinkTarget,
  splitPathAndPosition,
  type TerminalLinkKind,
  type TerminalLinkMatch,
} from "./terminalLinks";

// Context
export {
  appendTerminalContextsToPrompt,
  buildTerminalContextBlock,
  buildTerminalContextPreviewTitle,
  countInlineTerminalContextPlaceholders,
  deriveDisplayedUserMessageState,
  ensureInlineTerminalContextPlaceholders,
  extractTrailingTerminalContexts,
  filterTerminalContextsWithText,
  formatInlineTerminalContextLabel,
  formatTerminalContextLabel,
  formatTerminalContextRange,
  hasTerminalContextText,
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  insertInlineTerminalContextPlaceholder,
  isTerminalContextExpired,
  materializeInlineTerminalContextPrompt,
  normalizeTerminalContextSelection,
  normalizeTerminalContextText,
  removeInlineTerminalContextPlaceholder,
  stripInlineTerminalContextPlaceholders,
  type DisplayedUserMessageState,
  type ExtractedTerminalContexts,
  type ParsedTerminalContextEntry,
  type TerminalContextDraft,
  type TerminalContextSelection,
} from "./terminalContext";

// Focus
export { isTerminalFocused } from "./terminalFocus";

// Extract last command output
export { extractLastCommandOutput, looksLikePromptLine } from "./extractLastCommandOutput";

// State cleanup
export { collectActiveTerminalThreadIds } from "./terminalStateCleanup";

// User message terminal contexts
export {
  buildInlineTerminalContextText,
  formatInlineTerminalContextLabel as formatInlineTerminalContextHeaderLabel,
  textContainsInlineTerminalContextLabels,
} from "./userMessageTerminalContexts";

// Components
export { default as ThreadTerminalDrawer } from "./components/ThreadTerminalDrawer";
export {
  TerminalViewport,
  selectTerminalEventEntriesAfterSnapshot,
  selectPendingTerminalEventEntries,
  resolveTerminalSelectionActionPosition,
  terminalSelectionActionDelayForClickCount,
  shouldHandleTerminalSelectionMouseUp,
} from "./components/ThreadTerminalDrawer";
export {
  ComposerPendingTerminalContextChip,
  ComposerPendingTerminalContexts,
} from "./components/ComposerPendingTerminalContexts";
export { TerminalContextInlineChip } from "./components/TerminalContextInlineChip";
