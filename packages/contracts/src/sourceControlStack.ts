import { Schema } from "effect";

import {
  IsoDateTime,
  NonNegativeInt,
  ThreadId,
  TrimmedNonEmptyString,
  makeEntityId,
} from "./baseSchemas";
import { ChangeRequest, SourceControlProviderInfo } from "./sourceControl";

export const SourceControlStackEntryId = makeEntityId("SourceControlStackEntryId");
export type SourceControlStackEntryId = typeof SourceControlStackEntryId.Type;

export const SourceControlStackOperationId = makeEntityId("SourceControlStackOperationId");
export type SourceControlStackOperationId = typeof SourceControlStackOperationId.Type;

export const SourceControlStackEntryPublication = Schema.Literals([
  "draft-local",
  "published",
  "orphaned-provider",
  "stale-local",
]);
export type SourceControlStackEntryPublication = typeof SourceControlStackEntryPublication.Type;

export const SourceControlStackProblem = Schema.Literals([
  "not-a-repository",
  "provider-unavailable",
  "provider-auth-required",
  "ambiguous-provider-chain",
  "cycle-detected",
  "missing-parent-branch",
  "missing-local-branch",
  "dirty-worktree-blocking",
  "rebase-conflict",
  "provider-retarget-unsupported",
]);
export type SourceControlStackProblem = typeof SourceControlStackProblem.Type;

export const SourceControlStackCapability = Schema.Literals([
  "create-entry",
  "switch-entry",
  "rename-entry",
  "drop-entry",
  "reorder",
  "restack",
  "sync",
  "squash",
  "split-commits",
  "push",
  "publish",
  "update-change-requests",
  "close-change-requests",
]);
export type SourceControlStackCapability = typeof SourceControlStackCapability.Type;

export const SourceControlStackCommit = Schema.Struct({
  oid: TrimmedNonEmptyString,
  subject: TrimmedNonEmptyString,
  authoredAt: Schema.optionalKey(IsoDateTime),
});
export type SourceControlStackCommit = typeof SourceControlStackCommit.Type;

export const SourceControlStackEntry = Schema.Struct({
  id: SourceControlStackEntryId,
  index: NonNegativeInt,
  title: TrimmedNonEmptyString,
  description: Schema.optionalKey(TrimmedNonEmptyString),
  branchName: TrimmedNonEmptyString,
  headRefName: TrimmedNonEmptyString,
  baseRefName: TrimmedNonEmptyString,
  parentEntryId: Schema.NullOr(SourceControlStackEntryId),
  childEntryIds: Schema.Array(SourceControlStackEntryId),
  publication: SourceControlStackEntryPublication,
  changeRequest: Schema.NullOr(ChangeRequest),
  commits: Schema.Array(SourceControlStackCommit),
  commitOids: Schema.Array(TrimmedNonEmptyString),
  aheadCount: NonNegativeInt,
  behindCount: NonNegativeInt,
  hasLocalBranch: Schema.Boolean,
  hasRemoteBranch: Schema.Boolean,
  isCurrent: Schema.Boolean,
  problems: Schema.Array(SourceControlStackProblem),
});
export type SourceControlStackEntry = typeof SourceControlStackEntry.Type;

export const SourceControlStackSnapshot = Schema.Struct({
  threadId: ThreadId,
  cwd: TrimmedNonEmptyString,
  repositoryRoot: TrimmedNonEmptyString,
  provider: Schema.NullOr(SourceControlProviderInfo),
  rootBaseRef: TrimmedNonEmptyString,
  currentEntryId: Schema.NullOr(SourceControlStackEntryId),
  entries: Schema.Array(SourceControlStackEntry),
  capabilities: Schema.Array(SourceControlStackCapability),
  problems: Schema.Array(SourceControlStackProblem),
  generatedAt: IsoDateTime,
});
export type SourceControlStackSnapshot = typeof SourceControlStackSnapshot.Type;

export const SourceControlStackGetSnapshotInput = Schema.Struct({
  threadId: ThreadId,
  selectedHeadRefName: Schema.optionalKey(TrimmedNonEmptyString),
});
export type SourceControlStackGetSnapshotInput = typeof SourceControlStackGetSnapshotInput.Type;

export const SourceControlStackCreateEntryInput = Schema.Struct({
  threadId: ThreadId,
  parentEntryId: Schema.NullOr(SourceControlStackEntryId),
  position: Schema.Literals(["above", "below", "top", "bottom"]),
  branchName: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  description: Schema.optionalKey(TrimmedNonEmptyString),
  publish: Schema.optionalKey(Schema.Boolean),
});
export type SourceControlStackCreateEntryInput = typeof SourceControlStackCreateEntryInput.Type;

export const SourceControlStackSwitchEntryInput = Schema.Struct({
  threadId: ThreadId,
  entryId: SourceControlStackEntryId,
});
export type SourceControlStackSwitchEntryInput = typeof SourceControlStackSwitchEntryInput.Type;

