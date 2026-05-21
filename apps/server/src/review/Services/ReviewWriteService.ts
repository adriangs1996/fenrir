import type { GitCommandError, GitHubCliError, GitManagerServiceError } from "@fenrir/contracts";
import { Data, Effect, ServiceMap } from "effect";
import type { Effect as EffectType } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";
import type { ReviewSessionRecord } from "../../persistence/Services/ReviewSessions.ts";
import type { ReviewDiffServiceError, ReviewDiffServiceShape } from "./ReviewDiffService.ts";
import type {
  ReviewProviderError,
  ReviewProviderPullRequest,
  ReviewProviderReadResult,
} from "./ReviewProvider.ts";
import type {
  ReviewMutationServiceErrorCause,
  ReviewMutationServiceShape,
} from "./ReviewMutationService.ts";
import type { ReviewGitHubPendingDraftRepositoryShape } from "../../persistence/Services/ReviewGitHubDrafts.ts";
import type { ReviewSessionRepositoryShape } from "../../persistence/Services/ReviewSessions.ts";
import type { GitHubCliShape } from "../../git/Services/GitHubCli.ts";
import {
  GitHubReviewCommentId,
  GitHubReviewDecision,
  GitHubReviewDraftId,
  GitHubReviewThreadId,
  ReviewApplyRawMutationInput,
  ReviewApplyRawMutationResult,
  ReviewActionBlockedReason,
  ReviewActionBlockedError,
  ReviewChunkId,
  ReviewGetGitHubSnapshotInput,
  ReviewReplyToGitHubThreadInput,
  ReviewRpcError,
  ReviewSessionId,
  ReviewSubmitGitHubDraftInput,
  ReviewUpsertGitHubDraftInput,
  ReviewDeleteGitHubDraftInput,
  type GitHubReviewSnapshot as GitHubReviewSnapshotType,
  type ReviewGitHubPendingDraft as ReviewGitHubPendingDraftType,
  type ReviewStableAnchor,
} from "../../../../../packages/contracts/src/review.ts";
import { hashReviewAnchor } from "../../../../../packages/shared/src/review.ts";
import { pullRequestForReviewSession } from "../reviewSessionPullRequest.ts";

const GITHUB_GRAPHQL_TIMEOUT_MS = 45_000;

