import type {
  ReviewApplyRawMutationInput,
  ReviewApplyRawMutationResult,
  ReviewChunkId,
  ReviewRawLaneKind,
  ReviewRawMutationAction,
  ReviewRawMutationTargetKind,
  ReviewSessionId,
} from "@fenrir/contracts/sourceControlReview";
import { ReviewMutationConflictError, ReviewRpcError } from "@fenrir/contracts/sourceControlReview";
import { Data, Effect, Context } from "effect";

import type { GitCommandError, GitManagerServiceError } from "@fenrir/contracts";
import type { ProjectionRepositoryError } from "../../../persistence/Errors.ts";
import type { ReviewIgnoreRuleRecord } from "../../../persistence/Services/ReviewIgnoreRules.ts";
import type { ReviewSessionRecord } from "../../../persistence/Services/ReviewSessions.ts";
import type {
  LoadReviewFilePatchInput,
  LoadedReviewDiffFilePatchArtifact,
  ReviewDiffServiceErrorCause,
} from "./ReviewDiffService.ts";

export class ReviewMutationServiceError extends Data.TaggedError("ReviewMutationServiceError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type ReviewMutationServiceErrorCause =
  | ReviewMutationServiceError
  | ReviewRpcError
  | ReviewMutationConflictError
  | ProjectionRepositoryError
  | GitCommandError
  | ReviewDiffServiceErrorCause
  | GitManagerServiceError;

interface ExecutePatchArgs {
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
  readonly patch: string;
}

export interface ReviewMutationDependencies {
  readonly getSession: (
    sessionId: ReviewSessionId,
  ) => Effect.Effect<ReviewSessionRecord | null, ProjectionRepositoryError>;
  readonly loadFilePatchArtifact: (
    input: LoadReviewFilePatchInput,
  ) => Effect.Effect<LoadedReviewDiffFilePatchArtifact | null, ReviewMutationServiceErrorCause>;
  readonly executeGitPatch: (input: ExecutePatchArgs) => Effect.Effect<void, GitCommandError>;
  readonly refreshGitStatus: (cwd: string) => Effect.Effect<void, GitManagerServiceError>;
  readonly upsertIgnoreRule: (input: {
    readonly checkoutPath: string;
    readonly rulePath: string;
    readonly ruleKind: ReviewIgnoreRuleRecord["ruleKind"];
    readonly createdAt: string;
    readonly updatedAt: string;
  }) => Effect.Effect<ReviewIgnoreRuleRecord, ProjectionRepositoryError>;
  readonly deleteIgnoreRule: (input: {
    readonly checkoutPath: string;
    readonly normalizedPath: string;
    readonly ruleKind: ReviewIgnoreRuleRecord["ruleKind"];
  }) => Effect.Effect<void, ProjectionRepositoryError>;
}

export interface ReviewMutationServiceShape {
  readonly applyRawMutation: (
    input: ReviewApplyRawMutationInput,
  ) => Effect.Effect<ReviewApplyRawMutationResult, ReviewMutationServiceErrorCause>;
}

export class ReviewMutationService extends Context.Service<
  ReviewMutationService,
  ReviewMutationServiceShape
>()("t3/review/Services/ReviewMutationService") {}

function isSelectionTarget(
  target: ReviewApplyRawMutationInput["target"],
): target is Extract<
  ReviewApplyRawMutationInput["target"],
  { readonly targetKind: "file" | "chunk" }
> {
  return target.targetKind === "file" || target.targetKind === "chunk";
}

function assertAllowedSelectionMutation(
  input: ReviewApplyRawMutationInput,
): Effect.Effect<void, ReviewRpcError> {
  if (!isSelectionTarget(input.target)) {
    return Effect.fail(
      new ReviewRpcError({
        message: `Action ${input.action} requires an ignore rule target.`,
      }),
    );
  }

  const lane = input.target.lane;
  switch (input.action) {
    case "stage":
      return lane === "unstaged"
        ? Effect.void
        : Effect.fail(
            new ReviewRpcError({
              message: `Stage is only supported for unstaged selections. Received ${lane}.`,
            }),
          );
    case "unstage":
      return lane === "staged"
        ? Effect.void
        : Effect.fail(
            new ReviewRpcError({
              message: `Unstage is only supported for staged selections. Received ${lane}.`,
            }),
          );
    case "undo":
      return lane === "ignored"
        ? Effect.fail(
            new ReviewRpcError({
              message: "Undo is not supported for ignored selections.",
            }),
          )
        : Effect.void;
    case "ignore":
    case "unignore":
      return Effect.fail(
        new ReviewRpcError({
          message: `Action ${input.action} requires an ignore rule target.`,
        }),
      );
  }
}

function toRefreshNeeded(input: {
  readonly sessionId: ReviewSessionId;
  readonly action: ReviewRawMutationAction;
  readonly targetKind: ReviewRawMutationTargetKind;
  readonly message: string;
  readonly normalizedPath?: string;
  readonly lane?: ReviewRawLaneKind;
  readonly chunkId?: ReviewChunkId;
}) {
  return new ReviewMutationConflictError({
    reason: "refresh-needed",
    message: input.message,
    sessionId: input.sessionId,
    action: input.action,
    targetKind: input.targetKind,
    ...(input.normalizedPath ? { normalizedPath: input.normalizedPath } : {}),
    ...(input.lane ? { lane: input.lane } : {}),
    ...(input.chunkId ? { chunkId: input.chunkId } : {}),
  });
}

function selectionPatchInput(
  session: ReviewSessionRecord,
  target: Extract<ReviewApplyRawMutationInput["target"], { readonly targetKind: "file" | "chunk" }>,
): LoadReviewFilePatchInput {
  return {
    sessionId: session.sessionId,
    scope: target.lane === "committed" ? "branch" : "combined",
    lane: target.lane,
    normalizedPath: target.normalizedPath,
    target: session.target,
  };
}

function transitionForSelection(input: {
  readonly action: ReviewRawMutationAction;
  readonly lane: ReviewRawLaneKind;
  readonly normalizedPath: string;
}) {
  switch (input.action) {
    case "stage":
      return [
        {
          normalizedPath: input.normalizedPath,
          fromLane: "unstaged" as const,
          toLane: "staged" as const,
        },
      ];
    case "unstage":
      return [
        {
          normalizedPath: input.normalizedPath,
          fromLane: "staged" as const,
          toLane: "unstaged" as const,
        },
      ];
    case "undo":
      if (input.lane === "committed") {
        return [
          {
            normalizedPath: input.normalizedPath,
            fromLane: "committed" as const,
            toLane: "inverse-edit" as const,
          },
        ];
      }
      return [{ normalizedPath: input.normalizedPath, fromLane: input.lane }];
    case "ignore":
    case "unignore":
      return [];
  }
}

function confirmationForSelection(input: {
  readonly action: ReviewRawMutationAction;
  readonly targetKind: ReviewRawMutationTargetKind;
  readonly normalizedPath: string;
}) {
  const noun = input.targetKind === "chunk" ? "Chunk" : "File";
  switch (input.action) {
    case "stage":
      return `${noun} staged: ${input.normalizedPath}`;
    case "unstage":
      return `${noun} unstaged: ${input.normalizedPath}`;
    case "undo":
      return `${noun} undone: ${input.normalizedPath}`;
    case "ignore":
      return `Ignored: ${input.normalizedPath}`;
    case "unignore":
      return `Unignored: ${input.normalizedPath}`;
  }
}

function confirmationForIgnoreAction(action: "ignore" | "unignore", normalizedPath: string) {
  return action === "ignore" ? `Ignored: ${normalizedPath}` : `Unignored: ${normalizedPath}`;
}

export function makeReviewMutationService(
  deps: ReviewMutationDependencies,
): ReviewMutationServiceShape {
  const applySelectionMutation = (
    session: ReviewSessionRecord,
    input: ReviewApplyRawMutationInput,
  ): Effect.Effect<ReviewApplyRawMutationResult, ReviewMutationServiceErrorCause> =>
    Effect.gen(function* () {
      yield* assertAllowedSelectionMutation(input);
      const target = input.target;
      if (!isSelectionTarget(target)) {
        return yield* new ReviewRpcError({
          message: `Action ${input.action} requires a file or chunk selection.`,
        });
      }

      const artifact = yield* deps.loadFilePatchArtifact(selectionPatchInput(session, target));
      if (!artifact) {
        return yield* toRefreshNeeded({
          sessionId: input.sessionId,
          action: input.action,
          targetKind: target.targetKind,
          normalizedPath: target.normalizedPath,
          lane: target.lane,
          ...(target.targetKind === "chunk" ? { chunkId: target.chunkId } : {}),
          message:
            "The selected review item is out of date. Refresh the review diff and try again.",
        });
      }

      const patch =
        target.targetKind === "chunk"
          ? (artifact.chunkArtifacts.find((candidate) => candidate.chunkId === target.chunkId)
              ?.rawPatch ?? null)
          : artifact.rawPatch;

      if (!patch || patch.length === 0) {
        return yield* toRefreshNeeded({
          sessionId: input.sessionId,
          action: input.action,
          targetKind: target.targetKind,
          normalizedPath: target.normalizedPath,
          lane: target.lane,
          ...(target.targetKind === "chunk" ? { chunkId: target.chunkId } : {}),
          message:
            "The selected review item no longer matches the current diff. Refresh and try again.",
        });
      }

      const checkArgs =
        input.action === "stage"
          ? ["apply", "--cached", "--check", "-"]
          : input.action === "unstage"
            ? ["apply", "--cached", "--reverse", "--check", "-"]
            : ["apply", "--reverse", "--check", "-"];
      const applyArgs =
        input.action === "stage"
          ? ["apply", "--cached", "-"]
          : input.action === "unstage"
            ? ["apply", "--cached", "--reverse", "-"]
            : ["apply", "--reverse", "-"];

      if (input.action === "undo" && target.lane === "staged") {
        yield* deps
          .executeGitPatch({
            cwd: session.target.cwd,
            args: ["apply", "--cached", "--reverse", "--check", "-"],
            patch,
          })
          .pipe(
            Effect.mapError(() =>
              toRefreshNeeded({
                sessionId: input.sessionId,
                action: input.action,
                targetKind: target.targetKind,
                normalizedPath: target.normalizedPath,
                lane: target.lane,
                ...(target.targetKind === "chunk" ? { chunkId: target.chunkId } : {}),
                message: "The staged selection is stale and can no longer be undone cleanly.",
              }),
            ),
          );
        yield* deps
          .executeGitPatch({
            cwd: session.target.cwd,
            args: ["apply", "--reverse", "--check", "-"],
            patch,
          })
          .pipe(
            Effect.mapError(() =>
              toRefreshNeeded({
                sessionId: input.sessionId,
                action: input.action,
                targetKind: target.targetKind,
                normalizedPath: target.normalizedPath,
                lane: target.lane,
                ...(target.targetKind === "chunk" ? { chunkId: target.chunkId } : {}),
                message:
                  "The working tree no longer matches the staged selection. Refresh and try again.",
              }),
            ),
          );

        yield* deps.executeGitPatch({
          cwd: session.target.cwd,
          args: ["apply", "--cached", "--reverse", "-"],
          patch,
        });
        const worktreeApply = deps.executeGitPatch({
          cwd: session.target.cwd,
          args: ["apply", "--reverse", "-"],
          patch,
        });
        yield* worktreeApply.pipe(
          Effect.catch((error) =>
            deps
              .executeGitPatch({
                cwd: session.target.cwd,
                args: ["apply", "--cached", "-"],
                patch,
              })
              .pipe(
                Effect.catch(() => Effect.void),
                Effect.flatMap(() =>
                  Effect.fail(
                    new ReviewMutationServiceError({
                      operation: "ReviewMutationService.undoStaged.rollback",
                      message:
                        "Failed to restore the staged selection after a worktree apply error.",
                      cause: error,
                    }),
                  ),
                ),
              ),
          ),
        );
      } else {
        yield* deps
          .executeGitPatch({
            cwd: session.target.cwd,
            args: checkArgs,
            patch,
          })
          .pipe(
            Effect.mapError(() =>
              toRefreshNeeded({
                sessionId: input.sessionId,
                action: input.action,
                targetKind: target.targetKind,
                normalizedPath: target.normalizedPath,
                lane: target.lane,
                ...(target.targetKind === "chunk" ? { chunkId: target.chunkId } : {}),
                message:
                  "The selected diff no longer applies cleanly. Refresh the review tab and try again.",
              }),
            ),
          );
        yield* deps.executeGitPatch({
          cwd: session.target.cwd,
          args: applyArgs,
          patch,
        });
      }

      yield* deps.refreshGitStatus(session.target.cwd);
      return {
        sessionId: input.sessionId,
        action: input.action,
        targetKind: target.targetKind,
        confirmation: confirmationForSelection({
          action: input.action,
          targetKind: target.targetKind,
          normalizedPath: target.normalizedPath,
        }),
        selectionStatus: "applied",
        changedPaths: [target.normalizedPath],
        laneTransitions: transitionForSelection({
          action: input.action,
          lane: target.lane,
          normalizedPath: target.normalizedPath,
        }),
        generatedInverseEdit: input.action === "undo" && target.lane === "committed",
        refreshRequired: true,
      } satisfies ReviewApplyRawMutationResult;
    });

  const applyIgnoreMutation: ReviewMutationServiceShape["applyRawMutation"] = (input) =>
    Effect.gen(function* () {
      const session = yield* deps.getSession(input.sessionId).pipe(
        Effect.flatMap((record) =>
          record
            ? Effect.succeed(record)
            : Effect.fail(
                new ReviewRpcError({
                  message: `Review session not found: ${input.sessionId}`,
                }),
              ),
        ),
      );

      if (input.action === "ignore" || input.action === "unignore") {
        if (input.target.targetKind !== "ignore-rule") {
          return yield* new ReviewRpcError({
            message: `Action ${input.action} requires an ignore rule target.`,
          });
        }
        const now = new Date().toISOString();
        if (input.action === "ignore") {
          yield* deps.upsertIgnoreRule({
            checkoutPath: session.checkoutPath,
            rulePath: input.target.normalizedPath,
            ruleKind: input.target.ruleKind,
            createdAt: now,
            updatedAt: now,
          });
        } else {
          yield* deps.deleteIgnoreRule({
            checkoutPath: session.checkoutPath,
            normalizedPath: input.target.normalizedPath,
            ruleKind: input.target.ruleKind,
          });
        }

        return {
          sessionId: input.sessionId,
          action: input.action,
          targetKind: "ignore-rule",
          confirmation: confirmationForIgnoreAction(input.action, input.target.normalizedPath),
          selectionStatus: "applied",
          changedPaths: [input.target.normalizedPath],
          laneTransitions:
            input.action === "ignore"
              ? [
                  {
                    normalizedPath: input.target.normalizedPath,
                    toLane: "ignored",
                  },
                ]
              : [
                  {
                    normalizedPath: input.target.normalizedPath,
                    fromLane: "ignored",
                  },
                ],
          generatedInverseEdit: false,
          refreshRequired: true,
        } satisfies ReviewApplyRawMutationResult;
      }

      return yield* applySelectionMutation(session, input);
    });

  return {
    applyRawMutation: applyIgnoreMutation,
  };
}
