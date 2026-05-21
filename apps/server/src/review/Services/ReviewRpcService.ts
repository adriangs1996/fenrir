import { randomUUID } from "node:crypto";

import { AuthSessionId } from "@fenrir/contracts";
import { Data, Duration, Effect, Option, PubSub, Schema, ServiceMap, Stream } from "effect";
import type { Effect as EffectType } from "effect";

import type { ReviewAnnotationRecord } from "../../persistence/Services/ReviewAnnotations.ts";
import type { ReviewProgressRecord } from "../../persistence/Services/ReviewProgress.ts";
import type { ReviewSessionRecord } from "../../persistence/Services/ReviewSessions.ts";
import type { ReviewAnnotationRepositoryShape } from "../../persistence/Services/ReviewAnnotations.ts";
import type { ReviewAnalysisRepositoryShape } from "../../persistence/Services/ReviewAnalysis.ts";
import type { ReviewProgressRepositoryShape } from "../../persistence/Services/ReviewProgress.ts";
import type { ReviewSessionRepositoryShape } from "../../persistence/Services/ReviewSessions.ts";
import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";
import type { SourceControlStatusShape } from "../../sourceControl/Services/SourceControlStatus.ts";
import type { SessionCredentialServiceShape } from "../../auth/Services/SessionCredentialService.ts";
import type { ReviewAnalysisServiceShape } from "./ReviewAnalysisService.ts";
import type {
  EnsureActiveReviewSessionResult,
  ReviewSessionServiceShape,
} from "./ReviewSessionService.ts";
import type { ReviewDiffServiceShape } from "./ReviewDiffService.ts";
import type { ReviewWriteServiceShape } from "./ReviewWriteService.ts";
import {
  ReviewActionBlockedError,
  type ReviewChunkPayload,
  type ReviewCreateLocalAnnotationReplyInput,
  type ReviewCreateLocalAnnotationThreadInput,
  type ReviewDeleteLocalAnnotationReplyInput,
  type ReviewDeleteLocalAnnotationThreadInput,
  type ReviewDeleteOverviewNoteInput,
  type ReviewDiffFilePatch,
  type ReviewDiffSnapshot,
  type ReviewGenerateAnalysisInput,
  type ReviewGetChunkPayloadInput,
  type ReviewGetDiffSnapshotInput,
  type ReviewGetFilePatchInput,
  type ReviewGetGitHubSnapshotInput,
  type ReviewGetOrCreateSessionInput,
  type ReviewGetSessionInput,
  type ReviewLocalAnnotationReply,
  type ReviewLocalAnnotationThread,
  type ReviewOverviewNote,
  type ReviewSetLocalThreadResolvedInput,
  type ReviewDeleteGitHubDraftInput,
  type ReviewReplyToGitHubThreadInput,
  type ReviewRefreshProviderDataInput,
  ReviewRpcError,
  type ReviewSessionSnapshot,
  type ReviewSessionSummary,
  type ReviewSetModeInput,
  type ReviewSetProgressInput,
  type ReviewSetScopeInput,
  type ReviewStreamEvent,
  type ReviewSubmitGitHubDraftInput,
  type ReviewUpdateLocalAnnotationReplyInput,
  type ReviewUpdateLocalAnnotationThreadInput,
  type ReviewUpsertGitHubDraftInput,
  type ReviewUpsertOverviewNoteInput,
  type ReviewApplyRawMutationInput,
  type ReviewApplyRawMutationResult,
  type ReviewChunk,
  type ReviewLocalNoteAuthorSnapshot,
} from "../../../../../packages/contracts/src/review.ts";

