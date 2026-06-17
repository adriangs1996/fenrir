import { type ThreadId } from "@fenrir/contracts";

export type EditorContextKind = "selection" | "file";

export interface EditorContextSelection {
  file: string;
  lineStart: number;
  lineEnd: number;
  text: string;
  kind?: EditorContextKind;
}

export interface EditorContextDraft extends EditorContextSelection {
  id: string;
  threadId: ThreadId;
  createdAt: string;
}

export interface ExtractedEditorContexts {
  promptText: string;
  contextCount: number;
  previewTitle: string | null;
  contexts: ParsedEditorContextEntry[];
}

export interface ParsedEditorContextEntry {
  file: string;
  lineStart: number;
  lineEnd: number;
  body: string;
  kind?: EditorContextKind;
}

/** Matches a single `<editor_context …>…</editor_context>` block globally. */
const EDITOR_CONTEXT_BLOCK_PATTERN =
  /<editor_context\s+file="((?:[^"\\]|\\.)*)"\s+lineStart="(\d+)"\s+lineEnd="(\d+)">\n([\s\S]*?)\n<\/editor_context>/g;
const EDITOR_FILE_CONTEXT_BLOCK_PATTERN =
  /<editor_file_context\s+file="((?:[^"\\]|\\.)*)"\s+cursorLine="(\d+)">\n([\s\S]*?)\n<\/editor_file_context>/g;

export function normalizeEditorContextText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
}

export function hasEditorContextText(context: { text: string }): boolean {
  return normalizeEditorContextText(context.text).length > 0;
}

export function isEditorContextExpired(context: { text: string }): boolean {
  return !hasEditorContextText(context);
}

export function filterEditorContextsWithText<T extends { text: string }>(
  contexts: ReadonlyArray<T>,
): T[] {
  return contexts.filter((context) => hasEditorContextText(context));
}

export function normalizeEditorContextSelection(
  selection: EditorContextSelection,
): EditorContextSelection | null {
  const text = normalizeEditorContextText(selection.text);
  const file = selection.file.trim();
  if (text.length === 0 || file.length === 0) {
    return null;
  }
  const lineStart = Math.max(1, Math.floor(selection.lineStart));
  const lineEnd = Math.max(lineStart, Math.floor(selection.lineEnd));
  const kind = selection.kind === "file" ? "file" : "selection";
  return { file, lineStart, lineEnd, text, ...(kind === "file" ? { kind } : {}) };
}

export function formatEditorContextRange(selection: {
  lineStart: number;
  lineEnd: number;
}): string {
  return selection.lineStart === selection.lineEnd
    ? `line ${selection.lineStart}`
    : `lines ${selection.lineStart}-${selection.lineEnd}`;
}

export function formatEditorContextLabel(selection: {
  file: string;
  lineStart: number;
  lineEnd: number;
  kind?: EditorContextKind;
}): string {
  if (selection.kind === "file") {
    return `${basenameOfFile(selection.file)} active file`;
  }
  return `${basenameOfFile(selection.file)} ${formatEditorContextRange(selection)}`;
}

export function formatInlineEditorContextLabel(selection: {
  file: string;
  lineStart: number;
  lineEnd: number;
}): string {
  const basename = basenameOfFile(selection.file).toLowerCase().replace(/\s+/g, "-");
  const range =
    selection.lineStart === selection.lineEnd
      ? `${selection.lineStart}`
      : `${selection.lineStart}-${selection.lineEnd}`;
  return `@${basename}:${range}`;
}

function previewEditorContextText(text: string): string {
  const normalized = normalizeEditorContextText(text);
  if (normalized.length === 0) {
    return "";
  }
  const lines = normalized.split("\n");
  const visibleLines = lines.slice(0, 3);
  if (lines.length > 3) {
    visibleLines.push("...");
  }
  const preview = visibleLines.join("\n");
  return preview.length > 180 ? `${preview.slice(0, 177)}...` : preview;
}

export function buildEditorContextPreviewTitle(
  contexts: ReadonlyArray<EditorContextSelection>,
): string | null {
  if (contexts.length === 0) {
    return null;
  }
  const previews = contexts
    .map((context) => {
      const normalized = normalizeEditorContextSelection(context);
      if (!normalized) {
        return null;
      }
      const preview = previewEditorContextText(normalized.text);
      return preview.length > 0
        ? `${formatEditorContextLabel(normalized)}\n${preview}`
        : formatEditorContextLabel(normalized);
    })
    .filter((value): value is string => value !== null)
    .join("\n\n");
  return previews.length > 0 ? previews : null;
}

