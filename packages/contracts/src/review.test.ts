import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  GitHubReviewReadModel,
  ReviewActionBlockedError,
  ReviewApplyRawMutationInput,
  ReviewApplyRawMutationResult,
  ReviewCreateLocalAnnotationThreadInput,
  ReviewDiffFilePatch,
  ReviewDiffSnapshot,
  ReviewGenerateAnalysisInput,
  ReviewGitHubPendingDraft,
  ReviewGetOrCreateSessionInput,
  ReviewIgnoreRule,
  ReviewLocalAnnotationReply,
  ReviewChunkId,
  ReviewMutationConflictError,
  ReviewRpcError,
  ReviewSessionId,
  ReviewSessionSnapshot,
  ReviewStableAnchor,
  ReviewStreamEvent,
} from "./review";

const decodeGetOrCreateSessionInput = Schema.decodeUnknownSync(ReviewGetOrCreateSessionInput);
const decodeStableAnchor = Schema.decodeUnknownSync(ReviewStableAnchor);
const decodeCreateThreadInput = Schema.decodeUnknownSync(ReviewCreateLocalAnnotationThreadInput);
const decodeSessionSnapshot = Schema.decodeUnknownSync(ReviewSessionSnapshot);
const decodeDiffSnapshot = Schema.decodeUnknownSync(ReviewDiffSnapshot);
const decodeDiffFilePatch = Schema.decodeUnknownSync(ReviewDiffFilePatch);
const decodeApplyRawMutationInput = Schema.decodeUnknownSync(ReviewApplyRawMutationInput);
const decodeApplyRawMutationResult = Schema.decodeUnknownSync(ReviewApplyRawMutationResult);
const decodeGitHubReviewReadModel = Schema.decodeUnknownSync(GitHubReviewReadModel);
const decodeGitHubPendingDraft = Schema.decodeUnknownSync(ReviewGitHubPendingDraft);
const decodeReviewIgnoreRule = Schema.decodeUnknownSync(ReviewIgnoreRule);
const decodeReply = Schema.decodeUnknownSync(ReviewLocalAnnotationReply);
const decodeStreamEvent = Schema.decodeUnknownSync(ReviewStreamEvent);
const encodeRpcError = Schema.encodeSync(ReviewRpcError);
const encodeActionBlockedError = Schema.encodeSync(ReviewActionBlockedError);
const encodeMutationConflictError = Schema.encodeSync(ReviewMutationConflictError);

