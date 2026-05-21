import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";

import type { GitManagerServiceError } from "@fenrir/contracts";
import { ProjectId, ThreadId, TrimmedNonEmptyString } from "@fenrir/contracts";
import { Data, Effect, Option, ServiceMap } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";
import type { ReviewSessionRecord } from "../../persistence/Services/ReviewSessions.ts";
import {
  ReviewScope,
  ReviewSessionId,
  ReviewTabMode,
  type ReviewSessionTarget,
} from "../../../../../packages/contracts/src/review.ts";

export type ReviewSessionLifecycleAction = "created" | "reused" | "recreated";

export type ReviewSessionStalenessReason =
  | "code-diff-changed"
  | "pull-request-description-changed"
  | "github-discussion-changed";

export interface ReviewSessionStalenessMarkers {
  readonly codeDiffFingerprint: string | null;
  readonly pullRequestDescriptionFingerprint: string | null;
  readonly githubDiscussionFingerprint: string | null;
}

export interface ReviewSessionLifecycleBasis {
  readonly baseBranchOverride: string | null;
  readonly autoBaseRef: string | null;
  readonly effectiveBaseRef: string | null;
  readonly pullRequestOverride: {
    readonly provider: "github";
    readonly number: number;
    readonly url: string;
  } | null;
  readonly detectedPullRequest: {
    readonly provider: "github";
    readonly number: number;
    readonly url: string;
    readonly baseRef: string;
    readonly headRef: string;
  } | null;
  readonly attachedPullRequest: {
    readonly provider: "github";
    readonly number: number;
    readonly url: string;
    readonly baseRef: string;
    readonly headRef: string;
  } | null;
}

export interface ResolvedReviewSessionTarget {
  readonly checkoutPath: string;
  readonly target: ReviewSessionTarget;
  readonly basis: ReviewSessionLifecycleBasis;
  readonly stalenessMarkers: ReviewSessionStalenessMarkers;
}

export interface EnsureActiveReviewSessionInput {
  readonly threadId: ThreadId;
  readonly baseBranchOverride?: string | null;
  readonly pullRequestOverride?: {
    readonly provider: "github";
    readonly number: number;
    readonly url: string;
  } | null;
  readonly pullRequestDescriptionFingerprint?: string | null;
  readonly githubDiscussionFingerprint?: string | null;
  readonly previousStalenessMarkers?: ReviewSessionStalenessMarkers | null;
  readonly mode?: ReviewTabMode;
  readonly scope?: ReviewScope;
  readonly now?: string;
}

export interface EnsureActiveReviewSessionResult {
  readonly action: ReviewSessionLifecycleAction;
  readonly session: ReviewSessionRecord;
  readonly archivedSessionIds: ReadonlyArray<ReviewSessionId>;
  readonly resolvedTarget: ResolvedReviewSessionTarget;
  readonly stalenessReasons: ReadonlyArray<ReviewSessionStalenessReason>;
}

