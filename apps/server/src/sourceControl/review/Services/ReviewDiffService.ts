import { createHash } from "node:crypto";

import type {
  ReviewDiffFileChangeKind,
  ReviewDiffFileEntry,
  ReviewDiffFilePatch,
  ReviewDiffIgnoreRuleRef,
  ReviewDiffLane,
  ReviewDiffMetadataCard,
  ReviewDiffSnapshot,
  ReviewRawLaneKind,
  ReviewScope,
  ReviewSessionTarget,
  ReviewStableAnchor,
} from "@fenrir/contracts/sourceControlReview";
import {
  ReviewChunkId,
  ReviewFileId,
  ReviewGroupId,
  ReviewSessionId,
} from "@fenrir/contracts/sourceControlReview";
import type {
  GitCommandError,
  GitManagerServiceError,
  GitStatusStreamEvent,
} from "@fenrir/contracts";
import {
  hashReviewAnchor,
  hashReviewText,
  normalizeReviewExcerpt,
  normalizeReviewPath,
} from "@fenrir/shared/sourceControlReview";
import { Data, Duration, Effect, Context, Stream } from "effect";

import type { ProjectionRepositoryError } from "../../../persistence/Errors.ts";
import type { ReviewIgnoreRuleRecord } from "../../../persistence/Services/ReviewIgnoreRules.ts";

const DEFAULT_PATCH_OUTPUT_BYTES = 1_500_000;

const LANE_ORDER: Record<ReviewScope, ReadonlyArray<ReviewRawLaneKind>> = {
  uncommitted: ["ignored", "unstaged", "staged", "inverse-edit"],
  branch: ["committed"],
  combined: ["ignored", "unstaged", "staged", "committed", "inverse-edit"],
};

const LANE_TITLES: Record<ReviewRawLaneKind, string> = {
  ignored: "Ignored",
  unstaged: "Unstaged",
  staged: "Staged",
  committed: "Committed on branch",
  "inverse-edit": "Inverse edit",
};

