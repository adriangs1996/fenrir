import { randomBytes } from "node:crypto";

export const WORKFLOW_REFERENCE_VERSION = "2026-06-25.workflow-runtime-v1";
export const WORKFLOW_REFERENCE_TOKEN_TTL_MS = 30 * 60 * 1000;

export type WorkflowReferenceSection = "overview" | "ctx" | "examples" | "capabilities" | "errors";

export type WorkflowReferenceFormat = "markdown" | "json";

export interface WorkflowRuntimeApiEntry {
  readonly name: string;
  readonly signature: string;
  readonly description: string;
  readonly capabilities: ReadonlyArray<string>;
  readonly events: ReadonlyArray<string>;
  readonly errors: ReadonlyArray<string>;
  readonly example: string;
}

export interface WorkflowReferenceReceipt {
  readonly referenceVersion: string;
  readonly readToken: string;
  readonly expiresAt: string;
}

interface StoredReferenceReceipt extends WorkflowReferenceReceipt {
  readonly sessionId: string;
  readonly expiresAtMs: number;
}

const referenceReceipts = new Map<string, StoredReferenceReceipt>();

export const WORKFLOW_RUNTIME_API_REGISTRY: ReadonlyArray<WorkflowRuntimeApiEntry> = [
  {
    name: "ctx.step",
    signature: "ctx.step(stepKey: string, fn: () => Promise<T> | T): Promise<T>",
    description:
      "Runs a named workflow step, records step lifecycle events, and scopes nested runtime calls to that step.",
    capabilities: ["workflow.step"],
    events: ["workflow.step.started", "workflow.step.completed", "workflow.step.failed"],
    errors: ["Fails when stepKey is empty or the callback throws."],
    example: 'const plan = await ctx.step("plan", () => planner.ask("Create a plan."));',
  },
  {
    name: "ctx.parallel",
    signature:
      "ctx.parallel<T, R>(items: T[], mapper: (item: T, index: number) => Promise<R>, options?: { concurrency?: number }): Promise<R[]>",
    description: "Runs bounded parallel workflow work without exposing raw worker or process APIs.",
    capabilities: ["workflow.parallel"],
    events: [],
    errors: ["Propagates mapper failures."],
    example:
      "const results = await ctx.parallel(files, (file) => reviewer.ask(`Review ${file}`), { concurrency: 3 });",
  },
  {
    name: "ctx.log",
    signature: "ctx.log(messageOrEvent: unknown): Promise<void>",
    description: "Appends an auditable workflow log event visible in the run timeline.",
    capabilities: ["workflow.events"],
    events: ["workflow.notification.emitted"],
    errors: ["Fails when the event payload cannot be serialized."],
    example: 'await ctx.log({ phase: "research", filesConsidered: files.length });',
  },
  {
    name: "ctx.notify",
    signature: "ctx.notify(input: { level: string; title: string; body?: string }): Promise<void>",
    description: "Emits a user-visible workflow notification and timeline event.",
    capabilities: ["workflow.notifications"],
    events: ["workflow.notification.emitted"],
    errors: ["Fails when title is empty."],
    example: 'await ctx.notify({ level: "info", title: "Workflow completed" });',
  },
  {
    name: "ctx.team.agent",
    signature:
      "ctx.team.agent(name: string, options: { role: string; modelSelection?: unknown; runtimeMode?: string; mcpServerIds?: string[] }): WorkflowAgent",
    description:
      "Creates or reuses a named internal agent for this run. Agents are hidden implementation threads owned by the workflow run.",
    capabilities: ["workflow.agents"],
    events: ["workflow.agent.created"],
    errors: ["Fails when the agent name or role is empty, or when the provider cannot start."],
    example:
      'const implementer = ctx.team.agent("implementer", { role: "Implement accepted tasks." });',
  },
  {
    name: "agent.ask",
    signature: "agent.ask(promptOrInput: string | { prompt: string }): Promise<{ text: string }>",
    description:
      "Sends a prompt to a named workflow agent. The workflow owns prompt construction and control flow.",
    capabilities: ["workflow.agents", "provider.turns"],
    events: ["workflow.agent.message.sent", "workflow.agent.message.completed"],
    errors: ["Fails when the provider turn fails, is cancelled, or times out."],
    example:
      'const answer = await implementer.ask("Apply the accepted plan and report blockers.");',
  },
  {
    name: "ctx.context.build",
    signature:
      "ctx.context.build(input: { goal: string; agentName?: string; memoryKinds?: string[]; refs?: string[] }): Promise<{ prompt: string; selectedMemoryIds: string[]; selectedContextRefs: string[]; rationale: string }>",
    description:
      "Builds an agent prompt from workflow goal, selected workspace context, and active workflow memory.",
    capabilities: ["workflow.context", "workflow.memory"],
    events: ["workflow.prompt_build.created"],
    errors: ["Fails when requested context exceeds runtime limits."],
    example:
      'const prompt = await ctx.context.build({ goal: "Review websocket changes", agentName: "reviewer" });',
  },
  {
    name: "ctx.memory.list",
    signature:
      "ctx.memory.list(filter?: { kind?: string; status?: string; minConfidence?: number }): Promise<WorkflowMemoryItem[]>",
    description: "Lists active or historical workflow memory items available to context planning.",
    capabilities: ["workflow.memory"],
    events: [],
    errors: ["Fails when filter values are invalid."],
    example: 'const hints = await ctx.memory.list({ kind: "prompt_hint", status: "active" });',
  },
  {
    name: "ctx.memory.remember",
    signature:
      "ctx.memory.remember(input: { kind: string; content: string; confidence?: number; evidence?: unknown }): Promise<WorkflowMemoryItem>",
    description:
      "Stores an auditable workflow memory item to improve future context selection and prompt building.",
    capabilities: ["workflow.memory.write"],
    events: ["workflow.memory.remembered"],
    errors: ["Fails when content is empty or confidence is outside 0..1."],
    example:
      'await ctx.memory.remember({ kind: "failure_pattern", content: "Run typecheck before summarizing TS changes.", confidence: 0.8 });',
  },
  {
    name: "ctx.workspace.search",
    signature:
      "ctx.workspace.search(input: { query: string; globs?: string[]; limit?: number }): Promise<Array<{ path: string; line?: number; preview?: string }>>",
    description: "Searches the current project workspace through Fenrir-controlled APIs.",
    capabilities: ["workspace.search"],
    events: ["workflow.capability.called"],
    errors: ["Fails when query is empty or requested globs are outside the project."],
    example: 'const hits = await ctx.workspace.search({ query: "WorkflowService", limit: 20 });',
  },
  {
    name: "ctx.workspace.readFile",
    signature: "ctx.workspace.readFile(path: string): Promise<string>",
    description: "Reads a project workspace file through capability checks and audit logging.",
    capabilities: ["workspace.read"],
    events: ["workflow.capability.called"],
    errors: ["Fails when the file is outside the project or exceeds size limits."],
    example:
      'const moduleDoc = await ctx.workspace.readFile("apps/server/src/workflows/MODULE.md");',
  },
  {
    name: "ctx.fs.readFile",
    signature: "ctx.fs.readFile(path: string): Promise<string>",
    description:
      "Reads an explicitly permitted file path. Prefer ctx.workspace.readFile for project files.",
    capabilities: ["fs.read"],
    events: ["workflow.capability.called"],
    errors: ["Fails when the path is not granted by declared capabilities."],
    example: "const config = await ctx.fs.readFile(args.configPath);",
  },
  {
    name: "ctx.fs.writeFile",
    signature: "ctx.fs.writeFile(path: string, contents: string): Promise<void>",
    description:
      "Writes an explicitly permitted file path. This is never granted by default and must be declared.",
    capabilities: ["fs.write"],
    events: ["workflow.capability.called"],
    errors: ["Fails when write capability is missing or the path is outside the grant."],
    example: "await ctx.fs.writeFile(args.reportPath, reportMarkdown);",
  },
  {
    name: "ctx.state.get",
    signature:
      "ctx.state.get(key: string, options?: { scope?: string } | string): Promise<unknown>",
    description: "Reads run-scoped workflow state.",
    capabilities: ["workflow.state"],
    events: [],
    errors: ["Fails when key or scope is invalid."],
    example: 'const previous = await ctx.state.get("last-review");',
  },
  {
    name: "ctx.state.set",
    signature:
      "ctx.state.set(key: string, value: unknown, options?: { scope?: string } | string): Promise<void>",
    description: "Writes run-scoped workflow state and records provenance.",
    capabilities: ["workflow.state.write"],
    events: ["workflow.state.updated"],
    errors: ["Fails when value cannot be serialized."],
    example: 'await ctx.state.set("last-review", { passed: true });',
  },
  {
    name: "ctx.state.update",
    signature:
      "ctx.state.update(key: string, updater: (current: unknown) => unknown | Promise<unknown>, options?: { scope?: string } | string): Promise<unknown>",
    description: "Reads, transforms, and writes run-scoped workflow state.",
    capabilities: ["workflow.state.write"],
    events: ["workflow.state.updated"],
    errors: ["Fails when updater throws or the result cannot be serialized."],
    example: 'await ctx.state.update("attempts", (current) => Number(current ?? 0) + 1);',
  },
  {
    name: "ctx.notes.add",
    signature:
      "ctx.notes.add(input: { title?: string; body: string; visibility?: string }): Promise<void>",
    description: "Adds an auditable note to the workflow timeline.",
    capabilities: ["workflow.notes"],
    events: ["workflow.note.added"],
    errors: ["Fails when body is empty."],
    example: 'await ctx.notes.add({ title: "Risk", body: "Migration touches public contracts." });',
  },
  {
    name: "ctx.tasks.propose",
    signature:
      "ctx.tasks.propose(input: { title: string; reason?: string; kind: string; assignee?: string; prompt: string }): Promise<WorkflowTask>",
    description: "Creates a workflow task proposal for policy-driven acceptance or rejection.",
    capabilities: ["workflow.tasks"],
    events: ["workflow.task.proposed"],
    errors: ["Fails when title, kind, or prompt is invalid."],
    example:
      'await ctx.tasks.propose({ title: "Research provider API", kind: "research", prompt: "Find provider constraints." });',
  },
  {
    name: "ctx.tasks.accept",
    signature: "ctx.tasks.accept(taskId: string): Promise<void>",
    description: "Marks a proposed task accepted.",
    capabilities: ["workflow.tasks"],
    events: ["workflow.task.accepted"],
    errors: ["Fails when the task does not exist or is not proposed."],
    example: "await ctx.tasks.accept(task.id);",
  },
  {
    name: "ctx.tasks.reject",
    signature: "ctx.tasks.reject(taskId: string, reason?: string): Promise<void>",
    description: "Rejects a proposed task with optional rationale.",
    capabilities: ["workflow.tasks"],
    events: ["workflow.task.rejected"],
    errors: ["Fails when the task does not exist."],
    example: 'await ctx.tasks.reject(task.id, "Out of scope for this run.");',
  },
  {
    name: "ctx.tasks.run",
    signature: "ctx.tasks.run(taskId: string): Promise<unknown>",
    description: "Runs an accepted task through the assignee agent or workflow policy.",
    capabilities: ["workflow.tasks", "workflow.agents"],
    events: ["workflow.task.started", "workflow.task.completed", "workflow.task.failed"],
    errors: ["Fails when the task is not accepted or the assignee turn fails."],
    example: "const result = await ctx.tasks.run(task.id);",
  },
  {
    name: "ctx.ui.ask",
    signature:
      "ctx.ui.ask(input: { title: string; body?: string; fields: unknown }): Promise<Record<string, unknown>>",
    description:
      "Pauses the workflow for structured user input surfaced in Fenrir UI, then resumes with the response.",
    capabilities: ["workflow.user_input"],
    events: ["workflow.input.requested", "workflow.input.resolved", "workflow.run.paused"],
    errors: ["Fails when the request is cancelled or the run is stopped."],
    example:
      'const answer = await ctx.ui.ask({ title: "Run implementation task?", fields: [{ type: "confirm", name: "accept" }] });',
  },
];

