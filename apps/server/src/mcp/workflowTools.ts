import { WORKFLOW_TASK_KIND_VALUES } from "@fenrir/contracts";
import { z } from "zod";
import type * as z4 from "zod/v4/core";

type WorkflowInputSchema = Record<string, z4.$ZodType>;
type WorkflowToolContent = { type: "text"; text: string };

interface WorkflowToolCallResult {
  [key: string]: unknown;
  content: WorkflowToolContent[];
}

interface WorkflowMcpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: WorkflowInputSchema;
}

const emptyInputSchema = {};
const workflowId = z
  .string()
  .min(1)
  .describe("Workflow id returned by workflow_list_thread_drafts or workflow_list_project.");
const workflowRunId = z.string().min(1).describe("Workflow run id returned by workflow_run.");
const referenceVersion = z
  .string()
  .min(1)
  .describe("Reference version returned by workflow_reference in this MCP session.");
const readToken = z
  .string()
  .min(1)
  .describe("Read token returned by workflow_reference in this MCP session.");

export type WorkflowMcpMode = "management" | "collaboration";

export const WORKFLOW_MANAGEMENT_MCP_TOOLS = [
  {
    name: "workflow_reference",
    description:
      "Read the complete Fenrir workflow runtime API reference before creating or updating workflow source. This is mandatory: workflow_create, workflow_create_draft, workflow_update, and workflow_update_draft reject calls without the returned referenceVersion and readToken.",
    inputSchema: {
      format: z
        .enum(["markdown", "json"])
        .describe("Reference format. Defaults to markdown.")
        .optional(),
      section: z
        .enum(["overview", "ctx", "examples", "capabilities", "errors"])
        .describe("Optional reference section to return.")
        .optional(),
    },
  },
  {
    name: "workflow_create",
    description:
      "Create a new Fenrir workflow. You must call workflow_reference first and pass its referenceVersion and readToken. Source must use only the documented workflow ctx API.",
    inputSchema: {
      name: z.string().min(1).describe("Human-readable workflow name."),
      description: z.string().describe("Optional workflow description.").optional(),
      referenceVersion,
      readToken,
      source: z
        .string()
        .min(1)
        .describe("JavaScript workflow source exporting a default async function run(ctx, args)."),
    },
  },
  {
    name: "workflow_create_draft",
    description:
      "Create a new Fenrir workflow draft for the current chat thread. You must call workflow_reference first and pass its referenceVersion and readToken. Use workflow_update_draft instead when fixing or iterating on an existing listed workflowId. Store reviewed JavaScript source only; this does not run the workflow.",
    inputSchema: {
      name: z.string().min(1).describe("Human-readable workflow name."),
      description: z.string().describe("Optional workflow description.").optional(),
      referenceVersion,
      readToken,
      source: z
        .string()
        .min(1)
        .describe("JavaScript workflow source exporting a default async function run(ctx, args)."),
    },
  },
  {
    name: "workflow_update",
    description:
      "Replace the JavaScript source for an existing workflow. You must call workflow_reference first and pass its referenceVersion and readToken. Source must use only the documented workflow ctx API.",
    inputSchema: {
      workflowId,
      referenceVersion,
      readToken,
      source: z
        .string()
        .min(1)
        .describe(
          "Replacement JavaScript workflow source exporting a default async function run(ctx, args).",
        ),
    },
  },
  {
    name: "workflow_update_draft",
    description:
      "Replace the JavaScript source for an existing workflow draft in the current chat thread and revalidate it. You must call workflow_reference first and pass its referenceVersion and readToken. Use this when fixing a validation failure or iterating on a listed workflowId instead of creating a duplicate draft.",
    inputSchema: {
      workflowId,
      referenceVersion,
      readToken,
      source: z
        .string()
        .min(1)
        .describe(
          "Replacement JavaScript workflow source exporting a default async function run(ctx, args).",
        ),
    },
  },
  {
    name: "workflow_list_thread_drafts",
    description: "List workflow drafts and recent runs for the current chat thread.",
    inputSchema: emptyInputSchema,
  },
  {
    name: "workflow_run",
    description:
      "Run a validated workflow for the current chat thread. If workflowId is omitted, Fenrir runs the latest validated workflow for this thread.",
    inputSchema: {
      workflowId: workflowId.optional(),
      args: z.unknown().describe("Optional serializable workflow args.").optional(),
    },
  },
  {
    name: "workflow_get_status",
    description: "Get the current status snapshot for a workflow run.",
    inputSchema: { workflowRunId },
  },
  {
    name: "workflow_stop",
    description: "Stop a running or paused workflow run.",
    inputSchema: { workflowRunId },
  },
  {
    name: "workflow_archive_draft",
    description:
      "Remove a workflow draft from the current thread's workflow picker. This archives the local Fenrir artifact without deleting historical runs.",
    inputSchema: { workflowId },
  },
] satisfies ReadonlyArray<WorkflowMcpTool>;

export const WORKFLOW_COLLABORATION_MCP_TOOLS = [
  {
    name: "workflow_state_patch",
    description:
      "Patch shared workflow run state. The workflow JavaScript can read these values through ctx.state.",
    inputSchema: {
      scope: z.string().min(1).describe("Optional state scope. Defaults to workflow.").optional(),
      patch: z.record(z.string(), z.unknown()).describe("Object of state keys to set."),
    },
  },
  {
    name: "workflow_add_note",
    description: "Add an auditable note to the current workflow run timeline.",
    inputSchema: {
      title: z.string().min(1).describe("Optional note title.").optional(),
      body: z.string().min(1).describe("Note body."),
    },
  },
  {
    name: "workflow_propose_task",
    description:
      "Propose a workflow task for the workflow JavaScript to accept, reject, or run according to policy.",
    inputSchema: {
      title: z.string().min(1).describe("Task title."),
      reason: z.string().describe("Optional reason for the proposal.").optional(),
      kind: z.enum(WORKFLOW_TASK_KIND_VALUES).describe("Task kind."),
      assignee: z
        .string()
        .min(1)
        .describe("Optional preferred workflow agent assignee.")
        .optional(),
      prompt: z.string().min(1).describe("Prompt to use if the workflow runs this task."),
    },
  },
  {
    name: "workflow_message_agent",
    description:
      "Send a workflow-mediated message to another named agent in the current workflow run.",
    inputSchema: {
      to: z.string().min(1).describe("Target workflow agent name."),
      message: z.string().min(1).describe("Message body."),
    },
  },
  {
    name: "workflow_set_flag",
    description: "Set a boolean or scalar flag in the workflow run's flags state scope.",
    inputSchema: {
      key: z.string().min(1).describe("Flag key."),
      value: z.unknown().describe("Flag value."),
    },
  },
] satisfies ReadonlyArray<WorkflowMcpTool>;

export const WORKFLOW_MCP_TOOLS = WORKFLOW_MANAGEMENT_MCP_TOOLS;

export function workflowMcpToolsForMode(mode: WorkflowMcpMode): ReadonlyArray<WorkflowMcpTool> {
  return mode === "collaboration"
    ? WORKFLOW_COLLABORATION_MCP_TOOLS
    : WORKFLOW_MANAGEMENT_MCP_TOOLS;
}

export function truncateWorkflowToolResult(value: unknown): string {
  const text = JSON.stringify(value, null, 2) ?? String(value);
  const maxLength = 120_000;
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n... truncated ${text.length - maxLength} characters`;
}

export function formatWorkflowToolResult(result: unknown): WorkflowToolCallResult {
  return {
    content: [{ type: "text", text: truncateWorkflowToolResult(result) }],
  };
}
