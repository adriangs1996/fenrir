import { describe, expect, it } from "vitest";
import { Effect, Option, Stream } from "effect";

import { AuthSessionId, ProjectId, ThreadId, TrimmedNonEmptyString } from "@fenrir/contracts";

import type { ReviewSessionRecord } from "../../../persistence/Services/ReviewSessions.ts";
import type { ReviewGitHubPendingDraftRepositoryShape } from "../../../persistence/Services/ReviewGitHubDrafts.ts";
import type { ReviewSessionRepositoryShape } from "../../../persistence/Services/ReviewSessions.ts";
import type { ReviewDiffServiceShape } from "../Services/ReviewDiffService.ts";
import type { ReviewProviderReadResult } from "../Services/ReviewProvider.ts";
import { makeReviewWriteService } from "../Services/ReviewWriteService.ts";
import type { GitHubCliShape } from "../../../git/Services/GitHubCli.ts";
import {
  GitHubReviewDraftId,
  ReviewChunkId,
  ReviewSessionId,
  type ReviewGitHubPendingDraft,
  type ReviewStableAnchor,
} from "@fenrir/contracts/sourceControlReview";

const tn = TrimmedNonEmptyString.make;
const asAuthSessionId = (value: string) => AuthSessionId.make(value);
const asReviewSessionId = (value: string) => ReviewSessionId.make(value);
const asChunkId = (value: string) => ReviewChunkId.make(value);

function makeSession(): ReviewSessionRecord {
  return {
    sessionId: asReviewSessionId("review-session-1"),
    threadId: ThreadId.make("thread-1"),
    projectId: ProjectId.make("project-1"),
    checkoutPath: tn("/repo/worktree"),
    mode: "review",
    scope: "combined",
    target: {
      projectId: ProjectId.make("project-1"),
      threadId: ThreadId.make("thread-1"),
      cwd: "/repo/worktree",
      repositoryRoot: "/repo",
      repositoryName: "Fenrir",
      worktreePath: "/repo/worktree",
      selectionLabel: "PR #42",
      baseRef: tn("main"),
      headRef: tn("feature/rich-review-tab"),
      baseCommitOid: tn("abc123"),
      headCommitOid: tn("def456"),
      pullRequestNumber: 42,
      pullRequestUrl: "https://github.com/fenrir/fenrir/pull/42",
    },
    pullRequestOverrideProvider: null,
    pullRequestOverrideNumber: null,
    pullRequestOverrideUrl: null,
    pullRequestProvider: "github",
    pullRequestNumber: 42,
    pullRequestUrl: "https://github.com/fenrir/fenrir/pull/42",
    baseBranchOverride: tn("main"),
    createdAt: "2026-05-21T10:00:00.000Z",
    updatedAt: "2026-05-21T10:00:00.000Z",
    lastActivatedAt: "2026-05-21T10:00:00.000Z",
    archivedAt: null,
  };
}

function makeAnchor(
  path = "apps/server/src/review/write.ts",
  start = 10,
  end = 14,
): ReviewStableAnchor {
  return {
    normalizedPath: path,
    provenance: {
      scope: "branch",
      lane: "committed",
    },
    newRange: {
      startLine: start,
      endLine: end,
    },
    excerpt: "review write workflow anchor",
    excerptHash: "sha256:excerpt",
    patchFingerprint: "sha256:patch",
  };
}

const committedProvenance = {
  scope: "branch",
  lane: "committed",
} as const;

function makeRemoteReadResult(): ReviewProviderReadResult {
  return {
    status: "available",
    provider: "github",
    snapshot: {
      provider: "github",
      pullRequest: {
        number: 42,
        url: "https://github.com/fenrir/fenrir/pull/42",
        title: "Review write workflow",
        state: "open",
        isDraft: false,
        body: "",
        baseRef: "main",
        headRef: "feature/rich-review-tab",
        createdAt: "2026-05-21T10:00:00.000Z",
        updatedAt: "2026-05-21T10:00:00.000Z",
      },
      reviewThreads: [],
      generalComments: [],
    },
  };
}