export class ReviewDiffServiceError extends Data.TaggedError("ReviewDiffServiceError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type ReviewDiffServiceErrorCause =
  | ReviewDiffServiceError
  | GitCommandError
  | GitManagerServiceError
  | ProjectionRepositoryError;

export interface LoadReviewDiffInput {
  readonly sessionId: ReviewSessionId;
  readonly scope: ReviewScope;
  readonly target: ReviewSessionTarget;
}

export interface LoadReviewFilePatchInput extends LoadReviewDiffInput {
  readonly lane: ReviewRawLaneKind;
  readonly normalizedPath: string;
}

export interface LoadedReviewDiffChunkArtifact {
  readonly chunkId: ReviewChunkId;
  readonly anchor: ReviewStableAnchor;
  readonly rawPatch: string;
}

export interface LoadedReviewDiffFilePatchArtifact {
  readonly patch: ReviewDiffFilePatch;
  readonly rawPatch: string;
  readonly chunkArtifacts: ReadonlyArray<LoadedReviewDiffChunkArtifact>;
}

export interface ReviewDiffServiceShape {
  readonly loadSnapshot: (
    input: LoadReviewDiffInput,
  ) => Effect.Effect<ReviewDiffSnapshot, ReviewDiffServiceErrorCause>;
  readonly loadFilePatch: (
    input: LoadReviewFilePatchInput,
  ) => Effect.Effect<ReviewDiffFilePatch | null, ReviewDiffServiceErrorCause>;
  readonly loadFilePatchArtifact: (
    input: LoadReviewFilePatchInput,
  ) => Effect.Effect<LoadedReviewDiffFilePatchArtifact | null, ReviewDiffServiceErrorCause>;
  readonly streamSnapshots: (
    input: LoadReviewDiffInput,
  ) => Stream.Stream<ReviewDiffSnapshot, ReviewDiffServiceErrorCause>;
}

export class ReviewDiffService extends Context.Service<ReviewDiffService, ReviewDiffServiceShape>()(
  "t3/review/Services/ReviewDiffService",
) {}

interface ReviewDiffDependencies {
  readonly executeGit: (
    cwd: string,
    args: ReadonlyArray<string>,
    options?: { readonly maxOutputBytes?: number },
  ) => Effect.Effect<{ readonly stdout: string; readonly code: number }, GitCommandError>;
  readonly streamGitStatus: (
    cwd: string,
  ) => Stream.Stream<GitStatusStreamEvent, GitManagerServiceError>;
  readonly listReviewIgnoreRules: (
    checkoutPath: string,
  ) => Effect.Effect<ReadonlyArray<ReviewIgnoreRuleRecord>, ProjectionRepositoryError>;
}

interface RawDiffEntry {
  readonly path: string;
  readonly previousPath: string | null;
  readonly status: string;
  readonly oldMode: string;
  readonly newMode: string;
}

interface NumstatEntry {
  readonly path: string;
  readonly previousPath: string | null;
  readonly insertions: number;
  readonly deletions: number;
  readonly isBinary: boolean;
}

interface ReviewLaneFileRecord {
  readonly lane: ReviewRawLaneKind;
  readonly provenance: ReviewDiffFileEntry["provenance"];
  readonly path: string;
  readonly previousPath: string | null;
  readonly changeKind: ReviewDiffFileChangeKind;
  readonly insertions: number;
  readonly deletions: number;
  readonly metadata: ReviewDiffMetadataCard | undefined;
  readonly ignoreRule?: ReviewDiffIgnoreRuleRef;
}

interface ParsedPatchLine {
  readonly kind: "context" | "add" | "delete";
  readonly text: string;
  readonly oldLineNumber?: number;
  readonly newLineNumber?: number;
}

interface ParsedPatchChunk {
  readonly header: string;
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly lines: ReadonlyArray<ParsedPatchLine>;
}

interface ParsedPatchChunkArtifact {
  readonly parsedChunk: ParsedPatchChunk;
  readonly rawPatch: string;
}

function stableEntityId(prefix: string, parts: ReadonlyArray<string>): string {
  const digest = createHash("sha256").update(parts.join("\u241f")).digest("hex").slice(0, 24);
  return `${prefix}-${digest}`;
}

function toGroupId(sessionId: ReviewSessionId, lane: ReviewRawLaneKind): ReviewGroupId {
  return ReviewGroupId.make(stableEntityId("review-group", [sessionId, lane]));
}

function toFileId(
  sessionId: ReviewSessionId,
  lane: ReviewRawLaneKind,
  normalizedPath: string,
): ReviewFileId {
  return ReviewFileId.make(stableEntityId("review-file", [sessionId, lane, normalizedPath]));
}

function splitNullSeparated(input: string): string[] {
  return input.split("\0").filter((value) => value.length > 0);
}

function parseRawDiffEntries(stdout: string): ReadonlyArray<RawDiffEntry> {
  const tokens = splitNullSeparated(stdout);
  const entries: RawDiffEntry[] = [];

  for (let index = 0; index < tokens.length; ) {
    const header = tokens[index++];
    if (!header?.startsWith(":")) {
      continue;
    }

    const lastSpace = header.lastIndexOf(" ");
    const [oldMode = "", newMode = ""] = header
      .slice(1, lastSpace)
      .split(" ")
      .filter((part) => part.length > 0);
    const status = header.slice(lastSpace + 1).trim();

    if (status.startsWith("R") || status.startsWith("C")) {
      const previousPath = tokens[index++] ?? "";
      const nextPath = tokens[index++] ?? "";
      if (nextPath.length > 0) {
        entries.push({
          path: normalizeReviewPath(nextPath),
          previousPath: normalizeReviewPath(previousPath),
          status,
          oldMode,
          newMode,
        });
      }
      continue;
    }

    const nextPath = tokens[index++] ?? "";
    if (nextPath.length > 0) {
      entries.push({
        path: normalizeReviewPath(nextPath),
        previousPath: null,
        status,
        oldMode,
        newMode,
      });
    }
  }

  return entries;
}

function parseNumstatEntries(stdout: string): ReadonlyArray<NumstatEntry> {
  const tokens = stdout.split("\0");
  const entries: NumstatEntry[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || !token.includes("\t")) {
      continue;
    }

    const [rawInsertions = "", rawDeletions = "", rawPath = ""] = token.split("\t");
    if (rawPath.length > 0) {
      entries.push({
        path: normalizeReviewPath(rawPath),
        previousPath: null,
        insertions: rawInsertions === "-" ? 0 : Number(rawInsertions),
        deletions: rawDeletions === "-" ? 0 : Number(rawDeletions),
        isBinary: rawInsertions === "-" || rawDeletions === "-",
      });
      continue;
    }

    const previousPath = tokens[index + 1] ?? "";
    const nextPath = tokens[index + 2] ?? "";
    if (nextPath.length > 0) {
      entries.push({
        path: normalizeReviewPath(nextPath),
        previousPath: previousPath.length > 0 ? normalizeReviewPath(previousPath) : null,
        insertions: rawInsertions === "-" ? 0 : Number(rawInsertions),
        deletions: rawDeletions === "-" ? 0 : Number(rawDeletions),
        isBinary: rawInsertions === "-" || rawDeletions === "-",
      });
    }
    index += 2;
  }

  return entries;
}