describe("Review contracts", () => {
  it("decodes session targets and trims session metadata", () => {
    const parsed = decodeGetOrCreateSessionInput({
      threadId: " thread-1 ",
      baseBranchOverride: " main ",
      pullRequestOverride: {
        provider: "github",
        number: 42,
        url: "https://github.com/fenrir/fenrir/pull/42",
      },
      mode: "review",
      scope: "combined",
    });

    expect(parsed.threadId).toBe("thread-1");
    expect(parsed.baseBranchOverride).toBe("main");
    expect(parsed.pullRequestOverride?.number).toBe(42);
    expect(parsed.scope).toBe("combined");
  });

  it("decodes analysis generation input with an optional one-off instruction", () => {
    const parsed = Schema.decodeUnknownSync(ReviewGenerateAnalysisInput)({
      sessionId: " review-session-1 ",
      force: true,
      instruction: " Focus on reconnect churn and stale review anchors. ",
    });

    expect(parsed.sessionId).toBe("review-session-1");
    expect(parsed.instruction).toBe("Focus on reconnect churn and stale review anchors.");
  });

  it("decodes stable anchors with provenance and rematch fingerprints", () => {
    const parsed = decodeStableAnchor({
      normalizedPath: " apps/web/src/review.tsx ",
      provenance: {
        scope: "branch",
        lane: "committed",
      },
      oldRange: {
        startLine: 10,
        endLine: 14,
      },
      newRange: {
        startLine: 10,
        endLine: 18,
      },
      excerpt: " const value = nextValue(); ",
      excerptHash: "sha256:excerpt",
      patchFingerprint: "patch:fingerprint",
    });

    expect(parsed.normalizedPath).toBe("apps/web/src/review.tsx");
    expect(parsed.provenance.lane).toBe("committed");
    expect(parsed.newRange?.endLine).toBe(18);
  });

  it("decodes diff snapshots and lazy file patches", () => {
    const snapshot = decodeDiffSnapshot({
      sessionId: "review-session-1",
      scope: "combined",
      target: {
        cwd: "/repo/worktree",
        repositoryRoot: "/repo",
        worktreePath: null,
      },
      generatedAt: "2026-05-21T10:00:00.000Z",
      lanes: [
        {
          sessionId: "review-session-1",
          groupId: "review-group-1",
          kind: "committed",
          title: "Committed on branch",
          fileCount: 1,
          files: [
            {
              sessionId: "review-session-1",
              groupId: "review-group-1",
              fileId: "review-file-1",
              lane: "committed",
              provenance: {
                scope: "branch",
                lane: "committed",
              },
              normalizedPath: "apps/server/src/review.ts",
              displayPath: "apps/server/src/review.ts",
              changeKind: "rename",
              previousPath: "apps/server/src/review-old.ts",
              insertions: 12,
              deletions: 3,
              chunkCount: 1,
              metadata: {
                kind: "rename",
                title: "Renamed file",
                summaryLines: ["apps/server/src/review-old.ts -> apps/server/src/review.ts"],
              },
            },
          ],
        },
      ],
    });
    const patch = decodeDiffFilePatch({
      sessionId: "review-session-1",
      groupId: "review-group-1",
      fileId: "review-file-1",
      scope: "combined",
      lane: "committed",
      provenance: {
        scope: "branch",
        lane: "committed",
      },
      normalizedPath: "apps/server/src/review.ts",
      displayPath: "apps/server/src/review.ts",
      changeKind: "rename",
      previousPath: "apps/server/src/review-old.ts",
      insertions: 12,
      deletions: 3,
      metadata: {
        kind: "rename",
        title: "Renamed file",
        summaryLines: ["apps/server/src/review-old.ts -> apps/server/src/review.ts"],
      },
      chunks: [
        {
          chunkId: "review-chunk-1",
          anchor: {
            normalizedPath: "apps/server/src/review.ts",
            provenance: {
              scope: "branch",
              lane: "committed",
            },
            newRange: {
              startLine: 10,
              endLine: 16,
            },
            excerpt: "return buildDiffRuntime();",
          },
          header: "@@ -10,3 +10,7 @@",
          lines: [
            {
              kind: "context",
              text: "const value = 1;",
              oldLineNumber: 10,
              newLineNumber: 10,
            },
            {
              kind: "add",
              text: "return buildDiffRuntime();",
              newLineNumber: 11,
            },
          ],
        },
      ],
    });

    expect(snapshot.lanes[0]?.files[0]?.previousPath).toBe("apps/server/src/review-old.ts");
    expect(patch.chunks[0]?.lines[1]?.kind).toBe("add");
  });

  it("decodes local thread creation with embedded authorship metadata", () => {
    const parsed = decodeCreateThreadInput({
      sessionId: "review-session-1",
      groupId: "review-group-1",
      fileId: "review-file-1",
      chunkId: "review-chunk-1",
      anchor: {
        normalizedPath: "apps/server/src/review.ts",
        provenance: {
          scope: "uncommitted",
          lane: "unstaged",
        },
        newRange: {
          startLine: 40,
          endLine: 45,
        },
        excerpt: "server-owned summary",
      },
      body: "Needs a retry guard before updating session state.",
      progressState: "needs-follow-up",
      author: {
        authSessionId: "auth-session-1",
        subject: "Adrian",
        role: "user",
        clientLabel: "Safari",
        deviceLabel: "MacBook Pro",
      },
    });

    expect(parsed.author.authSessionId).toBe("auth-session-1");
    expect(parsed.author.clientLabel).toBe("Safari");
    expect(parsed.progressState).toBe("needs-follow-up");
  });

  it("decodes raw mutation commands and structured mutation results", () => {
    const input = decodeApplyRawMutationInput({
      sessionId: "review-session-1",
      action: "undo",
      target: {
        targetKind: "chunk",
        lane: "committed",
        normalizedPath: "apps/server/src/review.ts",
        chunkId: "review-chunk-1",
      },
    });
    const result = decodeApplyRawMutationResult({
      sessionId: "review-session-1",
      action: "undo",
      targetKind: "chunk",
      confirmation: "Chunk undone: apps/server/src/review.ts",
      selectionStatus: "applied",
      changedPaths: ["apps/server/src/review.ts"],
      laneTransitions: [
        {
          normalizedPath: "apps/server/src/review.ts",
          fromLane: "committed",
          toLane: "inverse-edit",
        },
      ],
      generatedInverseEdit: true,
      refreshRequired: true,
    });

    expect(input.target.targetKind).toBe("chunk");
    expect(result.generatedInverseEdit).toBe(true);
  });

  it("decodes private pending GitHub review drafts scoped to an auth session", () => {
    const parsed = decodeGitHubPendingDraft({
      id: " github-review-draft-1 ",
      sessionId: " review-session-1 ",
      authSessionId: " auth-session-1 ",
      draftKind: "inline-comment",
      anchor: {
        normalizedPath: " apps/server/src/review.ts ",
        provenance: {
          scope: "branch",
          lane: "committed",
        },
        newRange: {
          startLine: 10,
          endLine: 14,
        },
        excerpt: " review summary diff hunk ",
      },
      body: " Please split this branch and stale state handling. ",
      isOutdated: false,
      submitAction: "request-changes",
      createdAt: "2026-05-20T10:02:30.000Z",
      updatedAt: "2026-05-20T10:03:00.000Z",
    });

    expect(parsed.sessionId).toBe("review-session-1");
    expect(parsed.authSessionId).toBe("auth-session-1");
    expect(parsed.anchor?.normalizedPath).toBe("apps/server/src/review.ts");
    expect(parsed.submitAction).toBe("request-changes");
  });

  it("decodes checkout-scoped ignore rules with cheap match paths", () => {
    const parsed = decodeReviewIgnoreRule({
      checkoutPath: " /repo/worktree ",
      ruleKind: "directory",
      normalizedPath: " apps/server/src/review ",
      matchPath: " apps/server/src/review/ ",
      createdAt: "2026-05-20T10:04:00.000Z",
      updatedAt: "2026-05-20T10:04:00.000Z",
    });

    expect(parsed.checkoutPath).toBe("/repo/worktree");
    expect(parsed.normalizedPath).toBe("apps/server/src/review");
    expect(parsed.matchPath).toBe("apps/server/src/review/");
  });

  it("decodes a full snapshot with local and GitHub review artifacts", () => {
    const parsed = decodeSessionSnapshot({
      summary: {
        id: "review-session-1",
        mode: "review",
        scope: "combined",
        target: {
          cwd: "/repo",
          repositoryRoot: "/repo",
          repositoryName: "Fenrir",
          worktreePath: "/repo",
          selectionLabel: "PR #42",
          baseRef: "main",
          headRef: "feature/rich-review-tab",
          baseCommitOid: "abc123",
          headCommitOid: "def456",
          pullRequestNumber: 42,
          pullRequestUrl: "https://github.com/fenrir/fenrir/pull/42",
        },
        progressCounts: {
          unreviewed: 2,
          reviewed: 3,
          needsFollowUp: 1,
        },
        fileCount: 2,
        chunkCount: 3,
        localThreadCount: 1,
        overviewNoteCount: 1,
        analysisArtifactCount: 1,
        degradedReasons: ["patch-truncated"],
        blockedActions: ["sync-in-progress"],
        createdAt: "2026-05-20T10:00:00.000Z",
        updatedAt: "2026-05-20T10:05:00.000Z",
      },
      groups: [
        {
          id: "review-group-1",
          sessionId: "review-session-1",
          title: "Committed changes",
          scope: "branch",
          lane: "committed",
          progressState: "unreviewed",
          degradedReasons: [],
        },
      ],
      files: [
        {
          id: "review-file-1",
          sessionId: "review-session-1",
          groupId: "review-group-1",
          normalizedPath: "apps/server/src/review.ts",
          displayPath: "apps/server/src/review.ts",
          progressState: "needs-follow-up",
        },
      ],
      chunks: [
        {
          id: "review-chunk-1",
          sessionId: "review-session-1",
          groupId: "review-group-1",
          fileId: "review-file-1",
          anchor: {
            normalizedPath: "apps/server/src/review.ts",
            provenance: {
              scope: "branch",
              lane: "committed",
            },
            oldRange: {
              startLine: 10,
              endLine: 12,
            },
            newRange: {
              startLine: 10,
              endLine: 14,
            },
            excerpt: "review summary diff hunk",
            excerptHash: "excerpt-1",
            patchFingerprint: "patch-1",
          },
          progressState: "unreviewed",
        },
      ],
      localThreads: [
        {
          id: "review-thread-1",
          sessionId: "review-session-1",
          groupId: "review-group-1",
          fileId: "review-file-1",
          chunkId: "review-chunk-1",
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
          body: "Double-check provider fallback behavior.",
          progressState: "needs-follow-up",
          isResolved: false,
          isOutdated: false,
          isSuggestedResolved: false,
          viewerCanEdit: true,
          author: {
            authSessionId: "auth-session-1",
            subject: "Adrian",
            role: "user",
          },
          createdAt: "2026-05-20T10:01:00.000Z",
          updatedAt: "2026-05-20T10:02:00.000Z",
        },
      ],
      localReplies: [
        {
          id: "review-reply-1",
          threadId: "review-thread-1",
          sessionId: "review-session-1",
          body: "The retry guard belongs in the manager, not the UI.",
          viewerCanEdit: false,
          author: {
            authSessionId: "auth-session-2",
            subject: "Codex",
            role: "assistant",
            clientLabel: "Codex CLI",
          },
          createdAt: "2026-05-20T10:03:00.000Z",
          updatedAt: "2026-05-20T10:03:00.000Z",
        },
      ],
      overviewNotes: [
        {
          id: "overview-note-1",
          sessionId: "review-session-1",
          title: "Summary",
          body: "The main risk is stale diff anchoring after live churn.",
          progressState: "needs-follow-up",
          viewerCanEdit: true,
          author: {
            authSessionId: "auth-session-1",
            subject: "Adrian",
            role: "user",
            deviceLabel: "MacBook Pro",
          },
          createdAt: "2026-05-20T10:04:00.000Z",
          updatedAt: "2026-05-20T10:04:00.000Z",
        },
      ],
      analysisArtifacts: [
        {
          id: "review-artifact-1",
          sessionId: "review-session-1",
          provider: "codex",
          status: "completed",
          staleStatus: "fresh",
          summaryMarkdown: "Looks correct overall.",
          checklist: [
            {
              id: "check-risk-order",
              title: "Review the stale-anchor path first",
              detail: "This area carries the highest churn and the active inline discussion.",
              targetRefs: [
                {
                  groupId: "review-group-1",
                  lane: "committed",
                  fileId: "review-file-1",
                  chunkId: "review-chunk-1",
                  normalizedPath: "apps/server/src/review.ts",
                },
              ],
            },
          ],
          semanticGroups: [
            {
              id: "analysis-group-review",
              title: "Review orchestration path",
              rationale: "Most of the churn is concentrated in the review pipeline entrypoint.",
              suggestedReviewOrder: 1,
              needsAttention: true,
              targetRefs: [
                {
                  groupId: "review-group-1",
                  lane: "committed",
                  fileId: "review-file-1",
                  chunkId: "review-chunk-1",
                  normalizedPath: "apps/server/src/review.ts",
                },
              ],
              checklist: [
                {
                  id: "check-review-service",
                  title: "Validate stale marker propagation",
                  targetRefs: [
                    {
                      groupId: "review-group-1",
                      lane: "committed",
                      fileId: "review-file-1",
                      normalizedPath: "apps/server/src/review.ts",
                    },
                  ],
                },
              ],
              riskFlags: [
                {
                  level: "high",
                  label: "Stale anchors",
                  detail: "Remote comments will drift if chunk matching weakens under live churn.",
                  targetRefs: [
                    {
                      groupId: "review-group-1",
                      lane: "committed",
                      fileId: "review-file-1",
                      chunkId: "review-chunk-1",
                      normalizedPath: "apps/server/src/review.ts",
                    },
                  ],
                },
              ],
            },
          ],
          riskFlags: [
            {
              level: "medium",
              label: "Pending inline review",
              detail: "There is still an active inline draft on the same file.",
              targetRefs: [
                {
                  groupId: "review-group-1",
                  lane: "committed",
                  fileId: "review-file-1",
                  normalizedPath: "apps/server/src/review.ts",
                },
              ],
            },
          ],
          metadata: {
            mode: "review",
            scope: "combined",
            target: {
              cwd: "/repo",
              repositoryRoot: "/repo",
              worktreePath: null,
            },
            modelSelection: {
              provider: "codex",
              model: "gpt-5-codex",
            },
            instruction: "Focus on stale anchors.",
            codeDiffFingerprint: "sha256:diff-1",
            remoteContextFingerprint: "sha256:remote-1",
            fileCount: 1,
            semanticGroupCount: 1,
            remoteThreadCount: 1,
            remoteGeneralCommentCount: 0,
          },
          staleMetadata: {
            comparedAt: "2026-05-20T10:01:30.000Z",
            invalidatedBy: [],
            currentCodeDiffFingerprint: "sha256:diff-1",
            currentRemoteContextFingerprint: "sha256:remote-1",
            generatedMode: "review",
            currentMode: "review",
            generatedScope: "combined",
            currentScope: "combined",
            generatedModelSelection: {
              provider: "codex",
              model: "gpt-5-codex",
            },
            currentModelSelection: {
              provider: "codex",
              model: "gpt-5-codex",
            },
            generatedInstruction: "Focus on stale anchors.",
          },
          fileId: "review-file-1",
          chunkId: "review-chunk-1",
          requestedAt: "2026-05-20T10:00:30.000Z",
          completedAt: "2026-05-20T10:01:30.000Z",
        },
      ],
      github: {
        provider: "github",
        pullRequestNumber: 42,
        writable: true,
        draft: {
          id: "github-review-draft-1",
          state: "pending",
          pullRequestNumber: 42,
          decision: "comment",
          body: "Pending review draft.",
          threads: [
            {
              id: "github-thread-1",
              path: "apps/server/src/review.ts",
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
              isResolved: false,
              isOutdated: false,
              comments: [
                {
                  id: "github-comment-1",
                  threadId: "github-thread-1",
                  path: "apps/server/src/review.ts",
                  body: "Please clarify this control flow.",
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
                  authorLogin: "fenrir-bot",
                  isPending: true,
                  createdAt: "2026-05-20T10:02:30.000Z",
                  updatedAt: "2026-05-20T10:02:30.000Z",
                },
              ],
            },
          ],
          createdAt: "2026-05-20T10:02:00.000Z",
          updatedAt: "2026-05-20T10:03:00.000Z",
        },
        pendingDrafts: [
          {
            id: "github-review-draft-1",
            draftKind: "inline-comment",
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
            body: "Please clarify this control flow.",
            isOutdated: false,
            submitAction: "comment",
            createdAt: "2026-05-20T10:02:00.000Z",
            updatedAt: "2026-05-20T10:03:00.000Z",
          },
        ],
        threads: [],
        generalComments: [],
        reviews: [
          {
            id: "github-review-1",
            state: "submitted",
            pullRequestNumber: 42,
            decision: "approve",
            body: "Looks good.",
            threads: [],
            authorLogin: "octocat",
            createdAt: "2026-05-20T09:00:00.000Z",
            updatedAt: "2026-05-20T09:01:00.000Z",
            submittedAt: "2026-05-20T09:01:00.000Z",
          },
        ],
      },
    });

    expect(parsed.summary.mode).toBe("review");
    expect(parsed.analysisArtifacts[0]?.provider).toBe("codex");
    expect(parsed.analysisArtifacts[0]?.semanticGroups?.[0]?.riskFlags[0]?.label).toBe(
      "Stale anchors",
    );
    expect(parsed.github?.draft?.threads[0]?.comments[0]?.isPending).toBe(true);
  });

  it("decodes GitHub read models and stream updates separately", () => {
    const review = decodeGitHubReviewReadModel({
      id: "github-review-2",
      state: "submitted",
      pullRequestNumber: 7,
      decision: "request-changes",
      body: "Please handle stale anchors.",
      threads: [],
      authorLogin: "reviewer",
      createdAt: "2026-05-20T08:00:00.000Z",
      updatedAt: "2026-05-20T08:01:00.000Z",
      submittedAt: "2026-05-20T08:01:00.000Z",
    });
    const reply = decodeReply({
      id: "review-reply-2",
      threadId: "review-thread-1",
      sessionId: "review-session-1",
      body: "Anchors now include excerpt hashes.",
      viewerCanEdit: true,
      author: {
        authSessionId: "auth-session-3",
        subject: "Codex",
        role: "assistant",
      },
      createdAt: "2026-05-20T10:04:30.000Z",
      updatedAt: "2026-05-20T10:04:30.000Z",
    });
    const event = decodeStreamEvent({
      _tag: "progressUpdated",
      sessionId: "review-session-1",
      chunkId: "review-chunk-1",
      progressState: "reviewed",
    });

    expect(review.state).toBe("submitted");
    expect(reply.author.subject).toBe("Codex");
    expect(event._tag).toBe("progressUpdated");
  });

  it("encodes tagged review errors with typed reason fields", () => {
    const rpcError = encodeRpcError(new ReviewRpcError({ message: "failed to load review" }));
    const blocked = encodeActionBlockedError(
      new ReviewActionBlockedError({
        reason: "github-review-read-only",
        message: "The current PR token cannot submit a draft review.",
      }),
    );
    const conflict = encodeMutationConflictError(
      new ReviewMutationConflictError({
        reason: "refresh-needed",
        message: "The selected chunk is stale.",
        sessionId: ReviewSessionId.makeUnsafe("review-session-1"),
        action: "stage",
        targetKind: "chunk",
        normalizedPath: "apps/server/src/review.ts",
        lane: "unstaged",
        chunkId: ReviewChunkId.makeUnsafe("review-chunk-1"),
      }),
    );

    expect(rpcError._tag).toBe("ReviewRpcError");
    expect(blocked.reason).toBe("github-review-read-only");
    expect(conflict.reason).toBe("refresh-needed");
  });
});
