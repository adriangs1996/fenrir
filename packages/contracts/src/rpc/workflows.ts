import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";

import {
  WorkflowCreateDraftInput,
  WorkflowCreateDraftResult,
  WorkflowCancelScheduledRunInput,
  WorkflowCancelScheduledRunResult,
  WorkflowArchiveInput,
  WorkflowArchiveResult,
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
  WorkflowValidateInput,
  WorkflowValidateResult,
} from "../workflows";
import { WS_METHODS } from "./methods";

export const WsWorkflowsCreateDraftRpc = Rpc.make(WS_METHODS.workflowsCreateDraft, {
  payload: WorkflowCreateDraftInput,
  success: WorkflowCreateDraftResult,
  error: WorkflowError,
});

export const WsWorkflowsListThreadRpc = Rpc.make(WS_METHODS.workflowsListThread, {
  payload: WorkflowListThreadInput,
  success: WorkflowListThreadResult,
  error: WorkflowError,
});

export const WsWorkflowsListProjectWorkflowsRpc = Rpc.make(
  WS_METHODS.workflowsListProjectWorkflows,
  {
    payload: WorkflowListProjectWorkflowsInput,
    success: WorkflowListProjectWorkflowsResult,
    error: WorkflowError,
  },
);

export const WsWorkflowsListThreadLinksRpc = Rpc.make(WS_METHODS.workflowsListThreadLinks, {
  payload: WorkflowListThreadWorkflowLinksInput,
  success: WorkflowListThreadWorkflowLinksResult,
  error: WorkflowError,
});

export const WsWorkflowsLinkThreadRpc = Rpc.make(WS_METHODS.workflowsLinkThread, {
  payload: WorkflowLinkThreadInput,
  success: WorkflowLinkThreadResult,
  error: Schema.Union([WorkflowError, WorkflowNotFoundError]),
});

export const WsWorkflowsUnlinkThreadRpc = Rpc.make(WS_METHODS.workflowsUnlinkThread, {
  payload: WorkflowUnlinkThreadInput,
  success: WorkflowUnlinkThreadResult,
  error: Schema.Union([WorkflowError, WorkflowNotFoundError]),
});

export const WsWorkflowsOpenSourceRpc = Rpc.make(WS_METHODS.workflowsOpenSource, {
  payload: WorkflowOpenSourceInput,
  success: WorkflowOpenSourceResult,
  error: Schema.Union([WorkflowError, WorkflowNotFoundError]),
});

export const WsWorkflowsSyncSourceRpc = Rpc.make(WS_METHODS.workflowsSyncSource, {
  payload: WorkflowSyncSourceInput,
  success: WorkflowSyncSourceResult,
  error: Schema.Union([WorkflowError, WorkflowNotFoundError]),
});

export const WsWorkflowsValidateRpc = Rpc.make(WS_METHODS.workflowsValidate, {
  payload: WorkflowValidateInput,
  success: WorkflowValidateResult,
  error: Schema.Union([WorkflowError, WorkflowNotFoundError]),
});

export const WsWorkflowsArchiveRpc = Rpc.make(WS_METHODS.workflowsArchive, {
  payload: WorkflowArchiveInput,
  success: WorkflowArchiveResult,
  error: Schema.Union([WorkflowError, WorkflowNotFoundError]),
});

export const WsWorkflowsRunRpc = Rpc.make(WS_METHODS.workflowsRun, {
  payload: WorkflowRunInput,
  success: WorkflowRunResult,
  error: Schema.Union([WorkflowError, WorkflowNotFoundError]),
});

export const WsWorkflowsScheduleRunRpc = Rpc.make(WS_METHODS.workflowsScheduleRun, {
  payload: WorkflowScheduleRunInput,
  success: WorkflowScheduleRunResult,
  error: Schema.Union([WorkflowError, WorkflowNotFoundError]),
});

export const WsWorkflowsCancelScheduledRunRpc = Rpc.make(WS_METHODS.workflowsCancelScheduledRun, {
  payload: WorkflowCancelScheduledRunInput,
  success: WorkflowCancelScheduledRunResult,
  error: Schema.Union([WorkflowError, WorkflowNotFoundError]),
});

export const WsWorkflowsStopRpc = Rpc.make(WS_METHODS.workflowsStop, {
  payload: WorkflowStopInput,
  error: Schema.Union([WorkflowError, WorkflowNotFoundError]),
});

export const WsWorkflowsRespondToInputRpc = Rpc.make(WS_METHODS.workflowsRespondToInput, {
  payload: WorkflowRespondToInputInput,
  error: Schema.Union([WorkflowError, WorkflowNotFoundError]),
});

export const WsWorkflowsGetRunRpc = Rpc.make(WS_METHODS.workflowsGetRun, {
  payload: WorkflowRunByIdInput,
  success: WorkflowRunSnapshot,
  error: Schema.Union([WorkflowError, WorkflowNotFoundError]),
});

export const WsWorkflowsGetTimelineRpc = Rpc.make(WS_METHODS.workflowsGetTimeline, {
  payload: WorkflowGetTimelineInput,
  success: WorkflowGetTimelineResult,
  error: Schema.Union([WorkflowError, WorkflowNotFoundError]),
});

export const WsWorkflowsListMemoryRpc = Rpc.make(WS_METHODS.workflowsListMemory, {
  payload: WorkflowListMemoryInput,
  success: WorkflowListMemoryResult,
  error: Schema.Union([WorkflowError, WorkflowNotFoundError]),
});

export const WsWorkflowsSuppressMemoryItemRpc = Rpc.make(WS_METHODS.workflowsSuppressMemoryItem, {
  payload: WorkflowSuppressMemoryItemInput,
  success: WorkflowSuppressMemoryItemResult,
  error: Schema.Union([WorkflowError, WorkflowNotFoundError]),
});

export const WsSubscribeWorkflowEventsRpc = Rpc.make(WS_METHODS.subscribeWorkflowEvents, {
  payload: Schema.Struct({}),
  success: WorkflowEventStreamItem,
  stream: true,
});