function parseDiffChunks(patch: string): ReadonlyArray<ParsedPatchChunk> {
  const chunks: ParsedPatchChunk[] = [];
  let current: ParsedPatchChunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of patch.replace(/\r\n/g, "\n").split("\n")) {
    const headerMatch = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (headerMatch) {
      if (current) {
        chunks.push(current);
      }
      current = {
        header: line,
        oldStart: Number(headerMatch[1]),
        oldCount: Number(headerMatch[2] ?? "1"),
        newStart: Number(headerMatch[3]),
        newCount: Number(headerMatch[4] ?? "1"),
        lines: [],
      };
      oldLine = current.oldStart;
      newLine = current.newStart;
      continue;
    }

    if (!current || line === "" || line === "\\ No newline at end of file") {
      continue;
    }
    if (line.startsWith("diff --git ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
      continue;
    }

    if (line.startsWith("+")) {
      current = {
        ...current,
        lines: [...current.lines, { kind: "add", text: line.slice(1), newLineNumber: newLine }],
      };
      newLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      current = {
        ...current,
        lines: [...current.lines, { kind: "delete", text: line.slice(1), oldLineNumber: oldLine }],
      };
      oldLine += 1;
      continue;
    }

    const text = line.startsWith(" ") ? line.slice(1) : line;
    current = {
      ...current,
      lines: [
        ...current.lines,
        {
          kind: "context",
          text,
          oldLineNumber: oldLine,
          newLineNumber: newLine,
        },
      ],
    };
    oldLine += 1;
    newLine += 1;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function splitPatchChunkArtifacts(patch: string): ReadonlyArray<ParsedPatchChunkArtifact> {
  const lines = patch.match(/.*(?:\n|$)/g) ?? [];
  const headerLines: string[] = [];
  const chunkLines: string[][] = [];
  let currentChunkLines: string[] | null = null;

  for (const line of lines) {
    if (line.startsWith("@@ ")) {
      currentChunkLines = [line];
      chunkLines.push(currentChunkLines);
      continue;
    }

    if (currentChunkLines) {
      currentChunkLines.push(line);
    } else {
      headerLines.push(line);
    }
  }

  const fileHeader = headerLines.join("");
  return chunkLines
    .map((rawChunkLines) => {
      const rawPatch = `${fileHeader}${rawChunkLines.join("")}`;
      const parsedChunk = parseDiffChunks(rawPatch)[0];
      if (!parsedChunk) {
        return null;
      }
      return {
        parsedChunk,
        rawPatch,
      } satisfies ParsedPatchChunkArtifact;
    })
    .filter((value): value is ParsedPatchChunkArtifact => value !== null);
}

function toPatchRange(start: number, count: number) {
  if (count <= 0 || start <= 0) {
    return undefined;
  }
  return {
    startLine: start,
    endLine: start + count - 1,
  };
}

function selectChunkExcerpt(chunk: ParsedPatchChunk): string {
  const preferred = chunk.lines
    .filter((line) => line.kind !== "context")
    .slice(0, 4)
    .map((line) => line.text);
  const fallback = chunk.lines
    .filter((line) => line.text.trim().length > 0)
    .slice(0, 4)
    .map((line) => line.text);
  return normalizeReviewExcerpt((preferred.length > 0 ? preferred : fallback).join("\n"));
}

function extractPatchFingerprint(chunk: ParsedPatchChunk): string {
  return hashReviewText(
    chunk.lines.map((line) => `${line.kind}:${normalizeReviewExcerpt(line.text)}`).join("\n"),
  );
}

function matchingIgnoreRule(
  normalizedPath: string,
  rules: ReadonlyArray<ReviewIgnoreRuleRecord>,
): ReviewIgnoreRuleRecord | null {
  let best: ReviewIgnoreRuleRecord | null = null;

  for (const rule of rules) {
    const matches = rule.matchPath.endsWith("/")
      ? normalizedPath.startsWith(rule.matchPath)
      : normalizedPath === rule.matchPath;
    if (!matches) {
      continue;
    }
    if (!best || rule.matchPath.length > best.matchPath.length) {
      best = rule;
    }
  }

  return best;
}

function patchAnchorScope(lane: ReviewRawLaneKind): "branch" | "uncommitted" {
  return lane === "committed" ? "branch" : "uncommitted";
}

function toFileProvenance(lane: ReviewRawLaneKind): ReviewDiffFileEntry["provenance"] {
  return {
    scope: patchAnchorScope(lane),
    lane,
  };
}

function toIgnoreRuleRef(rule: ReviewIgnoreRuleRecord): ReviewDiffIgnoreRuleRef {
  return {
    ruleKind: rule.ruleKind,
    normalizedPath: rule.normalizedPath,
    matchPath: rule.matchPath,
  };
}

function buildMetadataCard(input: {
  readonly changeKind: ReviewDiffFileChangeKind;
  readonly path: string;
  readonly previousPath: string | null;
  readonly oldMode: string;
  readonly newMode: string;
  readonly ignoreRule?: ReviewDiffIgnoreRuleRef;
  readonly provenanceLane?: ReviewRawLaneKind;
}): ReviewDiffMetadataCard | undefined {
  switch (input.changeKind) {
    case "ignored":
      return {
        kind: "ignored",
        title: input.ignoreRule ? "Ignored by review rule" : "Ignored by git",
        summaryLines: input.ignoreRule
          ? [
              input.path,
              `Rule: ${input.ignoreRule.ruleKind} ${input.ignoreRule.matchPath}`,
              ...(input.provenanceLane && input.provenanceLane !== "ignored"
                ? [`Source: ${input.provenanceLane}`]
                : []),
            ]
          : [input.path],
      };
    case "rename":
      return {
        kind: "rename",
        title: "Renamed file",
        summaryLines:
          input.previousPath === null ? [input.path] : [`${input.previousPath} -> ${input.path}`],
      };
    case "delete":
      return {
        kind: "delete",
        title: "Deleted file",
        summaryLines: [input.path],
      };
    case "binary":
      return {
        kind: "binary",
        title: "Binary change",
        summaryLines: [input.path],
      };
    case "permission-only":
      return {
        kind: "permission-only",
        title: "Permission-only change",
        summaryLines: [`${input.oldMode} -> ${input.newMode}`],
      };
    case "text":
      return undefined;
  }
}

function resolveFileChangeKind(input: {
  readonly lane: ReviewRawLaneKind;
  readonly entry: RawDiffEntry;
  readonly numstat: NumstatEntry | undefined;
}): ReviewDiffFileChangeKind {
  if (input.lane === "ignored") {
    return "ignored";
  }
  if (input.entry.status.startsWith("R") || input.entry.status.startsWith("C")) {
    return "rename";
  }
  if (input.entry.status.startsWith("D")) {
    return "delete";
  }
  if (input.numstat?.isBinary) {
    return "binary";
  }
  if (
    input.entry.oldMode !== input.entry.newMode &&
    (input.numstat?.insertions ?? 0) === 0 &&
    (input.numstat?.deletions ?? 0) === 0
  ) {
    return "permission-only";
  }
  return "text";
}

function laneDiffArgs(
  lane: ReviewRawLaneKind,
  baseRef: string | null,
  extraPaths?: ReadonlyArray<string>,
): ReadonlyArray<string> | null {
  const pathArgs = extraPaths && extraPaths.length > 0 ? ["--", ...extraPaths] : [];

  switch (lane) {
    case "ignored":
      return null;
    case "unstaged":
      return ["diff", "--find-renames", "--find-copies", ...pathArgs];
    case "staged":
      return ["diff", "--cached", "--find-renames", "--find-copies", ...pathArgs];
    case "committed":
      return baseRef
        ? ["diff", "--find-renames", "--find-copies", `${baseRef}...HEAD`, ...pathArgs]
        : null;
    case "inverse-edit":
      return ["diff", "-R", "HEAD", "--find-renames", "--find-copies", ...pathArgs];
  }
}

function rawArgsForLane(
  lane: ReviewRawLaneKind,
  baseRef: string | null,
): ReadonlyArray<string> | null {
  const args = laneDiffArgs(lane, baseRef);
  return args ? [...args, "--raw", "-z"] : null;
}

function numstatArgsForLane(
  lane: ReviewRawLaneKind,
  baseRef: string | null,
): ReadonlyArray<string> | null {
  const args = laneDiffArgs(lane, baseRef);
  return args ? [...args, "--numstat", "-z"] : null;
}

function patchArgsForLane(
  lane: ReviewRawLaneKind,
  baseRef: string | null,
  paths: ReadonlyArray<string>,
): ReadonlyArray<string> | null {
  const args = laneDiffArgs(lane, baseRef, paths);
  return args ? [...args, "--patch", "--unified=3", "--binary"] : null;
}

function toDiffFileEntry(input: {
  readonly sessionId: ReviewSessionId;
  readonly lane: ReviewRawLaneKind;
  readonly record: ReviewLaneFileRecord;
}): ReviewDiffFileEntry {
  return {
    sessionId: input.sessionId,
    groupId: toGroupId(input.sessionId, input.lane),
    fileId: toFileId(input.sessionId, input.lane, input.record.path),
    lane: input.lane,
    provenance: input.record.provenance,
    normalizedPath: input.record.path,
    displayPath: input.record.path,
    ...(input.record.previousPath ? { previousPath: input.record.previousPath } : {}),
    changeKind: input.record.changeKind,
    insertions: input.record.insertions,
    deletions: input.record.deletions,
    chunkCount: 0,
    ...(input.record.metadata ? { metadata: input.record.metadata } : {}),
    ...(input.record.ignoreRule ? { ignoreRule: input.record.ignoreRule } : {}),
  };
}

function toDiffLane(
  sessionId: ReviewSessionId,
  lane: ReviewRawLaneKind,
  files: ReadonlyArray<ReviewDiffFileEntry>,
): ReviewDiffLane {
  return {
    sessionId,
    groupId: toGroupId(sessionId, lane),
    kind: lane,
    title: LANE_TITLES[lane],
    fileCount: files.length,
    files,
  };
}

export function makeReviewDiffService(deps: ReviewDiffDependencies): ReviewDiffServiceShape {
  const resolveBaseRef = (target: ReviewSessionTarget) =>
    Effect.gen(function* () {
      if (target.baseRef) {
        return target.baseRef;
      }

      const result = yield* deps.executeGit(target.cwd, [
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
      ]);
      if (result.code !== 0) {
        return null;
      }
      const normalized = result.stdout.trim().replace(/^refs\/remotes\/origin\//, "");
      return normalized.length > 0 ? normalized : null;
    });

  const loadIgnoredLaneFiles = (
    target: ReviewSessionTarget,
  ): Effect.Effect<ReadonlyArray<ReviewLaneFileRecord>, GitCommandError> =>
    Effect.gen(function* () {
      const result = yield* deps.executeGit(target.cwd, [
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "-z",
      ]);

      return splitNullSeparated(result.stdout)
        .map(normalizeReviewPath)
        .map(
          (pathValue) =>
            ({
              lane: "ignored",
              provenance: toFileProvenance("ignored"),
              path: pathValue,
              previousPath: null,
              changeKind: "ignored",
              insertions: 0,
              deletions: 0,
              metadata: buildMetadataCard({
                changeKind: "ignored",
                path: pathValue,
                previousPath: null,
                oldMode: "",
                newMode: "",
              }),
            }) satisfies ReviewLaneFileRecord,
        );
    });

  const loadLaneFiles = (
    target: ReviewSessionTarget,
    lane: Exclude<ReviewRawLaneKind, "ignored">,
    baseRef: string | null,
  ): Effect.Effect<ReadonlyArray<ReviewLaneFileRecord>, GitCommandError> =>
    Effect.gen(function* () {
      const rawArgs = rawArgsForLane(lane, baseRef);
      const numstatArgs = numstatArgsForLane(lane, baseRef);
      if (!rawArgs || !numstatArgs) {
        return [];
      }

      const [rawResult, numstatResult] = yield* Effect.all([
        deps.executeGit(target.cwd, rawArgs),
        deps.executeGit(target.cwd, numstatArgs),
      ]);
      const numstats = new Map(
        parseNumstatEntries(numstatResult.stdout).map((entry) => [
          `${entry.previousPath ?? ""}\u241f${entry.path}`,
          entry,
        ]),
      );

      return parseRawDiffEntries(rawResult.stdout).map((entry) => {
        const numstat =
          numstats.get(`${entry.previousPath ?? ""}\u241f${entry.path}`) ??
          numstats.get(`\u241f${entry.path}`);
        const changeKind = resolveFileChangeKind({ lane, entry, numstat });

        return {
          lane,
          provenance: toFileProvenance(lane),
          path: entry.path,
          previousPath: entry.previousPath,
          changeKind,
          insertions: numstat?.insertions ?? 0,
          deletions: numstat?.deletions ?? 0,
          metadata: buildMetadataCard({
            changeKind,
            path: entry.path,
            previousPath: entry.previousPath,
            oldMode: entry.oldMode,
            newMode: entry.newMode,
          }),
        } satisfies ReviewLaneFileRecord;
      });
    });

  const partitionIgnoredRecords = (
    records: ReadonlyArray<ReviewLaneFileRecord>,
    rules: ReadonlyArray<ReviewIgnoreRuleRecord>,
  ) => {
    const visible: ReviewLaneFileRecord[] = [];
    const ignored: ReviewLaneFileRecord[] = [];

    for (const record of records) {
      const rule = matchingIgnoreRule(record.path, rules);
      if (!rule) {
        visible.push(record);
        continue;
      }

      ignored.push({
        ...record,
        lane: "ignored",
        changeKind: "ignored",
        metadata: buildMetadataCard({
          changeKind: "ignored",
          path: record.path,
          previousPath: record.previousPath,
          oldMode: "",
          newMode: "",
          ignoreRule: toIgnoreRuleRef(rule),
          provenanceLane: record.provenance.lane,
        }),
        ignoreRule: toIgnoreRuleRef(rule),
      });
    }

    return {
      visible,
      ignored,
    };
  };

  const loadSnapshot: ReviewDiffServiceShape["loadSnapshot"] = (input) =>
    Effect.gen(function* () {
      const rules = yield* deps.listReviewIgnoreRules(input.target.cwd);
      const baseRef = yield* resolveBaseRef(input.target);
      const orderedLanes = LANE_ORDER[input.scope];
      const gitIgnoredFiles = orderedLanes.includes("ignored")
        ? yield* loadIgnoredLaneFiles(input.target)
        : [];
      const rawLaneEntries = yield* Effect.all(
        orderedLanes
          .filter((lane): lane is Exclude<ReviewRawLaneKind, "ignored"> => lane !== "ignored")
          .map((lane) => loadLaneFiles(input.target, lane, baseRef)),
      );
      const filesByLane = new Map<ReviewRawLaneKind, ReviewLaneFileRecord[]>();
      if (orderedLanes.includes("ignored")) {
        filesByLane.set("ignored", [...gitIgnoredFiles]);
      }
      orderedLanes
        .filter((lane): lane is Exclude<ReviewRawLaneKind, "ignored"> => lane !== "ignored")
        .forEach((lane, index) => {
          const records = rawLaneEntries[index] ?? [];
          const partitioned = partitionIgnoredRecords(records, rules);
          filesByLane.set(lane, partitioned.visible);
          if (orderedLanes.includes("ignored") && partitioned.ignored.length > 0) {
            filesByLane.set("ignored", [
              ...(filesByLane.get("ignored") ?? []),
              ...partitioned.ignored,
            ]);
          }
        });

      const lanes: ReviewDiffLane[] = orderedLanes.map((lane) =>
        toDiffLane(
          input.sessionId,
          lane,
          (filesByLane.get(lane) ?? []).map((record) =>
            toDiffFileEntry({
              sessionId: input.sessionId,
              lane,
              record,
            }),
          ),
        ),
      );

      return {
        sessionId: input.sessionId,
        scope: input.scope,
        target: input.target,
        generatedAt: new Date().toISOString(),
        lanes,
      };
    });

  const loadFilePatchArtifact: ReviewDiffServiceShape["loadFilePatchArtifact"] = (input) =>
    Effect.gen(function* () {
      const rules = yield* deps.listReviewIgnoreRules(input.target.cwd);
      const baseRef = yield* resolveBaseRef(input.target);
      const records =
        input.lane === "ignored"
          ? yield* Effect.gen(function* () {
              const gitIgnored = yield* loadIgnoredLaneFiles(input.target);
              const sourceLanes: ReadonlyArray<Exclude<ReviewRawLaneKind, "ignored">> = [
                "unstaged",
                "staged",
                "committed",
                "inverse-edit",
              ];
              const laneRecords = yield* Effect.all(
                sourceLanes.map((lane) => loadLaneFiles(input.target, lane, baseRef)),
              );
              return [
                ...gitIgnored,
                ...laneRecords.flatMap(
                  (laneRecordSet) => partitionIgnoredRecords(laneRecordSet, rules).ignored,
                ),
              ];
            })
          : yield* loadLaneFiles(input.target, input.lane, baseRef);
      const record = records.find(
        (candidate) => candidate.path === normalizeReviewPath(input.normalizedPath),
      );
      if (!record) {
        return null;
      }

      const fileId = toFileId(input.sessionId, input.lane, record.path);
      const groupId = toGroupId(input.sessionId, input.lane);
      if (input.lane === "ignored" && record.provenance.lane === "ignored") {
        return {
          patch: {
            sessionId: input.sessionId,
            groupId,
            fileId,
            scope: input.scope,
            lane: input.lane,
            provenance: record.provenance,
            normalizedPath: record.path,
            displayPath: record.path,
            changeKind: record.changeKind,
            insertions: 0,
            deletions: 0,
            ...(record.metadata ? { metadata: record.metadata } : {}),
            ...(record.ignoreRule ? { ignoreRule: record.ignoreRule } : {}),
            chunks: [],
          },
          rawPatch: "",
          chunkArtifacts: [],
        };
      }

      const patchPaths = [record.previousPath ?? record.path, record.path].filter(
        (value, index, values): value is string =>
          value.length > 0 && values.indexOf(value) === index,
      );
      const patchArgs = patchArgsForLane(record.provenance.lane, baseRef, patchPaths);
      if (!patchArgs) {
        return null;
      }

      const patchResult = yield* deps.executeGit(input.target.cwd, patchArgs, {
        maxOutputBytes: DEFAULT_PATCH_OUTPUT_BYTES,
      });
      const chunkArtifacts = splitPatchChunkArtifacts(patchResult.stdout).map((artifact) => {
        const chunk = artifact.parsedChunk;
        const excerpt = selectChunkExcerpt(chunk);
        const patchFingerprint = extractPatchFingerprint(chunk);
        const oldRange = toPatchRange(chunk.oldStart, chunk.oldCount);
        const newRange = toPatchRange(chunk.newStart, chunk.newCount);
        const anchor: ReviewStableAnchor = {
          normalizedPath: record.path,
          provenance: {
            scope: record.provenance.scope,
            lane: record.provenance.lane,
          },
          excerpt,
          excerptHash: hashReviewText(excerpt),
          patchFingerprint,
          ...(oldRange ? { oldRange } : {}),
          ...(newRange ? { newRange } : {}),
        };
        const chunkId = ReviewChunkId.make(
          stableEntityId("review-chunk", [
            input.sessionId,
            hashReviewAnchor({
              normalizedPath: anchor.normalizedPath,
              provenance: anchor.provenance,
              excerpt: anchor.excerpt,
              excerptHash: anchor.excerptHash,
              patchFingerprint: anchor.patchFingerprint,
            }),
          ]),
        );

        return {
          chunkId,
          anchor,
          rawPatch: artifact.rawPatch,
        } satisfies LoadedReviewDiffChunkArtifact;
      });
      const chunkMetadata = new Map(
        chunkArtifacts.map((artifact) => {
          const parsedChunk = parseDiffChunks(artifact.rawPatch)[0];
          return [artifact.chunkId, parsedChunk] as const;
        }),
      );
      const chunks = chunkArtifacts.map((artifact) => ({
        chunkId: artifact.chunkId,
        anchor: artifact.anchor,
        header: chunkMetadata.get(artifact.chunkId)?.header ?? "@@",
        lines: chunkMetadata.get(artifact.chunkId)?.lines ?? [],
      }));

      return {
        patch: {
          sessionId: input.sessionId,
          groupId,
          fileId,
          scope: input.scope,
          lane: input.lane,
          provenance: record.provenance,
          normalizedPath: record.path,
          displayPath: record.path,
          ...(record.previousPath ? { previousPath: record.previousPath } : {}),
          changeKind: record.changeKind,
          insertions: record.insertions,
          deletions: record.deletions,
          ...(record.metadata ? { metadata: record.metadata } : {}),
          ...(record.ignoreRule ? { ignoreRule: record.ignoreRule } : {}),
          chunks,
        },
        rawPatch: patchResult.stdout,
        chunkArtifacts,
      };
    });

  const loadFilePatch: ReviewDiffServiceShape["loadFilePatch"] = (input) =>
    loadFilePatchArtifact(input).pipe(Effect.map((artifact) => artifact?.patch ?? null));

  const streamSnapshots: ReviewDiffServiceShape["streamSnapshots"] = (input) =>
    deps.streamGitStatus(input.target.cwd).pipe(
      Stream.debounce(Duration.millis(150)),
      Stream.mapEffect(() => loadSnapshot(input)),
    );

  return {
    loadSnapshot,
    loadFilePatch,
    loadFilePatchArtifact,
    streamSnapshots,
  };
}
