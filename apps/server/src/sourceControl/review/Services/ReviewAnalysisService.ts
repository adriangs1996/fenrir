import { randomUUID } from "node:crypto";

import { Data, Effect, Option, Context } from "effect";
import type { Effect as EffectType } from "effect";
import type { ModelSelection } from "@fenrir/contracts";

import type { ProjectionRepositoryError } from "../../../persistence/Errors.ts";
import type { ReviewAnalysisRecord } from "../../../persistence/Services/ReviewAnalysis.ts";
import type { ReviewSessionRecord } from "../../../persistence/Services/ReviewSessions.ts";
import type { ProjectionSnapshotQueryShape } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import type {
  ReviewDiffFilePatch,
  ReviewDiffSnapshot,
} from "@fenrir/contracts/sourceControlReview";
import {
  ReviewAnalysisArtifactId,
  type ReviewAnalysisArtifact,
  type ReviewAnalysisChecklistItem,
  type ReviewAnalysisRiskFlag,
  type ReviewAnalysisSemanticGroup,
  type ReviewAnalysisTargetRef,
} from "@fenrir/contracts/sourceControlReview";
import { hashReviewText } from "@fenrir/shared/sourceControlReview";
import type {
  ReviewProviderReadResult,
  ReviewProviderShape,
  ReviewProviderSnapshot,
} from "./ReviewProvider.ts";
import type { ReviewDiffServiceErrorCause, ReviewDiffServiceShape } from "./ReviewDiffService.ts";
import { pullRequestForReviewSession } from "../reviewSessionPullRequest.ts";

