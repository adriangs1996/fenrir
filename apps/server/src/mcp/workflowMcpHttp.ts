import {
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  WorkflowError,
  WorkflowId,
  WorkflowNotFoundError,
  WorkflowRunId,
  WorkflowTaskKind,
  type WorkflowRunSnapshot,
} from "@fenrir/contracts";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import {
  WorkflowService,
  type WorkflowCollaborationContext,
  type WorkflowServiceShape,
} from "../workflows/Services/Workflow.ts";
import { getWorkflowMcpToken } from "./workflowMcpRuntime.ts";
import {
  WORKFLOW_COLLABORATION_MCP_TOOLS,
  WORKFLOW_MANAGEMENT_MCP_TOOLS,
  type WorkflowMcpMode,
} from "./workflowTools.ts";
import {
  validateWorkflowReferenceReceipt,
  workflowReferenceResponse,
} from "./workflowReference.ts";

const WorkflowMcpCall = Schema.Struct({
  toolName: Schema.String,
  input: Schema.optional(Schema.Unknown),
  projectId: ProjectId,
  originThreadId: ThreadId,
  mode: Schema.Literals(["management", "collaboration"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("management" as const)),
  ),
  workflowRunId: Schema.optional(WorkflowRunId),
  agentName: Schema.optional(TrimmedNonEmptyString),
  mcpSessionId: TrimmedNonEmptyString,
});

const WorkflowCreateDraftToolInput = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
  referenceVersion: TrimmedNonEmptyString,
  readToken: TrimmedNonEmptyString,
  source: Schema.String,
});

const WorkflowUpdateDraftToolInput = Schema.Struct({
  workflowId: WorkflowId,
  referenceVersion: TrimmedNonEmptyString,
  readToken: TrimmedNonEmptyString,
  source: Schema.String,
});

const WorkflowReferenceToolInput = Schema.Struct({
  format: Schema.optional(Schema.Literals(["markdown", "json"])),
  section: Schema.optional(
    Schema.Literals(["overview", "ctx", "examples", "capabilities", "errors"]),
  ),
});

const WorkflowRunToolInput = Schema.Struct({
  workflowId: Schema.optional(WorkflowId),
  args: Schema.optional(Schema.Unknown),
});

const WorkflowRunIdToolInput = Schema.Struct({
  workflowRunId: WorkflowRunId,
});

const WorkflowIdToolInput = Schema.Struct({
  workflowId: WorkflowId,
});

const WorkflowStatePatchToolInput = Schema.Struct({
  scope: Schema.optional(TrimmedNonEmptyString),
  patch: Schema.Record(Schema.String, Schema.Unknown),
});

const WorkflowAddNoteToolInput = Schema.Struct({
  title: Schema.optional(TrimmedNonEmptyString),
  body: TrimmedNonEmptyString,
});

const WorkflowProposeTaskToolInput = Schema.Struct({
  title: TrimmedNonEmptyString,
  reason: Schema.optional(Schema.String),
  kind: WorkflowTaskKind,
  assignee: Schema.optional(TrimmedNonEmptyString),
  prompt: TrimmedNonEmptyString,
});

const WorkflowMessageAgentToolInput = Schema.Struct({
  to: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
});

const WorkflowSetFlagToolInput = Schema.Struct({
  key: TrimmedNonEmptyString,
  value: Schema.Unknown,
});

const decodeCreateDraftInput = Schema.decodeUnknownSync(WorkflowCreateDraftToolInput);
const decodeUpdateDraftInput = Schema.decodeUnknownSync(WorkflowUpdateDraftToolInput);
const decodeReferenceInput = Schema.decodeUnknownSync(WorkflowReferenceToolInput);
const decodeRunInput = Schema.decodeUnknownSync(WorkflowRunToolInput);
const decodeRunIdInput = Schema.decodeUnknownSync(WorkflowRunIdToolInput);
const decodeWorkflowIdInput = Schema.decodeUnknownSync(WorkflowIdToolInput);
const decodeStatePatchInput = Schema.decodeUnknownSync(WorkflowStatePatchToolInput);
const decodeAddNoteInput = Schema.decodeUnknownSync(WorkflowAddNoteToolInput);
const decodeProposeTaskInput = Schema.decodeUnknownSync(WorkflowProposeTaskToolInput);
const decodeMessageAgentInput = Schema.decodeUnknownSync(WorkflowMessageAgentToolInput);
const decodeSetFlagInput = Schema.decodeUnknownSync(WorkflowSetFlagToolInput);
const isWorkflowNotFoundError = Schema.is(WorkflowNotFoundError);

function bearerToken(request: HttpServerRequest.HttpServerRequest): string | null {
  const authorization = request.headers["authorization"];
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    return null;
  }
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function jsonResponse(value: unknown, status = 200) {
  return HttpServerResponse.jsonUnsafe(value, { status });
}

