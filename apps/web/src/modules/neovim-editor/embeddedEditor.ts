import type { EmbeddedEditorKind } from "@fenrir/contracts/settings";

export const EMBEDDED_EDITOR_LABELS = {
  neovim: "Neovim",
  vscode: "VS Code",
} as const satisfies Record<EmbeddedEditorKind, string>;

export const EMBEDDED_EDITOR_OPTIONS = [
  { value: "neovim", label: EMBEDDED_EDITOR_LABELS.neovim },
  { value: "vscode", label: EMBEDDED_EDITOR_LABELS.vscode },
] as const satisfies ReadonlyArray<{ value: EmbeddedEditorKind; label: string }>;

export function isEmbeddedEditorKind(value: string): value is EmbeddedEditorKind {
  return value === "neovim" || value === "vscode";
}

export function resolveActiveEmbeddedEditor(input: {
  readonly preferredEditor: EmbeddedEditorKind;
  readonly nvimReady: boolean;
  readonly vscodeReady: boolean;
}): EmbeddedEditorKind {
  if (input.preferredEditor === "neovim" && input.nvimReady) return "neovim";
  if (input.preferredEditor === "vscode" && input.vscodeReady) return "vscode";
  return input.nvimReady ? "neovim" : "vscode";
}
