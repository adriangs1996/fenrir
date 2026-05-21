import type {
  ReviewChunkPayload,
  ReviewDiffChunk,
  ReviewDiffChunkLine,
  ReviewDiffFileEntry,
  ReviewDiffFilePatch,
  ReviewProgressState,
  ReviewRawLaneKind,
} from "../../../../../packages/contracts/src/review";

export type ReviewExplorerSectionKey = "ignored" | "unstaged" | "staged" | "committed";

export interface ReviewRawSelectionTarget {
  readonly selectionKey: string;
  readonly targetKind: "file" | "chunk";
  readonly lane: ReviewRawLaneKind;
  readonly normalizedPath: string;
  readonly displayPath: string;
  readonly label: string;
  readonly fileId: string;
  readonly chunkId?: string;
  readonly lineStart?: number | null;
}

export interface ReviewRawMutationAvailability {
  readonly stage: boolean;
  readonly unstage: boolean;
  readonly undo: boolean;
  readonly ignore: boolean;
  readonly unignore: boolean;
}

export function reviewSectionKeyForLane(lane: ReviewRawLaneKind): ReviewExplorerSectionKey {
  switch (lane) {
    case "ignored":
      return "ignored";
    case "staged":
      return "staged";
    case "committed":
      return "committed";
    case "unstaged":
    case "inverse-edit":
      return "unstaged";
  }
}

export function reviewSectionTitle(sectionKey: ReviewExplorerSectionKey): string {
  switch (sectionKey) {
    case "ignored":
      return "Ignored";
    case "unstaged":
      return "Unstaged";
    case "staged":
      return "Staged";
    case "committed":
      return "Committed on branch";
  }
}

export function buildFileSelectionTarget(file: ReviewDiffFileEntry): ReviewRawSelectionTarget {
  return {
    selectionKey: `file:${file.fileId}`,
    targetKind: "file",
    lane: file.lane,
    normalizedPath: file.normalizedPath,
    displayPath: file.displayPath,
    label: file.displayPath,
    fileId: file.fileId,
  };
}

export function buildChunkSelectionTarget(
  file: ReviewDiffFileEntry,
  chunk: ReviewDiffChunk,
): ReviewRawSelectionTarget {
  return {
    selectionKey: `chunk:${chunk.chunkId}`,
    targetKind: "chunk",
    lane: file.lane,
    normalizedPath: file.normalizedPath,
    displayPath: file.displayPath,
    label: `${file.displayPath} ${chunk.header}`,
    fileId: file.fileId,
    chunkId: chunk.chunkId,
    lineStart: chunk.anchor.newRange?.startLine ?? chunk.anchor.oldRange?.startLine ?? null,
  };
}

export function deriveRawMutationAvailability(
  targets: ReadonlyArray<ReviewRawSelectionTarget>,
): ReviewRawMutationAvailability {
  if (targets.length === 0) {
    return {
      stage: false,
      unstage: false,
      undo: false,
      ignore: false,
      unignore: false,
    };
  }

  return {
    stage: targets.every((target) => target.lane === "unstaged"),
    unstage: targets.every((target) => target.lane === "staged"),
    undo: targets.every((target) => target.lane !== "ignored"),
    ignore: targets.every((target) => target.targetKind === "file" && target.lane !== "ignored"),
    unignore: targets.every((target) => target.targetKind === "file" && target.lane === "ignored"),
  };
}

export function bulkProgressStatesForTargets(
  targets: ReadonlyArray<ReviewRawSelectionTarget>,
): readonly ReviewProgressState[] {
  return targets.length > 0 ? ["unreviewed", "reviewed", "needs-follow-up"] : [];
}

