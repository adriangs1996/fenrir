#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const requestLogPath = process.env.T3_ACP_REQUEST_LOG_PATH;
const exitLogPath = process.env.T3_ACP_EXIT_LOG_PATH;
const emitToolCalls = process.env.T3_ACP_EMIT_TOOL_CALLS === "1";
const emitInterleavedAssistantToolCalls =
  process.env.T3_ACP_EMIT_INTERLEAVED_ASSISTANT_TOOL_CALLS === "1";
const emitGenericToolPlaceholders = process.env.T3_ACP_EMIT_GENERIC_TOOL_PLACEHOLDERS === "1";
const emitAskQuestion = process.env.T3_ACP_EMIT_ASK_QUESTION === "1";
const failSetConfigOption = process.env.T3_ACP_FAIL_SET_CONFIG_OPTION === "1";
const exitOnSetConfigOption = process.env.T3_ACP_EXIT_ON_SET_CONFIG_OPTION === "1";
const promptResponseText = process.env.T3_ACP_PROMPT_RESPONSE_TEXT;
const sessionId = "mock-session-1";

let currentModeId = "ask";
let currentModelId = "default";
let parameterizedModelPicker = false;
let currentReasoning = "medium";
let currentContext = "272k";
let currentFast = false;
let nextRequestId = 1;
const cancelledSessions = new Set<string>();
const pendingRequests = new Map<string, (value: unknown) => void>();

function logExit(reason: string): void {
  if (!exitLogPath) {
    return;
  }
  appendFileSync(exitLogPath, `${reason}\n`, "utf8");
}

function logMessage(direction: "in" | "out", payload: unknown): void {
  if (!requestLogPath) {
    return;
  }
  appendFileSync(requestLogPath, `${direction} ${JSON.stringify(payload)}\n`, "utf8");
}

process.once("SIGTERM", () => {
  logExit("SIGTERM");
  process.exit(0);
});

process.once("SIGINT", () => {
  logExit("SIGINT");
  process.exit(0);
});

process.once("exit", (code) => {
  logExit(`exit:${code}`);
});

const availableModes = [
  {
    id: "ask",
    name: "Ask",
    description: "Request permission before making any changes",
  },
  {
    id: "architect",
    name: "Architect",
    description: "Design and plan software systems without implementation",
  },
  {
    id: "code",
    name: "Code",
    description: "Write and modify code with full tool access",
  },
] as const;

function modeState() {
  return {
    currentModeId,
    availableModes,
  };
}

function configOptions() {
  if (parameterizedModelPicker) {
    const baseOptions = [
      {
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select",
        currentValue: currentModeId,
        options: availableModes.map((mode) => {
          const option: { value: string; name: string; description?: string } = {
            value: mode.id,
            name: mode.name,
          };
          if (mode.description) {
            option.description = mode.description;
          }
          return option;
        }),
      },
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: currentModelId,
        options: [
          { value: "default", name: "Auto" },
          { value: "composer-2", name: "Composer 2" },
          { value: "gpt-5.4", name: "GPT-5.4" },
          { value: "claude-opus-4-6", name: "Opus 4.6" },
        ],
      },
    ];

    switch (currentModelId) {
      case "gpt-5.4":
        return [
          ...baseOptions,
          {
            id: "reasoning",
            name: "Reasoning",
            category: "thought_level",
            type: "select",
            currentValue: currentReasoning,
            options: [
              { value: "none", name: "None" },
              { value: "low", name: "Low" },
              { value: "medium", name: "Medium" },
              { value: "high", name: "High" },
              { value: "extra-high", name: "Extra High" },
            ],
          },
          {
            id: "context",
            name: "Context",
            category: "model_config",
            type: "select",
            currentValue: currentContext,
            options: [
              { value: "272k", name: "272K" },
              { value: "1m", name: "1M" },
            ],
          },
          {
            id: "fast",
            name: "Fast",
            category: "model_config",
            type: "select",
            currentValue: String(currentFast),
            options: [
              { value: "false", name: "Off" },
              { value: "true", name: "Fast" },
            ],
          },
        ];
      case "composer-2":
        return [
          ...baseOptions,
          {
            id: "fast",
            name: "Fast",
            category: "model_config",
            type: "select",
            currentValue: String(currentFast),
            options: [
              { value: "false", name: "Off" },
              { value: "true", name: "Fast" },
            ],
          },
        ];
      case "claude-opus-4-6":
        return [
          ...baseOptions,
          {
            id: "reasoning",
            name: "Reasoning",
            category: "thought_level",
            type: "select",
            currentValue: currentReasoning,
            options: [
              { value: "low", name: "Low" },
              { value: "medium", name: "Medium" },
              { value: "high", name: "High" },
            ],
          },
          {
            id: "thinking",
            name: "Thinking",
            category: "model_config",
            type: "boolean",
            currentValue: true,
          },
        ];
      default:
        return baseOptions;
    }
  }

  return [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: currentModelId,
      options: [
        { value: "default", name: "Auto" },
        { value: "composer-2", name: "Composer 2" },
        { value: "composer-2[fast=true]", name: "Composer 2 Fast" },
        { value: "gpt-5.3-codex[reasoning=medium,fast=false]", name: "Codex 5.3" },
      ],
    },
  ];
}