export const WORKFLOW_REFERENCE_EXAMPLES: ReadonlyArray<{
  readonly title: string;
  readonly source: string;
}> = [
  {
    title: "Basic agent team",
    source: `export default async function run(ctx, args) {
  const planner = ctx.team.agent("planner", {
    role: "Create plans, identify risk, and decide task routing.",
  });
  const implementer = ctx.team.agent("implementer", {
    role: "Apply accepted changes and report blockers.",
  });

  const plan = await ctx.step("plan", () =>
    planner.ask("Create a short implementation plan from the workflow args."),
  );

  await ctx.step("implement", () =>
    implementer.ask(\`Implement this plan:\\n\${plan.text ?? plan}\`),
  );
}`,
  },
  {
    title: "Memory-aware prompt build",
    source: `export default async function run(ctx, args) {
  const reviewer = ctx.team.agent("reviewer", {
    role: "Review code using repository conventions and prior workflow memory.",
  });

  const prompt = await ctx.context.build({
    goal: args.goal ?? "Review the current changes.",
    agentName: "reviewer",
    memoryKinds: ["repo_fact", "failure_pattern", "prompt_hint"],
  });

  const result = await ctx.step("review", () => reviewer.ask(prompt.prompt));
  await ctx.memory.remember({
    kind: "prompt_hint",
    content: "For this workflow, include failing checks before final recommendations.",
    confidence: 0.7,
  });
  return result;
}`,
  },
  {
    title: "User input gate",
    source: `export default async function run(ctx) {
  const answer = await ctx.ui.ask({
    title: "Accept implementation-expanding task?",
    fields: [{ type: "confirm", name: "accept", label: "Run implementation" }],
  });

  if (!answer.accept) {
    await ctx.log("User declined implementation.");
    return;
  }

  await ctx.tasks.propose({
    title: "Implementation",
    kind: "implementation",
    prompt: "Implement the accepted workflow task.",
  });
}`,
  },
];