export const SourceControlStackRenameEntryInput = Schema.Struct({
  threadId: ThreadId,
  entryId: SourceControlStackEntryId,
  branchName: TrimmedNonEmptyString,
  title: Schema.optionalKey(TrimmedNonEmptyString),
  description: Schema.optionalKey(TrimmedNonEmptyString),
});
export type SourceControlStackRenameEntryInput = typeof SourceControlStackRenameEntryInput.Type;

export const SourceControlStackDropEntryInput = Schema.Struct({
  threadId: ThreadId,
  entryId: SourceControlStackEntryId,
  reparentChildrenTo: Schema.Literals(["parent", "next"]),
  closeChangeRequest: Schema.optionalKey(Schema.Boolean),
  deleteLocalBranch: Schema.optionalKey(Schema.Boolean),
  deleteRemoteBranch: Schema.optionalKey(Schema.Boolean),
});
export type SourceControlStackDropEntryInput = typeof SourceControlStackDropEntryInput.Type;

export const SourceControlStackReorderInput = Schema.Struct({
  threadId: ThreadId,
  orderedEntryIds: Schema.Array(SourceControlStackEntryId),
});
export type SourceControlStackReorderInput = typeof SourceControlStackReorderInput.Type;
export const SourceControlStackReorderEntriesInput = SourceControlStackReorderInput;
export type SourceControlStackReorderEntriesInput = SourceControlStackReorderInput;

export const SourceControlStackRestackInput = Schema.Struct({
  threadId: ThreadId,
  rootBaseRef: Schema.optionalKey(TrimmedNonEmptyString),
});
export type SourceControlStackRestackInput = typeof SourceControlStackRestackInput.Type;

export const SourceControlStackSyncInput = Schema.Struct({
  threadId: ThreadId,
  fetch: Schema.optionalKey(Schema.Boolean),
});
export type SourceControlStackSyncInput = typeof SourceControlStackSyncInput.Type;

export const SourceControlStackSquashEntryInput = Schema.Struct({
  threadId: ThreadId,
  entryId: SourceControlStackEntryId,
  commitMessage: Schema.optionalKey(TrimmedNonEmptyString),
});
export type SourceControlStackSquashEntryInput = typeof SourceControlStackSquashEntryInput.Type;

export const SourceControlStackSplitEntryInput = Schema.Struct({
  threadId: ThreadId,
  entryId: SourceControlStackEntryId,
  commitOids: Schema.Array(TrimmedNonEmptyString),
  newBranchName: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  description: Schema.optionalKey(TrimmedNonEmptyString),
});
export type SourceControlStackSplitEntryInput = typeof SourceControlStackSplitEntryInput.Type;

export const SourceControlStackPublishInput = Schema.Struct({
  threadId: ThreadId,
  entryIds: Schema.optionalKey(Schema.Array(SourceControlStackEntryId)),
  createMissingChangeRequests: Schema.Boolean,
  updateExistingChangeRequests: Schema.Boolean,
});
export type SourceControlStackPublishInput = typeof SourceControlStackPublishInput.Type;

export const SourceControlStackContinueOperationInput = Schema.Struct({
  threadId: ThreadId,
  operationId: SourceControlStackOperationId,
});
export type SourceControlStackContinueOperationInput =
  typeof SourceControlStackContinueOperationInput.Type;

export const SourceControlStackAbortOperationInput = SourceControlStackContinueOperationInput;
export type SourceControlStackAbortOperationInput =
  typeof SourceControlStackAbortOperationInput.Type;

export const SourceControlStackMutationResult = Schema.Struct({
  operationId: SourceControlStackOperationId,
  status: Schema.Literals(["completed", "blocked", "conflict"]),
  message: TrimmedNonEmptyString,
  snapshot: SourceControlStackSnapshot,
});
export type SourceControlStackMutationResult = typeof SourceControlStackMutationResult.Type;
export const SourceControlStackOperationResult = SourceControlStackMutationResult;
export type SourceControlStackOperationResult = SourceControlStackMutationResult;

export const SourceControlStackStreamEvent = Schema.Union([
  Schema.TaggedStruct("snapshotReplaced", {
    snapshot: SourceControlStackSnapshot,
  }),
  Schema.TaggedStruct("operationStarted", {
    operationId: SourceControlStackOperationId,
    label: TrimmedNonEmptyString,
  }),
  Schema.TaggedStruct("operationProgress", {
    operationId: SourceControlStackOperationId,
    phase: TrimmedNonEmptyString,
    label: TrimmedNonEmptyString,
  }),
  Schema.TaggedStruct("operationCompleted", {
    operationId: SourceControlStackOperationId,
    result: SourceControlStackMutationResult,
  }),
  Schema.TaggedStruct("operationBlocked", {
    operationId: SourceControlStackOperationId,
    problems: Schema.Array(SourceControlStackProblem),
  }),
  Schema.TaggedStruct("operationConflict", {
    operationId: SourceControlStackOperationId,
    entryId: SourceControlStackEntryId,
    branchName: TrimmedNonEmptyString,
    message: TrimmedNonEmptyString,
  }),
]);
export type SourceControlStackStreamEvent = typeof SourceControlStackStreamEvent.Type;

export class SourceControlStackRpcError extends Schema.TaggedErrorClass<SourceControlStackRpcError>()(
  "SourceControlStackRpcError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}