function buildService(options?: {
  readonly committedChunks?: ReadonlyArray<{
    readonly chunkId: ReviewChunkId;
    readonly anchor: ReviewStableAnchor;
  }>;
  readonly remote?: ReviewProviderReadResult;
  readonly onExecute?: (args: ReadonlyArray<string>) => void;
}) {
  const session = makeSession();
  const authSessionId = asAuthSessionId("auth-session-1");
  const drafts = new Map<string, ReviewGitHubPendingDraft>();
  const committedChunks = options?.committedChunks ?? [
    {
      chunkId: asChunkId("review-chunk-1"),
      anchor: makeAnchor(),
    },
  ];

  const sessionsRepo: ReviewSessionRepositoryShape = {
    upsert: () => Effect.void,
    getById: ({ sessionId }) =>
      Effect.succeed(sessionId === session.sessionId ? Option.some(session) : Option.none()),
    findActiveByThread: () => Effect.succeed(Option.none()),
    listByThreadId: () => Effect.succeed([]),
    archive: () => Effect.void,
  };

  const draftsRepo: ReviewGitHubPendingDraftRepositoryShape = {
    upsert: (draft) =>
      Effect.sync(() => {
        drafts.set(draft.id, draft);
      }),
    getById: ({ draftId }) =>
      Effect.succeed(drafts.has(draftId) ? Option.some(drafts.get(draftId)!) : Option.none()),
    listForViewer: ({ sessionId, authSessionId }) =>
      Effect.succeed(
        [...drafts.values()].filter(
          (draft) => draft.sessionId === sessionId && draft.authSessionId === authSessionId,
        ),
      ),
    deleteById: ({ draftId }) =>
      Effect.sync(() => {
        drafts.delete(draftId);
      }),
    deleteForViewer: ({ sessionId, authSessionId }) =>
      Effect.sync(() => {
        for (const [draftId, draft] of drafts.entries()) {
          if (draft.sessionId === sessionId && draft.authSessionId === authSessionId) {
            drafts.delete(draftId);
          }
        }
      }),
    deleteForSession: () => Effect.void,
    markSessionDraftsOutdated: () => Effect.void,
  };

  const diff: ReviewDiffServiceShape = {
    loadSnapshot: () =>
      Effect.succeed({
        sessionId: session.sessionId,
        scope: "branch",
        target: session.target,
        generatedAt: "2026-05-21T10:00:00.000Z",
        lanes: [
          {
            sessionId: session.sessionId,
            groupId: "review-group-committed" as never,
            kind: "committed",
            title: "Committed on branch",
            fileCount: 1,
            files: [
              {
                sessionId: session.sessionId,
                groupId: "review-group-committed" as never,
                fileId: "review-file-1" as never,
                lane: "committed",
                provenance: committedProvenance,
                normalizedPath:
                  committedChunks[0]?.anchor.normalizedPath ?? "apps/server/src/review/write.ts",
                displayPath:
                  committedChunks[0]?.anchor.normalizedPath ?? "apps/server/src/review/write.ts",
                changeKind: "text",
                insertions: 4,
                deletions: 0,
                chunkCount: committedChunks.length,
              },
            ],
          },
        ],
      }),
    loadFilePatch: ({ normalizedPath }) =>
      Effect.succeed({
        sessionId: session.sessionId,
        groupId: "review-group-committed" as never,
        fileId: "review-file-1" as never,
        scope: "branch",
        lane: "committed",
        provenance: committedProvenance,
        normalizedPath,
        displayPath: normalizedPath,
        changeKind: "text",
        insertions: 4,
        deletions: 0,
        chunks: committedChunks
          .filter((chunk) => chunk.anchor.normalizedPath === normalizedPath)
          .map((chunk) => ({
            chunkId: chunk.chunkId,
            anchor: chunk.anchor,
            header: "@@ -10,0 +10,4 @@",
            lines: [],
          })),
      }),
    loadFilePatchArtifact: ({ normalizedPath }) =>
      Effect.succeed({
        patch: {
          sessionId: session.sessionId,
          groupId: "review-group-committed" as never,
          fileId: "review-file-1" as never,
          scope: "branch",
          lane: "committed",
          provenance: committedProvenance,
          normalizedPath,
          displayPath: normalizedPath,
          changeKind: "text",
          insertions: 4,
          deletions: 0,
          chunks: committedChunks
            .filter((chunk) => chunk.anchor.normalizedPath === normalizedPath)
            .map((chunk) => ({
              chunkId: chunk.chunkId,
              anchor: chunk.anchor,
              header: "@@ -10,0 +10,4 @@",
              lines: [],
            })),
        },
        rawPatch: "@@ -10,0 +10,4 @@\n+review write workflow anchor",
        chunkArtifacts: committedChunks
          .filter((chunk) => chunk.anchor.normalizedPath === normalizedPath)
          .map((chunk) => ({
            chunkId: chunk.chunkId,
            anchor: chunk.anchor,
            rawPatch: "@@ -10,0 +10,4 @@\n+review write workflow anchor",
          })),
      }),
    streamSnapshots: () => Stream.empty,
  };

  const gitHubCli: GitHubCliShape = {
    execute: ({ args }) =>
      Effect.sync(() => {
        options?.onExecute?.(args);
        const queryArg = args.find((arg) => arg.startsWith("query=")) ?? "";
        if (queryArg.includes("FenrirPullRequestNodeId")) {
          return {
            stdout: JSON.stringify({
              data: {
                resource: {
                  __typename: "PullRequest",
                  id: "PR_node_1",
                  number: 42,
                  url: "https://github.com/fenrir/fenrir/pull/42",
                },
              },
            }),
            stderr: "",
            code: 0,
            signal: null,
            timedOut: false,
          };
        }
        if (queryArg.includes("FenrirAddPullRequestReviewThreadReply")) {
          return {
            stdout: JSON.stringify({
              data: {
                addPullRequestReviewThreadReply: {
                  comment: {
                    id: "PRRC_reply_1",
                  },
                },
              },
            }),
            stderr: "",
            code: 0,
            signal: null,
            timedOut: false,
          };
        }
        if (queryArg.includes("FenrirAddPullRequestReview")) {
          return {
            stdout: JSON.stringify({
              data: {
                addPullRequestReview: {
                  pullRequestReview: {
                    id: "PRR_1",
                  },
                },
              },
            }),
            stderr: "",
            code: 0,
            signal: null,
            timedOut: false,
          };
        }
        throw new Error(`Unexpected GitHub CLI query: ${queryArg}`);
      }),
    listOpenPullRequests: () => Effect.succeed([]),
    getPullRequest: () => Effect.die(new Error("not used")),
    getRepositoryCloneUrls: () => Effect.die(new Error("not used")),
    createPullRequest: () => Effect.die(new Error("not used")),
    getDefaultBranch: () => Effect.succeed(null),
    checkoutPullRequest: () => Effect.die(new Error("not used")),
  };

  const service = makeReviewWriteService({
    sessions: sessionsRepo,
    drafts: draftsRepo,
    diff,
    mutations: {
      applyRawMutation: () => Effect.die(new Error("not used")),
    },
    provider: {
      readReview: () => Effect.succeed(options?.remote ?? makeRemoteReadResult()),
    },
    gitHubCli,
    now: () => "2026-05-21T10:00:00.000Z",
    makeId: () => "generated-id",
  });

  return {
    service,
    drafts,
    session,
    authSessionId,
  };
}

