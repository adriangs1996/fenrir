import { Context, Stream } from "effect";
import type { Effect } from "effect";

import type {
  SourceControlStackAbortOperationInput,
  SourceControlStackContinueOperationInput,
  SourceControlStackCreateEntryInput,
  SourceControlStackDropEntryInput,
  SourceControlStackGetSnapshotInput,
  SourceControlStackMutationResult,
  SourceControlStackPublishInput,
  SourceControlStackRenameEntryInput,
  SourceControlStackReorderInput,
  SourceControlStackRestackInput,
  SourceControlStackRpcError,
  SourceControlStackSnapshot,
  SourceControlStackSplitEntryInput,
  SourceControlStackSquashEntryInput,
  SourceControlStackStreamEvent,
  SourceControlStackSwitchEntryInput,
  SourceControlStackSyncInput,
} from "@fenrir/contracts/sourceControlStack";

export interface SourceControlStackServiceShape {
  readonly getSnapshot: (
    input: SourceControlStackGetSnapshotInput,
  ) => Effect.Effect<SourceControlStackSnapshot, SourceControlStackRpcError>;
  readonly createEntry: (
    input: SourceControlStackCreateEntryInput,
  ) => Effect.Effect<SourceControlStackMutationResult, SourceControlStackRpcError>;
  readonly switchEntry: (
    input: SourceControlStackSwitchEntryInput,
  ) => Effect.Effect<SourceControlStackMutationResult, SourceControlStackRpcError>;
  readonly renameEntry: (
    input: SourceControlStackRenameEntryInput,
  ) => Effect.Effect<SourceControlStackMutationResult, SourceControlStackRpcError>;
  readonly dropEntry: (
    input: SourceControlStackDropEntryInput,
  ) => Effect.Effect<SourceControlStackMutationResult, SourceControlStackRpcError>;
  readonly reorderEntries: (
    input: SourceControlStackReorderInput,
  ) => Effect.Effect<SourceControlStackMutationResult, SourceControlStackRpcError>;
  readonly restack: (
    input: SourceControlStackRestackInput,
  ) => Effect.Effect<SourceControlStackMutationResult, SourceControlStackRpcError>;
  readonly sync: (
    input: SourceControlStackSyncInput,
  ) => Effect.Effect<SourceControlStackMutationResult, SourceControlStackRpcError>;
  readonly squashEntry: (
    input: SourceControlStackSquashEntryInput,
  ) => Effect.Effect<SourceControlStackMutationResult, SourceControlStackRpcError>;
  readonly splitEntry: (
    input: SourceControlStackSplitEntryInput,
  ) => Effect.Effect<SourceControlStackMutationResult, SourceControlStackRpcError>;
  readonly publish: (
    input: SourceControlStackPublishInput,
  ) => Effect.Effect<SourceControlStackMutationResult, SourceControlStackRpcError>;
  readonly continueOperation: (
    input: SourceControlStackContinueOperationInput,
  ) => Effect.Effect<SourceControlStackMutationResult, SourceControlStackRpcError>;
  readonly abortOperation: (
    input: SourceControlStackAbortOperationInput,
  ) => Effect.Effect<SourceControlStackMutationResult, SourceControlStackRpcError>;
  readonly streamEvents: (
    input: SourceControlStackGetSnapshotInput,
  ) => Stream.Stream<SourceControlStackStreamEvent, SourceControlStackRpcError>;
}

export class SourceControlStackService extends Context.Service<
  SourceControlStackService,
  SourceControlStackServiceShape
>()("fenrir/sourceControl/stack/Services/SourceControlStackService") {}