export class ReviewAnalysisServiceError extends Data.TaggedError("ReviewAnalysisServiceError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type ReviewAnalysisServiceErrorCause =
  | ReviewAnalysisServiceError
  | ProjectionRepositoryError
  | ReviewDiffServiceErrorCause;

interface ReviewAnalysisContext {
  readonly session: ReviewSessionRecord;
  readonly diffSnapshot: ReviewDiffSnapshot;
  readonly filePatches: ReadonlyArray<ReviewDiffFilePatch>;
  readonly remote: ReviewProviderReadResult;
  readonly remoteSnapshot: ReviewProviderSnapshot | null;
  readonly modelSelection: ModelSelection | null;
  readonly instruction: string | null;
}

interface ReviewAreaAggregate {
  readonly id: string;
  readonly title: string;
  readonly files: ReadonlyArray<ReviewAreaFile>;
  readonly totalInsertions: number;
  readonly totalDeletions: number;
  readonly totalRemoteThreads: number;
  readonly totalRemoteGeneralComments: number;
  readonly totalScore: number;
  readonly needsAttention: boolean;
}

interface ReviewAreaFile {
  readonly patch: ReviewDiffFilePatch;
  readonly remoteThreads: ReadonlyArray<ReviewProviderSnapshot["reviewThreads"][number]>;
  readonly score: number;
}

export interface GenerateReviewAnalysisInput {
  readonly session: ReviewSessionRecord;
  readonly instruction?: string | null;
  readonly now?: string;
}

export interface PresentReviewAnalysisInput {
  readonly record: ReviewAnalysisRecord;
  readonly session: ReviewSessionRecord;
  readonly diffSnapshot: ReviewDiffSnapshot;
  readonly now?: string;
}

export interface RefreshReviewAnalysisStalenessInput {
  readonly record: ReviewAnalysisRecord;
  readonly session: ReviewSessionRecord;
  readonly now?: string;
}

export interface ReviewAnalysisServiceShape {
  readonly generate: (
    input: GenerateReviewAnalysisInput,
  ) => EffectType.Effect<ReviewAnalysisRecord, ReviewAnalysisServiceErrorCause>;
  readonly present: (
    input: PresentReviewAnalysisInput,
  ) => EffectType.Effect<ReviewAnalysisArtifact, ReviewAnalysisServiceErrorCause>;
  readonly refreshStaleness: (
    input: RefreshReviewAnalysisStalenessInput,
  ) => EffectType.Effect<ReviewAnalysisRecord, ReviewAnalysisServiceErrorCause>;
}

export class ReviewAnalysisService extends Context.Service<
  ReviewAnalysisService,
  ReviewAnalysisServiceShape
>()("t3/review/Services/ReviewAnalysisService") {}

export interface ReviewAnalysisDependencies {
  readonly projection: ProjectionSnapshotQueryShape;
  readonly diff: ReviewDiffServiceShape;
  readonly provider: ReviewProviderShape;
  readonly now: () => string;
}

function areaKeyForPath(normalizedPath: string): string {
  const parts = normalizedPath.split("/").filter((part) => part.length > 0);
  if (parts.length === 0) return "repository-root";
  if (parts.length === 1) return parts[0]!;
  return parts.slice(0, Math.min(4, parts.length - 1)).join("/");
}

function areaTitle(areaKey: string): string {
  if (areaKey === "repository-root") return "Repository root changes";
  const tail = areaKey.split("/").at(-1) ?? areaKey;
  return tail
    .split(/[-_]/g)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function compactText(value: string | null | undefined, maxLength: number): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) return undefined;
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 1)}...`;
}

function toTargetRef(input: {
  readonly patch: ReviewDiffFilePatch;
  readonly chunkId?: ReviewDiffFilePatch["chunks"][number]["chunkId"] | undefined;
}): ReviewAnalysisTargetRef {
  return {
    groupId: input.patch.groupId,
    lane: input.patch.lane,
    fileId: input.patch.fileId,
    ...(input.chunkId ? { chunkId: input.chunkId } : {}),
    normalizedPath: input.patch.normalizedPath,
  };
}

function codeDiffFingerprint(
  diffSnapshot: ReviewDiffSnapshot,
  filePatches: ReadonlyArray<ReviewDiffFilePatch>,
): string {
  return hashReviewText(
    JSON.stringify({
      scope: diffSnapshot.scope,
      target: {
        baseRef: diffSnapshot.target.baseRef ?? null,
        headRef: diffSnapshot.target.headRef ?? null,
        baseCommitOid: diffSnapshot.target.baseCommitOid ?? null,
        headCommitOid: diffSnapshot.target.headCommitOid ?? null,
      },
      lanes: diffSnapshot.lanes.map((lane) => ({
        kind: lane.kind,
        files: lane.files.map((file) => ({
          fileId: file.fileId,
          normalizedPath: file.normalizedPath,
          previousPath: file.previousPath ?? null,
          changeKind: file.changeKind,
          insertions: file.insertions,
          deletions: file.deletions,
          chunkCount: file.chunkCount,
        })),
      })),
      patches: filePatches.map((patch) => ({
        fileId: patch.fileId,
        normalizedPath: patch.normalizedPath,
        chunkIds: patch.chunks.map((chunk) => chunk.chunkId),
        anchors: patch.chunks.map((chunk) => ({
          normalizedPath: chunk.anchor.normalizedPath,
          excerpt: chunk.anchor.excerpt,
          oldRange: chunk.anchor.oldRange ?? null,
          newRange: chunk.anchor.newRange ?? null,
        })),
      })),
    }),
  );
}

function remoteContextFingerprint(
  remoteSnapshot: ReviewProviderSnapshot | null,
  remote: ReviewProviderReadResult,
): string {
  if (remoteSnapshot === null) {
    return hashReviewText(
      JSON.stringify({
        status: remote.status,
        provider: remote.provider,
        ...(remote.status === "unavailable"
          ? {
              reason: remote.reason,
              message: remote.message,
              pullRequest: remote.pullRequest,
            }
          : {}),
      }),
    );
  }

  return hashReviewText(
    JSON.stringify({
      pullRequest: {
        number: remoteSnapshot.pullRequest.number,
        url: remoteSnapshot.pullRequest.url,
        title: remoteSnapshot.pullRequest.title,
        state: remoteSnapshot.pullRequest.state,
        isDraft: remoteSnapshot.pullRequest.isDraft,
        body: remoteSnapshot.pullRequest.body,
        baseRef: remoteSnapshot.pullRequest.baseRef,
        headRef: remoteSnapshot.pullRequest.headRef,
        updatedAt: remoteSnapshot.pullRequest.updatedAt,
      },
      reviewThreads: remoteSnapshot.reviewThreads.map((thread) => ({
        id: thread.id,
        path: thread.path,
        isResolved: thread.isResolved,
        isOutdated: thread.isOutdated,
        isCollapsed: thread.isCollapsed,
        anchor: thread.anchor,
        comments: thread.comments.map((comment) => ({
          id: comment.id,
          body: comment.body,
          path: comment.path,
          updatedAt: comment.updatedAt,
        })),
      })),
      generalComments: remoteSnapshot.generalComments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        updatedAt: comment.updatedAt,
      })),
    }),
  );
}

function sameModelSelection(
  left: ModelSelection | null | undefined,
  right: ModelSelection | null | undefined,
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function derivedStaleStatus(reasons: ReadonlyArray<string>): ReviewAnalysisArtifact["staleStatus"] {
  if (reasons.length === 0) return "fresh";
  if (reasons.some((reason) => reason === "mode-changed" || reason === "scope-changed")) {
    return "stale-target";
  }
  return "stale-content";
}

function riskLevelForScore(score: number): ReviewAnalysisRiskFlag["level"] {
  if (score >= 140) return "high";
  if (score >= 80) return "medium";
  return "low";
}

function fileScore(input: {
  readonly patch: ReviewDiffFilePatch;
  readonly remoteThreads: ReadonlyArray<ReviewProviderSnapshot["reviewThreads"][number]>;
  readonly instruction: string | null;
}): number {
  const patch = input.patch;
  let score = patch.insertions + patch.deletions;
  switch (patch.changeKind) {
    case "delete":
      score += 40;
      break;
    case "rename":
      score += 25;
      break;
    case "binary":
      score += 35;
      break;
    case "permission-only":
      score += 15;
      break;
    case "ignored":
      score -= 10;
      break;
    default:
      break;
  }
  score += input.remoteThreads.length * 35;
  score += input.remoteThreads.reduce((sum, thread) => sum + thread.comments.length * 5, 0);
  if (input.remoteThreads.some((thread) => thread.isOutdated || !thread.isResolved)) {
    score += 30;
  }
  const instruction = input.instruction?.toLowerCase() ?? "";
  if (
    instruction.length > 0 &&
    (patch.normalizedPath.toLowerCase().includes(instruction) ||
      instruction
        .split(/\s+/)
        .filter((part) => part.length >= 4)
        .some((part) => patch.normalizedPath.toLowerCase().includes(part)))
  ) {
    score += 45;
  }
  return score;
}

function staleReasonsFor(input: {
  readonly artifact: ReviewAnalysisArtifact;
  readonly currentCodeDiffFingerprint: string;
  readonly currentRemoteContextFingerprint: string;
  readonly currentMode: ReviewSessionRecord["mode"];
  readonly currentScope: ReviewSessionRecord["scope"];
  readonly currentModelSelection: ModelSelection | null;
}): Array<string> {
  const metadata = input.artifact.metadata;
  if (!metadata) return [];

  const staleReasons: Array<string> = [];
  if (metadata.codeDiffFingerprint !== input.currentCodeDiffFingerprint) {
    staleReasons.push("code-diff-changed");
  }
  if (metadata.remoteContextFingerprint !== input.currentRemoteContextFingerprint) {
    staleReasons.push("remote-review-context-changed");
  }
  if (metadata.mode !== input.currentMode) {
    staleReasons.push("mode-changed");
  }
  if (metadata.scope !== input.currentScope) {
    staleReasons.push("scope-changed");
  }
  if (!sameModelSelection(metadata.modelSelection ?? null, input.currentModelSelection)) {
    staleReasons.push("model-changed");
  }
  return staleReasons;
}

function buildAreaAggregates(input: {
  readonly filePatches: ReadonlyArray<ReviewDiffFilePatch>;
  readonly remoteSnapshot: ReviewProviderSnapshot | null;
  readonly instruction: string | null;
}): ReadonlyArray<ReviewAreaAggregate> {
  const remoteThreadsByPath = new Map<
    string,
    ReadonlyArray<ReviewProviderSnapshot["reviewThreads"][number]>
  >();
  for (const thread of input.remoteSnapshot?.reviewThreads ?? []) {
    const current = remoteThreadsByPath.get(thread.path) ?? [];
    remoteThreadsByPath.set(thread.path, [...current, thread]);
  }

  const files = input.filePatches.map((patch) => {
    const remoteThreads = remoteThreadsByPath.get(patch.normalizedPath) ?? [];
    return {
      patch,
      remoteThreads,
      score: fileScore({
        patch,
        remoteThreads,
        instruction: input.instruction,
      }),
    } satisfies ReviewAreaFile;
  });

  const byArea = new Map<string, ReviewAreaFile[]>();
  for (const file of files) {
    const key = areaKeyForPath(file.patch.normalizedPath);
    const current = byArea.get(key) ?? [];
    current.push(file);
    byArea.set(key, current);
  }

  return [...byArea.entries()]
    .map(([id, areaFiles]) => {
      const totalInsertions = areaFiles.reduce((sum, file) => sum + file.patch.insertions, 0);
      const totalDeletions = areaFiles.reduce((sum, file) => sum + file.patch.deletions, 0);
      const totalRemoteThreads = areaFiles.reduce(
        (sum, file) => sum + file.remoteThreads.length,
        0,
      );
      const totalRemoteGeneralComments = input.remoteSnapshot?.generalComments.length ?? 0;
      const totalScore = areaFiles.reduce((sum, file) => sum + file.score, 0);
      const needsAttention =
        areaFiles.some((file) =>
          file.remoteThreads.some((thread) => thread.isOutdated || !thread.isResolved),
        ) || totalScore >= 120;
      return {
        id,
        title: areaTitle(id),
        files: areaFiles.toSorted((left, right) => right.score - left.score),
        totalInsertions,
        totalDeletions,
        totalRemoteThreads,
        totalRemoteGeneralComments,
        totalScore,
        needsAttention,
      } satisfies ReviewAreaAggregate;
    })
    .toSorted((left, right) => right.totalScore - left.totalScore);
}

function buildGroupRationale(area: ReviewAreaAggregate): string {
  const renameCount = area.files.filter((file) => file.patch.changeKind === "rename").length;
  const deleteCount = area.files.filter((file) => file.patch.changeKind === "delete").length;
  const binaryCount = area.files.filter((file) => file.patch.changeKind === "binary").length;
  const parts = [
    `${area.files.length} file${area.files.length === 1 ? "" : "s"}`,
    `${area.totalInsertions} insertions`,
    `${area.totalDeletions} deletions`,
  ];
  if (area.totalRemoteThreads > 0) {
    parts.push(
      `${area.totalRemoteThreads} GitHub review thread${area.totalRemoteThreads === 1 ? "" : "s"}`,
    );
  }
  if (renameCount > 0) parts.push(`${renameCount} rename${renameCount === 1 ? "" : "s"}`);
  if (deleteCount > 0) parts.push(`${deleteCount} delete${deleteCount === 1 ? "" : "s"}`);
  if (binaryCount > 0) parts.push(`${binaryCount} binary file${binaryCount === 1 ? "" : "s"}`);
  return `This group concentrates ${parts.join(", ")} and should be reviewed together for behavioral consistency.`;
}

function buildChecklistForArea(
  area: ReviewAreaAggregate,
): ReadonlyArray<ReviewAnalysisChecklistItem> {
  const primaryFile = area.files[0];
  if (!primaryFile) return [];
  const firstChunkId = primaryFile.patch.chunks[0]?.chunkId;
  const checklist: ReviewAnalysisChecklistItem[] = [
    Object.assign(
      {
        id: `review-${area.id}` as ReviewAnalysisChecklistItem["id"],
        title: compactText(`Review ${area.title} first`, 512)!,
        targetRefs: [toTargetRef({ patch: primaryFile.patch, chunkId: firstChunkId })],
      },
      compactText(buildGroupRationale(area), 100_000)
        ? { detail: compactText(buildGroupRationale(area), 100_000)! }
        : {},
    ),
  ];
  if (area.totalRemoteThreads > 0) {
    const detail = compactText(
      `There are ${area.totalRemoteThreads} existing review thread(s) attached to this area.`,
      100_000,
    );
    checklist.push({
      id: `threads-${area.id}` as ReviewAnalysisChecklistItem["id"],
      title: compactText(`Reconcile existing GitHub discussion in ${area.title}`, 512)!,
      ...(detail ? { detail } : {}),
      targetRefs: area.files
        .filter((file) => file.remoteThreads.length > 0)
        .map((file) => toTargetRef({ patch: file.patch, chunkId: file.patch.chunks[0]?.chunkId })),
    });
  }
  return checklist;
}

function buildRiskFlags(input: {
  readonly area: ReviewAreaAggregate;
  readonly remoteSnapshot: ReviewProviderSnapshot | null;
}): ReadonlyArray<ReviewAnalysisRiskFlag> {
  const area = input.area;
  const primaryTargetRefs = area.files
    .slice(0, 3)
    .map((file) => toTargetRef({ patch: file.patch, chunkId: file.patch.chunks[0]?.chunkId }));
  const flags: ReviewAnalysisRiskFlag[] = [];

  if (area.totalRemoteThreads > 0) {
    const detail = compactText(
      `${area.totalRemoteThreads} remote review thread(s) already target this group. Validate that the code still answers that feedback.`,
      100_000,
    );
    flags.push({
      level: riskLevelForScore(area.totalScore),
      label: compactText(`Existing review discussion in ${area.title}`, 512)!,
      ...(detail ? { detail } : {}),
      targetRefs: primaryTargetRefs,
    });
  }

  if (area.files.some((file) => file.patch.changeKind === "delete")) {
    const detail = compactText(
      "At least one file in this group is deleted. Check callers, imports, and any implicit contract changes.",
      100_000,
    );
    flags.push({
      level: "high",
      label: "Deleted code path",
      ...(detail ? { detail } : {}),
      targetRefs: primaryTargetRefs,
    });
  }

  if ((input.remoteSnapshot?.generalComments.length ?? 0) > 0) {
    const detail = compactText(
      `${input.remoteSnapshot!.generalComments.length} general pull request comment(s) exist and may set additional review expectations.`,
      100_000,
    );
    flags.push({
      level: "low",
      label: "General PR discussion present",
      ...(detail ? { detail } : {}),
      targetRefs: primaryTargetRefs,
    });
  }

  return flags;
}

function summaryMarkdown(input: {
  readonly context: ReviewAnalysisContext;
  readonly semanticGroups: ReadonlyArray<ReviewAnalysisSemanticGroup>;
  readonly checklist: ReadonlyArray<ReviewAnalysisChecklistItem>;
  readonly riskFlags: ReadonlyArray<ReviewAnalysisRiskFlag>;
}): string {
  const prTitle = input.context.remoteSnapshot?.pullRequest.title;
  const lines = [
    "# Review brief",
    "",
    prTitle ? `PR: ${prTitle}` : `Scope: ${input.context.session.scope}`,
    `Files: ${input.context.diffSnapshot.lanes.reduce((sum, lane) => sum + lane.fileCount, 0)}`,
    `Semantic groups: ${input.semanticGroups.length}`,
    `Remote review threads: ${input.context.remoteSnapshot?.reviewThreads.length ?? 0}`,
  ];
  if (input.context.instruction) {
    lines.push(`Focus: ${input.context.instruction}`);
  }
  if (input.semanticGroups[0]) {
    lines.push("", `Start with: ${input.semanticGroups[0].title}`);
  }
  if (input.riskFlags[0]) {
    lines.push(`Primary risk: ${input.riskFlags[0].label}`);
  }
  if (input.checklist.length > 0) {
    lines.push("", "Checklist:");
    for (const item of input.checklist.slice(0, 5)) {
      lines.push(`- ${item.title}`);
    }
  }
  return lines.join("\n");
}

const loadModelSelection = (
  projection: ProjectionSnapshotQueryShape,
  session: ReviewSessionRecord,
) =>
  projection
    .getThreadSnapshot(session.threadId)
    .pipe(
      Effect.map((threadOption) =>
        Option.isSome(threadOption) ? threadOption.value.modelSelection : null,
      ),
    );

const loadRemoteReview = (provider: ReviewProviderShape, session: ReviewSessionRecord) =>
  provider.readReview({
    cwd: session.checkoutPath,
    pullRequest: pullRequestForReviewSession(session),
  });

const loadFilePatches = (
  diff: ReviewDiffServiceShape,
  session: ReviewSessionRecord,
  diffSnapshot: ReviewDiffSnapshot,
) =>
  Effect.forEach(
    diffSnapshot.lanes.flatMap((lane) =>
      lane.files.map((file) => ({
        lane: lane.kind,
        normalizedPath: file.normalizedPath,
      })),
    ),
    ({ lane, normalizedPath }) =>
      diff.loadFilePatch({
        sessionId: session.sessionId,
        scope: session.scope,
        target: session.target,
        lane,
        normalizedPath,
      }),
    { concurrency: 4 },
  ).pipe(
    Effect.map((patches) =>
      patches.filter((patch): patch is ReviewDiffFilePatch => patch !== null),
    ),
  );

function buildArtifact(context: ReviewAnalysisContext, now: string): ReviewAnalysisArtifact {
  const semanticAreas = buildAreaAggregates({
    filePatches: context.filePatches,
    remoteSnapshot: context.remoteSnapshot,
    instruction: context.instruction,
  });

  const semanticGroups: ReviewAnalysisSemanticGroup[] = semanticAreas.map((area, index) => {
    const riskFlags = buildRiskFlags({
      area,
      remoteSnapshot: context.remoteSnapshot,
    });
    const targetRefs = area.files
      .slice(0, 5)
      .map((file) => toTargetRef({ patch: file.patch, chunkId: file.patch.chunks[0]?.chunkId }));
    return {
      id: area.id as ReviewAnalysisSemanticGroup["id"],
      title: compactText(area.title, 512)!,
      rationale: buildGroupRationale(area),
      suggestedReviewOrder: index + 1,
      needsAttention: area.needsAttention,
      targetRefs,
      checklist: buildChecklistForArea(area),
      riskFlags,
    };
  });

  const checklist: ReviewAnalysisChecklistItem[] = semanticGroups.flatMap(
    (group) => group.checklist,
  );

  if (context.remoteSnapshot?.generalComments.length) {
    const detail = compactText(
      `${context.remoteSnapshot.generalComments.length} general pull request comment(s) add non-inline review context.`,
      100_000,
    );
    checklist.push({
      id: "review-pr-discussion" as ReviewAnalysisChecklistItem["id"],
      title: "Read the general PR discussion before final sign-off",
      ...(detail ? { detail } : {}),
      targetRefs: semanticGroups[0]?.targetRefs ?? [],
    });
  }

  const riskFlags = semanticGroups.flatMap((group) => group.riskFlags).slice(0, 8);
  const metadata = {
    mode: context.session.mode,
    scope: context.session.scope,
    target: context.session.target,
    ...(context.modelSelection ? { modelSelection: context.modelSelection } : {}),
    ...(context.instruction ? { instruction: context.instruction } : {}),
    codeDiffFingerprint: codeDiffFingerprint(context.diffSnapshot, context.filePatches),
    remoteContextFingerprint: remoteContextFingerprint(context.remoteSnapshot, context.remote),
    fileCount: context.filePatches.length,
    semanticGroupCount: semanticGroups.length,
    remoteThreadCount: context.remoteSnapshot?.reviewThreads.length ?? 0,
    remoteGeneralCommentCount: context.remoteSnapshot?.generalComments.length ?? 0,
  } satisfies NonNullable<ReviewAnalysisArtifact["metadata"]>;

  return {
    id: ReviewAnalysisArtifactId.make(`review-analysis-${randomUUID()}`),
    sessionId: context.session.sessionId,
    provider: "fenrir-local",
    status: "completed",
    staleStatus: "fresh",
    summaryMarkdown: summaryMarkdown({
      context,
      semanticGroups,
      checklist,
      riskFlags,
    }),
    checklist,
    semanticGroups,
    riskFlags,
    metadata,
    staleMetadata: {
      comparedAt: now,
      invalidatedBy: [],
      currentCodeDiffFingerprint: metadata.codeDiffFingerprint,
      currentRemoteContextFingerprint: metadata.remoteContextFingerprint,
      generatedMode: context.session.mode,
      currentMode: context.session.mode,
      generatedScope: context.session.scope,
      currentScope: context.session.scope,
      ...(context.modelSelection ? { generatedModelSelection: context.modelSelection } : {}),
      ...(context.modelSelection ? { currentModelSelection: context.modelSelection } : {}),
      ...(context.instruction ? { generatedInstruction: context.instruction } : {}),
    },
    ...(semanticGroups[0]?.targetRefs[0]?.fileId
      ? { fileId: semanticGroups[0].targetRefs[0].fileId }
      : {}),
    ...(semanticGroups[0]?.targetRefs[0]?.chunkId
      ? { chunkId: semanticGroups[0].targetRefs[0].chunkId }
      : {}),
    requestedAt: now,
    completedAt: now,
  };
}

function decorateArtifact(input: {
  readonly artifact: ReviewAnalysisArtifact;
  readonly currentCodeDiffFingerprint: string;
  readonly currentRemoteContextFingerprint: string;
  readonly currentMode: ReviewSessionRecord["mode"];
  readonly currentScope: ReviewSessionRecord["scope"];
  readonly currentModelSelection: ModelSelection | null;
  readonly now: string;
}): ReviewAnalysisArtifact {
  const invalidatedBy = staleReasonsFor({
    artifact: input.artifact,
    currentCodeDiffFingerprint: input.currentCodeDiffFingerprint,
    currentRemoteContextFingerprint: input.currentRemoteContextFingerprint,
    currentMode: input.currentMode,
    currentScope: input.currentScope,
    currentModelSelection: input.currentModelSelection,
  });
  return {
    ...input.artifact,
    staleStatus: derivedStaleStatus(invalidatedBy),
    staleMetadata: {
      comparedAt: input.now,
      invalidatedBy: invalidatedBy as NonNullable<
        ReviewAnalysisArtifact["staleMetadata"]
      >["invalidatedBy"],
      currentCodeDiffFingerprint: input.currentCodeDiffFingerprint,
      currentRemoteContextFingerprint: input.currentRemoteContextFingerprint,
      generatedMode: input.artifact.metadata?.mode ?? input.currentMode,
      currentMode: input.currentMode,
      generatedScope: input.artifact.metadata?.scope ?? input.currentScope,
      currentScope: input.currentScope,
      ...(input.artifact.metadata?.modelSelection
        ? { generatedModelSelection: input.artifact.metadata.modelSelection }
        : {}),
      ...(input.currentModelSelection
        ? { currentModelSelection: input.currentModelSelection }
        : {}),
      ...(input.artifact.metadata?.instruction
        ? { generatedInstruction: input.artifact.metadata.instruction }
        : {}),
    },
  };
}

export function makeReviewAnalysisService(
  dependencies: ReviewAnalysisDependencies,
): ReviewAnalysisServiceShape {
  return {
    generate: (input) =>
      Effect.gen(function* () {
        const now = input.now ?? dependencies.now();
        const [diffSnapshot, modelSelection, remote] = yield* Effect.all([
          dependencies.diff.loadSnapshot({
            sessionId: input.session.sessionId,
            scope: input.session.scope,
            target: input.session.target,
          }),
          loadModelSelection(dependencies.projection, input.session),
          loadRemoteReview(dependencies.provider, input.session),
        ]);
        const filePatches = yield* loadFilePatches(dependencies.diff, input.session, diffSnapshot);
        const instruction = compactText(input.instruction, 100_000) ?? null;
        const artifact = buildArtifact(
          {
            session: input.session,
            diffSnapshot,
            filePatches,
            remote,
            remoteSnapshot: remote.status === "available" ? remote.snapshot : null,
            modelSelection,
            instruction,
          },
          now,
        );
        return {
          sessionId: input.session.sessionId,
          artifact,
          analysisPayload: {
            semanticGroupIds: artifact.semanticGroups?.map((group) => group.id) ?? [],
          },
          generatedAt: now,
          staleMarkerInputs: {
            codeDiffFingerprint: artifact.metadata?.codeDiffFingerprint ?? null,
            remoteContextFingerprint: artifact.metadata?.remoteContextFingerprint ?? null,
          },
          staleReasonFlags: [],
          updatedAt: now,
        } satisfies ReviewAnalysisRecord;
      }),
    present: (input) =>
      Effect.gen(function* () {
        const now = input.now ?? dependencies.now();
        const modelSelection = yield* loadModelSelection(dependencies.projection, input.session);
        const filePatches = yield* loadFilePatches(
          dependencies.diff,
          input.session,
          input.diffSnapshot,
        );
        const currentCodeDiffFingerprint = codeDiffFingerprint(input.diffSnapshot, filePatches);
        const currentRemoteContextFingerprint =
          input.record.artifact.metadata?.remoteContextFingerprint ??
          hashReviewText(JSON.stringify({ status: "unknown" }));
        return decorateArtifact({
          artifact: input.record.artifact,
          currentCodeDiffFingerprint,
          currentRemoteContextFingerprint,
          currentMode: input.session.mode,
          currentScope: input.session.scope,
          currentModelSelection: modelSelection,
          now,
        });
      }),
    refreshStaleness: (input) =>
      Effect.gen(function* () {
        const now = input.now ?? dependencies.now();
        const [diffSnapshot, modelSelection, remote] = yield* Effect.all([
          dependencies.diff.loadSnapshot({
            sessionId: input.session.sessionId,
            scope: input.session.scope,
            target: input.session.target,
          }),
          loadModelSelection(dependencies.projection, input.session),
          loadRemoteReview(dependencies.provider, input.session),
        ]);
        const filePatches = yield* loadFilePatches(dependencies.diff, input.session, diffSnapshot);
        const currentCodeDiff = codeDiffFingerprint(diffSnapshot, filePatches);
        const currentRemoteContext = remoteContextFingerprint(
          remote.status === "available" ? remote.snapshot : null,
          remote,
        );
        const refreshedArtifact = decorateArtifact({
          artifact: input.record.artifact,
          currentCodeDiffFingerprint: currentCodeDiff,
          currentRemoteContextFingerprint: currentRemoteContext,
          currentMode: input.session.mode,
          currentScope: input.session.scope,
          currentModelSelection: modelSelection,
          now,
        });
        return {
          ...input.record,
          artifact: refreshedArtifact,
          staleMarkerInputs: {
            codeDiffFingerprint: currentCodeDiff,
            remoteContextFingerprint: currentRemoteContext,
          },
          staleReasonFlags: refreshedArtifact.staleMetadata?.invalidatedBy ?? [],
          updatedAt: now,
        };
      }),
  };
}