function buildEditorContextBodyLines(selection: EditorContextSelection): string[] {
  return normalizeEditorContextText(selection.text)
    .split("\n")
    .map((line, index) => `  ${selection.lineStart + index} | ${line}`);
}

export function buildEditorContextBlock(draft: EditorContextDraft): string {
  const normalized = normalizeEditorContextSelection(draft);
  if (!normalized) {
    return "";
  }
  const safeFile = normalized.file.replace(/"/g, '\\"');
  if (normalized.kind === "file") {
    return [
      `<editor_file_context file="${safeFile}" cursorLine="${normalized.lineStart}">`,
      `- Active editor file: ${normalized.file}`,
      `- Cursor line: ${normalized.lineStart}`,
      ...normalizeEditorContextText(normalized.text)
        .split("\n")
        .map((line) => `- ${line}`),
      `</editor_file_context>`,
    ].join("\n");
  }
  const bodyLines = buildEditorContextBodyLines(normalized);
  return [
    `<editor_context file="${safeFile}" lineStart="${normalized.lineStart}" lineEnd="${normalized.lineEnd}">`,
    `- ${formatEditorContextLabel(normalized)}:`,
    ...bodyLines,
    `</editor_context>`,
  ].join("\n");
}

export function appendEditorContextsToPrompt(
  prompt: string,
  contexts: ReadonlyArray<EditorContextDraft>,
): string {
  const blocks = contexts
    .map((context) => buildEditorContextBlock(context))
    .filter((block) => block.length > 0);
  if (blocks.length === 0) {
    return prompt;
  }
  const joined = blocks.join("\n");
  return prompt.length > 0 ? `${prompt}\n\n${joined}` : joined;
}

export function extractTrailingEditorContexts(prompt: string): ExtractedEditorContexts {
  const blocks: Array<{
    start: number;
    end: number;
    kind: EditorContextKind;
    match: RegExpExecArray;
  }> = [];
  let match: RegExpExecArray | null;
  const selectionPattern = new RegExp(EDITOR_CONTEXT_BLOCK_PATTERN.source, "g");
  while ((match = selectionPattern.exec(prompt)) !== null) {
    blocks.push({
      start: match.index,
      end: match.index + match[0].length,
      kind: "selection",
      match,
    });
  }
  const filePattern = new RegExp(EDITOR_FILE_CONTEXT_BLOCK_PATTERN.source, "g");
  while ((match = filePattern.exec(prompt)) !== null) {
    blocks.push({
      start: match.index,
      end: match.index + match[0].length,
      kind: "file",
      match,
    });
  }
  blocks.sort((a, b) => a.start - b.start);

  if (blocks.length === 0) {
    return { promptText: prompt, contextCount: 0, previewTitle: null, contexts: [] };
  }

  // Walk backwards to find the contiguous trailing run of blocks (only
  // whitespace allowed between them and between the last block and the end).
  const trailing: (typeof blocks)[number][] = [];
  let cursor = prompt.length;
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i]!;
    const gap = prompt.slice(block.end, cursor);
    if (gap.trim().length > 0) break;
    trailing.unshift(block);
    cursor = block.start;
  }

  if (trailing.length === 0) {
    return { promptText: prompt, contextCount: 0, previewTitle: null, contexts: [] };
  }

  const promptText = prompt.slice(0, trailing[0]!.start).replace(/\n+$/, "");
  const contexts: ParsedEditorContextEntry[] = trailing.map(({ kind, match: mt }) => {
    const file = (mt[1] ?? "").replace(/\\"/g, '"');
    if (kind === "file") {
      const cursorLine = Number.parseInt(mt[2] ?? "1", 10);
      return {
        file,
        lineStart: cursorLine,
        lineEnd: cursorLine,
        body: mt[3] ?? "",
        kind,
      };
    }
    return {
      file,
      lineStart: Number.parseInt(mt[2] ?? "1", 10),
      lineEnd: Number.parseInt(mt[3] ?? "1", 10),
      body: mt[4] ?? "",
    };
  });

  return {
    promptText,
    contextCount: contexts.length,
    previewTitle: contexts
      .map(({ file, lineStart, lineEnd, body, kind }) => {
        const label = formatEditorContextLabel({
          file,
          lineStart,
          lineEnd,
          ...(kind ? { kind } : {}),
        });
        return body.length > 0 ? `${label}\n${body}` : label;
      })
      .join("\n\n"),
    contexts,
  };
}

function basenameOfFile(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return lastSlash === -1 ? filePath : filePath.slice(lastSlash + 1);
}
