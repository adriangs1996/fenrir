// @ts-nocheck
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  ProjectId,
  ThreadId,
  type OrchestrationProject,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@fenrir/contracts";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { describe, expect, it } from "vitest";

import { GitCore } from "../../../git/Services/GitCore.ts";
import { GitManager } from "../../../git/Services/GitManager.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ReviewSessionRepositoryLive } from "../../../persistence/Layers/ReviewSessions.ts";
import { SqlitePersistenceMemory } from "../../../persistence/Layers/Sqlite.ts";
import { ReviewSessionRepository } from "../../../persistence/Services/ReviewSessions.ts";
import { SourceControl } from "../../Services/SourceControl.ts";
import { ReviewSessionService } from "../Services/ReviewSessionService.ts";
import { ReviewSessionServiceLive } from "./ReviewSessionService.ts";

const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);

interface TestPullRequest {
  readonly number: number;
  readonly url: string;
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly title: string;
  readonly state: "open" | "closed" | "merged";
}

interface TestGitStatus {
  readonly branch: string | null;
  readonly hasWorkingTreeChanges: boolean;
  readonly workingTree: {
    readonly files: ReadonlyArray<{
      readonly path: string;
      readonly insertions: number;
      readonly deletions: number;
    }>;
    readonly insertions: number;
    readonly deletions: number;
  };
  readonly pr: TestPullRequest | null;
}

interface TestState {
  project: OrchestrationProject;
  thread: OrchestrationThread;
  readonly gitStatusByCwd: Map<string, TestGitStatus>;
  readonly gitConfigByKey: Map<string, string | null>;
  readonly gitExecByKey: Map<string, { readonly code: number; readonly stdout: string }>;
}

function gitExecKey(cwd: string, args: ReadonlyArray<string>): string {
  return `${cwd}::${args.join(" ")}`;
}

function canonicalCwd(cwd: string): string {
  try {
    return fs.realpathSync.native(cwd);
  } catch {
    return path.resolve(cwd);
  }
}

function makeProject(workspaceRoot: string): OrchestrationProject {
  return {
    id: asProjectId("project-review"),
    title: "Review Project",
    workspaceRoot,
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    managedProcesses: [],
    globalScriptDefaults: [],
    createdAt: "2026-05-20T10:00:00.000Z",
    updatedAt: "2026-05-20T10:00:00.000Z",
    deletedAt: null,
  };
}

function makeThread(worktreePath: string, branch: string): OrchestrationThread {
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
    branch,
    worktreePath,
    latestTurn: null,
    createdAt: "2026-05-20T10:00:00.000Z",
    updatedAt: "2026-05-20T10:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
  };
}

function makeReadModel(
  project: OrchestrationProject,
  thread: OrchestrationThread,
): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    projects: [project],
    threads: [thread],
    managedProcessInstances: [],
    updatedAt: "2026-05-20T10:00:00.000Z",
  };
}

function makeServiceLayer(state: TestState, persistenceLayer: any) {
  const reviewSessionRepositoryLayer = ReviewSessionRepositoryLive.pipe(
    Layer.provideMerge(persistenceLayer),
  );

  const projectionLayer = Layer.mock(ProjectionSnapshotQuery)({
    getBootstrapSnapshot: () => Effect.succeed(makeReadModel(state.project, state.thread)),
    getArchivedShellSnapshot: () => Effect.succeed(makeReadModel(state.project, state.thread)),
    getSnapshot: () => Effect.succeed(makeReadModel(state.project, state.thread)),
    getCounts: () => Effect.succeed({ projectCount: 1, threadCount: 1 }),
    getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
    getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
    getProjectShellById: () => Effect.succeed(Option.none()),
    getThreadShellById: () => Effect.succeed(Option.none()),
    getThreadSnapshot: (threadId) =>
      Effect.succeed(threadId === state.thread.id ? Option.some(state.thread) : Option.none()),
    getThreadCheckpointContext: () => Effect.succeed(Option.none()),
  });

  const sourceControlLayer = Layer.mock(SourceControl)({
    resolveWorkspace: () =>
      Effect.succeed({
        kind: "git",
        rootPath: state.project.workspaceRoot,
        metadataPath: path.join(state.project.workspaceRoot, ".git"),
        repositoryIdentity: null,
      }),
    isSupportedWorkspace: () => Effect.succeed(true),
    resolveRepositoryIdentity: () => Effect.succeed(null),
  });

  const gitManagerLayer = Layer.mock(GitManager)({
    status: ({ cwd }) => {
      const status = state.gitStatusByCwd.get(cwd);
      if (!status) {
        return Effect.die(new Error(`Missing git status mock for ${cwd}`));
      }
      return Effect.succeed({
        isRepo: true,
        hasOriginRemote: true,
        isDefaultBranch: false,
        branch: status.branch,
        hasWorkingTreeChanges: status.hasWorkingTreeChanges,
        workingTree: status.workingTree,
        hasUpstream: true,
        aheadCount: 0,
        behindCount: 0,
        pr: status.pr,
      });
    },
  });

  const gitCoreLayer = Layer.mock(GitCore)({
    readConfigValue: (cwd, key) =>
      Effect.succeed(state.gitConfigByKey.get(`${cwd}::${key}`) ?? null),
    execute: ({ cwd, args }) => {
      const result = state.gitExecByKey.get(gitExecKey(cwd, args)) ?? { code: 1, stdout: "" };
      return Effect.succeed({
        code: result.code,
        stdout: result.stdout,
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
      });
    },
  });

  const serviceLayer = ReviewSessionServiceLive.pipe(
    Layer.provideMerge(reviewSessionRepositoryLayer),
    Layer.provide(projectionLayer),
    Layer.provide(sourceControlLayer),
    Layer.provide(gitManagerLayer),
    Layer.provide(gitCoreLayer),
  );

  return Layer.mergeAll(serviceLayer, reviewSessionRepositoryLayer);
}

