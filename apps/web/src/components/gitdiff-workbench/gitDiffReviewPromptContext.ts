import type {
  ChangeRequestReviewThread,
  DiffTarget,
  GitDiffHunkSummary,
  LoadDiffFileResult,
} from "@fenrir/contracts";

export type GitDiffReviewLineSelection = {
  readonly side: "additions" | "deletions";
  readonly start: number;
  readonly end: number;
  readonly text: string | null;
};

export interface GitDiffReviewPromptContext {
  readonly filePath: string;
  readonly previousPath: string | null;
  readonly repositoryCwd: string;
  readonly projectCwd: string;
  readonly threadWorktreePath: string | null;
  readonly branch: string | null;
  readonly target: DiffTarget | null;
  readonly selection: GitDiffReviewLineSelection | null;
  readonly reviewThreads: readonly ChangeRequestReviewThread[];
}

function basenameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/g, "");
  return normalized.split("/").findLast((part) => part.length > 0) ?? normalized;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatLineRange(start: number, end: number): string {
  return start === end ? `line ${start}` : `lines ${start}-${end}`;
}

function normalizeMultilineText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
}

export function formatGitDiffReviewSelectionLabel(
  selection: Pick<GitDiffReviewLineSelection, "side" | "start" | "end">,
): string {
  return `${selection.side} ${formatLineRange(selection.start, selection.end)}`;
}

export function formatDiffTargetLabel(target: DiffTarget | null): string {
  if (!target) return "current diff";
  switch (target.kind) {
    case "worktree":
      return "working tree";
    case "staged":
      return "staged changes";
    case "range":
      return `${target.baseRef}..${target.headRef}`;
    case "commit":
      return target.parentRef
        ? `commit ${target.commitRef} from ${target.parentRef}`
        : `commit ${target.commitRef}`;
    case "stash":
      return `stash ${target.ref}`;
  }
}

export function extractGitDiffReviewSelectionText(
  diff: LoadDiffFileResult | undefined,
  selection: Pick<GitDiffReviewLineSelection, "side" | "start" | "end"> | null,
): string | null {
  if (!diff || !selection) return null;
  const file = selection.side === "additions" ? diff.newFile : diff.oldFile;
  if (!file) return null;

  const lines = file.contents.replace(/\r\n/g, "\n").split("\n");
  const selectedLines = lines.slice(selection.start - 1, selection.end);
  const text = normalizeMultilineText(selectedLines.join("\n"));
  return text.length > 0 ? text : null;
}

export function resolveGitDiffReviewSelectionHunkIndex(
  hunks: readonly GitDiffHunkSummary[],
  selection: Pick<GitDiffReviewLineSelection, "side" | "start" | "end"> | null,
): number | null {
  if (!selection) return null;

  const selectionStart = Math.min(selection.start, selection.end);
  const selectionEnd = Math.max(selection.start, selection.end);
  if (selectionStart < 1 || selectionEnd < 1) return null;

  for (const hunk of hunks) {
    const start = selection.side === "additions" ? hunk.newStart : hunk.oldStart;
    const lineCount = selection.side === "additions" ? hunk.newLines : hunk.oldLines;
    const end = Math.max(start, start + Math.max(lineCount, 1) - 1);
    if (start <= selectionEnd && selectionStart <= end) {
      return hunk.index;
    }
  }

  return null;
}

export function formatGitDiffReviewContextTitle(context: GitDiffReviewPromptContext): string {
  const file = basenameFromPath(context.filePath);
  return context.selection
    ? `${file} ${formatGitDiffReviewSelectionLabel(context.selection)}`
    : `${file} review`;
}

export function formatGitDiffReviewContextLabels(
  context: GitDiffReviewPromptContext,
): readonly string[] {
  return [
    context.selection
      ? `${basenameFromPath(context.filePath)} ${formatGitDiffReviewSelectionLabel(context.selection)}`
      : `${basenameFromPath(context.filePath)} review`,
    context.branch ? `branch ${context.branch}` : "detached HEAD",
    context.repositoryCwd,
  ];
}

function formatSelectedLines(selection: GitDiffReviewLineSelection): readonly string[] {
  if (!selection.text) {
    return ["- Selected line text unavailable from this diff payload."];
  }

  return selection.text.split("\n").map((line, index) => {
    const lineNumber = selection.start + index;
    return `  ${lineNumber} | ${line}`;
  });
}

function reviewThreadRange(thread: ChangeRequestReviewThread): {
  readonly start: number;
  readonly end: number;
} {
  const start = thread.startLine ?? thread.line;
  return {
    start: Math.min(start, thread.line),
    end: Math.max(start, thread.line),
  };
}

