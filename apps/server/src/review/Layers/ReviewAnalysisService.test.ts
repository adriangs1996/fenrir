import { describe, expect, it } from "vitest";
import { Effect, Option, Stream } from "effect";
import type { OrchestrationThread, ProjectId, ThreadId } from "@fenrir/contracts";
import {
  ReviewChunkId,
  ReviewFileId,
  ReviewGroupId,
  ReviewSessionId,
} from "../../../../../packages/contracts/src/review.ts";

import type { ReviewAnalysisRecord } from "../../persistence/Services/ReviewAnalysis.ts";
import type { ReviewSessionRecord } from "../../persistence/Services/ReviewSessions.ts";
import type { ProjectionSnapshotQueryShape } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { ReviewDiffServiceShape } from "../Services/ReviewDiffService.ts";
import type { ReviewProviderShape, ReviewProviderSnapshot } from "../Services/ReviewProvider.ts";
import {
  makeReviewAnalysisService,
  type ReviewAnalysisDependencies,
} from "../Services/ReviewAnalysisService.ts";

const asProjectId = (value: string) => value as ProjectId;
const asThreadId = (value: string) => value as ThreadId;
const asReviewSessionId = (value: string) => ReviewSessionId.makeUnsafe(value);
const asReviewGroupId = (value: string) => ReviewGroupId.makeUnsafe(value);
const asReviewFileId = (value: string) => ReviewFileId.makeUnsafe(value);
const asReviewChunkId = (value: string) => ReviewChunkId.makeUnsafe(value);
const committedProvenance = {
  scope: "branch",
  lane: "committed",
} as const;