function seedGitState(
  state: TestState,
  cwd: string,
  input: {
    readonly branch: string;
    readonly headCommit: string;
    readonly baseCommit: string;
    readonly baseRef?: string;
    readonly workingTreeFiles?: ReadonlyArray<{
      readonly path: string;
      readonly insertions: number;
      readonly deletions: number;
    }>;
    readonly pullRequest?: TestPullRequest;
  },
) {
  const baseRef = input.pullRequest?.baseBranch ?? input.baseRef ?? "main";
  const normalizedCwd = canonicalCwd(cwd);
  const workingTreeFiles = input.workingTreeFiles ?? [];
  state.gitStatusByCwd.set(normalizedCwd, {
    branch: input.branch,
    hasWorkingTreeChanges: workingTreeFiles.length > 0,
    workingTree: {
      files: workingTreeFiles,
      insertions: workingTreeFiles.reduce((sum, file) => sum + file.insertions, 0),
      deletions: workingTreeFiles.reduce((sum, file) => sum + file.deletions, 0),
    },
    pr: input.pullRequest ?? null,
  });
  state.gitConfigByKey.set(`${normalizedCwd}::branch.${input.branch}.remote`, "origin");
  state.gitConfigByKey.set(`${normalizedCwd}::branch.${input.branch}.gh-merge-base`, baseRef);
  state.gitExecByKey.set(gitExecKey(normalizedCwd, ["rev-parse", "HEAD"]), {
    code: 0,
    stdout: input.headCommit,
  });
  state.gitExecByKey.set(gitExecKey(normalizedCwd, ["rev-parse", baseRef]), {
    code: 0,
    stdout: input.baseCommit,
  });
}

function buildRuntime(layer: any) {
  return ManagedRuntime.make(layer);
}

