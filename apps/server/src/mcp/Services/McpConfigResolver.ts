import type { McpServerId, ResolvedMcpServerConfig, ServerSettings } from "@fenrir/contracts";
import { Schema, Context } from "effect";
import type { Effect } from "effect";

export class McpConfigResolverError extends Schema.TaggedErrorClass<McpConfigResolverError>()(
  "McpConfigResolverError",
  {
    message: Schema.String,
  },
) {}

export interface ResolveMcpServersInput {
  readonly selectedServerIds: ReadonlyArray<McpServerId>;
  readonly settings: ServerSettings;
  readonly environment?: NodeJS.ProcessEnv;
}

export interface ResolvedMcpServers {
  readonly serverIds: ReadonlyArray<McpServerId>;
  readonly servers: ReadonlyArray<ResolvedMcpServerConfig>;
  readonly configHash: string;
}

export interface McpConfigResolverShape {
  readonly resolve: (
    input: ResolveMcpServersInput,
  ) => Effect.Effect<ResolvedMcpServers, McpConfigResolverError>;
}

export class McpConfigResolver extends Context.Service<McpConfigResolver, McpConfigResolverShape>()(
  "fenrir/mcp/Services/McpConfigResolver",
) {}