export class ReviewSessionServiceError extends Data.TaggedError("ReviewSessionServiceError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type ReviewSessionServiceErrorCause =
  | ReviewSessionServiceError
  | ProjectionRepositoryError
  | GitManagerServiceError;

export interface ReviewSessionServiceShape {
  readonly ensureActiveSession: (
    input: EnsureActiveReviewSessionInput,
  ) => Effect.Effect<EnsureActiveReviewSessionResult, ReviewSessionServiceErrorCause>;
  readonly resolveTarget: (
    input: Omit<EnsureActiveReviewSessionInput, "previousStalenessMarkers">,
  ) => Effect.Effect<ResolvedReviewSessionTarget, ReviewSessionServiceErrorCause>;
  readonly classifyStaleness: (
    previous: ReviewSessionStalenessMarkers | null,
    current: ReviewSessionStalenessMarkers,
  ) => ReadonlyArray<ReviewSessionStalenessReason>;
}

export class ReviewSessionService extends ServiceMap.Service<
  ReviewSessionService,
  ReviewSessionServiceShape
>()("t3/review/Services/ReviewSessionService") {}

export interface ThreadProjectContext {
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
  readonly branch: string | null;
}

export interface ReviewSessionResolutionDependencies {
  readonly getThreadProjectContext: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<ThreadProjectContext>, ProjectionRepositoryError>;
  readonly listSessionsByThreadId: (
    threadId: ThreadId,
  ) => Effect.Effect<ReadonlyArray<ReviewSessionRecord>, ProjectionRepositoryError>;
  readonly listAllSessionsByThreadId: (
    threadId: ThreadId,
  ) => Effect.Effect<ReadonlyArray<ReviewSessionRecord>, ProjectionRepositoryError>;
  readonly upsertSession: (
    session: ReviewSessionRecord,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly archiveSession: (
    sessionId: ReviewSessionId,
    archivedAt: string,
    updatedAt: string,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly resolveWorkspace: (cwd: string) => Effect.Effect<{
    readonly rootPath: string;
    readonly repositoryIdentity: {
      readonly canonicalKey: string;
    } | null;
  } | null>;
  readonly readGitStatus: (cwd: string) => Effect.Effect<
    {
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
      readonly pr: {
        readonly number: number;
        readonly url: string;
        readonly baseBranch: string;
        readonly headBranch: string;
      } | null;
    },
    GitManagerServiceError
  >;
  readonly readGitConfigValue: (cwd: string, key: string) => Effect.Effect<string | null>;
  readonly runGit: (
    cwd: string,
    args: ReadonlyArray<string>,
  ) => Effect.Effect<{
    readonly code: number;
    readonly stdout: string;
  }>;
}

const DEFAULT_BASE_BRANCH_CANDIDATES = ["main", "master", "trunk", "develop"] as const;

const trimNullable = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

function canonicalizePath(value: string): string {
  const trimmed = value.trim();
  try {
    return realpathSync.native(trimmed);
  } catch {
    return path.resolve(trimmed);
  }
}

function inferRepositoryName(
  repositoryRoot: string,
  canonicalKey: string | null | undefined,
): string | undefined {
  const fromIdentity = canonicalKey?.split("/").at(-1)?.trim() ?? "";
  if (fromIdentity.length > 0) {
    return fromIdentity;
  }
  const fromPath = path.basename(repositoryRoot).trim();
  return fromPath.length > 0 ? fromPath : undefined;
}

function hashFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeBaseBranchOverride(value: string | null | undefined): string | null {
  const trimmed = trimNullable(value);
  return trimmed === null ? null : TrimmedNonEmptyString.makeUnsafe(trimmed);
}

function pullRequestIdentityFromSession(
  session: Pick<
    ReviewSessionRecord,
    "pullRequestProvider" | "pullRequestNumber" | "pullRequestUrl"
  >,
): string | null {
  if (
    session.pullRequestProvider === null ||
    session.pullRequestNumber === null ||
    session.pullRequestUrl === null
  ) {
    return null;
  }
  return `${session.pullRequestProvider}:${session.pullRequestNumber}:${session.pullRequestUrl}`;
}

function pullRequestOverrideFromSession(
  session: Pick<
    ReviewSessionRecord,
    "pullRequestOverrideProvider" | "pullRequestOverrideNumber" | "pullRequestOverrideUrl"
  >,
): ReviewSessionLifecycleBasis["pullRequestOverride"] {
  if (
    session.pullRequestOverrideProvider !== "github" ||
    session.pullRequestOverrideProvider === null ||
    session.pullRequestOverrideNumber === null ||
    session.pullRequestOverrideUrl === null
  ) {
    return null;
  }
  return {
    provider: session.pullRequestOverrideProvider,
    number: session.pullRequestOverrideNumber,
    url: session.pullRequestOverrideUrl,
  };
}

function pullRequestIdentityFromTarget(target: ResolvedReviewSessionTarget): string | null {
  const pullRequest = target.basis.attachedPullRequest;
  if (!pullRequest) {
    return null;
  }
  return `${pullRequest.provider}:${pullRequest.number}:${pullRequest.url}`;
}

function buildSelectionLabel(
  attachedPullRequest: ReviewSessionLifecycleBasis["attachedPullRequest"],
  headRef: string | null,
  repositoryName: string | undefined,
): string | undefined {
  if (attachedPullRequest) {
    return `PR #${attachedPullRequest.number}`;
  }
  if (headRef) {
    return `Branch ${headRef}`;
  }
  return repositoryName;
}

function branchExistsWithRefs(
  deps: ReviewSessionResolutionDependencies,
  cwd: string,
  refs: ReadonlyArray<string>,
) {
  return Effect.gen(function* () {
    for (const ref of refs) {
      const result = yield* deps.runGit(cwd, ["rev-parse", "--verify", "--quiet", ref]);
      if (result.code === 0) {
        return true;
      }
    }
    return false;
  });
}

export function classifyReviewSessionStaleness(
  previous: ReviewSessionStalenessMarkers | null,
  current: ReviewSessionStalenessMarkers,
): ReadonlyArray<ReviewSessionStalenessReason> {
  if (!previous) {
    return [];
  }

  const reasons: ReviewSessionStalenessReason[] = [];
  if (
    previous.codeDiffFingerprint !== null &&
    current.codeDiffFingerprint !== null &&
    previous.codeDiffFingerprint !== current.codeDiffFingerprint
  ) {
    reasons.push("code-diff-changed");
  }
  if (
    previous.pullRequestDescriptionFingerprint !== null &&
    current.pullRequestDescriptionFingerprint !== null &&
    previous.pullRequestDescriptionFingerprint !== current.pullRequestDescriptionFingerprint
  ) {
    reasons.push("pull-request-description-changed");
  }
  if (
    previous.githubDiscussionFingerprint !== null &&
    current.githubDiscussionFingerprint !== null &&
    previous.githubDiscussionFingerprint !== current.githubDiscussionFingerprint
  ) {
    reasons.push("github-discussion-changed");
  }
  return reasons;
}

export const makeResolveTarget =
  (deps: ReviewSessionResolutionDependencies): ReviewSessionServiceShape["resolveTarget"] =>
  (input) =>
    Effect.gen(function* () {
      const threadContextOption = yield* deps.getThreadProjectContext(input.threadId);
      if (Option.isNone(threadContextOption)) {
        return yield* new ReviewSessionServiceError({
          operation: "ReviewSessionService.resolveTarget",
          message: `Thread ${input.threadId} was not found in the orchestration projection.`,
        });
      }

      const threadContext = threadContextOption.value;
      const checkoutPath = canonicalizePath(
        threadContext.worktreePath ?? threadContext.workspaceRoot,
      );
      const sessions = yield* deps.listAllSessionsByThreadId(input.threadId);
      const inheritedBaseOverride =
        normalizeBaseBranchOverride(input.baseBranchOverride) ??
        sessions.find((session) => session.baseBranchOverride !== null)?.baseBranchOverride ??
        null;
      const inheritedPullRequestOverride =
        input.pullRequestOverride ??
        sessions.flatMap((session) => {
          const override = pullRequestOverrideFromSession(session);
          return override ? [override] : [];
        })[0] ??
        null;
      const sameCheckoutActiveSession =
        sessions.find(
          (session) => session.archivedAt === null && session.checkoutPath === checkoutPath,
        ) ?? null;

      const workspace = yield* deps.resolveWorkspace(checkoutPath);
      if (!workspace) {
        return yield* new ReviewSessionServiceError({
          operation: "ReviewSessionService.resolveTarget",
          message: `Checkout path ${checkoutPath} is not inside a supported repository.`,
        });
      }

      const gitStatus = yield* deps.readGitStatus(checkoutPath);
      const detectedPullRequest =
        gitStatus.pr ??
        (sameCheckoutActiveSession !== null &&
        sameCheckoutActiveSession.pullRequestNumber !== null &&
        sameCheckoutActiveSession.pullRequestUrl !== null &&
        sameCheckoutActiveSession.target.baseRef &&
        sameCheckoutActiveSession.target.headRef
          ? {
              number: sameCheckoutActiveSession.pullRequestNumber,
              url: sameCheckoutActiveSession.pullRequestUrl,
              baseBranch: sameCheckoutActiveSession.target.baseRef,
              headBranch: sameCheckoutActiveSession.target.headRef,
            }
          : null);
      const fallbackPullRequest =
        inheritedPullRequestOverride === null
          ? detectedPullRequest
          : detectedPullRequest &&
              detectedPullRequest.number === inheritedPullRequestOverride.number &&
              detectedPullRequest.url === inheritedPullRequestOverride.url
            ? detectedPullRequest
            : {
                number: inheritedPullRequestOverride.number,
                url: inheritedPullRequestOverride.url,
                baseBranch:
                  sameCheckoutActiveSession?.target.baseRef ??
                  detectedPullRequest?.baseBranch ??
                  trimNullable(
                    yield* deps.readGitConfigValue(
                      checkoutPath,
                      gitStatus.branch ? `branch.${gitStatus.branch}.gh-merge-base` : "",
                    ),
                  ) ??
                  "main",
                headBranch:
                  sameCheckoutActiveSession?.target.headRef ??
                  trimNullable(gitStatus.branch) ??
                  trimNullable(threadContext.branch) ??
                  "HEAD",
              };

      const remoteName =
        (gitStatus.branch
          ? trimNullable(
              yield* deps.readGitConfigValue(checkoutPath, `branch.${gitStatus.branch}.remote`),
            )
          : null) ?? "origin";
      const configuredBaseBranch =
        gitStatus.branch === null
          ? null
          : trimNullable(
              yield* deps.readGitConfigValue(
                checkoutPath,
                `branch.${gitStatus.branch}.gh-merge-base`,
              ),
            );

      let autoBaseRef = fallbackPullRequest?.baseBranch ?? configuredBaseBranch ?? null;
      if (!autoBaseRef) {
        const remoteHead = yield* deps.runGit(checkoutPath, [
          "symbolic-ref",
          `refs/remotes/${remoteName}/HEAD`,
        ]);
        if (remoteHead.code === 0) {
          const normalizedRemoteHead = trimNullable(remoteHead.stdout);
          const branch =
            normalizedRemoteHead === null
              ? null
              : trimNullable(normalizedRemoteHead.split("/").slice(3).join("/"));
          if (branch && branch !== gitStatus.branch) {
            autoBaseRef = branch;
          }
        }
      }

      if (!autoBaseRef && gitStatus.branch !== null) {
        for (const candidate of DEFAULT_BASE_BRANCH_CANDIDATES) {
          if (candidate === gitStatus.branch) {
            continue;
          }
          const exists = yield* branchExistsWithRefs(deps, checkoutPath, [
            `refs/heads/${candidate}`,
            `refs/remotes/${remoteName}/${candidate}`,
            `refs/remotes/origin/${candidate}`,
          ]);
          if (exists) {
            autoBaseRef = candidate;
            break;
          }
        }
      }

      const effectiveBaseRef =
        fallbackPullRequest?.baseBranch ?? inheritedBaseOverride ?? autoBaseRef;
      const headRef =
        trimNullable(fallbackPullRequest?.headBranch) ??
        trimNullable(gitStatus.branch) ??
        trimNullable(threadContext.branch);
      const headCommit = yield* deps.runGit(checkoutPath, ["rev-parse", "HEAD"]);
      const baseCommit =
        effectiveBaseRef === null
          ? null
          : yield* deps.runGit(checkoutPath, ["rev-parse", effectiveBaseRef]);

      const repositoryRoot = canonicalizePath(workspace.rootPath);
      const repositoryName = inferRepositoryName(
        repositoryRoot,
        workspace.repositoryIdentity?.canonicalKey,
      );
      const attachedPullRequest = fallbackPullRequest
        ? {
            provider: "github" as const,
            number: fallbackPullRequest.number,
            url: fallbackPullRequest.url,
            baseRef: fallbackPullRequest.baseBranch,
            headRef: fallbackPullRequest.headBranch,
          }
        : null;

      const selectionLabel = buildSelectionLabel(attachedPullRequest, headRef, repositoryName);
      const baseCommitOid =
        baseCommit && baseCommit.code === 0 ? trimNullable(baseCommit.stdout) : null;
      const headCommitOid = headCommit.code === 0 ? trimNullable(headCommit.stdout) : null;

      const target: ReviewSessionTarget = {
        projectId: threadContext.projectId,
        threadId: threadContext.threadId,
        cwd: checkoutPath,
        repositoryRoot,
        ...(repositoryName ? { repositoryName } : {}),
        worktreePath: threadContext.worktreePath
          ? canonicalizePath(threadContext.worktreePath)
          : null,
        ...(selectionLabel ? { selectionLabel } : {}),
        ...(effectiveBaseRef ? { baseRef: effectiveBaseRef } : {}),
        ...(headRef ? { headRef } : {}),
        ...(baseCommitOid ? { baseCommitOid } : {}),
        ...(headCommitOid ? { headCommitOid } : {}),
        ...(attachedPullRequest ? { pullRequestNumber: attachedPullRequest.number } : {}),
        ...(attachedPullRequest ? { pullRequestUrl: attachedPullRequest.url } : {}),
      };

      const stalenessMarkers: ReviewSessionStalenessMarkers = {
        codeDiffFingerprint: hashFingerprint({
          baseRef: target.baseRef ?? null,
          baseCommitOid: target.baseCommitOid ?? null,
          headCommitOid: target.headCommitOid ?? null,
          hasWorkingTreeChanges: gitStatus.hasWorkingTreeChanges,
          workingTree: gitStatus.workingTree.files
            .map((file) => ({
              path: file.path,
              insertions: file.insertions,
              deletions: file.deletions,
            }))
            .toSorted((left, right) => left.path.localeCompare(right.path)),
        }),
        pullRequestDescriptionFingerprint: trimNullable(input.pullRequestDescriptionFingerprint),
        githubDiscussionFingerprint: trimNullable(input.githubDiscussionFingerprint),
      };

      return {
        checkoutPath,
        target,
        basis: {
          baseBranchOverride: inheritedBaseOverride,
          autoBaseRef,
          effectiveBaseRef,
          pullRequestOverride: inheritedPullRequestOverride,
          detectedPullRequest: detectedPullRequest
            ? {
                provider: "github",
                number: detectedPullRequest.number,
                url: detectedPullRequest.url,
                baseRef: detectedPullRequest.baseBranch,
                headRef: detectedPullRequest.headBranch,
              }
            : null,
          attachedPullRequest,
        },
        stalenessMarkers,
      } satisfies ResolvedReviewSessionTarget;
    });

export const makeEnsureActiveSession =
  (
    deps: ReviewSessionResolutionDependencies,
    resolveTarget: ReviewSessionServiceShape["resolveTarget"],
  ): ReviewSessionServiceShape["ensureActiveSession"] =>
  (input) =>
    Effect.gen(function* () {
      const now = input.now ?? new Date().toISOString();
      const resolvedTarget = yield* resolveTarget(input);
      const activeSessions = yield* deps.listSessionsByThreadId(input.threadId);

      const reusableSession =
        activeSessions.find(
          (session) =>
            session.checkoutPath === resolvedTarget.checkoutPath &&
            pullRequestIdentityFromSession(session) ===
              pullRequestIdentityFromTarget(resolvedTarget),
        ) ?? null;

      const nextSession: ReviewSessionRecord = reusableSession
        ? {
            ...reusableSession,
            projectId: resolvedTarget.target.projectId ?? null,
            checkoutPath: resolvedTarget.checkoutPath,
            mode: input.mode ?? reusableSession.mode,
            scope: input.scope ?? reusableSession.scope,
            target: resolvedTarget.target,
            pullRequestOverrideProvider: resolvedTarget.basis.pullRequestOverride?.provider ?? null,
            pullRequestOverrideNumber: resolvedTarget.basis.pullRequestOverride?.number ?? null,
            pullRequestOverrideUrl: resolvedTarget.basis.pullRequestOverride?.url ?? null,
            pullRequestProvider: resolvedTarget.basis.attachedPullRequest ? "github" : null,
            pullRequestNumber: resolvedTarget.basis.attachedPullRequest?.number ?? null,
            pullRequestUrl: resolvedTarget.basis.attachedPullRequest?.url ?? null,
            baseBranchOverride: resolvedTarget.basis.baseBranchOverride,
            updatedAt: now,
            lastActivatedAt: now,
            archivedAt: null,
          }
        : {
            sessionId: ReviewSessionId.makeUnsafe(`review-session-${randomUUID()}`),
            threadId: input.threadId,
            projectId: resolvedTarget.target.projectId ?? null,
            checkoutPath: resolvedTarget.checkoutPath,
            mode: input.mode ?? "review",
            scope: input.scope ?? "combined",
            target: resolvedTarget.target,
            pullRequestOverrideProvider: resolvedTarget.basis.pullRequestOverride?.provider ?? null,
            pullRequestOverrideNumber: resolvedTarget.basis.pullRequestOverride?.number ?? null,
            pullRequestOverrideUrl: resolvedTarget.basis.pullRequestOverride?.url ?? null,
            pullRequestProvider: resolvedTarget.basis.attachedPullRequest ? "github" : null,
            pullRequestNumber: resolvedTarget.basis.attachedPullRequest?.number ?? null,
            pullRequestUrl: resolvedTarget.basis.attachedPullRequest?.url ?? null,
            baseBranchOverride: resolvedTarget.basis.baseBranchOverride,
            createdAt: now,
            updatedAt: now,
            lastActivatedAt: now,
            archivedAt: null,
          };

      const sessionsToArchive = activeSessions.filter(
        (session) =>
          session.sessionId !== nextSession.sessionId &&
          (session.checkoutPath !== resolvedTarget.checkoutPath ||
            pullRequestIdentityFromSession(session) !==
              pullRequestIdentityFromTarget(resolvedTarget)),
      );

      for (const session of sessionsToArchive) {
        yield* deps.archiveSession(session.sessionId, now, now);
      }
      yield* deps.upsertSession(nextSession);

      return {
        action: reusableSession ? "reused" : activeSessions.length === 0 ? "created" : "recreated",
        session: nextSession,
        archivedSessionIds: sessionsToArchive.map((session) => session.sessionId),
        resolvedTarget,
        stalenessReasons: classifyReviewSessionStaleness(
          input.previousStalenessMarkers ?? null,
          resolvedTarget.stalenessMarkers,
        ),
      } satisfies EnsureActiveReviewSessionResult;
    });