function send(payload: unknown): void {
  logMessage("out", payload);
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function respondSuccess(id: number | string, result: unknown): void {
  send({
    jsonrpc: "2.0",
    id,
    result,
  });
}

function respondError(id: number | string, code: number, message: string, data?: unknown): void {
  send({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  });
}

function notify(method: string, params: unknown): void {
  send({
    jsonrpc: "2.0",
    method,
    params,
  });
}

async function requestClient(method: string, params: unknown): Promise<unknown> {
  const id = nextRequestId++;
  const promise = new Promise<unknown>((resolve) => {
    pendingRequests.set(String(id), resolve);
  });
  send({
    jsonrpc: "2.0",
    id,
    method,
    params,
  });
  return await promise;
}

async function emitPromptFlow(requestedSessionId: string): Promise<{ stopReason: string }> {
  if (emitInterleavedAssistantToolCalls) {
    const toolCallId = "tool-call-1";

    notify("session/update", {
      sessionId: requestedSessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "before tool" },
      },
    });

    notify("session/update", {
      sessionId: requestedSessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId,
        title: "Terminal",
        kind: "execute",
        status: "pending",
        rawInput: {
          command: ["echo", "hello"],
        },
      },
    });

    notify("session/update", {
      sessionId: requestedSessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "completed",
        rawOutput: {
          exitCode: 0,
          stdout: "hello",
          stderr: "",
        },
      },
    });

    notify("session/update", {
      sessionId: requestedSessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "after tool" },
      },
    });

    return { stopReason: "end_turn" };
  }

  if (emitToolCalls) {
    const toolCallId = "tool-call-1";

    notify("session/update", {
      sessionId: requestedSessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId,
        title: "Terminal",
        kind: "execute",
        status: "pending",
        rawInput: {
          command: ["cat", "server/package.json"],
        },
      },
    });

    notify("session/update", {
      sessionId: requestedSessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "in_progress",
      },
    });

    const permission = (await requestClient("session/request_permission", {
      sessionId: requestedSessionId,
      toolCall: {
        toolCallId,
        title: "`cat server/package.json`",
        kind: "execute",
        status: "pending",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: "Not in allowlist: cat server/package.json",
            },
          },
        ],
      },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "allow-always", name: "Allow always", kind: "allow_always" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" },
      ],
    })) as { outcome?: { outcome?: string } };

    const cancelled =
      cancelledSessions.delete(requestedSessionId) || permission?.outcome?.outcome === "cancelled";

    notify("session/update", {
      sessionId: requestedSessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId,
        title: "Terminal",
        kind: "execute",
        status: "completed",
        rawOutput: {
          exitCode: 0,
          stdout: '{ "name": "t3" }',
          stderr: "",
        },
      },
    });

    notify("session/update", {
      sessionId: requestedSessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hello from mock" },
      },
    });

    return { stopReason: cancelled ? "cancelled" : "end_turn" };
  }

  if (emitGenericToolPlaceholders) {
    const toolCallId = "tool-call-generic-1";

    notify("session/update", {
      sessionId: requestedSessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId,
        title: "Read File",
        kind: "read",
        status: "pending",
        rawInput: {},
      },
    });

    notify("session/update", {
      sessionId: requestedSessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "in_progress",
      },
    });

    notify("session/update", {
      sessionId: requestedSessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "completed",
        rawOutput: {
          content: "package.json\n",
        },
      },
    });

    return { stopReason: "end_turn" };
  }

  if (emitAskQuestion) {
    await requestClient("cursor/ask_question", {
      toolCallId: "ask-question-tool-call-1",
      title: "Question",
      questions: [
        {
          id: "scope",
          prompt: "Which scope?",
          options: [
            { id: "workspace", label: "Workspace" },
            { id: "session", label: "Session" },
          ],
        },
      ],
    });

    return { stopReason: "end_turn" };
  }

  notify("session/update", {
    sessionId: requestedSessionId,
    update: {
      sessionUpdate: "plan",
      entries: [
        {
          content: "Inspect mock ACP state",
          priority: "high",
          status: "completed",
        },
        {
          content: "Implement the requested change",
          priority: "high",
          status: "in_progress",
        },
      ],
    },
  });

  notify("session/update", {
    sessionId: requestedSessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: promptResponseText ?? "hello from mock" },
    },
  });

  return { stopReason: "end_turn" };
}