describe("ReviewSessionService", () => {
  it("preserves the active session across diff churn", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fenrir-review-root-"));
    const worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), "fenrir-review-worktree-"));
    const state: TestState = {
      project: makeProject(workspaceRoot),
      thread: makeThread(worktreePath, "feature/review"),
      gitStatusByCwd: new Map(),
      gitConfigByKey: new Map(),
      gitExecByKey: new Map(),
    };
    seedGitState(state, worktreePath, {
      branch: "feature/review",
      headCommit: "head-1",
      baseCommit: "base-1",
    });
    const layer = makeServiceLayer(state, SqlitePersistenceMemory);
    const runtime = buildRuntime(layer);

    const first: any = await runtime.runPromise(
      Effect.gen(function* () {
        const reviewSessionService = yield* ReviewSessionService;
        return yield* reviewSessionService.ensureActiveSession({
          threadId: state.thread.id,
          now: "2026-05-20T10:00:00.000Z",
        });
      }),
    );

    seedGitState(state, worktreePath, {
      branch: "feature/review",
      headCommit: "head-2",
      baseCommit: "base-1",
      workingTreeFiles: [{ path: "apps/server/src/review.ts", insertions: 8, deletions: 2 }],
    });

    const second: any = await runtime.runPromise(
      Effect.gen(function* () {
        const reviewSessionService = yield* ReviewSessionService;
        return yield* reviewSessionService.ensureActiveSession({
          threadId: state.thread.id,
          now: "2026-05-20T10:05:00.000Z",
          previousStalenessMarkers: first.resolvedTarget.stalenessMarkers,
        });
      }),
    );

    expect(second.action).toBe("reused");
    expect(second.session.sessionId).toBe(first.session.sessionId);
    expect(second.stalenessReasons).toEqual(["code-diff-changed"]);
  });

  it("recreates the active session when checkout path changes", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fenrir-review-root-"));
    const worktreePathA = fs.mkdtempSync(path.join(os.tmpdir(), "fenrir-review-worktree-a-"));
    const worktreePathB = fs.mkdtempSync(path.join(os.tmpdir(), "fenrir-review-worktree-b-"));
    const state: TestState = {
      project: makeProject(workspaceRoot),
      thread: makeThread(worktreePathA, "feature/review"),
      gitStatusByCwd: new Map(),
      gitConfigByKey: new Map(),
      gitExecByKey: new Map(),
    };
    seedGitState(state, worktreePathA, {
      branch: "feature/review",
      headCommit: "head-a",
      baseCommit: "base-a",
    });
    seedGitState(state, worktreePathB, {
      branch: "feature/review",
      headCommit: "head-b",
      baseCommit: "base-b",
    });
    const layer = makeServiceLayer(state, SqlitePersistenceMemory);
    const runtime = buildRuntime(layer);

    const first: any = await runtime.runPromise(
      Effect.gen(function* () {
        const reviewSessionService = yield* ReviewSessionService;
        return yield* reviewSessionService.ensureActiveSession({
          threadId: state.thread.id,
          now: "2026-05-20T10:00:00.000Z",
        });
      }),
    );

    state.thread = {
      ...state.thread,
      worktreePath: worktreePathB,
      updatedAt: "2026-05-20T10:10:00.000Z",
    };

    const second: any = await runtime.runPromise(
      Effect.gen(function* () {
        const reviewSessionService = yield* ReviewSessionService;
        const repository = yield* ReviewSessionRepository;
        const result = yield* reviewSessionService.ensureActiveSession({
          threadId: state.thread.id,
          now: "2026-05-20T10:10:00.000Z",
        });
        const active = yield* repository.listByThreadId({ threadId: state.thread.id });
        const all = yield* repository.listByThreadId({
          threadId: state.thread.id,
          includeArchived: true,
        });
        return { result, active, all };
      }),
    );

    expect(second.result.action).toBe("recreated");
    expect(second.result.session.sessionId).not.toBe(first.session.sessionId);
    expect(second.result.archivedSessionIds).toEqual([first.session.sessionId]);
    expect(second.active.map((session: any) => session.sessionId)).toEqual([
      second.result.session.sessionId,
    ]);
    expect(
      second.all.find((session: any) => session.sessionId === first.session.sessionId)?.archivedAt,
    ).not.toBeNull();
  });

  it("recreates the active session when the attached PR changes", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fenrir-review-root-"));
    const worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), "fenrir-review-worktree-"));
    const state: TestState = {
      project: makeProject(workspaceRoot),
      thread: makeThread(worktreePath, "feature/pr-review"),
      gitStatusByCwd: new Map(),
      gitConfigByKey: new Map(),
      gitExecByKey: new Map(),
    };
    seedGitState(state, worktreePath, {
      branch: "feature/pr-review",
      headCommit: "head-pr-1",
      baseCommit: "base-pr-1",
      pullRequest: {
        number: 42,
        url: "https://github.com/fenrir/fenrir/pull/42",
        baseBranch: "main",
        headBranch: "feature/pr-review",
        title: "PR 42",
        state: "open",
      },
    });
    const layer = makeServiceLayer(state, SqlitePersistenceMemory);
    const runtime = buildRuntime(layer);

    const first: any = await runtime.runPromise(
      Effect.gen(function* () {
        const reviewSessionService = yield* ReviewSessionService;
        return yield* reviewSessionService.ensureActiveSession({
          threadId: state.thread.id,
          now: "2026-05-20T10:00:00.000Z",
        });
      }),
    );

    seedGitState(state, worktreePath, {
      branch: "feature/pr-review",
      headCommit: "head-pr-2",
      baseCommit: "base-pr-1",
      pullRequest: {
        number: 43,
        url: "https://github.com/fenrir/fenrir/pull/43",
        baseBranch: "main",
        headBranch: "feature/pr-review",
        title: "PR 43",
        state: "open",
      },
    });

    const second: any = await runtime.runPromise(
      Effect.gen(function* () {
        const reviewSessionService = yield* ReviewSessionService;
        return yield* reviewSessionService.ensureActiveSession({
          threadId: state.thread.id,
          now: "2026-05-20T10:10:00.000Z",
        });
      }),
    );

    expect(second.action).toBe("recreated");
    expect(second.session.sessionId).not.toBe(first.session.sessionId);
    expect(second.archivedSessionIds).toEqual([first.session.sessionId]);
    expect(second.session.pullRequestNumber).toBe(43);
  });

  it("preserves the active session across a harmless branch rename", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fenrir-review-root-"));
    const worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), "fenrir-review-worktree-"));
    const state: TestState = {
      project: makeProject(workspaceRoot),
      thread: makeThread(worktreePath, "feature/review-old"),
      gitStatusByCwd: new Map(),
      gitConfigByKey: new Map(),
      gitExecByKey: new Map(),
    };
    seedGitState(state, worktreePath, {
      branch: "feature/review-old",
      headCommit: "head-rename",
      baseCommit: "base-rename",
    });
    const layer = makeServiceLayer(state, SqlitePersistenceMemory);
    const runtime = buildRuntime(layer);

    const first: any = await runtime.runPromise(
      Effect.gen(function* () {
        const reviewSessionService = yield* ReviewSessionService;
        return yield* reviewSessionService.ensureActiveSession({
          threadId: state.thread.id,
          now: "2026-05-20T10:00:00.000Z",
        });
      }),
    );

    state.thread = {
      ...state.thread,
      branch: "feature/review-new",
      updatedAt: "2026-05-20T10:05:00.000Z",
    };
    seedGitState(state, worktreePath, {
      branch: "feature/review-new",
      headCommit: "head-rename",
      baseCommit: "base-rename",
    });

    const second: any = await runtime.runPromise(
      Effect.gen(function* () {
        const reviewSessionService = yield* ReviewSessionService;
        return yield* reviewSessionService.ensureActiveSession({
          threadId: state.thread.id,
          now: "2026-05-20T10:05:00.000Z",
        });
      }),
    );

    expect(second.action).toBe("reused");
    expect(second.session.sessionId).toBe(first.session.sessionId);
    expect(second.resolvedTarget.target.headRef).toBe("feature/review-new");
  });

  it("prefers a persisted pull request override over branch autodetection", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fenrir-review-root-"));
    const worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), "fenrir-review-worktree-"));
    const state: TestState = {
      project: makeProject(workspaceRoot),
      thread: makeThread(worktreePath, "feature/review"),
      gitStatusByCwd: new Map(),
      gitConfigByKey: new Map(),
      gitExecByKey: new Map(),
    };
    seedGitState(state, worktreePath, {
      branch: "feature/review",
      headCommit: "head-override-1",
      baseCommit: "base-override-1",
      pullRequest: {
        number: 42,
        url: "https://github.com/fenrir/fenrir/pull/42",
        baseBranch: "main",
        headBranch: "feature/review",
        title: "Autodetected PR",
        state: "open",
      },
    });
    const layer = makeServiceLayer(state, SqlitePersistenceMemory);
    const runtime = buildRuntime(layer);

    const first: any = await runtime.runPromise(
      Effect.gen(function* () {
        const reviewSessionService = yield* ReviewSessionService;
        return yield* reviewSessionService.ensureActiveSession({
          threadId: state.thread.id,
          now: "2026-05-20T10:00:00.000Z",
          pullRequestOverride: {
            provider: "github",
            number: 108,
            url: "https://github.com/fenrir/fenrir/pull/108",
          },
        });
      }),
    );

    expect(first.resolvedTarget.basis.pullRequestOverride).toEqual({
      provider: "github",
      number: 108,
      url: "https://github.com/fenrir/fenrir/pull/108",
    });
    expect(first.resolvedTarget.basis.detectedPullRequest?.number).toBe(42);
    expect(first.resolvedTarget.basis.attachedPullRequest?.number).toBe(108);

    const second: any = await runtime.runPromise(
      Effect.gen(function* () {
        const reviewSessionService = yield* ReviewSessionService;
        return yield* reviewSessionService.ensureActiveSession({
          threadId: state.thread.id,
          now: "2026-05-20T10:05:00.000Z",
        });
      }),
    );

    expect(second.action).toBe("reused");
    expect(second.session.pullRequestOverrideNumber).toBe(108);
    expect(second.session.pullRequestNumber).toBe(108);
    expect(second.resolvedTarget.basis.attachedPullRequest?.number).toBe(108);
  });

  it("deterministically reuses the same active session after reload", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fenrir-review-root-"));
    const worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), "fenrir-review-worktree-"));
    const state: TestState = {
      project: makeProject(workspaceRoot),
      thread: makeThread(worktreePath, "feature/reload"),
      gitStatusByCwd: new Map(),
      gitConfigByKey: new Map(),
      gitExecByKey: new Map(),
    };
    seedGitState(state, worktreePath, {
      branch: "feature/reload",
      headCommit: "head-reload",
      baseCommit: "base-reload",
    });
    const firstRuntime = buildRuntime(makeServiceLayer(state, SqlitePersistenceMemory));
    const firstRun: any = await firstRuntime.runPromise(
      Effect.gen(function* () {
        const reviewSessionService = yield* ReviewSessionService;
        const repository = yield* ReviewSessionRepository;
        const first = yield* reviewSessionService.ensureActiveSession({
          threadId: state.thread.id,
          now: "2026-05-20T10:00:00.000Z",
        });
        return { first, repository };
      }),
    );

    const projectionLayer = Layer.mock(ProjectionSnapshotQuery)({
      getBootstrapSnapshot: () => Effect.succeed(makeReadModel(state.project, state.thread)),
      getArchivedShellSnapshot: () => Effect.succeed(makeReadModel(state.project, state.thread)),
      getSnapshot: () => Effect.succeed(makeReadModel(state.project, state.thread)),
      getCounts: () => Effect.succeed({ projectCount: 1, threadCount: 1 }),
      getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
      getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
      getProjectShellById: () => Effect.succeed(Option.none()),
      getThreadShellById: () => Effect.succeed(Option.none()),
      getThreadSnapshot: (threadId) =>
        Effect.succeed(threadId === state.thread.id ? Option.some(state.thread) : Option.none()),
      getThreadCheckpointContext: () => Effect.succeed(Option.none()),
    });
    const sourceControlLayer = Layer.mock(SourceControl)({
      resolveWorkspace: () =>
        Effect.succeed({
          kind: "git",
          rootPath: state.project.workspaceRoot,
          metadataPath: path.join(state.project.workspaceRoot, ".git"),
          repositoryIdentity: null,
        }),
      isSupportedWorkspace: () => Effect.succeed(true),
      resolveRepositoryIdentity: () => Effect.succeed(null),
    });
    const gitManagerLayer = Layer.mock(GitManager)({
      status: ({ cwd }) => {
        const status = state.gitStatusByCwd.get(cwd);
        if (!status) {
          return Effect.die(new Error(`Missing git status mock for ${cwd}`));
        }
        return Effect.succeed({
          isRepo: true,
          hasOriginRemote: true,
          isDefaultBranch: false,
          branch: status.branch,
          hasWorkingTreeChanges: status.hasWorkingTreeChanges,
          workingTree: status.workingTree,
          hasUpstream: true,
          aheadCount: 0,
          behindCount: 0,
          pr: status.pr,
        });
      },
    });
    const gitCoreLayer = Layer.mock(GitCore)({
      readConfigValue: (cwd, key) =>
        Effect.succeed(state.gitConfigByKey.get(`${cwd}::${key}`) ?? null),
      execute: ({ cwd, args }) => {
        const result = state.gitExecByKey.get(gitExecKey(cwd, args)) ?? { code: 1, stdout: "" };
        return Effect.succeed({
          code: result.code,
          stdout: result.stdout,
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
        });
      },
    });
    const secondRuntime = buildRuntime(
      ReviewSessionServiceLive.pipe(
        Layer.provideMerge(Layer.succeed(ReviewSessionRepository, firstRun.repository)),
        Layer.provide(projectionLayer),
        Layer.provide(sourceControlLayer),
        Layer.provide(gitManagerLayer),
        Layer.provide(gitCoreLayer),
      ),
    );
    const second: any = await secondRuntime.runPromise(
      Effect.gen(function* () {
        const reviewSessionService = yield* ReviewSessionService;
        return yield* reviewSessionService.ensureActiveSession({
          threadId: state.thread.id,
          now: "2026-05-20T10:05:00.000Z",
        });
      }),
    );

    expect(second.action).toBe("reused");
    expect(second.session.sessionId).toBe(firstRun.first.session.sessionId);
  });
});
