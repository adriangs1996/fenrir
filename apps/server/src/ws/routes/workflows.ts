import { Effect } from "effect";

import { WS_METHODS } from "@fenrir/contracts";

import { WorkflowService } from "../../workflows/Services/Workflow";
import { makeRpcDomain } from "../handlers";

export const makeWorkflowRoutes = Effect.gen(function* () {
  const workflowService = yield* WorkflowService;
  const workflows = makeRpcDomain("workflows");

  return {
    [WS_METHODS.workflowsCreateDraft]: workflows.effect(WS_METHODS.workflowsCreateDraft, (input) =>
      workflowService.createDraft(input),
    ),
    [WS_METHODS.workflowsListThread]: workflows.effect(WS_METHODS.workflowsListThread, (input) =>
      workflowService.listThread(input),
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
    [WS_METHODS.subscribeWorkflowEvents]: workflows.stream(
      WS_METHODS.subscribeWorkflowEvents,
      (_input) => workflowService.streamEvents,
    ),
  };
});
