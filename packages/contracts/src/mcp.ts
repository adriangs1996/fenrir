import { Effect, Schema } from "effect";
import { makeEntityId, TrimmedNonEmptyString } from "./baseSchemas";

export const McpServerId = makeEntityId("McpServerId");
export type McpServerId = typeof McpServerId.Type;

export const McpValueRef = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("literal"),
    value: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("env"),
    name: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    type: Schema.Literal("secret"),
    secretId: TrimmedNonEmptyString,
  }),
]);
export type McpValueRef = typeof McpValueRef.Type;

const McpValueMap = Schema.Record(TrimmedNonEmptyString, McpValueRef);

export const McpServerTransport = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("stdio"),
    command: TrimmedNonEmptyString,
    args: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
    env: McpValueMap.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    cwd: Schema.optional(TrimmedNonEmptyString),
  }),
  Schema.Struct({
    type: Schema.Literal("http"),
    url: TrimmedNonEmptyString,
    headers: McpValueMap.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  }),
  Schema.Struct({
    type: Schema.Literal("sse"),
    url: TrimmedNonEmptyString,
    headers: McpValueMap.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  }),
]);
export type McpServerTransport = typeof McpServerTransport.Type;

export const McpServerDefinition = Schema.Struct({
  id: McpServerId,
  name: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  source: Schema.Literals(["user", "fenrir"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("user")),
  ),
  transport: McpServerTransport,
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
});
export type McpServerDefinition = typeof McpServerDefinition.Type;

export const ThreadMcpSelection = Schema.Struct({
  serverIds: Schema.Array(McpServerId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type ThreadMcpSelection = typeof ThreadMcpSelection.Type;

export const ResolvedMcpServerTransport = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("stdio"),
    command: TrimmedNonEmptyString,
    args: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
    env: Schema.Record(Schema.String, Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed({})),
    ),
    cwd: Schema.optional(TrimmedNonEmptyString),
  }),
  Schema.Struct({
    type: Schema.Literal("http"),
    url: TrimmedNonEmptyString,
    headers: Schema.Record(Schema.String, Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed({})),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("sse"),
    url: TrimmedNonEmptyString,
    headers: Schema.Record(Schema.String, Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed({})),
    ),
  }),
]);
export type ResolvedMcpServerTransport = typeof ResolvedMcpServerTransport.Type;

export const ResolvedMcpServerConfig = Schema.Struct({
  id: McpServerId,
  name: TrimmedNonEmptyString,
  transport: ResolvedMcpServerTransport,
});
export type ResolvedMcpServerConfig = typeof ResolvedMcpServerConfig.Type;