export class ReviewWriteServiceError extends Data.TaggedError("ReviewWriteServiceError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

type ReviewWriteServiceErrorCause =
  | ReviewWriteServiceError
  | ReviewMutationServiceErrorCause
  | ProjectionRepositoryError
  | ReviewDiffServiceError
  | GitCommandError
  | GitManagerServiceError
  | ReviewProviderError
  | GitHubCliError
  | ReviewRpcError
  | ReviewActionBlockedError;

export interface ReviewWriteServiceShape {
  readonly getGitHubSnapshot: (
    input: ReviewGetGitHubSnapshotInput & {
      readonly authSessionId: ReviewGitHubPendingDraftType["authSessionId"];
    },
  ) => EffectType.Effect<GitHubReviewSnapshotType | null, ReviewWriteServiceErrorCause>;
  readonly upsertGitHubDraft: (
    input: ReviewUpsertGitHubDraftInput & {
      readonly authSessionId: ReviewGitHubPendingDraftType["authSessionId"];
    },
  ) => EffectType.Effect<GitHubReviewSnapshotType, ReviewWriteServiceErrorCause>;
  readonly deleteGitHubDraft: (
    input: ReviewDeleteGitHubDraftInput & {
      readonly authSessionId: ReviewGitHubPendingDraftType["authSessionId"];
    },
  ) => EffectType.Effect<GitHubReviewSnapshotType, ReviewWriteServiceErrorCause>;
  readonly replyToGitHubThread: (
    input: ReviewReplyToGitHubThreadInput & {
      readonly authSessionId: ReviewGitHubPendingDraftType["authSessionId"];
    },
  ) => EffectType.Effect<GitHubReviewSnapshotType, ReviewWriteServiceErrorCause>;
  readonly submitGitHubDraft: (
    input: ReviewSubmitGitHubDraftInput & {
      readonly authSessionId: ReviewGitHubPendingDraftType["authSessionId"];
    },
  ) => EffectType.Effect<GitHubReviewSnapshotType, ReviewWriteServiceErrorCause>;
  readonly applyRawMutation: (
    input: ReviewApplyRawMutationInput,
  ) => EffectType.Effect<ReviewApplyRawMutationResult, ReviewWriteServiceErrorCause>;
}

export class ReviewWriteService extends ServiceMap.Service<
  ReviewWriteService,
  ReviewWriteServiceShape
>()("t3/review/Services/ReviewWriteService") {}

interface ReviewWriteDependencies {
  readonly sessions: ReviewSessionRepositoryShape;
  readonly drafts: ReviewGitHubPendingDraftRepositoryShape;
  readonly diff: ReviewDiffServiceShape;
  readonly provider: {
    readonly readReview: (input: {
      readonly cwd: string;
      readonly pullRequest: ReviewProviderPullRequest | null;
    }) => EffectType.Effect<ReviewProviderReadResult, never>;
  };
  readonly gitHubCli: GitHubCliShape;
  readonly mutations: ReviewMutationServiceShape;
  readonly now: () => string;
  readonly makeId: () => string;
}

interface CommittedChunkRecord {
  readonly chunkId: ReviewChunkId;
  readonly anchor: ReviewStableAnchor;
}

function blocked(reason: ReviewActionBlockedReason, message: string) {
  return new ReviewActionBlockedError({ reason, message });
}

function rpcError(message: string, cause?: unknown) {
  return new ReviewRpcError({ message, ...(cause === undefined ? {} : { cause }) });
}

function reviewDraftDecision(
  drafts: ReadonlyArray<ReviewGitHubPendingDraftType>,
): typeof GitHubReviewDecision.Type {
  return (
    drafts.find((draft) => draft.draftKind === "review-summary")?.submitAction ??
    drafts.find((draft) => draft.submitAction !== null)?.submitAction ??
    "comment"
  );
}

function toDraftSnapshot(input: {
  readonly drafts: ReadonlyArray<ReviewGitHubPendingDraftType>;
  readonly pullRequestNumber: number;
}): GitHubReviewSnapshotType["draft"] {
  if (input.drafts.length === 0) {
    return null;
  }

  const summaryDraft = input.drafts.find((draft) => draft.draftKind === "review-summary") ?? null;
  const inlineDrafts = input.drafts.filter(
    (draft) => draft.draftKind === "inline-comment" && draft.anchor !== null,
  );
  const createdAt = input.drafts.reduce(
    (min, draft) => (draft.createdAt < min ? draft.createdAt : min),
    input.drafts[0]!.createdAt,
  );
  const updatedAt = input.drafts.reduce(
    (max, draft) => (draft.updatedAt > max ? draft.updatedAt : max),
    input.drafts[0]!.updatedAt,
  );

  return {
    id: GitHubReviewDraftId.makeUnsafe("github-review-local-pending"),
    state: "pending",
    pullRequestNumber: input.pullRequestNumber,
    decision: reviewDraftDecision(input.drafts),
    ...(summaryDraft ? { body: summaryDraft.body } : {}),
    threads: inlineDrafts.map((draft) => {
      const threadId = GitHubReviewThreadId.makeUnsafe(`github-pending-thread-${draft.id}`);
      const anchor = draft.anchor!;
      return {
        id: threadId,
        path: anchor.normalizedPath,
        anchor,
        isResolved: false,
        isOutdated: draft.isOutdated,
        comments: [
          {
            id: GitHubReviewCommentId.makeUnsafe(`github-pending-comment-${draft.id}`),
            threadId,
            path: anchor.normalizedPath,
            body: draft.body,
            anchor,
            authorLogin: "you",
            isPending: true,
            createdAt: draft.createdAt,
            updatedAt: draft.updatedAt,
          },
        ],
      };
    }),
    createdAt,
    updatedAt,
  };
}

function extractGitHubSnapshot(input: {
  readonly session: ReviewSessionRecord;
  readonly remote: ReviewProviderReadResult;
  readonly drafts: ReadonlyArray<ReviewGitHubPendingDraftType>;
}): GitHubReviewSnapshotType | null {
  const pullRequestNumber =
    input.session.pullRequestNumber ?? input.session.target.pullRequestNumber ?? null;
  if (pullRequestNumber === null) {
    return null;
  }

  return {
    provider: "github",
    pullRequestNumber,
    writable: input.remote.status === "available",
    draft: toDraftSnapshot({
      drafts: input.drafts,
      pullRequestNumber,
    }),
    pendingDrafts: input.drafts.map((draft) => ({
      id: draft.id,
      draftKind: draft.draftKind,
      anchor: draft.anchor,
      body: draft.body,
      isOutdated: draft.isOutdated,
      submitAction: draft.submitAction,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    })),
    threads:
      input.remote.status === "available"
        ? input.remote.snapshot.reviewThreads.map((thread) => ({
            id: GitHubReviewThreadId.makeUnsafe(thread.id),
            path: thread.path,
            anchor: thread.anchor,
            isResolved: thread.isResolved,
            isOutdated: thread.isOutdated,
            comments: thread.comments.map((comment) => ({
              id: GitHubReviewCommentId.makeUnsafe(comment.id),
              threadId: GitHubReviewThreadId.makeUnsafe(thread.id),
              path: comment.path,
              body: comment.body,
              anchor: comment.anchor,
              authorLogin: comment.authorLogin,
              ...(comment.authorAvatarUrl ? { authorAvatarUrl: comment.authorAvatarUrl } : {}),
              isPending: false,
              createdAt: comment.createdAt,
              updatedAt: comment.updatedAt,
            })),
          }))
        : [],
    generalComments:
      input.remote.status === "available"
        ? input.remote.snapshot.generalComments.map((comment) => ({
            id: GitHubReviewCommentId.makeUnsafe(comment.id),
            body: comment.body,
            authorLogin: comment.authorLogin,
            ...(comment.authorAvatarUrl ? { authorAvatarUrl: comment.authorAvatarUrl } : {}),
            isPending: false,
            createdAt: comment.createdAt,
            updatedAt: comment.updatedAt,
          }))
        : [],
    reviews: [],
  };
}

function normalizeGraphQlErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function graphQlPayload(raw: string, operation: string) {
  return Effect.try({
    try: () => JSON.parse(raw) as Record<string, unknown>,
    catch: (cause) =>
      new ReviewWriteServiceError({
        operation,
        message: `GitHub returned invalid GraphQL JSON for ${operation}.`,
        cause,
      }),
  }).pipe(
    Effect.flatMap((payload) => {
      const errors = Array.isArray(payload.errors) ? payload.errors : [];
      const errorMessages = errors
        .map((entry) =>
          typeof entry === "object" && entry !== null && typeof entry.message === "string"
            ? entry.message.trim()
            : "",
        )
        .filter((value) => value.length > 0);
      if (errorMessages.length > 0) {
        return Effect.fail(
          new ReviewWriteServiceError({
            operation,
            message: errorMessages.join("; "),
            cause: payload,
          }),
        );
      }
      return Effect.succeed(payload);
    }),
  );
}

function graphQlArgs(query: string, variables: Readonly<Record<string, string>>) {
  const args = ["api", "graphql"];
  for (const [key, value] of Object.entries(variables)) {
    args.push("-F", `${key}=${value}`);
  }
  args.push("-f", `query=${query}`);
  return args;
}

const pullRequestNodeIdQuery = `
query FenrirPullRequestNodeId($url: URI!) {
  resource(url: $url) {
    __typename
    ... on PullRequest {
      id
      number
      url
    }
  }
}
`;

const addPullRequestReviewMutation = `
mutation FenrirAddPullRequestReview(
  $pullRequestId: ID!
  $event: PullRequestReviewEvent!
  $body: String
  $threads: [DraftPullRequestReviewThread!]
) {
  addPullRequestReview(
    input: {
      pullRequestId: $pullRequestId
      event: $event
      body: $body
      threads: $threads
    }
  ) {
    pullRequestReview {
      id
    }
  }
}
`;

const addPullRequestReviewThreadReplyMutation = `
mutation FenrirAddPullRequestReviewThreadReply(
  $threadId: ID!
  $body: String!
) {
  addPullRequestReviewThreadReply(
    input: {
      pullRequestReviewThreadId: $threadId
      body: $body
    }
  ) {
    comment {
      id
    }
  }
}
`;

function reviewEvent(
  decision: typeof GitHubReviewDecision.Type,
): "COMMENT" | "APPROVE" | "REQUEST_CHANGES" {
  switch (decision) {
    case "approve":
      return "APPROVE";
    case "request-changes":
      return "REQUEST_CHANGES";
    default:
      return "COMMENT";
  }
}

function reviewThreadInputForAnchor(anchor: ReviewStableAnchor, body: string) {
  if (anchor.provenance.scope !== "branch" || anchor.provenance.lane !== "committed") {
    return null;
  }

  const lineRange = anchor.newRange ?? anchor.oldRange;
  if (!lineRange) {
    return null;
  }

  const side = anchor.newRange ? "RIGHT" : "LEFT";
  return {
    path: anchor.normalizedPath,
    body,
    line: String(lineRange.endLine),
    side,
    ...(lineRange.startLine !== lineRange.endLine
      ? {
          startLine: String(lineRange.startLine),
          startSide: side,
        }
      : {}),
  };
}

export function makeReviewWriteService(
  dependencies: ReviewWriteDependencies,
): ReviewWriteServiceShape {
  const getSession = (sessionId: ReviewSessionId) =>
    dependencies.sessions
      .getById({ sessionId })
      .pipe(
        Effect.flatMap((session) =>
          session._tag === "Some"
            ? Effect.succeed(session.value)
            : Effect.fail(
                rpcError(`Review session "${sessionId}" does not exist or is no longer available.`),
              ),
        ),
      );

  const loadCommittedChunks = (session: ReviewSessionRecord) =>
    dependencies.diff
      .loadSnapshot({
        sessionId: session.sessionId,
        scope: "branch",
        target: session.target,
      })
      .pipe(
        Effect.flatMap((snapshot) => {
          const committedLane = snapshot.lanes.find((lane) => lane.kind === "committed");
          if (!committedLane) {
            return Effect.succeed([] as ReadonlyArray<CommittedChunkRecord>);
          }

          return Effect.forEach(
            committedLane.files,
            (file) =>
              dependencies.diff
                .loadFilePatch({
                  sessionId: session.sessionId,
                  scope: "branch",
                  target: session.target,
                  lane: "committed",
                  normalizedPath: file.normalizedPath,
                })
                .pipe(
                  Effect.map((patch) =>
                    (patch?.chunks ?? []).map((chunk) => ({
                      chunkId: chunk.chunkId,
                      anchor: chunk.anchor,
                    })),
                  ),
                ),
            { concurrency: 4 },
          ).pipe(Effect.map((chunks) => chunks.flat()));
        }),
      );

  const loadSnapshot = (input: {
    readonly session: ReviewSessionRecord;
    readonly authSessionId: ReviewGitHubPendingDraftType["authSessionId"];
  }) =>
    Effect.gen(function* () {
      const pullRequest = pullRequestForReviewSession(input.session);
      const drafts = yield* dependencies.drafts.listForViewer({
        sessionId: input.session.sessionId,
        authSessionId: input.authSessionId,
      });
      const remote = yield* dependencies.provider.readReview({
        cwd: input.session.checkoutPath,
        pullRequest,
      });
      return extractGitHubSnapshot({
        session: input.session,
        remote,
        drafts,
      });
    });

  const getGitHubSnapshot: ReviewWriteServiceShape["getGitHubSnapshot"] = (input) =>
    Effect.gen(function* () {
      const session = yield* getSession(input.sessionId);
      return yield* loadSnapshot({
        session,
        authSessionId: input.authSessionId,
      });
    });

  const resolveInlineDraftAnchor = (input: {
    readonly session: ReviewSessionRecord;
    readonly chunkId: ReviewChunkId;
  }) =>
    Effect.gen(function* () {
      const committedChunks = yield* loadCommittedChunks(input.session);
      const chunk =
        committedChunks.find((candidate) => candidate.chunkId === input.chunkId) ?? null;
      if (!chunk) {
        return yield* blocked(
          "github-review-read-only",
          `Only pull-request-mapped committed chunks can create GitHub inline comments. Chunk "${input.chunkId}" is not currently mapped to the active pull request diff.`,
        );
      }
      return chunk.anchor;
    });

  const upsertGitHubDraft: ReviewWriteServiceShape["upsertGitHubDraft"] = (input) =>
    Effect.gen(function* () {
      const session = yield* getSession(input.sessionId);
      const pullRequest = pullRequestForReviewSession(session);
      if (!pullRequest) {
        return yield* blocked(
          "github-review-read-only",
          "This review session is not attached to a writable GitHub pull request.",
        );
      }

      const existingDraft =
        input.draftId === undefined
          ? null
          : yield* dependencies.drafts
              .getById({ draftId: input.draftId })
              .pipe(
                Effect.flatMap((option) =>
                  option._tag === "Some"
                    ? Effect.succeed(option.value)
                    : Effect.succeed<ReviewGitHubPendingDraftType | null>(null),
                ),
              );

      if (
        existingDraft !== null &&
        (existingDraft.sessionId !== session.sessionId ||
          existingDraft.authSessionId !== input.authSessionId)
      ) {
        return yield* rpcError(
          `Pending GitHub draft "${existingDraft.id}" is not available to this viewer.`,
        );
      }

      if (input.draftKind === "review-summary" && input.chunkId !== undefined) {
        return yield* rpcError("GitHub review summary drafts cannot target a diff chunk.");
      }

      if (input.draftKind === "inline-comment" && input.chunkId === undefined) {
        return yield* rpcError("GitHub inline review drafts require a target review chunk.");
      }

      const now = dependencies.now();
      const anchor =
        input.draftKind === "inline-comment"
          ? yield* resolveInlineDraftAnchor({
              session,
              chunkId: input.chunkId!,
            })
          : null;

      const nextDraft: ReviewGitHubPendingDraftType = {
        id:
          existingDraft?.id ??
          GitHubReviewDraftId.makeUnsafe(`github-review-draft-${dependencies.makeId()}`),
        sessionId: session.sessionId,
        authSessionId: input.authSessionId,
        draftKind: input.draftKind,
        anchor,
        body: input.body,
        isOutdated: false,
        submitAction: input.submitAction ?? existingDraft?.submitAction ?? null,
        createdAt: existingDraft?.createdAt ?? now,
        updatedAt: now,
      };

      yield* dependencies.drafts.upsert(nextDraft);
      return (yield* loadSnapshot({
        session,
        authSessionId: input.authSessionId,
      }))!;
    });

  const deleteGitHubDraft: ReviewWriteServiceShape["deleteGitHubDraft"] = (input) =>
    Effect.gen(function* () {
      const session = yield* getSession(input.sessionId);
      const draftOption = yield* dependencies.drafts.getById({ draftId: input.draftId });
      if (draftOption._tag === "None") {
        return (yield* loadSnapshot({
          session,
          authSessionId: input.authSessionId,
        }))!;
      }

      const draft = draftOption.value;
      if (draft.sessionId !== session.sessionId || draft.authSessionId !== input.authSessionId) {
        return yield* rpcError(
          `Pending GitHub draft "${input.draftId}" is not available to this viewer.`,
        );
      }

      yield* dependencies.drafts.deleteById({ draftId: input.draftId });
      return (yield* loadSnapshot({
        session,
        authSessionId: input.authSessionId,
      }))!;
    });

  const replyToGitHubThread: ReviewWriteServiceShape["replyToGitHubThread"] = (input) =>
    Effect.gen(function* () {
      const session = yield* getSession(input.sessionId);
      const pullRequest = pullRequestForReviewSession(session);
      if (!pullRequest) {
        return yield* blocked(
          "github-review-read-only",
          "This review session is not attached to a writable GitHub pull request.",
        );
      }

      yield* dependencies.gitHubCli
        .execute({
          cwd: session.checkoutPath,
          timeoutMs: GITHUB_GRAPHQL_TIMEOUT_MS,
          args: graphQlArgs(addPullRequestReviewThreadReplyMutation, {
            threadId: input.threadId,
            body: input.body,
          }),
        })
        .pipe(
          Effect.map((result) => result.stdout.trim()),
          Effect.flatMap((raw) =>
            graphQlPayload(raw, "ReviewWriteService.replyToGitHubThread").pipe(
              Effect.flatMap((payload) => {
                const commentId =
                  (
                    (
                      (payload.data as Record<string, unknown> | undefined)
                        ?.addPullRequestReviewThreadReply as Record<string, unknown> | undefined
                    )?.comment as Record<string, unknown> | undefined
                  )?.id ?? null;
                return typeof commentId === "string" && commentId.trim().length > 0
                  ? Effect.void
                  : Effect.fail(
                      new ReviewWriteServiceError({
                        operation: "ReviewWriteService.replyToGitHubThread",
                        message: "GitHub did not return the created thread reply.",
                        cause: payload,
                      }),
                    );
              }),
            ),
          ),
          Effect.mapError((error) =>
            error instanceof ReviewWriteServiceError
              ? error
              : new ReviewWriteServiceError({
                  operation: "ReviewWriteService.replyToGitHubThread",
                  message: normalizeGraphQlErrorMessage(error, "GitHub thread reply failed."),
                  cause: error,
                }),
          ),
        );

      return (yield* loadSnapshot({
        session,
        authSessionId: input.authSessionId,
      }))!;
    });

  const resolvePullRequestNodeId = (
    session: ReviewSessionRecord,
    pullRequest: ReviewProviderPullRequest,
  ) =>
    dependencies.gitHubCli
      .execute({
        cwd: session.checkoutPath,
        timeoutMs: GITHUB_GRAPHQL_TIMEOUT_MS,
        args: graphQlArgs(pullRequestNodeIdQuery, {
          url: pullRequest.url,
        }),
      })
      .pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) => graphQlPayload(raw, "ReviewWriteService.resolvePullRequestNodeId")),
        Effect.flatMap((payload) => {
          const resource = (payload.data as Record<string, unknown> | undefined)?.resource as
            | Record<string, unknown>
            | null
            | undefined;
          const id = typeof resource?.id === "string" ? resource.id.trim() : "";
          return id.length > 0
            ? Effect.succeed(id)
            : Effect.fail(
                new ReviewWriteServiceError({
                  operation: "ReviewWriteService.resolvePullRequestNodeId",
                  message: `GitHub did not return a pull request node id for ${pullRequest.url}.`,
                  cause: payload,
                }),
              );
        }),
      );

  const submitGitHubDraft: ReviewWriteServiceShape["submitGitHubDraft"] = (input) =>
    Effect.gen(function* () {
      const session = yield* getSession(input.sessionId);
      const pullRequest = pullRequestForReviewSession(session);
      if (!pullRequest) {
        return yield* blocked(
          "github-review-read-only",
          "This review session is not attached to a writable GitHub pull request.",
        );
      }

      const drafts = yield* dependencies.drafts.listForViewer({
        sessionId: session.sessionId,
        authSessionId: input.authSessionId,
      });
      if (drafts.length === 0 && (input.body?.trim() ?? "").length === 0) {
        return yield* blocked(
          "no-reviewable-content",
          "There are no pending GitHub review comments to submit.",
        );
      }

      const inlineDrafts = drafts.filter((draft) => draft.draftKind === "inline-comment");
      const summaryDraft = drafts.find((draft) => draft.draftKind === "review-summary") ?? null;
      const staleFlagDrafts = inlineDrafts.filter((draft) => draft.isOutdated);
      if (staleFlagDrafts.length > 0) {
        return yield* blocked(
          "session-target-stale",
          `One or more pending GitHub drafts are stale and must be refreshed or removed before submission: ${staleFlagDrafts
            .map((draft) => draft.id)
            .join(", ")}.`,
        );
      }

      const committedChunks = yield* loadCommittedChunks(session);
      const committedAnchorHashes = new Set(
        committedChunks.map((chunk) =>
          hashReviewAnchor({
            normalizedPath: chunk.anchor.normalizedPath,
            provenance: chunk.anchor.provenance,
            excerpt: chunk.anchor.excerpt,
            ...(chunk.anchor.excerptHash ? { excerptHash: chunk.anchor.excerptHash } : {}),
            ...(chunk.anchor.patchFingerprint
              ? { patchFingerprint: chunk.anchor.patchFingerprint }
              : {}),
          }),
        ),
      );

      const staleAnchorDrafts = inlineDrafts.filter((draft) => {
        if (draft.anchor === null) {
          return true;
        }
        const anchorHash = hashReviewAnchor({
          normalizedPath: draft.anchor.normalizedPath,
          provenance: draft.anchor.provenance,
          excerpt: draft.anchor.excerpt,
          ...(draft.anchor.excerptHash ? { excerptHash: draft.anchor.excerptHash } : {}),
          ...(draft.anchor.patchFingerprint
            ? { patchFingerprint: draft.anchor.patchFingerprint }
            : {}),
        });
        return !committedAnchorHashes.has(anchorHash);
      });
      if (staleAnchorDrafts.length > 0) {
        return yield* blocked(
          "session-target-stale",
          `One or more pending GitHub drafts no longer match the current pull request diff and must be refreshed or removed before submission: ${staleAnchorDrafts
            .map((draft) => draft.id)
            .join(", ")}.`,
        );
      }

      const threadInputs = inlineDrafts.map((draft) =>
        reviewThreadInputForAnchor(draft.anchor!, draft.body),
      );
      const invalidThreadDrafts = inlineDrafts.filter((_, index) => threadInputs[index] === null);
      if (invalidThreadDrafts.length > 0) {
        return yield* blocked(
          "github-review-read-only",
          `Only pull-request-mapped committed chunks can be submitted as GitHub inline comments: ${invalidThreadDrafts
            .map((draft) => draft.id)
            .join(", ")}.`,
        );
      }

      const pullRequestId = yield* resolvePullRequestNodeId(session, pullRequest);
      const finalBody = input.body ?? summaryDraft?.body;
      const threadPayloads = threadInputs.filter(
        (entry): entry is NonNullable<typeof entry> => entry !== null,
      );
      const graphqlArgs = [
        "api",
        "graphql",
        "-F",
        `pullRequestId=${pullRequestId}`,
        "-F",
        `event=${reviewEvent(input.decision)}`,
      ];
      if (finalBody) {
        graphqlArgs.push("-F", `body=${finalBody}`);
      }
      for (const [index, thread] of threadPayloads.entries()) {
        graphqlArgs.push("-F", `threads[${index}][path]=${thread.path}`);
        graphqlArgs.push("-F", `threads[${index}][body]=${thread.body}`);
        graphqlArgs.push("-F", `threads[${index}][line]=${thread.line}`);
        graphqlArgs.push("-F", `threads[${index}][side]=${thread.side}`);
        if (thread.startLine) {
          graphqlArgs.push("-F", `threads[${index}][startLine]=${thread.startLine}`);
        }
        if (thread.startSide) {
          graphqlArgs.push("-F", `threads[${index}][startSide]=${thread.startSide}`);
        }
      }
      graphqlArgs.push("-f", `query=${addPullRequestReviewMutation}`);

      yield* dependencies.gitHubCli
        .execute({
          cwd: session.checkoutPath,
          timeoutMs: GITHUB_GRAPHQL_TIMEOUT_MS,
          args: graphqlArgs,
        })
        .pipe(
          Effect.map((result) => result.stdout.trim()),
          Effect.flatMap((raw) => graphQlPayload(raw, "ReviewWriteService.submitGitHubDraft")),
          Effect.flatMap((payload) => {
            const reviewId =
              (
                (
                  (payload.data as Record<string, unknown> | undefined)?.addPullRequestReview as
                    | Record<string, unknown>
                    | undefined
                )?.pullRequestReview as Record<string, unknown> | undefined
              )?.id ?? null;
            return typeof reviewId === "string" && reviewId.trim().length > 0
              ? Effect.void
              : Effect.fail(
                  new ReviewWriteServiceError({
                    operation: "ReviewWriteService.submitGitHubDraft",
                    message: "GitHub did not return the created review id.",
                    cause: payload,
                  }),
                );
          }),
          Effect.mapError((error) =>
            error instanceof ReviewWriteServiceError
              ? error
              : new ReviewWriteServiceError({
                  operation: "ReviewWriteService.submitGitHubDraft",
                  message: normalizeGraphQlErrorMessage(error, "GitHub review submission failed."),
                  cause: error,
                }),
          ),
        );

      yield* dependencies.drafts.deleteForViewer({
        sessionId: session.sessionId,
        authSessionId: input.authSessionId,
      });

      return (yield* loadSnapshot({
        session,
        authSessionId: input.authSessionId,
      }))!;
    });

  const applyRawMutation: ReviewWriteServiceShape["applyRawMutation"] = (input) =>
    dependencies.mutations.applyRawMutation(input);

  return {
    getGitHubSnapshot,
    upsertGitHubDraft,
    deleteGitHubDraft,
    replyToGitHubThread,
    submitGitHubDraft,
    applyRawMutation,
  };
}