function sectionAllows(
  selected: WorkflowReferenceSection | undefined,
  section: WorkflowReferenceSection,
): boolean {
  return selected === undefined || selected === section;
}

function markdownForApiEntry(entry: WorkflowRuntimeApiEntry): string {
  return [
    `### ${entry.name}`,
    "",
    `Signature: \`${entry.signature}\``,
    "",
    entry.description,
    "",
    `Capabilities: ${entry.capabilities.length > 0 ? entry.capabilities.map((capability) => `\`${capability}\``).join(", ") : "none"}`,
    `Events: ${entry.events.length > 0 ? entry.events.map((event) => `\`${event}\``).join(", ") : "none"}`,
    "",
    "Errors:",
    ...entry.errors.map((error) => `- ${error}`),
    "",
    "Example:",
    "",
    "```js",
    entry.example,
    "```",
  ].join("\n");
}

export function buildWorkflowReferenceMarkdown(section?: WorkflowReferenceSection): string {
  const parts: string[] = [
    "# Fenrir Workflow Runtime API Reference",
    "",
    `Reference version: ${WORKFLOW_REFERENCE_VERSION}`,
    "",
  ];

  if (sectionAllows(section, "overview")) {
    parts.push(
      "## Overview",
      "",
      "Workflow source must export `default async function run(ctx, args)`. Fenrir executes the source in an isolated runtime and exposes only the documented `ctx` API. Do not import Fenrir internals, do not use raw filesystem, shell, database, network, or MCP access, and do not infer APIs from Fenrir source code.",
      "",
      "Workflows are context orchestrators: they build prompts, coordinate named agents, maintain state, record events, use memory, and request controlled Fenrir capabilities.",
      "",
    );
  }

  if (sectionAllows(section, "ctx")) {
    parts.push("## Context API", "", ...WORKFLOW_RUNTIME_API_REGISTRY.map(markdownForApiEntry), "");
  }

  if (sectionAllows(section, "capabilities")) {
    parts.push(
      "## Capabilities",
      "",
      "- Capabilities are declared by the workflow definition and enforced by Fenrir Runtime.",
      "- Every capability call must be event-logged with run, step, and workflow provenance.",
      "- `workspace.read`, `workspace.search`, and workflow state APIs are the safe defaults.",
      "- `fs.write`, shell, raw DB, raw network, raw Fenrir imports, and unrestricted filesystem access are not default capabilities.",
      "",
    );
  }

  if (sectionAllows(section, "errors")) {
    parts.push(
      "## Errors And Recovery",
      "",
      "- Runtime API calls reject with actionable errors instead of exposing raw internals.",
      "- Use `ctx.step` boundaries around meaningful work so failures are visible in the timeline.",
      "- Use `ctx.ui.ask` when policy requires user approval before expanding implementation scope.",
      "- Use `ctx.memory.remember` for durable lessons, not for transient run state.",
      "",
    );
  }

  if (sectionAllows(section, "examples")) {
    parts.push(
      "## Examples",
      "",
      ...WORKFLOW_REFERENCE_EXAMPLES.flatMap((example) => [
        `### ${example.title}`,
        "",
        "```js",
        example.source,
        "```",
        "",
      ]),
    );
  }

  return parts.join("\n").trimEnd();
}