const unknownWorkflowTool = (toolName: string) =>
  new WorkflowError({ message: `Unknown Workflows MCP tool ${toolName}` });
const managementToolNames = new Set(WORKFLOW_MANAGEMENT_MCP_TOOLS.map((tool) => tool.name));
const collaborationToolNames = new Set(WORKFLOW_COLLABORATION_MCP_TOOLS.map((tool) => tool.name));

function validateToolMode(
  toolName: string,
  mode: WorkflowMcpMode,
): Effect.Effect<void, WorkflowError> {
  const allowed = mode === "management" ? managementToolNames : collaborationToolNames;
  if (allowed.has(toolName)) {
    return Effect.void;
  }
  const otherModeTool =
    mode === "management"
      ? collaborationToolNames.has(toolName)
      : managementToolNames.has(toolName);
  return Effect.fail(
    new WorkflowError({
      message: otherModeTool
        ? `Workflow tool ${toolName} is not available in ${mode} mode.`
        : `Unknown Workflows MCP tool ${toolName}`,
    }),
  );
}

export function callWorkflowMcpTool(
  workflows: WorkflowServiceShape,
  toolName: string,
  context: {
    readonly projectId: ProjectId;
    readonly originThreadId: ThreadId;
    readonly mode?: WorkflowMcpMode | undefined;
    readonly workflowRunId?: WorkflowRunId | undefined;
    readonly agentName?: string | undefined;
    readonly mcpSessionId?: string | undefined;
  },
  input: unknown = {},
): Effect.Effect<unknown, WorkflowError | WorkflowNotFoundError> {
  const mode = context.mode ?? "management";
  const mcpSessionId = context.mcpSessionId ?? "default";
  const requireReferenceRead = (decoded: {
    readonly referenceVersion: string;
    readonly readToken: string;
  }): Effect.Effect<void, WorkflowError> => {
    const validation = validateWorkflowReferenceReceipt({
      sessionId: mcpSessionId,
      referenceVersion: decoded.referenceVersion,
      readToken: decoded.readToken,
    });
    return validation.valid
      ? Effect.void
      : Effect.fail(new WorkflowError({ message: validation.message }));
  };
  const collaborationContext = (): Effect.Effect<WorkflowCollaborationContext, WorkflowError> =>
    Effect.gen(function* () {
      if (!context.workflowRunId || !context.agentName) {
        return yield* new WorkflowError({
          message: "Workflow collaboration context is missing.",
        });
      }
      return {
        projectId: context.projectId,
        workflowRunId: context.workflowRunId,
        agentThreadId: context.originThreadId,
        agentName: context.agentName,
      };
    });
  const getRunForContext = (
    runId: WorkflowRunId,
  ): Effect.Effect<WorkflowRunSnapshot, WorkflowError | WorkflowNotFoundError> =>
    workflows.getRun({ runId }).pipe(
      Effect.flatMap((run) =>
        run.projectId === context.projectId && run.originThreadId === context.originThreadId
          ? Effect.succeed(run)
          : Effect.fail(
              new WorkflowError({
                message: "Workflow run does not belong to the current MCP thread context.",
              }),
            ),
      ),
    );
  const ensureWorkflowForContext = (workflowId: WorkflowId): Effect.Effect<void, WorkflowError> =>
    workflows.listThread(context).pipe(
      Effect.flatMap((snapshot) =>
        snapshot.workflows.some((summary) => summary.workflow.workflowId === workflowId)
          ? Effect.void
          : Effect.fail(
              new WorkflowError({
                message: "Workflow draft does not belong to the current MCP thread context.",
              }),
            ),
      ),
    );

  const dispatchTool = (): Effect.Effect<unknown, WorkflowError | WorkflowNotFoundError> => {
    switch (toolName) {
      case "workflow_reference": {
        const decoded = decodeReferenceInput(input);
        return Effect.succeed(
          workflowReferenceResponse({
            sessionId: mcpSessionId,
            format: decoded.format,
            section: decoded.section,
          }),
        );
      }
      case "workflow_create":
      case "workflow_create_draft": {
        const decoded = decodeCreateDraftInput(input);
        return requireReferenceRead(decoded).pipe(
          Effect.flatMap(() =>
            workflows.createDraft({
              projectId: context.projectId,
              originThreadId: context.originThreadId,
              name: decoded.name,
              source: decoded.source,
              ...(decoded.description !== undefined ? { description: decoded.description } : {}),
            }),
          ),
        );
      }
      case "workflow_update":
      case "workflow_update_draft": {
        const decoded = decodeUpdateDraftInput(input);
        return requireReferenceRead(decoded).pipe(
          Effect.flatMap(() => ensureWorkflowForContext(decoded.workflowId)),
          Effect.flatMap(() =>
            workflows.syncSource({
              workflowId: decoded.workflowId,
              source: decoded.source,
            }),
          ),
          Effect.flatMap(() => workflows.validate({ workflowId: decoded.workflowId })),
        );
      }
      case "workflow_list_thread_drafts":
        return workflows.listThread(context);
      case "workflow_run": {
        const decoded = decodeRunInput(input);
        return workflows.run({
          projectId: context.projectId,
          originThreadId: context.originThreadId,
          ...(decoded.workflowId !== undefined ? { workflowId: decoded.workflowId } : {}),
          ...(decoded.args !== undefined ? { args: decoded.args } : {}),
        });
      }
      case "workflow_get_status": {
        const decoded = decodeRunIdInput(input);
        return getRunForContext(decoded.workflowRunId);
      }
      case "workflow_stop": {
        const decoded = decodeRunIdInput(input);
        return getRunForContext(decoded.workflowRunId).pipe(
          Effect.flatMap(() => workflows.stop({ runId: decoded.workflowRunId })),
          Effect.as({ stopped: true }),
        );
      }
      case "workflow_archive_draft": {
        const decoded = decodeWorkflowIdInput(input);
        return ensureWorkflowForContext(decoded.workflowId).pipe(
          Effect.flatMap(() => workflows.archive({ workflowId: decoded.workflowId })),
        );
      }
      case "workflow_state_patch": {
        const decoded = decodeStatePatchInput(input);
        return collaborationContext().pipe(
          Effect.flatMap((collaboration) =>
            workflows.collaborationStatePatch({
              context: collaboration,
              scope: decoded.scope ?? ("workflow" as any),
              patch: decoded.patch,
            }),
          ),
        );
      }
      case "workflow_add_note": {
        const decoded = decodeAddNoteInput(input);
        return collaborationContext().pipe(
          Effect.flatMap((collaboration) =>
            workflows.collaborationAddNote({
              context: collaboration,
              ...(decoded.title !== undefined ? { title: decoded.title } : {}),
              body: decoded.body,
            }),
          ),
        );
      }
      case "workflow_propose_task": {
        const decoded = decodeProposeTaskInput(input);
        return collaborationContext().pipe(
          Effect.flatMap((collaboration) =>
            workflows.collaborationProposeTask({
              context: collaboration,
              title: decoded.title,
              ...(decoded.reason !== undefined ? { reason: decoded.reason } : {}),
              kind: decoded.kind,
              ...(decoded.assignee !== undefined ? { assignee: decoded.assignee } : {}),
              prompt: decoded.prompt,
            }),
          ),
        );
      }
      case "workflow_message_agent": {
        const decoded = decodeMessageAgentInput(input);
        return collaborationContext().pipe(
          Effect.flatMap((collaboration) =>
            workflows.collaborationMessageAgent({
              context: collaboration,
              to: decoded.to,
              message: decoded.message,
            }),
          ),
        );
      }
      case "workflow_set_flag": {
        const decoded = decodeSetFlagInput(input);
        return collaborationContext().pipe(
          Effect.flatMap((collaboration) =>
            workflows.collaborationStatePatch({
              context: collaboration,
              scope: "flags" as any,
              patch: { [decoded.key]: decoded.value },
            }),
          ),
        );
      }
      default:
        return Effect.fail(unknownWorkflowTool(toolName));
    }
  };
  return validateToolMode(toolName, mode).pipe(Effect.flatMap(dispatchTool));
}