describe("ReviewWriteService", () => {
  it("keeps brand-new inline GitHub comments local until final submit", async () => {
    const { service, drafts, session, authSessionId } = buildService();

    const snapshot = await Effect.runPromise(
      service.upsertGitHubDraft({
        sessionId: session.sessionId,
        authSessionId,
        draftKind: "inline-comment",
        chunkId: asChunkId("review-chunk-1"),
        body: tn("Please split the transport and stale validation concerns."),
      }),
    );

    expect(drafts.size).toBe(1);
    expect(snapshot.draft?.threads).toHaveLength(1);
    expect(snapshot.draft?.threads[0]?.comments[0]?.isPending).toBe(true);
    expect(snapshot.draft?.threads[0]?.anchor.normalizedPath).toBe(
      "apps/server/src/review/write.ts",
    );
  });

  it("posts replies to existing GitHub threads immediately", async () => {
    const capturedArgs: ReadonlyArray<string>[] = [];
    const { service, drafts, session, authSessionId } = buildService({
      onExecute: (args) => {
        capturedArgs.push(args);
      },
    });

    const snapshot = await Effect.runPromise(
      service.replyToGitHubThread({
        sessionId: session.sessionId,
        authSessionId,
        threadId: "PRRT_123" as never,
        body: tn("Replying immediately without creating a local pending draft."),
      }),
    );

    expect(drafts.size).toBe(0);
    expect(snapshot.writable).toBe(true);
    expect(
      capturedArgs.some((args) =>
        args.some((arg) => arg.includes("FenrirAddPullRequestReviewThreadReply")),
      ),
    ).toBe(true);
  });

  it("blocks submission when any pending inline draft anchor is stale", async () => {
    const staleDraftAnchor = makeAnchor("apps/server/src/review/old.ts", 50, 52);
    const { service, drafts, session, authSessionId } = buildService();
    drafts.set("github-review-draft-stale", {
      id: GitHubReviewDraftId.make("github-review-draft-stale"),
      sessionId: session.sessionId,
      authSessionId,
      draftKind: "inline-comment",
      anchor: staleDraftAnchor,
      body: tn("This anchor is stale."),
      isOutdated: false,
      submitAction: null,
      createdAt: "2026-05-21T10:00:00.000Z",
      updatedAt: "2026-05-21T10:00:00.000Z",
    });

    await expect(
      Effect.runPromise(
        service.submitGitHubDraft({
          sessionId: session.sessionId,
          authSessionId,
          decision: "comment",
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "ReviewActionBlockedError",
      reason: "session-target-stale",
    });
  });

  it("submits accumulated inline drafts and a summary as one GitHub review", async () => {
    const capturedArgs: ReadonlyArray<string>[] = [];
    const { service, drafts, session, authSessionId } = buildService({
      onExecute: (args) => {
        capturedArgs.push(args);
      },
    });

    drafts.set("github-review-draft-inline", {
      id: GitHubReviewDraftId.make("github-review-draft-inline"),
      sessionId: session.sessionId,
      authSessionId,
      draftKind: "inline-comment",
      anchor: makeAnchor(),
      body: tn("Ship this after tightening the stale guard."),
      isOutdated: false,
      submitAction: null,
      createdAt: "2026-05-21T10:00:00.000Z",
      updatedAt: "2026-05-21T10:00:00.000Z",
    });
    drafts.set("github-review-draft-summary", {
      id: GitHubReviewDraftId.make("github-review-draft-summary"),
      sessionId: session.sessionId,
      authSessionId,
      draftKind: "review-summary",
      anchor: null,
      body: tn("Overall this looks correct after the stale-draft validation lands."),
      isOutdated: false,
      submitAction: "approve",
      createdAt: "2026-05-21T10:00:00.000Z",
      updatedAt: "2026-05-21T10:00:00.000Z",
    });

    const snapshot = await Effect.runPromise(
      service.submitGitHubDraft({
        sessionId: session.sessionId,
        authSessionId,
        decision: "approve",
      }),
    );

    expect(drafts.size).toBe(0);
    expect(snapshot.draft).toBeNull();
    const submitArgs = capturedArgs.find((args) =>
      args.some((arg) => arg.includes("FenrirAddPullRequestReview")),
    );
    expect(submitArgs).toBeDefined();
    expect(submitArgs).toContain("event=APPROVE");
    expect(submitArgs).toContain("threads[0][path]=apps/server/src/review/write.ts");
  });
});
