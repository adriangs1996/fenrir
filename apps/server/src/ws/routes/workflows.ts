import { Effect } from "effect";

import { WS_METHODS } from "@fenrir/contracts";

import { WorkflowService } from "../../workflows/Services/Workflow";
import { makeControlPlaneDomain } from "../controlPlane";

export const makeWorkflowRoutes = Effect.gen(function* () {
  const workflowService = yield* WorkflowService;
  const workflows = makeControlPlaneDomain("workflows");

  return {
    [WS_METHODS.workflowsCreateDraft]: workflows.effect(WS_METHODS.workflowsCreateDraft, (input) =>
      workflowService.createDraft(input),
    ),
    [WS_METHODS.workflowsListThread]: workflows.effect(WS_METHODS.workflowsListThread, (input) =>
      workflowService.listThread(input),
    ),
    [WS_METHODS.workflowsListProjectWorkflows]: workflows.effect(
      WS_METHODS.workflowsListProjectWorkflows,
      (input) => workflowService.listProjectWorkflows(input),
    ),
    [WS_METHODS.workflowsListThreadLinks]: workflows.effect(
      WS_METHODS.workflowsListThreadLinks,
      (input) => workflowService.listThreadLinks(input),
    ),
    [WS_METHODS.workflowsLinkThread]: workflows.effect(WS_METHODS.workflowsLinkThread, (input) =>
      workflowService.linkThread(input),
    ),
    [WS_METHODS.workflowsUnlinkThread]: workflows.effect(
      WS_METHODS.workflowsUnlinkThread,
      (input) => workflowService.unlinkThread(input),
    ),
    [WS_METHODS.workflowsOpenSource]: workflows.effect(WS_METHODS.workflowsOpenSource, (input) =>
      workflowService.openSource(input),
    ),
    [WS_METHODS.workflowsSyncSource]: workflows.effect(WS_METHODS.workflowsSyncSource, (input) =>
      workflowService.syncSource(input),
    ),
    [WS_METHODS.workflowsValidate]: workflows.effect(WS_METHODS.workflowsValidate, (input) =>
      workflowService.validate(input),
    ),
    [WS_METHODS.workflowsArchive]: workflows.effect(WS_METHODS.workflowsArchive, (input) =>
      workflowService.archive(input),
    ),
    [WS_METHODS.workflowsRun]: workflows.effect(WS_METHODS.workflowsRun, (input) =>
      workflowService.run(input),
    ),
    [WS_METHODS.workflowsScheduleRun]: workflows.effect(WS_METHODS.workflowsScheduleRun, (input) =>
      workflowService.scheduleRun(input),
    ),
    [WS_METHODS.workflowsCancelScheduledRun]: workflows.effect(
      WS_METHODS.workflowsCancelScheduledRun,
      (input) => workflowService.cancelScheduledRun(input),
    ),
    [WS_METHODS.workflowsStop]: workflows.effect(WS_METHODS.workflowsStop, (input) =>
      workflowService.stop(input),
    ),
    [WS_METHODS.workflowsRespondToInput]: workflows.effect(
      WS_METHODS.workflowsRespondToInput,
      (input) => workflowService.respondToInput(input),
    ),
    [WS_METHODS.workflowsGetRun]: workflows.effect(WS_METHODS.workflowsGetRun, (input) =>
      workflowService.getRun(input),
    ),
    [WS_METHODS.workflowsGetTimeline]: workflows.effect(WS_METHODS.workflowsGetTimeline, (input) =>
      workflowService.getTimeline(input),
    ),
    [WS_METHODS.workflowsListMemory]: workflows.effect(WS_METHODS.workflowsListMemory, (input) =>
      workflowService.listMemory(input),
    ),
    [WS_METHODS.workflowsSuppressMemoryItem]: workflows.effect(
      WS_METHODS.workflowsSuppressMemoryItem,
      (input) => workflowService.suppressMemoryItem(input),
    ),
    [WS_METHODS.subscribeWorkflowEvents]: workflows.stream(
      WS_METHODS.subscribeWorkflowEvents,
      (_input) => workflowService.streamEvents,
    ),
  };
});