export const workflowMcpCallRouteLayer = HttpRouter.add(
  "POST",
  "/api/internal/mcp/workflows/call",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (bearerToken(request) !== getWorkflowMcpToken()) {
      return HttpServerResponse.text("Unauthorized", { status: 401 });
    }
    const payload = yield* HttpServerRequest.schemaBodyJson(WorkflowMcpCall);
    const workflows = yield* WorkflowService;
    const result = yield* callWorkflowMcpTool(
      workflows,
      payload.toolName,
      {
        projectId: payload.projectId,
        originThreadId: payload.originThreadId,
        mode: payload.mode,
        mcpSessionId: payload.mcpSessionId,
        ...(payload.workflowRunId !== undefined ? { workflowRunId: payload.workflowRunId } : {}),
        ...(payload.agentName !== undefined ? { agentName: payload.agentName } : {}),
      },
      payload.input ?? {},
    );
    return jsonResponse({ ok: true, result });
  }).pipe(
    Effect.catch((error: unknown) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          {
            ok: false,
            error: error instanceof Error ? error.message : "Workflow MCP call failed.",
          },
          {
            status: isWorkflowNotFoundError(error) ? 404 : 500,
          },
        ),
      ),
    ),
  ),
);

export const WorkflowMcpHttpLive = Layer.mergeAll(workflowMcpCallRouteLayer);
