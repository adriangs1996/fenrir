import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";

import {
  WorkflowCreateDraftInput,
  WorkflowCreateDraftResult,
  WorkflowArchiveInput,
  WorkflowArchiveResult,
  WorkflowError,
  WorkflowEventStreamItem,
  WorkflowGetTimelineInput,
  WorkflowGetTimelineResult,
  WorkflowListThreadInput,
  WorkflowListThreadResult,
  WorkflowNotFoundError,
  WorkflowOpenSourceInput,
  WorkflowOpenSourceResult,
  WorkflowRespondToInputInput,
  WorkflowRunByIdInput,
  WorkflowRunInput,
  WorkflowRunResult,
  WorkflowRunSnapshot,
  WorkflowStopInput,
  WorkflowSyncSourceInput,
  WorkflowSyncSourceResult,
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

export const WsSubscribeWorkflowEventsRpc = Rpc.make(WS_METHODS.subscribeWorkflowEvents, {
  payload: Schema.Struct({}),
  success: WorkflowEventStreamItem,
  stream: true,
});