export function resolveOpenChangeTarget(args: {
  readonly cwd: string;
  readonly file: ReviewDiffFileEntry;
  readonly patch?: ReviewDiffFilePatch | null;
  readonly chunk?: ReviewDiffChunk | null;
  readonly chunkPayload?: ReviewChunkPayload | null;
}): string {
  const preferredChunk = args.chunk ?? args.patch?.chunks[0] ?? null;
  const line =
    resolveCurrentFileLine(preferredChunk) ??
    args.chunkPayload?.anchor.newRange?.startLine ??
    args.chunk?.anchor.newRange?.startLine ??
    args.patch?.chunks[0]?.anchor.newRange?.startLine ??
    null;
  const base = `${args.cwd.replace(/\/+$/g, "")}/${args.file.normalizedPath}`;
  return line ? `${base}:${line}` : base;
}

function resolveCurrentFileLine(chunk: ReviewDiffChunk | null | undefined): number | null {
  if (!chunk) {
    return null;
  }
  const directTarget =
    chunk.anchor.newRange?.startLine ??
    findNearestSurvivingLine(chunk.lines, chunk.anchor.oldRange?.startLine ?? null);
  return directTarget ?? null;
}

function findNearestSurvivingLine(
  lines: ReadonlyArray<ReviewDiffChunkLine>,
  deletedLine: number | null,
): number | null {
  const survivingLines = lines
    .filter((line) => line.newLineNumber !== undefined)
    .map((line) => line.newLineNumber!);
  if (survivingLines.length === 0) {
    return null;
  }
  if (deletedLine === null) {
    return survivingLines[0] ?? null;
  }

  let bestLine = survivingLines[0] ?? null;
  let bestDistance =
    bestLine === null ? Number.POSITIVE_INFINITY : Math.abs(bestLine - deletedLine);
  for (const candidate of survivingLines.slice(1)) {
    const distance = Math.abs(candidate - deletedLine);
    if (distance < bestDistance) {
      bestLine = candidate;
      bestDistance = distance;
    }
  }
  return bestLine;
}

function snippetFromChunk(chunk: ReviewDiffChunk): string {
  const lines = chunk.lines
    .filter((line) => line.kind !== "context")
    .slice(0, 8)
    .map(
      (line) => `${line.kind === "add" ? "+" : line.kind === "delete" ? "-" : " "} ${line.text}`,
    );
  if (lines.length > 0) {
    return lines.join("\n");
  }
  return chunk.lines
    .slice(0, 8)
    .map((line) => `  ${line.text}`)
    .join("\n");
}

function snippetFromPatch(patch: ReviewDiffFilePatch): string {
  return patch.chunks
    .slice(0, 2)
    .flatMap((chunk) => [chunk.header, snippetFromChunk(chunk)])
    .filter((value) => value.trim().length > 0)
    .join("\n");
}

export function buildAskAgentPrompt(args: {
  readonly mode: "selection" | "risk";
  readonly targets: ReadonlyArray<ReviewRawSelectionTarget>;
  readonly selectedFile?: ReviewDiffFileEntry | null;
  readonly selectedPatch?: ReviewDiffFilePatch | null;
  readonly selectedChunk?: ReviewDiffChunk | null;
}): string {
  const lead =
    args.mode === "risk"
      ? "Review these raw changes for risk, regressions, and missing tests."
      : "Help me reason about these raw changes and suggest the next action.";
  const targetLines = args.targets.slice(0, 8).map((target) => {
    const lineSuffix =
      target.targetKind === "chunk" && target.lineStart ? `:${target.lineStart}` : "";
    return `- ${target.displayPath}${lineSuffix} (${target.lane})`;
  });
  const snippet =
    args.selectedChunk !== null && args.selectedChunk !== undefined
      ? snippetFromChunk(args.selectedChunk)
      : args.selectedPatch
        ? snippetFromPatch(args.selectedPatch)
        : "";

  return [
    lead,
    "",
    "Selected review targets:",
    ...targetLines,
    ...(snippet.length > 0 ? ["", "Patch excerpt:", "```diff", snippet, "```"] : []),
  ].join("\n");
}
