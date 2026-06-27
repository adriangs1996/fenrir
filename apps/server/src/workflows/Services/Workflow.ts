import { Context } from "effect";
import type { Effect, Stream } from "effect";
import type {
  ThreadId,
  WorkflowArchiveInput,
  WorkflowArchiveResult,
  WorkflowCancelScheduledRunInput,
  WorkflowCancelScheduledRunResult,
  ProjectId,
  WorkflowCreateDraftInput,
  WorkflowCreateDraftResult,
  WorkflowError,
  WorkflowEventStreamItem,
  WorkflowGetTimelineInput,
  WorkflowGetTimelineResult,
  WorkflowLinkThreadInput,
  WorkflowLinkThreadResult,
  WorkflowListMemoryInput,
  WorkflowListMemoryResult,
  WorkflowListProjectWorkflowsInput,
  WorkflowListProjectWorkflowsResult,
  WorkflowListThreadInput,
  WorkflowListThreadResult,
  WorkflowListThreadWorkflowLinksInput,
  WorkflowListThreadWorkflowLinksResult,
  WorkflowNotFoundError,
  WorkflowOpenSourceInput,
  WorkflowOpenSourceResult,
  WorkflowRespondToInputInput,
  WorkflowRunByIdInput,
  WorkflowRunInput,
  WorkflowRunId,
  WorkflowRunResult,
  WorkflowRunSnapshot,
  WorkflowScheduleRunInput,
  WorkflowScheduleRunResult,
  WorkflowStopInput,
  WorkflowSuppressMemoryItemInput,
  WorkflowSuppressMemoryItemResult,
  WorkflowSyncSourceInput,
  WorkflowSyncSourceResult,
  WorkflowUnlinkThreadInput,
  WorkflowUnlinkThreadResult,
  WorkflowTaskKind,
  WorkflowValidateInput,
  WorkflowValidateResult,
} from "@fenrir/contracts";

export interface WorkflowCollaborationContext {
  readonly projectId: ProjectId;
  readonly workflowRunId: WorkflowRunId;
  readonly agentThreadId: ThreadId;
  readonly agentName: string;
}

export interface WorkflowCollaborationStatePatchInput {
  readonly context: WorkflowCollaborationContext;
  readonly scope: string;
  readonly patch: Readonly<Record<string, unknown>>;
}

export interface WorkflowCollaborationAddNoteInput {
  readonly context: WorkflowCollaborationContext;
  readonly title?: string | undefined;
  readonly body: string;
}

export interface WorkflowCollaborationProposeTaskInput {
  readonly context: WorkflowCollaborationContext;
  readonly title: string;
  readonly reason?: string | undefined;
  readonly kind: WorkflowTaskKind;
  readonly assignee?: string | undefined;
  readonly prompt: string;
}

export interface WorkflowCollaborationMessageAgentInput {
  readonly context: WorkflowCollaborationContext;
  readonly to: string;
  readonly message: string;
}

export interface WorkflowServiceShape {
  readonly createDraft: (
    input: WorkflowCreateDraftInput,
  ) => Effect.Effect<WorkflowCreateDraftResult, WorkflowError>;
  readonly listThread: (
    input: WorkflowListThreadInput,
  ) => Effect.Effect<WorkflowListThreadResult, WorkflowError>;
  readonly listProjectWorkflows: (
    input: WorkflowListProjectWorkflowsInput,
  ) => Effect.Effect<WorkflowListProjectWorkflowsResult, WorkflowError>;
  readonly listThreadLinks: (
    input: WorkflowListThreadWorkflowLinksInput,
  ) => Effect.Effect<WorkflowListThreadWorkflowLinksResult, WorkflowError>;
  readonly linkThread: (
    input: WorkflowLinkThreadInput,
  ) => Effect.Effect<WorkflowLinkThreadResult, WorkflowError | WorkflowNotFoundError>;
  readonly unlinkThread: (
    input: WorkflowUnlinkThreadInput,
  ) => Effect.Effect<WorkflowUnlinkThreadResult, WorkflowError | WorkflowNotFoundError>;
  readonly openSource: (
    input: WorkflowOpenSourceInput,
  ) => Effect.Effect<WorkflowOpenSourceResult, WorkflowError | WorkflowNotFoundError>;
  readonly syncSource: (
    input: WorkflowSyncSourceInput,
  ) => Effect.Effect<WorkflowSyncSourceResult, WorkflowError | WorkflowNotFoundError>;
  readonly validate: (
    input: WorkflowValidateInput,
  ) => Effect.Effect<WorkflowValidateResult, WorkflowError | WorkflowNotFoundError>;
  readonly archive: (
    input: WorkflowArchiveInput,
  ) => Effect.Effect<WorkflowArchiveResult, WorkflowError | WorkflowNotFoundError>;
  readonly run: (
    input: WorkflowRunInput,
  ) => Effect.Effect<WorkflowRunResult, WorkflowError | WorkflowNotFoundError>;
  readonly scheduleRun: (
    input: WorkflowScheduleRunInput,
  ) => Effect.Effect<WorkflowScheduleRunResult, WorkflowError | WorkflowNotFoundError>;
  readonly cancelScheduledRun: (
    input: WorkflowCancelScheduledRunInput,
  ) => Effect.Effect<WorkflowCancelScheduledRunResult, WorkflowError | WorkflowNotFoundError>;
  readonly stop: (
    input: WorkflowStopInput,
  ) => Effect.Effect<void, WorkflowError | WorkflowNotFoundError>;
  readonly respondToInput: (
    input: WorkflowRespondToInputInput,
  ) => Effect.Effect<void, WorkflowError | WorkflowNotFoundError>;
  readonly getRun: (
    input: WorkflowRunByIdInput,
  ) => Effect.Effect<WorkflowRunSnapshot, WorkflowNotFoundError | WorkflowError>;
  readonly getTimeline: (
    input: WorkflowGetTimelineInput,
  ) => Effect.Effect<WorkflowGetTimelineResult, WorkflowError | WorkflowNotFoundError>;
  readonly listMemory: (
    input: WorkflowListMemoryInput,
  ) => Effect.Effect<WorkflowListMemoryResult, WorkflowError | WorkflowNotFoundError>;
  readonly suppressMemoryItem: (
    input: WorkflowSuppressMemoryItemInput,
  ) => Effect.Effect<WorkflowSuppressMemoryItemResult, WorkflowError | WorkflowNotFoundError>;
  readonly collaborationStatePatch: (
    input: WorkflowCollaborationStatePatchInput,
  ) => Effect.Effect<WorkflowRunSnapshot, WorkflowError | WorkflowNotFoundError>;
  readonly collaborationAddNote: (
    input: WorkflowCollaborationAddNoteInput,
  ) => Effect.Effect<{ noted: true }, WorkflowError | WorkflowNotFoundError>;
  readonly collaborationProposeTask: (
    input: WorkflowCollaborationProposeTaskInput,
  ) => Effect.Effect<WorkflowRunSnapshot, WorkflowError | WorkflowNotFoundError>;
  readonly collaborationMessageAgent: (
    input: WorkflowCollaborationMessageAgentInput,
  ) => Effect.Effect<{ sent: true; threadId: ThreadId }, WorkflowError | WorkflowNotFoundError>;
  readonly streamEvents: Stream.Stream<WorkflowEventStreamItem>;
}

export class WorkflowService extends Context.Service<WorkflowService, WorkflowServiceShape>()(
  "fenrir/workflows/Services/WorkflowService",
) {}
