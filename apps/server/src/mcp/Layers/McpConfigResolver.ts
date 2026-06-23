import type {
  McpServerDefinition,
  McpServerId,
  McpValueRef,
  ResolvedMcpServerConfig,
} from "@fenrir/contracts";
import {
  getFenrirBuiltInMcpServers,
  FENRIR_BROWSER_LAB_MCP_ID,
  FENRIR_REMOTE_HOST_MCP_ID,
  FENRIR_WORKFLOWS_MCP_ID,
} from "@fenrir/shared/mcpBuiltIns";
import { Effect, Layer, Option } from "effect";

import { ServerConfig } from "../../config.ts";
import {
  McpConfigResolver,
  McpConfigResolverError,
  type McpConfigResolverShape,
} from "../Services/McpConfigResolver";
import {
  getBrowserLabMcpBackendUrl,
  getBrowserLabMcpRunnerEnv,
  getBrowserLabMcpToken,
  resolveBrowserLabMcpRunnerPath,
} from "../browserLabMcpRuntime.ts";
import {
  getRemoteHostMcpBackendUrl,
  getRemoteHostMcpRunnerEnv,
  getRemoteHostMcpToken,
  resolveRemoteHostMcpRunnerPath,
} from "../remoteHostMcpRuntime.ts";
import {
  getWorkflowMcpBackendUrl,
  getWorkflowMcpRunnerEnv,
  getWorkflowMcpToken,
  resolveWorkflowMcpRunnerPath,
} from "../workflowMcpRuntime.ts";
import { hashResolvedMcpServers } from "../mcpConfigHash.ts";

function mergeDefinitions(
  settings: { readonly disabledBuiltInMcpServerIds: ReadonlyArray<McpServerId> },
  configured: Record<string, McpServerDefinition>,
): Map<string, McpServerDefinition> {
  const definitions = new Map<string, McpServerDefinition>();
  for (const server of getFenrirBuiltInMcpServers(settings)) {
    definitions.set(server.id, server);
  }
  for (const server of Object.values(configured)) {
    definitions.set(server.id, server);
  }
  return definitions;
}

function resolveValue(
  label: string,
  value: McpValueRef,
  environment: NodeJS.ProcessEnv,
): Effect.Effect<string, McpConfigResolverError> {
  switch (value.type) {
    case "literal":
      return Effect.succeed(value.value);
    case "env": {
      const resolved = environment[value.name];
      return resolved === undefined
        ? Effect.fail(
            new McpConfigResolverError({
              message: `MCP value '${label}' references missing environment variable '${value.name}'.`,
            }),
          )
        : Effect.succeed(resolved);
    }
    case "secret":
      return Effect.fail(
        new McpConfigResolverError({
          message: `MCP value '${label}' references secret '${value.secretId}', but Fenrir secret-backed MCP values are not wired yet.`,
        }),
      );
  }
}

function resolveValueRecord(
  values: Record<string, McpValueRef>,
  environment: NodeJS.ProcessEnv,
): Effect.Effect<Record<string, string>, McpConfigResolverError> {
  return Effect.forEach(Object.entries(values), ([key, value]) =>
    resolveValue(key, value, environment).pipe(Effect.map((resolved) => [key, resolved] as const)),
  ).pipe(Effect.map((entries) => Object.fromEntries(entries)));
}