function reviewThreadOverlapsSelection(
  thread: ChangeRequestReviewThread,
  selection: GitDiffReviewLineSelection | null,
): boolean {
  if (!selection || thread.side !== selection.side) {
    return false;
  }

  const threadRange = reviewThreadRange(thread);
  return threadRange.start <= selection.end && selection.start <= threadRange.end;
}

function reviewCommentCount(threads: readonly ChangeRequestReviewThread[]): number {
  return threads.reduce((total, thread) => total + thread.comments.length, 0);
}

function formatReviewCommentAttributes(
  comment: ChangeRequestReviewThread["comments"][number],
): string {
  return [
    `id="${escapeAttribute(comment.id)}"`,
    `author="${escapeAttribute(comment.author.login)}"`,
    ...(comment.createdAt ? [`createdAt="${escapeAttribute(comment.createdAt)}"`] : []),
    ...(comment.updatedAt ? [`updatedAt="${escapeAttribute(comment.updatedAt)}"`] : []),
    ...(comment.url ? [`url="${escapeAttribute(comment.url)}"`] : []),
  ].join(" ");
}

function formatReviewCommentLines(
  comment: ChangeRequestReviewThread["comments"][number],
): readonly string[] {
  const body = normalizeMultilineText(comment.body);
  const bodyLines = body.length > 0 ? body.split("\n") : ["(empty comment)"];
  return [
    `<review_comment ${formatReviewCommentAttributes(comment)}>`,
    ...bodyLines.map((line) => `  ${line}`),
    "</review_comment>",
  ];
}

function formatReviewThreadLines(
  thread: ChangeRequestReviewThread,
  selection: GitDiffReviewLineSelection | null,
): readonly string[] {
  const range = reviewThreadRange(thread);
  const overlapsSelection = reviewThreadOverlapsSelection(thread, selection);
  return [
    `<review_thread id="${escapeAttribute(thread.id)}" path="${escapeAttribute(thread.path)}" side="${thread.side}" startLine="${range.start}" line="${range.end}" overlapsSelection="${overlapsSelection ? "true" : "false"}">`,
    `- Location: ${thread.side} ${formatLineRange(range.start, range.end)}`,
    `- State: ${thread.isResolved ? "resolved" : "unresolved"}${thread.isOutdated ? ", outdated" : ""}`,
    ...(thread.comments.length > 0
      ? thread.comments.flatMap(formatReviewCommentLines)
      : ["- No comments in thread."]),
    "</review_thread>",
  ];
}

export function buildGitDiffReviewContextBlock(context: GitDiffReviewPromptContext): string {
  const attrs = [
    `file="${escapeAttribute(context.filePath)}"`,
    `repositoryCwd="${escapeAttribute(context.repositoryCwd)}"`,
    context.branch ? `branch="${escapeAttribute(context.branch)}"` : `branch=""`,
    `target="${escapeAttribute(formatDiffTargetLabel(context.target))}"`,
  ];
  const selection = context.selection;
  const commentCount = reviewCommentCount(context.reviewThreads);

  return [
    `<git_diff_review_context ${attrs.join(" ")}>`,
    `- Repository cwd: ${context.repositoryCwd}`,
    `- Project cwd: ${context.projectCwd}`,
    ...(context.threadWorktreePath
      ? [`- Thread worktree path: ${context.threadWorktreePath}`]
      : []),
    `- Branch: ${context.branch ?? "detached HEAD"}`,
    `- Diff target: ${formatDiffTargetLabel(context.target)}`,
    `- File: ${context.filePath}`,
    ...(context.previousPath ? [`- Previous file: ${context.previousPath}`] : []),
    selection
      ? `- Visual selection: ${formatGitDiffReviewSelectionLabel(selection)}`
      : "- Visual selection: none",
    context.reviewThreads.length > 0
      ? `- Review comments: ${context.reviewThreads.length} ${context.reviewThreads.length === 1 ? "thread" : "threads"}, ${commentCount} ${commentCount === 1 ? "comment" : "comments"}`
      : "- Review comments: none",
    ...(selection
      ? [
          `<selected_diff_lines side="${selection.side}" start="${selection.start}" end="${selection.end}">`,
          ...formatSelectedLines(selection),
          "</selected_diff_lines>",
        ]
      : []),
    ...(context.reviewThreads.length > 0
      ? [
          "<review_comments>",
          ...context.reviewThreads.flatMap((thread) => formatReviewThreadLines(thread, selection)),
          "</review_comments>",
        ]
      : []),
    "</git_diff_review_context>",
  ].join("\n");
}

export function appendGitDiffReviewContextToPrompt(
  prompt: string,
  context: GitDiffReviewPromptContext,
): string {
  const block = buildGitDiffReviewContextBlock(context);
  return prompt.length > 0 ? `${prompt}\n\n${block}` : block;
}