export function buildWorkflowReferenceJson(section?: WorkflowReferenceSection): unknown {
  return {
    referenceVersion: WORKFLOW_REFERENCE_VERSION,
    ...(sectionAllows(section, "overview")
      ? {
          overview: {
            sourceContract: "export default async function run(ctx, args)",
            purpose:
              "Fenrir workflows orchestrate context, agents, state, memory, capabilities, and timeline events.",
            forbidden:
              "Do not import Fenrir internals or use raw filesystem, shell, database, network, MCP, or unrestricted runtime access.",
          },
        }
      : {}),
    ...(sectionAllows(section, "ctx") ? { ctx: WORKFLOW_RUNTIME_API_REGISTRY } : {}),
    ...(sectionAllows(section, "capabilities")
      ? {
          capabilities: {
            defaultSafe: ["workflow.step", "workflow.events", "workflow.state", "workflow.agents"],
            nonDefault: ["fs.write", "shell", "raw.db", "raw.network", "raw.mcp"],
          },
        }
      : {}),
    ...(sectionAllows(section, "errors")
      ? {
          errors: {
            guidance: [
              "Use ctx.step boundaries for visible failure provenance.",
              "Use ctx.ui.ask before expanding implementation scope when policy requires approval.",
              "Use workflow memory for durable lessons and state for transient run data.",
            ],
          },
        }
      : {}),
    ...(sectionAllows(section, "examples") ? { examples: WORKFLOW_REFERENCE_EXAMPLES } : {}),
  };
}