function makeThread(): OrchestrationThread {
  return {
    id: asThreadId("thread-review"),
    projectId: asProjectId("project-review"),
    title: "Review Thread",
    modelSelection: {
      provider: "codex",
      model: "gpt-5-codex",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "feature/rich-review-tab",
    worktreePath: "/repo/worktree",
    latestTurn: null,
    createdAt: "2026-05-21T09:00:00.000Z",
    updatedAt: "2026-05-21T09:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
  };
}

function makeSession(): ReviewSessionRecord {
  return {
    sessionId: asReviewSessionId("review-session-1"),
    threadId: asThreadId("thread-review"),
    projectId: asProjectId("project-review"),
    checkoutPath: "/repo/worktree",
    mode: "review",
    scope: "combined",
    target: {
      projectId: asProjectId("project-review"),
      threadId: asThreadId("thread-review"),
      cwd: "/repo/worktree",
      repositoryRoot: "/repo",
      repositoryName: "Fenrir",
      worktreePath: "/repo/worktree",
      selectionLabel: "PR #42",
      baseRef: "main",
      headRef: "feature/rich-review-tab",
      baseCommitOid: "abc123",
      headCommitOid: "def456",
      pullRequestNumber: 42,
      pullRequestUrl: "https://github.com/fenrir/fenrir/pull/42",
    },
    pullRequestOverrideProvider: null,
    pullRequestOverrideNumber: null,
    pullRequestOverrideUrl: null,
    pullRequestProvider: "github",
    pullRequestNumber: 42,
    pullRequestUrl: "https://github.com/fenrir/fenrir/pull/42",
    baseBranchOverride: "main",
    createdAt: "2026-05-21T09:00:00.000Z",
    updatedAt: "2026-05-21T09:00:00.000Z",
    lastActivatedAt: "2026-05-21T09:00:00.000Z",
    archivedAt: null,
  };
}

function makeRemoteSnapshot(body: string): ReviewProviderSnapshot {
  return {
    provider: "github",
    pullRequest: {
      number: 42,
      url: "https://github.com/fenrir/fenrir/pull/42",
      title: "Rich review tab",
      state: "open",
      isDraft: false,
      body,
      baseRef: "main",
      headRef: "feature/rich-review-tab",
      authorLogin: "adrian",
      createdAt: "2026-05-21T08:00:00.000Z",
      updatedAt: "2026-05-21T09:00:00.000Z",
    },
    reviewThreads: [
      {
        id: "thread-1",
        path: "apps/server/src/review/Services/ReviewRpcService.ts",
        anchor: {
          normalizedPath: "apps/server/src/review/Services/ReviewRpcService.ts",
          provenance: {
            scope: "branch",
            lane: "committed",
          },
          newRange: {
            startLine: 10,
            endLine: 14,
          },
          excerpt: "return buildSnapshot(sessionId, authSessionId);",
        },
        isResolved: false,
        isOutdated: false,
        isCollapsed: false,
        comments: [
          {
            id: "comment-1",
            body: "Please verify stale analysis after refresh.",
            path: "apps/server/src/review/Services/ReviewRpcService.ts",
            anchor: {
              normalizedPath: "apps/server/src/review/Services/ReviewRpcService.ts",
              provenance: {
                scope: "branch",
                lane: "committed",
              },
              newRange: {
                startLine: 10,
                endLine: 14,
              },
              excerpt: "return buildSnapshot(sessionId, authSessionId);",
            },
            authorLogin: "reviewer",
            createdAt: "2026-05-21T08:30:00.000Z",
            updatedAt: "2026-05-21T08:30:00.000Z",
          },
        ],
      },
    ],
    generalComments: [
      {
        id: "general-1",
        body: "Focus on backend invalidation rules.",
        authorLogin: "reviewer",
        createdAt: "2026-05-21T08:35:00.000Z",
        updatedAt: "2026-05-21T08:35:00.000Z",
      },
    ],
  };
}

function makeDependencies(state: {
  diffSnapshot: ReturnType<ReviewDiffServiceShape["loadSnapshot"]> extends Effect.Effect<
    infer A,
    any
  >
    ? A
    : never;
  filePatch: NonNullable<
    ReturnType<ReviewDiffServiceShape["loadFilePatch"]> extends Effect.Effect<infer A, any>
      ? A
      : never
  >;
  remoteSnapshot: ReviewProviderSnapshot;
}): ReviewAnalysisDependencies {
  const projection: ProjectionSnapshotQueryShape = {
    getBootstrapSnapshot: () => Effect.die("unused"),
    getSnapshot: () => Effect.die("unused"),
    getCounts: () => Effect.die("unused"),
    getActiveProjectByWorkspaceRoot: () => Effect.die("unused"),
    getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
    getThreadSnapshot: () => Effect.succeed(Option.some(makeThread())),
    getThreadCheckpointContext: () => Effect.die("unused"),
  };

  const diff: ReviewDiffServiceShape = {
    loadSnapshot: () => Effect.succeed(state.diffSnapshot),
    loadFilePatch: () => Effect.succeed(state.filePatch),
    loadFilePatchArtifact: () => Effect.die("unused"),
    streamSnapshots: () => Stream.die("unused"),
  };

  const provider: ReviewProviderShape = {
    provider: "github",
    resolvePullRequestReference: () => Effect.die("unused"),
    readReview: () =>
      Effect.succeed({
        status: "available",
        provider: "github",
        snapshot: state.remoteSnapshot,
      }),
  };

  return {
    projection,
    diff,
    provider,
    now: () => "2026-05-21T10:00:00.000Z",
  };
}

describe("ReviewAnalysisService", () => {
  it("builds a structured artifact from diff and remote review context", async () => {
    const diffSnapshot = {
      sessionId: asReviewSessionId("review-session-1"),
      scope: "combined",
      target: makeSession().target,
      generatedAt: "2026-05-21T09:30:00.000Z",
      lanes: [
        {
          sessionId: asReviewSessionId("review-session-1"),
          groupId: asReviewGroupId("review-group-1"),
          kind: "committed",
          title: "Committed on branch",
          fileCount: 1,
          files: [
            {
              sessionId: asReviewSessionId("review-session-1"),
              groupId: asReviewGroupId("review-group-1"),
              fileId: asReviewFileId("review-file-1"),
              lane: "committed",
              provenance: committedProvenance,
              normalizedPath: "apps/server/src/review/Services/ReviewRpcService.ts",
              displayPath: "apps/server/src/review/Services/ReviewRpcService.ts",
              changeKind: "text",
              insertions: 42,
              deletions: 8,
              chunkCount: 1,
            },
          ],
        },
      ],
    } as const;

    const filePatch = {
      sessionId: asReviewSessionId("review-session-1"),
      groupId: asReviewGroupId("review-group-1"),
      fileId: asReviewFileId("review-file-1"),
      scope: "combined",
      lane: "committed",
      provenance: committedProvenance,
      normalizedPath: "apps/server/src/review/Services/ReviewRpcService.ts",
      displayPath: "apps/server/src/review/Services/ReviewRpcService.ts",
      changeKind: "text",
      insertions: 42,
      deletions: 8,
      chunks: [
        {
          chunkId: asReviewChunkId("review-chunk-1"),
          anchor: {
            normalizedPath: "apps/server/src/review/Services/ReviewRpcService.ts",
            provenance: {
              scope: "branch",
              lane: "committed",
            },
            newRange: {
              startLine: 10,
              endLine: 14,
            },
            excerpt: "return buildSnapshot(sessionId, authSessionId);",
          },
          header: "@@ -10,4 +10,8 @@",
          lines: [],
        },
      ],
    } as const;

    const service = makeReviewAnalysisService(
      makeDependencies({
        diffSnapshot,
        filePatch,
        remoteSnapshot: makeRemoteSnapshot("Review analysis backend."),
      }),
    );

    const record = await Effect.runPromise(
      service.generate({
        session: makeSession(),
        instruction: "Focus on stale invalidation.",
      }),
    );

    expect(record.artifact.provider).toBe("fenrir-local");
    expect(record.artifact.semanticGroups?.length).toBe(1);
    expect(record.artifact.checklist?.[0]?.title).toContain("Review");
    expect(record.artifact.metadata?.modelSelection?.model).toBe("gpt-5-codex");
    expect(record.artifact.metadata?.instruction).toBe("Focus on stale invalidation.");
    expect(record.artifact.riskFlags?.[0]?.label).toContain("review discussion");
  });

  it("marks the artifact stale when diff or remote review context changes", async () => {
    const session = makeSession();
    const baseDiffSnapshot = {
      sessionId: asReviewSessionId("review-session-1"),
      scope: "combined",
      target: session.target,
      generatedAt: "2026-05-21T09:30:00.000Z",
      lanes: [
        {
          sessionId: asReviewSessionId("review-session-1"),
          groupId: asReviewGroupId("review-group-1"),
          kind: "committed",
          title: "Committed on branch",
          fileCount: 1,
          files: [
            {
              sessionId: asReviewSessionId("review-session-1"),
              groupId: asReviewGroupId("review-group-1"),
              fileId: asReviewFileId("review-file-1"),
              lane: "committed",
              provenance: committedProvenance,
              normalizedPath: "apps/server/src/review/Services/ReviewRpcService.ts",
              displayPath: "apps/server/src/review/Services/ReviewRpcService.ts",
              changeKind: "text",
              insertions: 42,
              deletions: 8,
              chunkCount: 1,
            },
          ],
        },
      ],
    } as const;

    const originalPatch = {
      sessionId: asReviewSessionId("review-session-1"),
      groupId: asReviewGroupId("review-group-1"),
      fileId: asReviewFileId("review-file-1"),
      scope: "combined",
      lane: "committed",
      provenance: committedProvenance,
      normalizedPath: "apps/server/src/review/Services/ReviewRpcService.ts",
      displayPath: "apps/server/src/review/Services/ReviewRpcService.ts",
      changeKind: "text",
      insertions: 42,
      deletions: 8,
      chunks: [
        {
          chunkId: asReviewChunkId("review-chunk-1"),
          anchor: {
            normalizedPath: "apps/server/src/review/Services/ReviewRpcService.ts",
            provenance: {
              scope: "branch",
              lane: "committed",
            },
            newRange: {
              startLine: 10,
              endLine: 14,
            },
            excerpt: "return buildSnapshot(sessionId, authSessionId);",
          },
          header: "@@ -10,4 +10,8 @@",
          lines: [],
        },
      ],
    } as const;

    const service = makeReviewAnalysisService(
      makeDependencies({
        diffSnapshot: baseDiffSnapshot,
        filePatch: originalPatch,
        remoteSnapshot: makeRemoteSnapshot("Review analysis backend."),
      }),
    );

    const generated = (await Effect.runPromise(
      service.generate({
        session,
      }),
    )) as ReviewAnalysisRecord;

    const staleService = makeReviewAnalysisService(
      makeDependencies({
        diffSnapshot: {
          ...baseDiffSnapshot,
          lanes: [
            {
              ...baseDiffSnapshot.lanes[0],
              files: [
                {
                  ...baseDiffSnapshot.lanes[0].files[0],
                  insertions: 60,
                },
              ],
            },
          ],
        },
        filePatch: {
          ...originalPatch,
          insertions: 60,
        },
        remoteSnapshot: makeRemoteSnapshot("Review analysis backend with updated discussion."),
      }),
    );

    const refreshed = await Effect.runPromise(
      staleService.refreshStaleness({
        session,
        record: generated,
      }),
    );

    expect(refreshed.artifact.staleStatus).toBe("stale-content");
    expect(refreshed.artifact.staleMetadata?.invalidatedBy).toContain("code-diff-changed");
    expect(refreshed.artifact.staleMetadata?.invalidatedBy).toContain(
      "remote-review-context-changed",
    );
  });
});