export class ReviewRpcServiceError extends Data.TaggedError("ReviewRpcServiceError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

type ReviewRpcServiceErrorCause =
  | ReviewRpcError
  | ReviewActionBlockedError
  | ReviewRpcServiceError
  | ProjectionRepositoryError;

export interface ReviewRpcServiceShape {
  readonly getOrCreateSession: (
    input: ReviewGetOrCreateSessionInput,
    authSessionId: AuthSessionId,
  ) => EffectType.Effect<ReviewSessionSummary, ReviewRpcServiceErrorCause>;
  readonly getSessionSummary: (
    input: ReviewGetSessionInput,
    authSessionId: AuthSessionId,
  ) => EffectType.Effect<ReviewSessionSummary, ReviewRpcServiceErrorCause>;
  readonly getSessionSnapshot: (
    input: ReviewGetSessionInput,
    authSessionId: AuthSessionId,
  ) => EffectType.Effect<ReviewSessionSnapshot, ReviewRpcServiceErrorCause>;
  readonly getDiffSnapshot: (
    input: ReviewGetDiffSnapshotInput,
  ) => EffectType.Effect<ReviewDiffSnapshot, ReviewRpcServiceErrorCause>;
  readonly getFilePatch: (
    input: ReviewGetFilePatchInput,
  ) => EffectType.Effect<ReviewDiffFilePatch | null, ReviewRpcServiceErrorCause>;
  readonly getChunkPayload: (
    input: ReviewGetChunkPayloadInput,
  ) => EffectType.Effect<ReviewChunkPayload | null, ReviewRpcServiceErrorCause>;
  readonly setMode: (
    input: ReviewSetModeInput,
    authSessionId: AuthSessionId,
  ) => EffectType.Effect<ReviewSessionSummary, ReviewRpcServiceErrorCause>;
  readonly setScope: (
    input: ReviewSetScopeInput,
    authSessionId: AuthSessionId,
  ) => EffectType.Effect<ReviewSessionSummary, ReviewRpcServiceErrorCause>;
  readonly setProgress: (
    input: ReviewSetProgressInput,
    authSessionId: AuthSessionId,
  ) => EffectType.Effect<ReviewSessionSummary, ReviewRpcServiceErrorCause>;
  readonly createLocalThread: (
    input: ReviewCreateLocalAnnotationThreadInput,
    authSessionId: AuthSessionId,
  ) => EffectType.Effect<ReviewLocalAnnotationThread, ReviewRpcServiceErrorCause>;
  readonly updateLocalThread: (
    input: ReviewUpdateLocalAnnotationThreadInput,
    authSessionId: AuthSessionId,
  ) => EffectType.Effect<ReviewLocalAnnotationThread, ReviewRpcServiceErrorCause>;
  readonly deleteLocalThread: (
    input: ReviewDeleteLocalAnnotationThreadInput,
    authSessionId: AuthSessionId,
  ) => EffectType.Effect<void, ReviewRpcServiceErrorCause>;
  readonly setLocalThreadResolved: (
    input: ReviewSetLocalThreadResolvedInput,
    authSessionId: AuthSessionId,
  ) => EffectType.Effect<ReviewLocalAnnotationThread, ReviewRpcServiceErrorCause>;
  readonly createLocalReply: (
    input: ReviewCreateLocalAnnotationReplyInput,
    authSessionId: AuthSessionId,
  ) => EffectType.Effect<ReviewLocalAnnotationReply, ReviewRpcServiceErrorCause>;
  readonly updateLocalReply: (
    input: ReviewUpdateLocalAnnotationReplyInput,
    authSessionId: AuthSessionId,
  ) => EffectType.Effect<ReviewLocalAnnotationReply, ReviewRpcServiceErrorCause>;
  readonly deleteLocalReply: (
    input: ReviewDeleteLocalAnnotationReplyInput,
    authSessionId: AuthSessionId,
  ) => EffectType.Effect<void, ReviewRpcServiceErrorCause>;
  readonly upsertOverviewNote: (
    input: ReviewUpsertOverviewNoteInput,
    authSessionId: AuthSessionId,
  ) => EffectType.Effect<ReviewOverviewNote, ReviewRpcServiceErrorCause>;
  readonly deleteOverviewNote: (
    input: ReviewDeleteOverviewNoteInput,
    authSessionId: AuthSessionId,
  ) => EffectType.Effect<void, ReviewRpcServiceErrorCause>;
  readonly getGitHubSnapshot: (
    input: ReviewGetGitHubSnapshotInput,
    authSessionId: AuthSessionId,
  ) => EffectType.Effect<ReviewSessionSnapshot["github"], ReviewRpcServiceErrorCause>;
  readonly upsertGitHubDraft: (
    input: ReviewUpsertGitHubDraftInput & { readonly authSessionId: AuthSessionId },
  ) => EffectType.Effect<NonNullable<ReviewSessionSnapshot["github"]>, ReviewRpcServiceErrorCause>;
  readonly applyRawMutation: (
    input: ReviewApplyRawMutationInput,
  ) => EffectType.Effect<ReviewApplyRawMutationResult, ReviewRpcServiceErrorCause>;
  readonly deleteGitHubDraft: (
    input: ReviewDeleteGitHubDraftInput & { readonly authSessionId: AuthSessionId },
  ) => EffectType.Effect<NonNullable<ReviewSessionSnapshot["github"]>, ReviewRpcServiceErrorCause>;
  readonly replyToGitHubThread: (
    input: ReviewReplyToGitHubThreadInput & { readonly authSessionId: AuthSessionId },
  ) => EffectType.Effect<NonNullable<ReviewSessionSnapshot["github"]>, ReviewRpcServiceErrorCause>;
  readonly submitGitHubDraft: (
    input: ReviewSubmitGitHubDraftInput & { readonly authSessionId: AuthSessionId },
  ) => EffectType.Effect<NonNullable<ReviewSessionSnapshot["github"]>, ReviewRpcServiceErrorCause>;
  readonly refreshProviderData: (
    input: ReviewRefreshProviderDataInput,
    authSessionId: AuthSessionId,
  ) => EffectType.Effect<ReviewSessionSnapshot, ReviewRpcServiceErrorCause>;
  readonly generateAnalysis: (
    input: ReviewGenerateAnalysisInput,
    authSessionId: AuthSessionId,
  ) => EffectType.Effect<
    NonNullable<ReviewSessionSnapshot["analysisArtifacts"]>[number],
    ReviewRpcServiceErrorCause
  >;
  readonly streamEvents: (
    input: ReviewGetSessionInput,
    authSessionId: AuthSessionId,
  ) => Stream.Stream<ReviewStreamEvent, ReviewRpcServiceErrorCause>;
}

export class ReviewRpcService extends ServiceMap.Service<ReviewRpcService, ReviewRpcServiceShape>()(
  "t3/review/Services/ReviewRpcService",
) {}

interface ReviewRpcDependencies {
  readonly sessions: ReviewSessionRepositoryShape;
  readonly annotations: ReviewAnnotationRepositoryShape;
  readonly progress: ReviewProgressRepositoryShape;
  readonly analysis: ReviewAnalysisRepositoryShape;
  readonly analysisService: ReviewAnalysisServiceShape;
  readonly diff: ReviewDiffServiceShape;
  readonly sessionService: ReviewSessionServiceShape;
  readonly write: ReviewWriteServiceShape;
  readonly sourceControlStatus: SourceControlStatusShape;
  readonly authSessions: SessionCredentialServiceShape;
}

const progressKey = (targetKind: string, targetId: string) => `${targetKind}:${targetId}`;

const rpcError = (message: string, cause?: unknown) =>
  new ReviewRpcError({ message, ...(cause === undefined ? {} : { cause }) });

function progressStateFor(
  map: ReadonlyMap<string, ReviewProgressRecord["progressState"]>,
  targetKind: string,
  targetId: string,
  fallback: ReviewProgressRecord["progressState"] = "unreviewed",
) {
  return map.get(progressKey(targetKind, targetId)) ?? fallback;
}

function toLocalThread(
  record: ReviewAnnotationRecord,
  progressMap: ReadonlyMap<string, ReviewProgressRecord["progressState"]>,
  currentChunksById: ReadonlyMap<string, ReviewChunk>,
  authSessionId: AuthSessionId,
): ReviewLocalAnnotationThread | null {
  if (
    record.annotationKind !== "thread" ||
    record.groupId === null ||
    record.fileId === null ||
    record.anchor === null
  ) {
    return null;
  }

  const stillMatchesCurrentChunk =
    record.chunkId !== null && currentChunksById.has(record.chunkId)
      ? currentChunksById.get(record.chunkId)!.anchor.patchFingerprint ===
        record.anchor.patchFingerprint
      : false;
  const isOutdated = record.chunkId !== null ? !stillMatchesCurrentChunk : false;

  return {
    id: record.annotationId as ReviewLocalAnnotationThread["id"],
    sessionId: record.sessionId,
    groupId: record.groupId,
    fileId: record.fileId,
    ...(record.chunkId ? { chunkId: record.chunkId } : {}),
    anchor: record.anchor,
    body: record.body,
    progressState: progressStateFor(progressMap, "thread", record.annotationId),
    isResolved: record.isResolved,
    isOutdated,
    isSuggestedResolved: isOutdated && !record.isResolved,
    viewerCanEdit: record.author.authSessionId === authSessionId,
    author: record.author,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toLocalReply(
  record: ReviewAnnotationRecord,
  authSessionId: AuthSessionId,
): ReviewLocalAnnotationReply | null {
  if (record.annotationKind !== "reply" || record.parentAnnotationId === null) {
    return null;
  }

  return {
    id: record.annotationId as ReviewLocalAnnotationReply["id"],
    threadId: record.parentAnnotationId as ReviewLocalAnnotationReply["threadId"],
    sessionId: record.sessionId,
    body: record.body,
    viewerCanEdit: record.author.authSessionId === authSessionId,
    author: record.author,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toOverviewNote(
  record: ReviewAnnotationRecord,
  progressMap: ReadonlyMap<string, ReviewProgressRecord["progressState"]>,
  authSessionId: AuthSessionId,
): ReviewOverviewNote | null {
  if (record.annotationKind !== "overview-note") {
    return null;
  }

  return {
    id: record.annotationId as ReviewOverviewNote["id"],
    sessionId: record.sessionId,
    ...(record.title ? { title: record.title } : {}),
    body: record.body,
    progressState: progressStateFor(progressMap, "overview-note", record.annotationId),
    viewerCanEdit: record.author.authSessionId === authSessionId,
    author: record.author,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function applyFileProgress(
  snapshot: ReviewDiffSnapshot,
  progressMap: ReadonlyMap<string, ReviewProgressRecord["progressState"]>,
) {
  return snapshot.lanes.flatMap((lane) =>
    lane.files.map((file) => ({
      id: file.fileId,
      sessionId: file.sessionId,
      groupId: file.groupId,
      normalizedPath: file.normalizedPath,
      displayPath: file.displayPath,
      progressState: progressStateFor(progressMap, "file", file.fileId),
    })),
  );
}

function applyGroupProgress(
  snapshot: ReviewDiffSnapshot,
  progressMap: ReadonlyMap<string, ReviewProgressRecord["progressState"]>,
) {
  return snapshot.lanes.map((lane) => ({
    id: lane.groupId,
    sessionId: lane.sessionId,
    title: lane.title,
    scope: snapshot.scope,
    lane: lane.kind,
    progressState: progressStateFor(progressMap, "group", lane.groupId),
    degradedReasons: [] as const,
  }));
}

function countProgress(
  values: ReadonlyArray<{ readonly progressState: ReviewProgressRecord["progressState"] }>,
) {
  let unreviewed = 0;
  let reviewed = 0;
  let needsFollowUp = 0;

  for (const value of values) {
    if (value.progressState === "reviewed") reviewed += 1;
    else if (value.progressState === "needs-follow-up") needsFollowUp += 1;
    else unreviewed += 1;
  }

  return { unreviewed, reviewed, needsFollowUp };
}

function toChunks(
  patch: ReviewDiffFilePatch,
  progressMap: ReadonlyMap<string, ReviewProgressRecord["progressState"]>,
): ReadonlyArray<ReviewChunk> {
  return patch.chunks.map((chunk) => ({
    id: chunk.chunkId,
    sessionId: patch.sessionId,
    groupId: patch.groupId,
    fileId: patch.fileId,
    anchor: chunk.anchor,
    progressState: progressStateFor(progressMap, "chunk", chunk.chunkId),
  }));
}

export const makeReviewRpcService = (deps: ReviewRpcDependencies) =>
  Effect.gen(function* () {
    const changes = yield* PubSub.unbounded<string>();

    const publish = (sessionId: string) => PubSub.publish(changes, sessionId).pipe(Effect.asVoid);

    const loadSession = (sessionId: ReviewGetSessionInput["sessionId"]) =>
      deps.sessions.getById({ sessionId }).pipe(
        Effect.flatMap((session) =>
          Option.match(session, {
            onNone: () => Effect.fail(rpcError("Review session not found.")),
            onSome: Effect.succeed,
          }),
        ),
      );

    const loadDiffSnapshot = (
      session: ReviewSessionRecord,
    ): EffectType.Effect<
      {
        readonly snapshot: ReviewDiffSnapshot;
        readonly degraded: ReadonlyArray<ReviewSessionSummary["degradedReasons"][number]>;
      },
      ReviewRpcServiceErrorCause
    > =>
      deps.diff
        .loadSnapshot({
          sessionId: session.sessionId,
          scope: session.scope,
          target: session.target,
        })
        .pipe(
          Effect.map((snapshot) => ({ snapshot, degraded: [] as const })),
          Effect.orElseSucceed(() => ({
            snapshot: {
              sessionId: session.sessionId,
              scope: session.scope,
              target: session.target,
              generatedAt: new Date().toISOString(),
              lanes: [],
            } satisfies ReviewDiffSnapshot,
            degraded: ["diff-unavailable"] as const,
          })),
        );

    const buildSnapshot = (
      sessionId: ReviewGetSessionInput["sessionId"],
      authSessionId: AuthSessionId,
    ): EffectType.Effect<ReviewSessionSnapshot, ReviewRpcServiceErrorCause> =>
      Effect.gen(function* () {
        const session = yield* loadSession(sessionId);
        const [diffResult, annotationRows, progressRows, analysisRow, github] = yield* Effect.all([
          loadDiffSnapshot(session),
          deps.annotations
            .listBySessionId({ sessionId })
            .pipe(
              Effect.mapError((cause) => rpcError("Failed to load review annotations.", cause)),
            ),
          deps.progress
            .listBySessionId({ sessionId })
            .pipe(Effect.mapError((cause) => rpcError("Failed to load review progress.", cause))),
          deps.analysis.getBySessionId({ sessionId }).pipe(
            Effect.map((row) => Option.getOrNull(row)),
            Effect.mapError((cause) => rpcError("Failed to load review analysis.", cause)),
          ),
          deps.write
            .getGitHubSnapshot({ sessionId, authSessionId })
            .pipe(Effect.orElseSucceed(() => null)),
        ]);

        const progressMap = new Map(
          progressRows.map((row) => [progressKey(row.targetKind, row.targetId), row.progressState]),
        );

        const groups = applyGroupProgress(diffResult.snapshot, progressMap);
        const files = applyFileProgress(diffResult.snapshot, progressMap);
        const patchArtifacts = yield* Effect.forEach(
          diffResult.snapshot.lanes.flatMap((lane) =>
            lane.files.map((file) => ({
              sessionId,
              scope: session.scope,
              target: session.target,
              lane: lane.kind,
              normalizedPath: file.normalizedPath,
            })),
          ),
          (patchInput) =>
            deps.diff.loadFilePatch(patchInput).pipe(Effect.orElseSucceed(() => null)),
          { concurrency: 4 },
        );
        const chunks = patchArtifacts.flatMap((patch) =>
          patch ? toChunks(patch, progressMap) : [],
        );
        const currentChunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
        const localThreads = annotationRows
          .map((record) => toLocalThread(record, progressMap, currentChunksById, authSessionId))
          .filter((value): value is ReviewLocalAnnotationThread => value !== null);
        const localReplies = annotationRows
          .map((record) => toLocalReply(record, authSessionId))
          .filter((value): value is ReviewLocalAnnotationReply => value !== null);
        const overviewNotes = annotationRows
          .map((record) => toOverviewNote(record, progressMap, authSessionId))
          .filter((value): value is ReviewOverviewNote => value !== null);
        const analysisArtifacts = analysisRow
          ? [
              yield* deps.analysisService
                .present({
                  record: analysisRow,
                  session,
                  diffSnapshot: diffResult.snapshot,
                })
                .pipe(
                  Effect.mapError((cause) =>
                    rpcError("Failed to project review analysis artifact.", cause),
                  ),
                ),
            ]
          : [];

        const progressCounts = countProgress([
          ...files,
          ...chunks,
          ...localThreads,
          ...overviewNotes,
        ]);
        const degradedReasons = [...diffResult.degraded];
        const blockedActions: Array<ReviewSessionSummary["blockedActions"][number]> = [];
        if (files.length === 0) blockedActions.push("no-reviewable-content");
        if (degradedReasons.length > 0) blockedActions.push("degraded-state");
        if (github && github.writable === false) blockedActions.push("github-review-read-only");

        return {
          summary: {
            id: session.sessionId,
            mode: session.mode,
            scope: session.scope,
            target: session.target,
            progressCounts,
            fileCount: files.length,
            chunkCount: chunks.length,
            localThreadCount: localThreads.length,
            overviewNoteCount: overviewNotes.length,
            analysisArtifactCount: analysisArtifacts.length,
            degradedReasons,
            blockedActions,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
          },
          groups,
          files,
          chunks,
          localThreads,
          localReplies,
          overviewNotes,
          analysisArtifacts,
          github,
        } as ReviewSessionSnapshot;
      });

    const buildSummary = (
      sessionId: ReviewGetSessionInput["sessionId"],
      authSessionId: AuthSessionId,
    ) => buildSnapshot(sessionId, authSessionId).pipe(Effect.map((snapshot) => snapshot.summary));

    const updateSession = <
      TInput extends { readonly sessionId: ReviewGetSessionInput["sessionId"] },
    >(
      input: TInput,
      update: (session: ReviewSessionRecord) => ReviewSessionRecord,
    ) =>
      Effect.gen(function* () {
        const current = yield* loadSession(input.sessionId);
        const next = update(current);
        yield* deps.sessions
          .upsert(next)
          .pipe(Effect.mapError((cause) => rpcError("Failed to persist review session.", cause)));
        yield* publish(input.sessionId);
        return next;
      });

    const resolveAuthorSnapshot = (
      fallback: ReviewLocalNoteAuthorSnapshot,
      authSessionId: AuthSessionId,
    ): EffectType.Effect<ReviewLocalNoteAuthorSnapshot, ReviewRpcServiceErrorCause> =>
      deps.authSessions.listActive().pipe(
        Effect.map((sessions) => sessions.find((session) => session.sessionId === authSessionId)),
        Effect.map((session) => ({
          authSessionId,
          subject: session?.subject?.trim() || fallback.subject,
          role: fallback.role,
          ...(session?.client.browser || session?.client.label
            ? { clientLabel: session.client.browser ?? session.client.label }
            : fallback.clientLabel
              ? { clientLabel: fallback.clientLabel }
              : {}),
          ...(session?.client.os || session?.client.label
            ? { deviceLabel: session.client.os ?? session.client.label }
            : fallback.deviceLabel
              ? { deviceLabel: fallback.deviceLabel }
              : {}),
        })),
        Effect.orElseSucceed(() => ({
          ...fallback,
          authSessionId,
        })),
      );

    const requireExistingAnnotation = (
      annotationId: string,
      message: string,
    ): EffectType.Effect<ReviewAnnotationRecord, ReviewRpcServiceErrorCause> =>
      deps.annotations.getById({ annotationId }).pipe(
        Effect.mapError((cause) => rpcError(message, cause)),
        Effect.flatMap((record) =>
          Option.match(record, {
            onNone: () => Effect.fail(rpcError(message)),
            onSome: Effect.succeed,
          }),
        ),
      );

    const ensureAuthorCanEdit = (
      record: ReviewAnnotationRecord,
      authSessionId: AuthSessionId,
    ): EffectType.Effect<void, ReviewRpcServiceErrorCause> =>
      record.author.authSessionId === authSessionId
        ? Effect.void
        : Effect.fail(
            rpcError("Only the original author can edit or delete this local review note."),
          );

    return ReviewRpcService.of({
      getOrCreateSession: (input, authSessionId) =>
        Effect.gen(function* () {
          const result: EnsureActiveReviewSessionResult = yield* deps.sessionService
            .ensureActiveSession({
              threadId: input.threadId,
              ...(input.baseBranchOverride ? { baseBranchOverride: input.baseBranchOverride } : {}),
              ...(input.pullRequestOverride
                ? { pullRequestOverride: input.pullRequestOverride }
                : {}),
              ...(input.mode ? { mode: input.mode } : {}),
              ...(input.scope ? { scope: input.scope } : {}),
            })
            .pipe(Effect.mapError((cause) => rpcError("Failed to resolve review session.", cause)));
          yield* publish(result.session.sessionId);
          return yield* buildSummary(result.session.sessionId, authSessionId);
        }),
      getSessionSummary: (input, authSessionId) => buildSummary(input.sessionId, authSessionId),
      getSessionSnapshot: (input, authSessionId) => buildSnapshot(input.sessionId, authSessionId),
      getDiffSnapshot: (input) =>
        Effect.gen(function* () {
          const session = yield* loadSession(input.sessionId);
          return (yield* loadDiffSnapshot(session)).snapshot;
        }),
      getFilePatch: (input) =>
        Effect.gen(function* () {
          const session = yield* loadSession(input.sessionId);
          return yield* deps.diff
            .loadFilePatch({
              sessionId: session.sessionId,
              scope: session.scope,
              target: session.target,
              lane: input.lane,
              normalizedPath: input.normalizedPath,
            })
            .pipe(Effect.mapError((cause) => rpcError("Failed to load review file patch.", cause)));
        }),
      getChunkPayload: (input) =>
        Effect.gen(function* () {
          const session = yield* loadSession(input.sessionId);
          const artifact = yield* deps.diff
            .loadFilePatchArtifact({
              sessionId: session.sessionId,
              scope: session.scope,
              target: session.target,
              lane: input.lane,
              normalizedPath: input.normalizedPath,
            })
            .pipe(
              Effect.mapError((cause) => rpcError("Failed to load review chunk payload.", cause)),
            );
          if (artifact === null) return null;
          const chunkArtifact = artifact.chunkArtifacts.find(
            (chunk) => chunk.chunkId === input.chunkId,
          );
          if (!chunkArtifact) return null;
          return {
            sessionId: session.sessionId,
            groupId: artifact.patch.groupId,
            fileId: artifact.patch.fileId,
            lane: input.lane,
            normalizedPath: artifact.patch.normalizedPath,
            chunkId: chunkArtifact.chunkId,
            anchor: chunkArtifact.anchor,
            rawPatch: chunkArtifact.rawPatch,
          } as ReviewChunkPayload;
        }),
      setMode: (input, authSessionId) =>
        updateSession(input, (session) => ({
          ...session,
          mode: input.mode,
          updatedAt: new Date().toISOString(),
        })).pipe(Effect.flatMap((session) => buildSummary(session.sessionId, authSessionId))),
      setScope: (input, authSessionId) =>
        updateSession(input, (session) => ({
          ...session,
          scope: input.scope,
          updatedAt: new Date().toISOString(),
        })).pipe(Effect.flatMap((session) => buildSummary(session.sessionId, authSessionId))),
      setProgress: (input, authSessionId) =>
        Effect.gen(function* () {
          const targetId = input.chunkId ?? input.fileId ?? input.threadId ?? input.overviewNoteId;
          const targetKind = input.chunkId
            ? "chunk"
            : input.fileId
              ? "file"
              : input.threadId
                ? "thread"
                : input.overviewNoteId
                  ? "overview-note"
                  : null;
          if (!targetId || !targetKind) {
            return yield* rpcError("Review progress updates require a target.");
          }
          const author = yield* resolveAuthorSnapshot(
            {
              authSessionId,
              subject: "Current session",
              role: "user",
            },
            authSessionId,
          );
          yield* deps.progress
            .upsert({
              sessionId: input.sessionId,
              targetKind,
              targetId,
              progressState: input.progressState,
              author,
              lastUpdatedAt: new Date().toISOString(),
            })
            .pipe(
              Effect.mapError((cause) => rpcError("Failed to persist review progress.", cause)),
            );
          yield* publish(input.sessionId);
          return yield* buildSummary(input.sessionId, authSessionId);
        }),
      createLocalThread: (input, authSessionId) =>
        Effect.gen(function* () {
          const now = new Date().toISOString();
          const author = yield* resolveAuthorSnapshot(input.author, authSessionId);
          const thread: ReviewAnnotationRecord = {
            annotationId: `review-thread-${randomUUID()}`,
            sessionId: input.sessionId,
            annotationKind: "thread",
            parentAnnotationId: null,
            targetKind: input.chunkId ? "chunk" : "file",
            targetId: input.chunkId ?? input.fileId,
            groupId: input.groupId,
            fileId: input.fileId,
            chunkId: input.chunkId ?? null,
            anchor: input.anchor,
            source: "local",
            title: null,
            body: input.body,
            author,
            isResolved: false,
            isReopened: false,
            isOutdated: false,
            isSuggestedResolved: false,
            createdAt: now,
            updatedAt: now,
          };
          yield* deps.annotations
            .upsert(thread)
            .pipe(
              Effect.mapError((cause) => rpcError("Failed to create local review thread.", cause)),
            );
          if (input.progressState) {
            yield* deps.progress.upsert({
              sessionId: input.sessionId,
              targetKind: "thread",
              targetId: thread.annotationId,
              progressState: input.progressState,
              author: thread.author,
              lastUpdatedAt: now,
            });
          }
          yield* publish(input.sessionId);
          return {
            id: thread.annotationId as ReviewLocalAnnotationThread["id"],
            sessionId: thread.sessionId,
            groupId: thread.groupId!,
            fileId: thread.fileId!,
            ...(thread.chunkId ? { chunkId: thread.chunkId } : {}),
            anchor: thread.anchor!,
            body: thread.body,
            progressState: input.progressState ?? "unreviewed",
            isResolved: false,
            isOutdated: false,
            isSuggestedResolved: false,
            viewerCanEdit: true,
            author: thread.author,
            createdAt: thread.createdAt,
            updatedAt: thread.updatedAt,
          } as ReviewLocalAnnotationThread;
        }),
      updateLocalThread: (input, authSessionId) =>
        Effect.gen(function* () {
          const existing = yield* requireExistingAnnotation(
            input.threadId,
            "Review thread not found.",
          );
          yield* ensureAuthorCanEdit(existing, authSessionId);
          if (existing.annotationKind !== "thread") {
            return yield* rpcError("Review thread not found.");
          }
          const updated = {
            ...existing,
            body: input.body,
            updatedAt: new Date().toISOString(),
          } satisfies ReviewAnnotationRecord;
          yield* deps.annotations
            .upsert(updated)
            .pipe(
              Effect.mapError((cause) => rpcError("Failed to update local review thread.", cause)),
            );
          yield* publish(input.sessionId);
          const snapshot = yield* buildSnapshot(input.sessionId, authSessionId);
          const thread = snapshot.localThreads.find((candidate) => candidate.id === input.threadId);
          return yield* thread
            ? Effect.succeed(thread)
            : Effect.fail(rpcError("Review thread not found after update."));
        }),
      deleteLocalThread: (input, authSessionId) =>
        Effect.gen(function* () {
          const existing = yield* requireExistingAnnotation(
            input.threadId,
            "Review thread not found.",
          );
          yield* ensureAuthorCanEdit(existing, authSessionId);
          yield* deps.annotations
            .deleteById({ annotationId: input.threadId })
            .pipe(
              Effect.mapError((cause) => rpcError("Failed to delete local review thread.", cause)),
            );
          yield* publish(input.sessionId);
        }),
      setLocalThreadResolved: (input, authSessionId) =>
        Effect.gen(function* () {
          const existing = yield* requireExistingAnnotation(
            input.threadId,
            "Review thread not found.",
          );
          if (existing.annotationKind !== "thread") {
            return yield* rpcError("Review thread not found.");
          }
          const updated = {
            ...existing,
            isResolved: input.resolved,
            isReopened: input.resolved ? existing.isReopened : true,
            updatedAt: new Date().toISOString(),
          } satisfies ReviewAnnotationRecord;
          yield* deps.annotations
            .upsert(updated)
            .pipe(
              Effect.mapError((cause) =>
                rpcError("Failed to update local review thread resolution.", cause),
              ),
            );
          yield* publish(input.sessionId);
          const snapshot = yield* buildSnapshot(input.sessionId, authSessionId);
          const thread = snapshot.localThreads.find((candidate) => candidate.id === input.threadId);
          return yield* thread
            ? Effect.succeed(thread)
            : Effect.fail(rpcError("Review thread not found after update."));
        }),
      createLocalReply: (input, authSessionId) =>
        Effect.gen(function* () {
          const parent = yield* requireExistingAnnotation(
            input.threadId,
            "Review thread not found.",
          );
          const author = yield* resolveAuthorSnapshot(input.author, authSessionId);
          const now = new Date().toISOString();
          const reply: ReviewAnnotationRecord = {
            annotationId: `review-reply-${randomUUID()}`,
            sessionId: input.sessionId,
            annotationKind: "reply",
            parentAnnotationId: parent.annotationId,
            targetKind: "chunk",
            targetId: parent.chunkId ?? parent.fileId ?? parent.groupId ?? parent.annotationId,
            groupId: parent.groupId,
            fileId: parent.fileId,
            chunkId: parent.chunkId,
            anchor: parent.anchor,
            source: "local",
            title: null,
            body: input.body,
            author,
            isResolved: false,
            isReopened: false,
            isOutdated: false,
            isSuggestedResolved: false,
            createdAt: now,
            updatedAt: now,
          };
          yield* deps.annotations
            .upsert(reply)
            .pipe(
              Effect.mapError((cause) => rpcError("Failed to create local review reply.", cause)),
            );
          yield* publish(input.sessionId);
          return {
            id: reply.annotationId as ReviewLocalAnnotationReply["id"],
            threadId: parent.annotationId as ReviewLocalAnnotationReply["threadId"],
            sessionId: reply.sessionId,
            body: reply.body,
            viewerCanEdit: true,
            author: reply.author,
            createdAt: reply.createdAt,
            updatedAt: reply.updatedAt,
          };
        }),
      updateLocalReply: (input, authSessionId) =>
        Effect.gen(function* () {
          const existing = yield* requireExistingAnnotation(
            input.replyId,
            "Review reply not found.",
          );
          yield* ensureAuthorCanEdit(existing, authSessionId);
          if (existing.annotationKind !== "reply" || existing.parentAnnotationId === null) {
            return yield* rpcError("Review reply not found.");
          }
          const updated = {
            ...existing,
            body: input.body,
            updatedAt: new Date().toISOString(),
          } satisfies ReviewAnnotationRecord;
          yield* deps.annotations
            .upsert(updated)
            .pipe(
              Effect.mapError((cause) => rpcError("Failed to update local review reply.", cause)),
            );
          yield* publish(input.sessionId);
          return {
            id: updated.annotationId as ReviewLocalAnnotationReply["id"],
            threadId: updated.parentAnnotationId as ReviewLocalAnnotationReply["threadId"],
            sessionId: updated.sessionId,
            body: updated.body,
            viewerCanEdit: true,
            author: updated.author,
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
          };
        }),
      deleteLocalReply: (input, authSessionId) =>
        Effect.gen(function* () {
          const existing = yield* requireExistingAnnotation(
            input.replyId,
            "Review reply not found.",
          );
          yield* ensureAuthorCanEdit(existing, authSessionId);
          yield* deps.annotations
            .deleteById({ annotationId: input.replyId })
            .pipe(
              Effect.mapError((cause) => rpcError("Failed to delete local review reply.", cause)),
            );
          yield* publish(input.sessionId);
        }),
      upsertOverviewNote: (input, authSessionId) =>
        Effect.gen(function* () {
          const existing = input.noteId
            ? yield* deps.annotations.getById({ annotationId: input.noteId }).pipe(
                Effect.mapError((cause) => rpcError("Failed to read overview note.", cause)),
                Effect.map(Option.getOrNull),
              )
            : null;
          if (existing) {
            yield* ensureAuthorCanEdit(existing, authSessionId);
          }
          const now = new Date().toISOString();
          const author = yield* resolveAuthorSnapshot(input.author, authSessionId);
          const note: ReviewAnnotationRecord = {
            annotationId: existing?.annotationId ?? input.noteId ?? `review-note-${randomUUID()}`,
            sessionId: input.sessionId,
            annotationKind: "overview-note",
            parentAnnotationId: null,
            targetKind: "overview",
            targetId: null,
            groupId: null,
            fileId: null,
            chunkId: null,
            anchor: null,
            source: "local",
            title: input.title ?? null,
            body: input.body,
            author: existing?.author ?? author,
            isResolved: false,
            isReopened: false,
            isOutdated: false,
            isSuggestedResolved: false,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          };
          yield* deps.annotations
            .upsert(note)
            .pipe(Effect.mapError((cause) => rpcError("Failed to persist overview note.", cause)));
          if (input.progressState) {
            yield* deps.progress.upsert({
              sessionId: input.sessionId,
              targetKind: "overview-note",
              targetId: note.annotationId,
              progressState: input.progressState,
              author: note.author,
              lastUpdatedAt: now,
            });
          }
          yield* publish(input.sessionId);
          return {
            id: note.annotationId as ReviewOverviewNote["id"],
            sessionId: note.sessionId,
            ...(note.title ? { title: note.title } : {}),
            body: note.body,
            progressState: input.progressState ?? "unreviewed",
            viewerCanEdit: true,
            author: note.author,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
          } as ReviewOverviewNote;
        }),
      deleteOverviewNote: (input, authSessionId) =>
        Effect.gen(function* () {
          const existing = yield* requireExistingAnnotation(
            input.noteId,
            "Overview note not found.",
          );
          yield* ensureAuthorCanEdit(existing, authSessionId);
          yield* deps.annotations
            .deleteById({ annotationId: input.noteId })
            .pipe(Effect.mapError((cause) => rpcError("Failed to delete overview note.", cause)));
          yield* publish(input.sessionId);
        }),
      getGitHubSnapshot: (input, authSessionId) =>
        deps.write
          .getGitHubSnapshot({ ...input, authSessionId })
          .pipe(
            Effect.mapError((cause) => rpcError("Failed to read GitHub review snapshot.", cause)),
          ),
      upsertGitHubDraft: (input) =>
        deps.write.upsertGitHubDraft(input).pipe(
          Effect.tap(() => publish(input.sessionId)),
          Effect.mapError((cause) => rpcError("Failed to persist GitHub review draft.", cause)),
        ),
      applyRawMutation: (input) =>
        deps.write.applyRawMutation(input).pipe(
          Effect.tap(() => publish(input.sessionId)),
          Effect.mapError((cause) =>
            Schema.is(ReviewRpcError)(cause) || Schema.is(ReviewActionBlockedError)(cause)
              ? cause
              : rpcError("Failed to apply raw review mutation.", cause),
          ),
        ),
      deleteGitHubDraft: (input) =>
        deps.write.deleteGitHubDraft(input).pipe(
          Effect.tap(() => publish(input.sessionId)),
          Effect.mapError((cause) => rpcError("Failed to delete GitHub review draft.", cause)),
        ),
      replyToGitHubThread: (input) =>
        deps.write.replyToGitHubThread(input).pipe(
          Effect.tap(() => publish(input.sessionId)),
          Effect.mapError((cause) => rpcError("Failed to reply to GitHub review thread.", cause)),
        ),
      submitGitHubDraft: (input) =>
        deps.write.submitGitHubDraft(input).pipe(
          Effect.tap(() => publish(input.sessionId)),
          Effect.mapError((cause) => rpcError("Failed to submit GitHub review draft.", cause)),
        ),
      refreshProviderData: (input, authSessionId) =>
        Effect.gen(function* () {
          const session = yield* loadSession(input.sessionId);
          const existingAnalysis = yield* deps.analysis
            .getBySessionId({ sessionId: input.sessionId })
            .pipe(
              Effect.map((row) => Option.getOrNull(row)),
              Effect.mapError((cause) => rpcError("Failed to load review analysis.", cause)),
            );
          if (existingAnalysis) {
            const refreshed = yield* deps.analysisService
              .refreshStaleness({
                record: existingAnalysis,
                session,
              })
              .pipe(
                Effect.mapError((cause) =>
                  rpcError("Failed to refresh review analysis staleness.", cause),
                ),
              );
            yield* deps.analysis
              .upsertLatest(refreshed)
              .pipe(
                Effect.mapError((cause) =>
                  rpcError("Failed to persist refreshed review analysis.", cause),
                ),
              );
          }
          const snapshot = yield* buildSnapshot(input.sessionId, authSessionId);
          yield* publish(input.sessionId);
          return snapshot;
        }),
      generateAnalysis: (input, authSessionId) =>
        Effect.gen(function* () {
          const session = yield* loadSession(input.sessionId);
          const existing = yield* deps.analysis.getBySessionId({ sessionId: input.sessionId }).pipe(
            Effect.map((row) => Option.getOrNull(row)),
            Effect.mapError((cause) => rpcError("Failed to load review analysis.", cause)),
          );
          const shouldRegenerate =
            existing === null || input.force === true || input.instruction !== undefined;
          if (existing && !shouldRegenerate) {
            const snapshot = yield* buildSnapshot(input.sessionId, authSessionId);
            return snapshot.analysisArtifacts[0]!;
          }
          const analysisRecord = yield* deps.analysisService
            .generate(
              input.instruction === undefined
                ? { session }
                : {
                    session,
                    instruction: input.instruction,
                  },
            )
            .pipe(
              Effect.mapError((cause) => rpcError("Failed to generate review analysis.", cause)),
            );
          yield* deps.analysis
            .upsertLatest(analysisRecord)
            .pipe(
              Effect.mapError((cause) => rpcError("Failed to persist review analysis.", cause)),
            );
          yield* publish(input.sessionId);
          const snapshot = yield* buildSnapshot(input.sessionId, authSessionId);
          return snapshot.analysisArtifacts[0]!;
        }),
      streamEvents: (input, authSessionId) =>
        Stream.unwrap(
          loadSession(input.sessionId).pipe(
            Effect.map((session) =>
              Stream.merge(
                Stream.fromEffect(buildSnapshot(input.sessionId, authSessionId)).pipe(
                  Stream.map((snapshot) => ({
                    _tag: "sessionSnapshotReplaced" as const,
                    snapshot,
                  })),
                ),
                Stream.merge(
                  Stream.fromPubSub(changes).pipe(
                    Stream.filter((sessionId) => sessionId === input.sessionId),
                    Stream.debounce(Duration.millis(50)),
                    Stream.mapEffect(() => buildSnapshot(input.sessionId, authSessionId)),
                  ),
                  deps.sourceControlStatus.streamStatus({ cwd: session.target.cwd }).pipe(
                    Stream.debounce(Duration.millis(150)),
                    Stream.mapEffect(() => buildSnapshot(input.sessionId, authSessionId)),
                  ),
                ).pipe(
                  Stream.map((snapshot) => ({
                    _tag: "sessionSnapshotReplaced" as const,
                    snapshot,
                  })),
                ),
              ),
            ),
          ),
        ).pipe(
          Stream.mapError((cause) =>
            Schema.is(ReviewRpcError)(cause) ? cause : rpcError("Review stream failed.", cause),
          ),
        ),
    });
  });