async function handleRequest(message: {
  id: number | string;
  method: string;
  params?: any;
}): Promise<void> {
  switch (message.method) {
    case "initialize": {
      parameterizedModelPicker =
        message.params?.clientCapabilities?._meta?.parameterizedModelPicker === true;
      respondSuccess(message.id, {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true },
      });
      return;
    }
    case "authenticate": {
      respondSuccess(message.id, {});
      return;
    }
    case "session/new": {
      respondSuccess(message.id, {
        sessionId,
        modes: modeState(),
        configOptions: configOptions(),
      });
      return;
    }
    case "session/load": {
      notify("session/update", {
        sessionId: String(message.params?.sessionId ?? sessionId),
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "replay" },
        },
      });
      respondSuccess(message.id, {
        modes: modeState(),
        configOptions: configOptions(),
      });
      return;
    }
    case "session/set_config_option": {
      if (exitOnSetConfigOption) {
        process.exit(7);
      }
      if (failSetConfigOption) {
        respondError(message.id, -32602, "Mock invalid params for session/set_config_option", {
          method: "session/set_config_option",
          params: message.params,
        });
        return;
      }
      if (message.params?.configId === "mode" && typeof message.params?.value === "string") {
        currentModeId = message.params.value;
      }
      if (message.params?.configId === "model" && typeof message.params?.value === "string") {
        currentModelId = message.params.value;
      }
      if (message.params?.configId === "reasoning" && typeof message.params?.value === "string") {
        currentReasoning = message.params.value;
      }
      if (message.params?.configId === "context" && typeof message.params?.value === "string") {
        currentContext = message.params.value;
      }
      if (message.params?.configId === "fast") {
        currentFast = message.params.value === true || message.params.value === "true";
      }
      respondSuccess(message.id, {
        configOptions: configOptions(),
      });
      return;
    }
    case "session/prompt": {
      const result = await emitPromptFlow(String(message.params?.sessionId ?? sessionId));
      respondSuccess(message.id, result);
      return;
    }
    case "session/mode/set": {
      if (typeof message.params?.modeId === "string") {
        currentModeId = message.params.modeId;
      }
      respondSuccess(message.id, {
        currentModeId,
      });
      return;
    }
    default: {
      respondSuccess(message.id, {
        echoedMethod: message.method,
        echoedParams: message.params ?? null,
      });
    }
  }
}

function handleNotification(message: { method: string; params?: any }): void {
  if (message.method === "session/cancel") {
    cancelledSessions.add(String(message.params?.sessionId ?? sessionId));
    return;
  }
  if (message.method === "@effect/rpc/Ping") {
    notify("@effect/rpc/Pong", undefined);
  }
}

function handleResponse(message: { id: number | string; result?: unknown; error?: unknown }): void {
  const resolve = pendingRequests.get(String(message.id));
  if (!resolve) {
    return;
  }
  pendingRequests.delete(String(message.id));
  if (message.error) {
    resolve({ outcome: { outcome: "cancelled" }, error: message.error });
    return;
  }
  resolve(message.result);
}

async function handleMessage(message: any): Promise<void> {
  logMessage("in", message);

  if (message && typeof message === "object" && "id" in message && !("method" in message)) {
    handleResponse(message as { id: number | string; result?: unknown; error?: unknown });
    return;
  }

  if (!message || typeof message !== "object" || typeof message.method !== "string") {
    return;
  }

  if ("id" in message && message.id !== undefined && message.id !== "") {
    await handleRequest(message as { id: number | string; method: string; params?: any });
    return;
  }

  handleNotification(message as { method: string; params?: any });
}

async function main(): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    try {
      const decoded = JSON.parse(trimmed);
      if (Array.isArray(decoded)) {
        for (const message of decoded) {
          await handleMessage(message);
        }
      } else {
        await handleMessage(decoded);
      }
    } catch (error) {
      appendFileSync(
        process.stderr.fd,
        `mock-agent parse error: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
}

void main();
