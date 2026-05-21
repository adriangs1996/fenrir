import { Effect, Layer, Option } from "effect";

import { GitCore } from "../../git/Services/GitCore.ts";
import { GitManager } from "../../git/Services/GitManager.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ReviewSessionRepository } from "../../persistence/Services/ReviewSessions.ts";
import { SourceControl } from "../../sourceControl/Services/SourceControl.ts";
import {
  classifyReviewSessionStaleness,
  makeEnsureActiveSession,
  makeResolveTarget,
  ReviewSessionService,
  type ReviewSessionResolutionDependencies,
  type ReviewSessionServiceShape,
} from "../Services/ReviewSessionService.ts";

const makeReviewSessionService = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const reviewSessionRepository = yield* ReviewSessionRepository;
  const sourceControl = yield* SourceControl;
  const gitManager = yield* GitManager;
  const gitCore = yield* GitCore;

  const dependencies: ReviewSessionResolutionDependencies = {
    getThreadProjectContext: (threadId) =>
      Effect.gen(function* () {
        const threadOption = yield* projectionSnapshotQuery.getThreadSnapshot(threadId);
        if (Option.isNone(threadOption)) {
          return Option.none();
        }

        const snapshot = yield* projectionSnapshotQuery.getSnapshot();
        const project = snapshot.projects.find(
          (candidate) =>
            candidate.id === threadOption.value.projectId && candidate.deletedAt === null,
        );
        if (!project) {
          return Option.none();
        }

        return Option.some({
          projectId: threadOption.value.projectId,
          threadId: threadOption.value.id,
          workspaceRoot: project.workspaceRoot,
          worktreePath: threadOption.value.worktreePath,
          branch: threadOption.value.branch,
        });
      }),
    listSessionsByThreadId: (threadId) => reviewSessionRepository.listByThreadId({ threadId }),
    listAllSessionsByThreadId: (threadId) =>
      reviewSessionRepository.listByThreadId({ threadId, includeArchived: true }),
    upsertSession: (session) => reviewSessionRepository.upsert(session),
    archiveSession: (sessionId, archivedAt, updatedAt) =>
      reviewSessionRepository.archive({
        sessionId,
        archivedAt,
        updatedAt,
      }),
    resolveWorkspace: (cwd) =>
      sourceControl.resolveWorkspace(cwd).pipe(
        Effect.map((workspace) =>
          workspace
            ? {
                rootPath: workspace.rootPath,
                repositoryIdentity: workspace.repositoryIdentity,
              }
            : null,
        ),
      ),
    readGitStatus: (cwd) =>
      gitManager.status({ cwd }).pipe(
        Effect.map((status) => ({
          branch: status.branch,
          hasWorkingTreeChanges: status.hasWorkingTreeChanges,
          workingTree: status.workingTree,
          pr: status.pr,
        })),
      ),
    readGitConfigValue: (cwd, key) =>
      gitCore.readConfigValue(cwd, key).pipe(Effect.catch(() => Effect.succeed(null))),
    runGit: (cwd, args) =>
      gitCore
        .execute({
          operation: "ReviewSessionService.runGit",
          cwd,
          args,
          allowNonZeroExit: true,
        })
        .pipe(
          Effect.map((result) => ({
            code: result.code,
            stdout: result.stdout.trim(),
          })),
          Effect.catch(() => Effect.succeed({ code: 1, stdout: "" })),
        ),
  };

  const resolveTarget = makeResolveTarget(dependencies);
  const ensureActiveSession = makeEnsureActiveSession(dependencies, resolveTarget);

  return {
    resolveTarget,
    ensureActiveSession,
    classifyStaleness: classifyReviewSessionStaleness,
  } satisfies ReviewSessionServiceShape;
});

export const ReviewSessionServiceLive = Layer.effect(
  ReviewSessionService,
  makeReviewSessionService,
);
