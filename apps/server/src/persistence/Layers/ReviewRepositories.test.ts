import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  AuthSessionId,
  IsoDateTime,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@fenrir/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ReviewAnalysisRepository } from "../Services/ReviewAnalysis.ts";
import { ReviewAnnotationRepository } from "../Services/ReviewAnnotations.ts";
import { ReviewGitHubPendingDraftRepository } from "../Services/ReviewGitHubDrafts.ts";
import { ReviewIgnoreRuleRepository } from "../Services/ReviewIgnoreRules.ts";
import { ReviewProgressRepository } from "../Services/ReviewProgress.ts";
import { ReviewSessionRepository, type ReviewSessionRecord } from "../Services/ReviewSessions.ts";
import {
  GitHubReviewDraftId,
  ReviewAnalysisArtifactId,
  ReviewChunkId,
  ReviewFileId,
  ReviewGitHubPendingDraft,
  ReviewGroupId,
  ReviewIgnoreRule,
  ReviewLocalAnnotationThreadId,
  ReviewSessionId,
} from "@fenrir/contracts/sourceControlReview";
import { ReviewAnalysisRepositoryLive } from "./ReviewAnalysis.ts";
import { ReviewAnnotationRepositoryLive } from "./ReviewAnnotations.ts";
import { ReviewGitHubPendingDraftRepositoryLive } from "./ReviewGitHubDrafts.ts";
import { ReviewIgnoreRuleRepositoryLive } from "./ReviewIgnoreRules.ts";
import { ReviewProgressRepositoryLive } from "./ReviewProgress.ts";
import { ReviewSessionRepositoryLive } from "./ReviewSessions.ts";
import { makeSqlitePersistenceLive, SqlitePersistenceMemory } from "./Sqlite.ts";

const ts = IsoDateTime.make;
const tn = TrimmedNonEmptyString.make;

