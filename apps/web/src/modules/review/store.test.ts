import { afterEach, describe, expect, it } from "vitest";

import { useReviewStore } from "./store";

function resetReviewStore() {
  useReviewStore.setState(useReviewStore.getInitialState(), true);
}

function makeRouteState() {
  return {
    tab: "review" as const,
    reviewMode: "review" as const,
    reviewScope: "combined" as const,
  };
}

function makeContext(threadId: string) {
  return {
    environmentId: "environment-local",
    threadId,
    routeKind: "server" as const,
  };
}

function makeDiffSnapshot(input: {
  readonly laneFileId: string;
  readonly normalizedPath: string;
  readonly headCommitOid: string;
  readonly chunkCount?: number;
}) {
  return {
    sessionId: "review-session-1",
    scope: "combined",
    target: {
      cwd: "/repo/worktree",
      repositoryRoot: "/repo",
      worktreePath: null,
      baseRef: "main",
      headRef: "feature/review",
      baseCommitOid: "base-1",
      headCommitOid: input.headCommitOid,
      pullRequestNumber: 42,
    },
    generatedAt: "2026-05-21T10:00:00.000Z",
    lanes: [
      {
        sessionId: "review-session-1",
        groupId: "lane-1",
        kind: "committed",
        title: "Committed on branch",
        fileCount: 1,
        files: [
          {
            sessionId: "review-session-1",
            groupId: "lane-1",
            fileId: input.laneFileId,
            lane: "committed",
            provenance: {
              scope: "branch",
              lane: "committed",
            },
            normalizedPath: input.normalizedPath,
            displayPath: input.normalizedPath,
            changeKind: "text",
            insertions: 4,
            deletions: 1,
            chunkCount: input.chunkCount ?? 1,
          },
        ],
      },
    ],
  } as const;
}

describe("review store", () => {
  afterEach(() => {
    resetReviewStore();
  });

  it("clears lazy diff caches when the diff token changes", () => {
    const threadKey = "environment-local:thread-1";
    const store = useReviewStore.getState();
    store.ensureThread(threadKey, makeContext("thread-1"), makeRouteState());
    store.applySessionSummary(threadKey, {
      id: "review-session-1",
      mode: "review",
      scope: "combined",
      target: {
        cwd: "/repo/worktree",
        repositoryRoot: "/repo",
        worktreePath: null,
      },
      createdAt: "2026-05-21T10:00:00.000Z",
      updatedAt: "2026-05-21T10:00:00.000Z",
      degradedReasons: [],
      blockedActions: [],
    } as never);

    store.applyDiffSnapshot(
      threadKey,
      makeDiffSnapshot({
        laneFileId: "file-1",
        normalizedPath: "src/a.ts",
        headCommitOid: "head-1",
      }) as never,
    );
    store.applyFilePatch(threadKey, "patch-key", {
      fileId: "file-1",
      lane: "committed",
      normalizedPath: "src/a.ts",
      chunks: [{ chunkId: "chunk-1" }],
    } as never);
    store.applyChunkPayload(threadKey, "payload-key", {
      anchor: { normalizedPath: "src/a.ts" },
    } as never);

    store.applyDiffSnapshot(
      threadKey,
      makeDiffSnapshot({
        laneFileId: "file-2",
        normalizedPath: "src/b.ts",
        headCommitOid: "head-2",
      }) as never,
    );

    const thread = useReviewStore.getState().threads[threadKey]!;
    expect(thread.filePatchCache).toEqual({});
    expect(thread.chunkPayloadCache).toEqual({});
    expect(thread.explorer.fileEntryById["file-2"]?.normalizedPath).toBe("src/b.ts");
  });

  it("keeps review UI expansion persisted per thread without leaking session caches", () => {
    const store = useReviewStore.getState();
    const threadA = "environment-local:thread-a";
    const threadB = "environment-local:thread-b";
    store.ensureThread(threadA, makeContext("thread-a"), makeRouteState());
    store.ensureThread(threadB, makeContext("thread-b"), makeRouteState());
    store.toggleFileExpanded(threadA, "file-a");
    store.applyFilePatch(threadA, "patch-a", {
      fileId: "file-a",
      lane: "committed",
      normalizedPath: "src/a.ts",
      chunks: [{ chunkId: "chunk-a" }],
    } as never);

    const persistApi = useReviewStore.persist as unknown as {
      getOptions: () => {
        partialize: (state: ReturnType<typeof useReviewStore.getState>) => unknown;
        merge: (
          persistedState: unknown,
          currentState: ReturnType<typeof useReviewStore.getInitialState>,
        ) => ReturnType<typeof useReviewStore.getState>;
      };
    };

    const persisted = persistApi.getOptions().partialize(useReviewStore.getState());
    const merged = persistApi.getOptions().merge(persisted, useReviewStore.getInitialState());

    expect(merged.threads[threadA]?.expansion.fileIds["file-a"]).toBe(true);
    expect(merged.threads[threadB]?.expansion.fileIds["file-a"]).toBeUndefined();
    expect(merged.threads[threadA]?.filePatchCache).toEqual({});
    expect(merged.threads[threadA]?.chunkPayloadCache).toEqual({});
  });
});