export function issueWorkflowReferenceReceipt(
  sessionId: string,
  issuedAt: Date = new Date(),
): WorkflowReferenceReceipt {
  const readToken = randomBytes(24).toString("base64url");
  const expiresAtMs = issuedAt.getTime() + WORKFLOW_REFERENCE_TOKEN_TTL_MS;
  const receipt: StoredReferenceReceipt = {
    sessionId,
    referenceVersion: WORKFLOW_REFERENCE_VERSION,
    readToken,
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
  };
  referenceReceipts.set(readToken, receipt);
  return {
    referenceVersion: receipt.referenceVersion,
    readToken: receipt.readToken,
    expiresAt: receipt.expiresAt,
  };
}

export function validateWorkflowReferenceReceipt(input: {
  readonly sessionId: string;
  readonly referenceVersion: string;
  readonly readToken: string;
  readonly now?: Date | undefined;
}): { readonly valid: true } | { readonly valid: false; readonly message: string } {
  if (input.referenceVersion !== WORKFLOW_REFERENCE_VERSION) {
    return {
      valid: false,
      message:
        "Workflow reference is stale. Call workflow_reference before creating or updating workflow source.",
    };
  }

  const receipt = referenceReceipts.get(input.readToken);
  if (!receipt) {
    return {
      valid: false,
      message:
        "Workflow reference has not been read. Call workflow_reference before creating or updating workflow source.",
    };
  }

  if (receipt.sessionId !== input.sessionId) {
    return {
      valid: false,
      message:
        "Workflow reference token belongs to a different MCP session. Call workflow_reference before creating or updating workflow source.",
    };
  }

  if (receipt.referenceVersion !== input.referenceVersion) {
    return {
      valid: false,
      message:
        "Workflow reference version mismatch. Call workflow_reference before creating or updating workflow source.",
    };
  }

  if ((input.now ?? new Date()).getTime() > receipt.expiresAtMs) {
    referenceReceipts.delete(input.readToken);
    return {
      valid: false,
      message:
        "Workflow reference token expired. Call workflow_reference before creating or updating workflow source.",
    };
  }

  return { valid: true };
}

export function workflowReferenceResponse(input: {
  readonly sessionId: string;
  readonly format?: WorkflowReferenceFormat | undefined;
  readonly section?: WorkflowReferenceSection | undefined;
}): WorkflowReferenceReceipt & { readonly content: unknown } {
  const receipt = issueWorkflowReferenceReceipt(input.sessionId);
  const format = input.format ?? "markdown";
  return {
    ...receipt,
    content:
      format === "json"
        ? buildWorkflowReferenceJson(input.section)
        : buildWorkflowReferenceMarkdown(input.section),
  };
}