function resolveServer(
  server: McpServerDefinition,
  environment: NodeJS.ProcessEnv,
  runtime: {
    readonly browserLabRunnerPath: string;
    readonly browserLabBackendUrl: string;
    readonly browserLabToken: string;
    readonly remoteHostRunnerPath: string;
    readonly remoteHostBackendUrl: string;
    readonly remoteHostToken: string;
    readonly workflowRunnerPath: string;
    readonly workflowBackendUrl: string;
    readonly workflowToken: string;
  },
): Effect.Effect<ResolvedMcpServerConfig, McpConfigResolverError> {
  if (server.id === FENRIR_BROWSER_LAB_MCP_ID) {
    return Effect.succeed({
      id: server.id,
      name: server.name,
      transport: {
        type: "stdio",
        command: process.execPath,
        args: [runtime.browserLabRunnerPath],
        env: {
          ...getBrowserLabMcpRunnerEnv(),
          FENRIR_MCP_BACKEND_URL: runtime.browserLabBackendUrl,
          FENRIR_MCP_TOKEN: runtime.browserLabToken,
        },
      },
    });
  }
  if (server.id === FENRIR_REMOTE_HOST_MCP_ID) {
    return Effect.succeed({
      id: server.id,
      name: server.name,
      transport: {
        type: "stdio",
        command: process.execPath,
        args: [runtime.remoteHostRunnerPath],
        env: {
          ...getRemoteHostMcpRunnerEnv(),
          FENRIR_MCP_BACKEND_URL: runtime.remoteHostBackendUrl,
          FENRIR_MCP_TOKEN: runtime.remoteHostToken,
        },
      },
    });
  }
  if (server.id === FENRIR_WORKFLOWS_MCP_ID) {
    const projectId = environment.FENRIR_MCP_WORKFLOW_PROJECT_ID?.trim();
    const threadId = environment.FENRIR_MCP_WORKFLOW_THREAD_ID?.trim();
    const mode =
      environment.FENRIR_MCP_WORKFLOW_MODE?.trim() === "collaboration"
        ? "collaboration"
        : "management";
    const runId = environment.FENRIR_MCP_WORKFLOW_RUN_ID?.trim();
    const agentName = environment.FENRIR_MCP_WORKFLOW_AGENT_NAME?.trim();
    if (!projectId || !threadId) {
      return Effect.fail(
        new McpConfigResolverError({
          message: "Workflow MCP server requires active project and thread context.",
        }),
      );
    }
    if (mode === "collaboration" && (!runId || !agentName)) {
      return Effect.fail(
        new McpConfigResolverError({
          message:
            "Workflow collaboration MCP server requires active workflow run and agent context.",
        }),
      );
    }
    return Effect.succeed({
      id: server.id,
      name: server.name,
      transport: {
        type: "stdio",
        command: process.execPath,
        args: [runtime.workflowRunnerPath],
        env: {
          ...getWorkflowMcpRunnerEnv(),
          FENRIR_MCP_BACKEND_URL: runtime.workflowBackendUrl,
          FENRIR_MCP_TOKEN: runtime.workflowToken,
          FENRIR_MCP_WORKFLOW_PROJECT_ID: projectId,
          FENRIR_MCP_WORKFLOW_THREAD_ID: threadId,
          FENRIR_MCP_WORKFLOW_MODE: mode,
          ...(runId ? { FENRIR_MCP_WORKFLOW_RUN_ID: runId } : {}),
          ...(agentName ? { FENRIR_MCP_WORKFLOW_AGENT_NAME: agentName } : {}),
        },
      },
    });
  }

  const transport = server.transport;
  switch (transport.type) {
    case "stdio":
      return resolveValueRecord(transport.env, environment).pipe(
        Effect.map((env) => ({
          id: server.id,
          name: server.name,
          transport: {
            type: "stdio" as const,
            command: transport.command,
            args: transport.args,
            env,
            ...(transport.cwd ? { cwd: transport.cwd } : {}),
          },
        })),
      );
    case "http":
      if (!URL.canParse(transport.url)) {
        return Effect.fail(
          new McpConfigResolverError({
            message: `MCP server '${server.name}' has an invalid HTTP URL.`,
          }),
        );
      }
      return resolveValueRecord(transport.headers, environment).pipe(
        Effect.map((headers) => ({
          id: server.id,
          name: server.name,
          transport: {
            type: "http" as const,
            url: transport.url,
            headers,
          },
        })),
      );
    case "sse":
      if (!URL.canParse(transport.url)) {
        return Effect.fail(
          new McpConfigResolverError({
            message: `MCP server '${server.name}' has an invalid SSE URL.`,
          }),
        );
      }
      return resolveValueRecord(transport.headers, environment).pipe(
        Effect.map((headers) => ({
          id: server.id,
          name: server.name,
          transport: {
            type: "sse" as const,
            url: transport.url,
            headers,
          },
        })),
      );
  }
}

export const McpConfigResolverLive = Layer.effect(
  McpConfigResolver,
  Effect.gen(function* () {
    const config = Option.getOrUndefined(yield* Effect.serviceOption(ServerConfig));
    const runtime = {
      browserLabRunnerPath: resolveBrowserLabMcpRunnerPath(),
      browserLabBackendUrl: getBrowserLabMcpBackendUrl(config),
      browserLabToken: getBrowserLabMcpToken(),
      remoteHostRunnerPath: resolveRemoteHostMcpRunnerPath(),
      remoteHostBackendUrl: getRemoteHostMcpBackendUrl(config),
      remoteHostToken: getRemoteHostMcpToken(),
      workflowRunnerPath: resolveWorkflowMcpRunnerPath(),
      workflowBackendUrl: getWorkflowMcpBackendUrl(config),
      workflowToken: getWorkflowMcpToken(),
    };
    return {
      resolve: (input) =>
        Effect.gen(function* () {
          const definitions = mergeDefinitions(input.settings, input.settings.mcpServers);
          const uniqueIds = Array.from(new Set(input.selectedServerIds)) as McpServerId[];
          const servers = yield* Effect.forEach(uniqueIds, (serverId) => {
            const definition = definitions.get(serverId);
            if (!definition) {
              return Effect.fail(
                new McpConfigResolverError({ message: `Unknown MCP server '${serverId}'.` }),
              );
            }
            if (!definition.enabled) {
              return Effect.fail(
                new McpConfigResolverError({
                  message: `MCP server '${definition.name}' is disabled.`,
                }),
              );
            }
            return resolveServer(definition, input.environment ?? process.env, runtime);
          });
          return {
            serverIds: uniqueIds,
            servers,
            configHash: hashResolvedMcpServers(servers),
          };
        }),
    } satisfies McpConfigResolverShape;
  }),
);