const reviewRepositoriesLayer = it.layer(
  Layer.mergeAll(
    ReviewSessionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ReviewAnnotationRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ReviewProgressRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ReviewAnalysisRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ReviewGitHubPendingDraftRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ReviewIgnoreRuleRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

function makeSessionRecord(
  overrides: Omit<Partial<ReviewSessionRecord>, "sessionId" | "threadId"> & {
    readonly sessionId: string;
    readonly threadId: string;
  },
): ReviewSessionRecord {
  return {
    sessionId: ReviewSessionId.make(overrides.sessionId),
    threadId: ThreadId.make(overrides.threadId),
    projectId: overrides.projectId ?? ProjectId.make("project-review"),
    checkoutPath: overrides.checkoutPath ?? tn("/repo/worktree"),
    mode: overrides.mode ?? "review",
    scope: overrides.scope ?? "combined",
    target: overrides.target ?? {
      projectId: ProjectId.make("project-review"),
      threadId: ThreadId.make(overrides.threadId),
      cwd: "/repo/worktree",
      repositoryRoot: "/repo",
      repositoryName: "Fenrir",
      worktreePath: "/repo/worktree",
      selectionLabel: "PR #42",
      baseRef: tn("main"),
      headRef: tn("feature/rich-review-tab"),
      pullRequestNumber: 42,
      pullRequestUrl: "https://github.com/fenrir/fenrir/pull/42",
    },
    pullRequestOverrideProvider: overrides.pullRequestOverrideProvider ?? null,
    pullRequestOverrideNumber: overrides.pullRequestOverrideNumber ?? null,
    pullRequestOverrideUrl: overrides.pullRequestOverrideUrl ?? null,
    pullRequestProvider: overrides.pullRequestProvider ?? "github",
    pullRequestNumber: overrides.pullRequestNumber ?? 42,
    pullRequestUrl: overrides.pullRequestUrl ?? "https://github.com/fenrir/fenrir/pull/42",
    baseBranchOverride: overrides.baseBranchOverride ?? tn("main"),
    createdAt: overrides.createdAt ?? ts("2026-05-20T10:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? ts("2026-05-20T10:00:00.000Z"),
    lastActivatedAt: overrides.lastActivatedAt ?? ts("2026-05-20T10:00:00.000Z"),
    archivedAt: overrides.archivedAt ?? null,
  };
}

function makePendingDraft(
  overrides: Omit<Partial<ReviewGitHubPendingDraft>, "id" | "sessionId" | "authSessionId"> & {
    readonly id: string;
    readonly sessionId: string;
    readonly authSessionId: string;
  },
): ReviewGitHubPendingDraft {
  return {
    id: GitHubReviewDraftId.make(overrides.id),
    sessionId: ReviewSessionId.make(overrides.sessionId),
    authSessionId: AuthSessionId.make(overrides.authSessionId),
    draftKind: overrides.draftKind ?? "inline-comment",
    anchor: overrides.anchor ?? {
      normalizedPath: "apps/server/src/review.ts",
      provenance: {
        scope: "branch",
        lane: "committed",
      },
      newRange: {
        startLine: 10,
        endLine: 14,
      },
      excerpt: "review summary diff hunk",
    },
    body: overrides.body ?? tn("Please clarify the stale marker behavior."),
    isOutdated: overrides.isOutdated ?? false,
    submitAction: overrides.submitAction ?? null,
    createdAt: overrides.createdAt ?? ts("2026-05-20T10:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? ts("2026-05-20T10:00:00.000Z"),
  };
}

function makeIgnoreRule(input: {
  readonly checkoutPath: string;
  readonly ruleKind: ReviewIgnoreRule["ruleKind"];
  readonly normalizedPath: string;
  readonly matchPath: string;
}): ReviewIgnoreRule {
  return {
    checkoutPath: tn(input.checkoutPath),
    ruleKind: input.ruleKind,
    normalizedPath: tn(input.normalizedPath),
    matchPath: tn(input.matchPath),
    createdAt: ts("2026-05-20T10:00:00.000Z"),
    updatedAt: ts("2026-05-20T10:00:00.000Z"),
  };
}

reviewRepositoriesLayer("Review repositories — session lifecycle", (it) => {
  it.effect("creates, updates, lists, and archives review sessions", () =>
    Effect.gen(function* () {
      const sessions = yield* ReviewSessionRepository;

      const first = makeSessionRecord({
        sessionId: "review-session-1",
        threadId: "thread-1",
      });
      const second = makeSessionRecord({
        sessionId: "review-session-2",
        threadId: "thread-1",
        checkoutPath: tn("/repo/worktree-2"),
        target: {
          ...first.target,
          worktreePath: "/repo/worktree-2",
          cwd: "/repo/worktree-2",
        },
        updatedAt: ts("2026-05-20T10:10:00.000Z"),
        lastActivatedAt: ts("2026-05-20T10:10:00.000Z"),
      });

      yield* sessions.upsert(first);
      yield* sessions.upsert(second);
      yield* sessions.upsert({
        ...first,
        pullRequestOverrideProvider: "github",
        pullRequestOverrideNumber: 99,
        pullRequestOverrideUrl: "https://github.com/fenrir/fenrir/pull/99",
        baseBranchOverride: tn("release/1.2"),
        updatedAt: ts("2026-05-20T10:15:00.000Z"),
        lastActivatedAt: ts("2026-05-20T10:15:00.000Z"),
      });

      const active = yield* sessions.findActiveByThread({
        threadId: ThreadId.make("thread-1"),
        checkoutPath: tn("/repo/worktree"),
      });
      assert.equal(active._tag, "Some");
      if (Option.isSome(active)) {
        assert.equal(active.value.baseBranchOverride, "release/1.2");
        assert.equal(active.value.pullRequestOverrideNumber, 99);
      }

      const listed = yield* sessions.listByThreadId({
        threadId: ThreadId.make("thread-1"),
        includeArchived: true,
      });
      assert.deepStrictEqual(
        listed.map((session) => session.sessionId),
        ["review-session-1", "review-session-2"],
      );

      yield* sessions.archive({
        sessionId: ReviewSessionId.make("review-session-1"),
        archivedAt: ts("2026-05-20T10:20:00.000Z"),
        updatedAt: ts("2026-05-20T10:20:00.000Z"),
      });

      const noLongerActive = yield* sessions.findActiveByThread({
        threadId: ThreadId.make("thread-1"),
        checkoutPath: tn("/repo/worktree"),
      });
      assert.equal(noLongerActive._tag, "None");

      const activeOnly = yield* sessions.listByThreadId({
        threadId: ThreadId.make("thread-1"),
      });
      assert.deepStrictEqual(
        activeOnly.map((session) => session.sessionId),
        ["review-session-2"],
      );
    }),
  );
});

reviewRepositoriesLayer("Review repositories — private drafts and ignore rules", (it) => {
  it.effect("keeps pending GitHub drafts private to the authenticated client session", () =>
    Effect.gen(function* () {
      const sessions = yield* ReviewSessionRepository;
      const drafts = yield* ReviewGitHubPendingDraftRepository;

      const session = makeSessionRecord({
        sessionId: "review-session-private-drafts",
        threadId: "thread-private-drafts",
      });
      yield* sessions.upsert(session);

      yield* drafts.upsert(
        makePendingDraft({
          id: "github-review-draft-a",
          sessionId: "review-session-private-drafts",
          authSessionId: "auth-session-a",
          draftKind: "inline-comment",
          submitAction: "comment",
        }),
      );
      yield* drafts.upsert(
        makePendingDraft({
          id: "github-review-draft-b",
          sessionId: "review-session-private-drafts",
          authSessionId: "auth-session-b",
          draftKind: "review-summary",
          anchor: null,
          body: "Overall summary for a different signed-in client.",
          submitAction: "request-changes",
          updatedAt: ts("2026-05-20T10:05:00.000Z"),
        }),
      );

      const viewerA = yield* drafts.listForViewer({
        sessionId: session.sessionId,
        authSessionId: AuthSessionId.make("auth-session-a"),
      });
      const viewerB = yield* drafts.listForViewer({
        sessionId: session.sessionId,
        authSessionId: AuthSessionId.make("auth-session-b"),
      });

      assert.deepStrictEqual(
        viewerA.map((draft) => draft.id),
        ["github-review-draft-a"],
      );
      assert.deepStrictEqual(
        viewerB.map((draft) => draft.id),
        ["github-review-draft-b"],
      );

      yield* drafts.markSessionDraftsOutdated({
        sessionId: session.sessionId,
        markedOutdatedAt: ts("2026-05-20T10:06:00.000Z"),
      });
      const outdatedViewerA = yield* drafts.listForViewer({
        sessionId: session.sessionId,
        authSessionId: AuthSessionId.make("auth-session-a"),
      });
      assert.equal(outdatedViewerA[0]?.isOutdated, true);
      assert.equal(outdatedViewerA[0]?.submitAction, "comment");
    }),
  );

  it.effect("shares ignore rules across threads that point at the same checkout path", () =>
    Effect.gen(function* () {
      const ignoreRules = yield* ReviewIgnoreRuleRepository;

      const firstRule = yield* ignoreRules.upsertNormalized({
        checkoutPath: tn("/repo/worktree/"),
        rulePath: tn("./apps/server/src/review"),
        ruleKind: "directory",
        createdAt: ts("2026-05-20T10:00:00.000Z"),
        updatedAt: ts("2026-05-20T10:00:00.000Z"),
      });
      const secondRule = yield* ignoreRules.upsertNormalized({
        checkoutPath: tn("/repo/worktree"),
        rulePath: tn("/repo/worktree/apps/web/src/review.tsx"),
        ruleKind: "file",
        createdAt: ts("2026-05-20T10:01:00.000Z"),
        updatedAt: ts("2026-05-20T10:01:00.000Z"),
      });

      assert.deepStrictEqual(
        firstRule,
        makeIgnoreRule({
          checkoutPath: "/repo/worktree",
          ruleKind: "directory",
          normalizedPath: "apps/server/src/review",
          matchPath: "apps/server/src/review/",
        }),
      );
      assert.deepStrictEqual(secondRule, {
        ...makeIgnoreRule({
          checkoutPath: "/repo/worktree",
          ruleKind: "file",
          normalizedPath: "apps/web/src/review.tsx",
          matchPath: "apps/web/src/review.tsx",
        }),
        createdAt: ts("2026-05-20T10:01:00.000Z"),
        updatedAt: ts("2026-05-20T10:01:00.000Z"),
      });

      const threadOneRules = yield* ignoreRules.listByCheckoutPath({
        checkoutPath: tn("/repo/worktree"),
      });
      const threadTwoRules = yield* ignoreRules.listByCheckoutPath({
        checkoutPath: tn("/repo/worktree/"),
      });

      assert.deepStrictEqual(threadOneRules, threadTwoRules);
      assert.deepStrictEqual(
        threadOneRules.map((rule) => [rule.ruleKind, rule.normalizedPath, rule.matchPath]),
        [
          ["directory", "apps/server/src/review", "apps/server/src/review/"],
          ["file", "apps/web/src/review.tsx", "apps/web/src/review.tsx"],
        ],
      );

      yield* ignoreRules.delete({
        checkoutPath: tn("/repo/worktree"),
        ruleKind: "directory",
        normalizedPath: tn("apps/server/src/review"),
      });
      const remainingRules = yield* ignoreRules.listByCheckoutPath({
        checkoutPath: tn("/repo/worktree"),
      });
      assert.deepStrictEqual(
        remainingRules.map((rule) => [rule.ruleKind, rule.normalizedPath]),
        [["file", "apps/web/src/review.tsx"]],
      );
    }),
  );
});

it.effect(
  "Review repositories persist local annotations, progress, and latest analysis across restart",
  () =>
    Effect.gen(function* () {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fenrir-review-persistence-"));
      const dbPath = path.join(tempDir, "orchestration.sqlite");
      const persistenceLayer = makeSqlitePersistenceLive(dbPath);
      const repoLayer = Layer.mergeAll(
        ReviewSessionRepositoryLive.pipe(Layer.provideMerge(persistenceLayer)),
        ReviewAnnotationRepositoryLive.pipe(Layer.provideMerge(persistenceLayer)),
        ReviewProgressRepositoryLive.pipe(Layer.provideMerge(persistenceLayer)),
        ReviewAnalysisRepositoryLive.pipe(Layer.provideMerge(persistenceLayer)),
        ReviewGitHubPendingDraftRepositoryLive.pipe(Layer.provideMerge(persistenceLayer)),
        ReviewIgnoreRuleRepositoryLive.pipe(Layer.provideMerge(persistenceLayer)),
      );

      const session = makeSessionRecord({
        sessionId: "review-session-restart",
        threadId: "thread-restart",
      });

      yield* Effect.gen(function* () {
        const sessions = yield* ReviewSessionRepository;
        const annotations = yield* ReviewAnnotationRepository;
        const progress = yield* ReviewProgressRepository;
        const analysis = yield* ReviewAnalysisRepository;
        const drafts = yield* ReviewGitHubPendingDraftRepository;
        const ignoreRules = yield* ReviewIgnoreRuleRepository;
        const sql = yield* SqlClient.SqlClient;

        yield* sessions.upsert(session);
        yield* annotations.upsert({
          annotationId: ReviewLocalAnnotationThreadId.make("review-thread-1"),
          sessionId: session.sessionId,
          annotationKind: "thread",
          parentAnnotationId: null,
          targetKind: "chunk",
          targetId: ReviewChunkId.make("review-chunk-1"),
          groupId: ReviewGroupId.make("review-group-1"),
          fileId: ReviewFileId.make("review-file-1"),
          chunkId: ReviewChunkId.make("review-chunk-1"),
          anchor: {
            normalizedPath: "apps/server/src/review.ts",
            provenance: {
              scope: "branch",
              lane: "committed",
            },
            newRange: {
              startLine: 10,
              endLine: 14,
            },
            excerpt: "review summary diff hunk",
          },
          source: "local",
          title: null,
          body: tn("Double-check provider fallback behavior."),
          author: {
            authSessionId: AuthSessionId.make("auth-session-1"),
            subject: "Adrian",
            role: "user",
          },
          isResolved: false,
          isReopened: false,
          isOutdated: false,
          isSuggestedResolved: false,
          createdAt: ts("2026-05-20T10:01:00.000Z"),
          updatedAt: ts("2026-05-20T10:02:00.000Z"),
        });
        yield* progress.upsert({
          sessionId: session.sessionId,
          targetKind: "chunk",
          targetId: ReviewChunkId.make("review-chunk-1"),
          progressState: "needs-follow-up",
          author: {
            authSessionId: AuthSessionId.make("auth-session-1"),
            subject: "Adrian",
            role: "user",
            clientLabel: "Safari",
          },
          lastUpdatedAt: ts("2026-05-20T10:03:00.000Z"),
        });
        yield* analysis.upsertLatest({
          sessionId: session.sessionId,
          artifact: {
            id: ReviewAnalysisArtifactId.make("review-artifact-1"),
            sessionId: session.sessionId,
            provider: "codex",
            status: "completed",
            staleStatus: "fresh",
            summaryMarkdown: "Initial summary",
            requestedAt: "2026-05-20T10:03:00.000Z",
            completedAt: "2026-05-20T10:04:00.000Z",
          },
          analysisPayload: {
            findings: [
              {
                severity: "medium",
                summary: "retry logic missing around shared persistence writes",
              },
            ],
          },
          generatedAt: ts("2026-05-20T10:04:00.000Z"),
          staleMarkerInputs: {
            baseCommitOid: "abc123",
            headCommitOid: "def456",
          },
          staleReasonFlags: [tn("content-changed")],
          updatedAt: ts("2026-05-20T10:04:00.000Z"),
        });
        yield* analysis.upsertLatest({
          sessionId: session.sessionId,
          artifact: {
            id: ReviewAnalysisArtifactId.make("review-artifact-2"),
            sessionId: session.sessionId,
            provider: "codex",
            status: "completed",
            staleStatus: "fresh",
            summaryMarkdown: "Updated summary",
            requestedAt: "2026-05-20T10:05:00.000Z",
            completedAt: "2026-05-20T10:06:00.000Z",
          },
          analysisPayload: {
            findings: [
              {
                severity: "low",
                summary: "latest-only row replaced successfully",
              },
            ],
          },
          generatedAt: ts("2026-05-20T10:06:00.000Z"),
          staleMarkerInputs: {
            baseCommitOid: "abc123",
            headCommitOid: "def789",
          },
          staleReasonFlags: [tn("superseded")],
          updatedAt: ts("2026-05-20T10:06:00.000Z"),
        });
        yield* drafts.upsert(
          makePendingDraft({
            id: "github-review-draft-restart",
            sessionId: "review-session-restart",
            authSessionId: "auth-session-1",
            draftKind: "review-summary",
            anchor: null,
            body: "Private pending summary before final submit.",
            submitAction: "approve",
            updatedAt: ts("2026-05-20T10:07:00.000Z"),
          }),
        );
        yield* ignoreRules.upsertNormalized({
          checkoutPath: tn("/repo/worktree/"),
          rulePath: tn("apps/server/src/review"),
          ruleKind: "directory",
          createdAt: ts("2026-05-20T10:08:00.000Z"),
          updatedAt: ts("2026-05-20T10:08:00.000Z"),
        });

        const analysisRows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS "count"
        FROM review_analysis
        WHERE session_id = ${session.sessionId}
      `;
        assert.equal(analysisRows[0]?.count, 1);

        const draftRows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS "count"
        FROM review_github_pending_drafts
        WHERE session_id = ${session.sessionId}
      `;
        assert.equal(draftRows[0]?.count, 1);
      }).pipe(Effect.provide(repoLayer));

      yield* Effect.gen(function* () {
        const sessions = yield* ReviewSessionRepository;
        const annotations = yield* ReviewAnnotationRepository;
        const progress = yield* ReviewProgressRepository;
        const analysis = yield* ReviewAnalysisRepository;
        const drafts = yield* ReviewGitHubPendingDraftRepository;
        const ignoreRules = yield* ReviewIgnoreRuleRepository;

        const persistedSession = yield* sessions.getById({
          sessionId: session.sessionId,
        });
        assert.equal(persistedSession._tag, "Some");

        const persistedAnnotations = yield* annotations.listBySessionId({
          sessionId: session.sessionId,
        });
        assert.equal(persistedAnnotations.length, 1);
        assert.equal(persistedAnnotations[0]?.body, "Double-check provider fallback behavior.");

        const persistedProgress = yield* progress.getByTarget({
          sessionId: session.sessionId,
          targetKind: "chunk",
          targetId: ReviewChunkId.make("review-chunk-1"),
        });
        assert.equal(persistedProgress._tag, "Some");
        if (Option.isSome(persistedProgress)) {
          assert.equal(persistedProgress.value.progressState, "needs-follow-up");
          assert.equal(persistedProgress.value.author.clientLabel, "Safari");
        }

        const persistedAnalysis = yield* analysis.getBySessionId({
          sessionId: session.sessionId,
        });
        assert.equal(persistedAnalysis._tag, "Some");
        if (Option.isSome(persistedAnalysis)) {
          assert.equal(persistedAnalysis.value.artifact.id, "review-artifact-2");
          assert.deepStrictEqual(persistedAnalysis.value.staleReasonFlags, ["superseded"]);
        }

        const persistedDrafts = yield* drafts.listForViewer({
          sessionId: session.sessionId,
          authSessionId: AuthSessionId.make("auth-session-1"),
        });
        assert.equal(persistedDrafts[0]?.id, "github-review-draft-restart");
        assert.equal(persistedDrafts[0]?.submitAction, "approve");

        const persistedIgnoreRules = yield* ignoreRules.listByCheckoutPath({
          checkoutPath: tn("/repo/worktree"),
        });
        assert.deepStrictEqual(
          persistedIgnoreRules.map((rule) => [rule.ruleKind, rule.normalizedPath, rule.matchPath]),
          [["directory", "apps/server/src/review", "apps/server/src/review/"]],
        );
      }).pipe(Effect.provide(repoLayer));

      fs.rmSync(tempDir, { recursive: true, force: true });
    }).pipe(Effect.provide(NodeServices.layer)),
);
