import { Duration, Effect } from "effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { TrimmedNonEmptyString, TrimmedString } from "./baseSchemas";
import { DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER, ProviderOptionSelections } from "./model";
import { McpServerDefinition, McpServerId } from "./mcp";
import { ModelSelection, ProviderSelectionKind } from "./orchestration";
import { ProviderInstanceConfigMap } from "./providerInstance";

// ── Client Settings (local-only) ───────────────────────────────

export const TimestampFormat = Schema.Literals(["locale", "12-hour", "24-hour"]);
export type TimestampFormat = typeof TimestampFormat.Type;
export const DEFAULT_TIMESTAMP_FORMAT: TimestampFormat = "locale";

export const SidebarProjectSortOrder = Schema.Literals(["updated_at", "created_at", "manual"]);
export type SidebarProjectSortOrder = typeof SidebarProjectSortOrder.Type;
export const DEFAULT_SIDEBAR_PROJECT_SORT_ORDER: SidebarProjectSortOrder = "updated_at";

export const SidebarThreadSortOrder = Schema.Literals(["updated_at", "created_at"]);
export type SidebarThreadSortOrder = typeof SidebarThreadSortOrder.Type;
export const DEFAULT_SIDEBAR_THREAD_SORT_ORDER: SidebarThreadSortOrder = "updated_at";

export const EmbeddedEditorKind = Schema.Literals(["neovim", "vscode"]);
export type EmbeddedEditorKind = typeof EmbeddedEditorKind.Type;
export const DEFAULT_EMBEDDED_EDITOR_KIND: EmbeddedEditorKind = "neovim";

export const MIN_SIDEBAR_THREAD_PREVIEW_COUNT = 1;
export const MAX_SIDEBAR_THREAD_PREVIEW_COUNT = 15;
export const SidebarThreadPreviewCount = Schema.Number.pipe(
  Schema.decodeTo(
    Schema.Number,
    SchemaTransformation.transformOrFail({
      decode: (value) =>
        Effect.succeed(
          Math.min(
            MAX_SIDEBAR_THREAD_PREVIEW_COUNT,
            Math.max(MIN_SIDEBAR_THREAD_PREVIEW_COUNT, Math.round(value)),
          ),
        ),
      encode: (value) => Effect.succeed(value),
    }),
  ),
  Schema.withDecodingDefault(Effect.succeed(6)),
);
export type SidebarThreadPreviewCount = typeof SidebarThreadPreviewCount.Type;
export const DEFAULT_SIDEBAR_THREAD_PREVIEW_COUNT: SidebarThreadPreviewCount = 6;

export const ModelFavorite = Schema.Struct({
  provider: ProviderSelectionKind,
  model: TrimmedNonEmptyString,
});
export type ModelFavorite = typeof ModelFavorite.Type;

export const ClientSettingsSchema = Schema.Struct({
  confirmThreadArchive: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  confirmThreadDelete: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  diffIgnoreWhitespace: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  diffWordWrap: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  sidebarProjectSortOrder: SidebarProjectSortOrder.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_SIDEBAR_PROJECT_SORT_ORDER)),
  ),
  sidebarThreadSortOrder: SidebarThreadSortOrder.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_SIDEBAR_THREAD_SORT_ORDER)),
  ),
  sidebarThreadPreviewCount: SidebarThreadPreviewCount.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_SIDEBAR_THREAD_PREVIEW_COUNT)),
  ),
  favorites: Schema.Array(ModelFavorite).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  timestampFormat: TimestampFormat.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_TIMESTAMP_FORMAT)),
  ),
  embeddedEditor: EmbeddedEditorKind.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_EMBEDDED_EDITOR_KIND)),
  ),
  uiFontFamily: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed("Geist Mono"))),
  uiFontSize: Schema.Number.pipe(
    Schema.decodeTo(
      Schema.Number,
      SchemaTransformation.transformOrFail({
        decode: (n) => Effect.succeed(Math.min(Math.max(n, 10), 24)),
        encode: (n) => Effect.succeed(n),
      }),
    ),
    Schema.withDecodingDefault(Effect.succeed(14)),
  ),
  terminalFontFamily: Schema.String.pipe(
    Schema.withDecodingDefault(Effect.succeed("GeistMono Nerd Font")),
  ),
  terminalFontSize: Schema.Number.pipe(
    Schema.decodeTo(
      Schema.Number,
      SchemaTransformation.transformOrFail({
        decode: (n) => Effect.succeed(Math.min(Math.max(n, 8), 24)),
        encode: (n) => Effect.succeed(n),
      }),
    ),
    Schema.withDecodingDefault(Effect.succeed(12)),
  ),
  terminalLineHeight: Schema.Number.pipe(
    Schema.decodeTo(
      Schema.Number,
      SchemaTransformation.transformOrFail({
        decode: (n) => Effect.succeed(Math.min(Math.max(n, 1.0), 2.0)),
        encode: (n) => Effect.succeed(n),
      }),
    ),
    Schema.withDecodingDefault(Effect.succeed(1.2)),
  ),
  editorFontFamily: Schema.String.pipe(
    Schema.withDecodingDefault(Effect.succeed("GeistMono Nerd Font")),
  ),
  editorFontSize: Schema.Number.pipe(
    Schema.decodeTo(
      Schema.Number,
      SchemaTransformation.transformOrFail({
        decode: (n) => Effect.succeed(Math.min(Math.max(n, 8), 32)),
        encode: (n) => Effect.succeed(n),
      }),
    ),
    Schema.withDecodingDefault(Effect.succeed(14)),
  ),
  editorLineHeight: Schema.Number.pipe(
    Schema.decodeTo(
      Schema.Number,
      SchemaTransformation.transformOrFail({
        decode: (n) => Effect.succeed(Math.min(Math.max(n, 1.0), 2.0)),
        encode: (n) => Effect.succeed(n),
      }),
    ),
    Schema.withDecodingDefault(Effect.succeed(1.2)),
  ),
  editorFontWeight: Schema.Number.pipe(
    Schema.decodeTo(
      Schema.Number,
      SchemaTransformation.transformOrFail({
        decode: (n) => Effect.succeed(Math.min(Math.max(Math.round(n / 100) * 100, 100), 900)),
        encode: (n) => Effect.succeed(n),
      }),
    ),
    Schema.withDecodingDefault(Effect.succeed(400)),
  ),
  editorLigatures: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type ClientSettings = typeof ClientSettingsSchema.Type;

export const DEFAULT_CLIENT_SETTINGS: ClientSettings = Schema.decodeSync(ClientSettingsSchema)({});

// ── Server Settings (server-authoritative) ────────────────────

export const ThreadEnvMode = Schema.Literals(["local", "worktree"]);
export type ThreadEnvMode = typeof ThreadEnvMode.Type;

const makeBinaryPathSetting = (fallback: string) =>
  TrimmedString.pipe(
    Schema.decodeTo(
      Schema.String,
      SchemaTransformation.transformOrFail({
        decode: (value) => Effect.succeed(value || fallback),
        encode: (value) => Effect.succeed(value),
      }),
    ),
    Schema.withDecodingDefault(Effect.succeed(fallback)),
  );

export type ProviderSettingsFormControl = "text" | "password" | "textarea" | "switch";

export interface ProviderSettingsFormAnnotation {
  readonly control?: ProviderSettingsFormControl | undefined;
  readonly placeholder?: string | undefined;
  readonly hidden?: boolean | undefined;
  readonly clearWhenEmpty?: "omit" | "persist" | undefined;
}

export interface ProviderSettingsFormSchemaAnnotation {
  readonly order?: readonly string[] | undefined;
}

declare module "effect/Schema" {
  namespace Annotations {
    interface Annotations {
      readonly providerSettingsForm?: ProviderSettingsFormAnnotation | undefined;
      readonly providerSettingsFormSchema?: ProviderSettingsFormSchemaAnnotation | undefined;
    }
  }
}

export type ProviderSettingsOrder<Fields extends Schema.Struct.Fields> = readonly Extract<
  keyof Fields,
  string
>[];

export function makeProviderSettingsSchema<const Fields extends Schema.Struct.Fields>(
  fields: Fields,
  options?: {
    readonly order?: ProviderSettingsOrder<Fields> | undefined;
  },
): Schema.Struct<Fields> {
  return Schema.Struct(fields).pipe(
    Schema.annotate({
      providerSettingsFormSchema:
        options?.order === undefined ? undefined : { order: options.order },
    }),
  );
}

export const CodexSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(true)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    binaryPath: makeBinaryPathSetting("codex").pipe(
      Schema.annotateKey({
        title: "Binary path",
        description: "Path to the Codex binary used by this instance.",
        providerSettingsForm: { placeholder: "codex", clearWhenEmpty: "omit" },
      }),
    ),
    homePath: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "CODEX_HOME path",
        description: "Optional custom Codex home and config directory.",
        providerSettingsForm: { placeholder: "CODEX_HOME", clearWhenEmpty: "omit" },
      }),
    ),
    customModels: Schema.Array(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: ["binaryPath", "homePath"],
  },
);
export type CodexSettings = typeof CodexSettings.Type;

export const ClaudeSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(true)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    binaryPath: makeBinaryPathSetting("claude").pipe(
      Schema.annotateKey({
        title: "Binary path",
        description: "Path to the Claude binary used by this instance.",
        providerSettingsForm: { placeholder: "claude", clearWhenEmpty: "omit" },
      }),
    ),
    customModels: Schema.Array(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: ["binaryPath"],
  },
);
export type ClaudeSettings = typeof ClaudeSettings.Type;

export const CursorSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    binaryPath: makeBinaryPathSetting("agent").pipe(
      Schema.annotateKey({
        title: "Binary path",
        description: "Path to the Cursor agent binary.",
        providerSettingsForm: { placeholder: "agent", clearWhenEmpty: "omit" },
      }),
    ),
    apiEndpoint: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "API endpoint",
        description: "Override the Cursor API endpoint for this instance.",
        providerSettingsForm: { placeholder: "https://...", clearWhenEmpty: "omit" },
      }),
    ),
    customModels: Schema.Array(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: ["binaryPath", "apiEndpoint"],
  },
);
export type CursorSettings = typeof CursorSettings.Type;

export const OpenCodeSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(true)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    binaryPath: makeBinaryPathSetting("opencode").pipe(
      Schema.annotateKey({
        title: "Binary path",
        description: "Path to the OpenCode binary.",
        providerSettingsForm: { placeholder: "opencode", clearWhenEmpty: "omit" },
      }),
    ),
    serverUrl: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Server URL",
        description: "Leave blank to let Fenrir spawn the server when needed.",
        providerSettingsForm: {
          placeholder: "http://127.0.0.1:4096",
          clearWhenEmpty: "omit",
        },
      }),
    ),
    serverPassword: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Server password",
        description: "Stored in plain text on disk.",
        providerSettingsForm: {
          control: "password",
          placeholder: "Optional",
          clearWhenEmpty: "omit",
        },
      }),
    ),
    customModels: Schema.Array(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: ["binaryPath", "serverUrl", "serverPassword"],
  },
);
export type OpenCodeSettings = typeof OpenCodeSettings.Type;

export const ObservabilitySettings = Schema.Struct({
  otlpTracesUrl: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  otlpMetricsUrl: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type ObservabilitySettings = typeof ObservabilitySettings.Type;

export const DEFAULT_AUTOMATIC_GIT_FETCH_INTERVAL = Duration.seconds(30);

export const ServerSettings = Schema.Struct({
  enableAssistantStreaming: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  automaticGitFetchInterval: Schema.DurationFromMillis.pipe(
    Schema.withDecodingDefault(
      Effect.succeed(Duration.toMillis(DEFAULT_AUTOMATIC_GIT_FETCH_INTERVAL)),
    ),
  ),
  defaultThreadEnvMode: ThreadEnvMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("local" as const satisfies ThreadEnvMode)),
  ),
  addProjectBaseDirectory: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  textGenerationModelSelection: ModelSelection.pipe(
    Schema.withDecodingDefault(
      Effect.succeed({
        provider: "codex" as const,
        model: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER.codex,
      }),
    ),
  ),

  // Provider specific settings
  providers: Schema.Struct({
    codex: CodexSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    claudeAgent: ClaudeSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  }).pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  providerInstances: ProviderInstanceConfigMap.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  mcpServers: Schema.Record(McpServerId, McpServerDefinition).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  defaultMcpServerIds: Schema.Array(McpServerId).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  disabledBuiltInMcpServerIds: Schema.Array(McpServerId).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  observability: ObservabilitySettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type ServerSettings = typeof ServerSettings.Type;

export const DEFAULT_SERVER_SETTINGS: ServerSettings = Schema.decodeSync(ServerSettings)({});

export class ServerSettingsError extends Schema.TaggedErrorClass<ServerSettingsError>()(
  "ServerSettingsError",
  {
    settingsPath: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Server settings error at ${this.settingsPath}: ${this.detail}`;
  }
}

// ── Unified type ─────────────────────────────────────────────────────

export type UnifiedSettings = ServerSettings & ClientSettings;
export const DEFAULT_UNIFIED_SETTINGS: UnifiedSettings = {
  ...DEFAULT_SERVER_SETTINGS,
  ...DEFAULT_CLIENT_SETTINGS,
};

// ── Server Settings Patch (replace with a Schema.deepPartial if available) ──────────────────────────────────────────

const ModelSelectionPatch = Schema.Union([
  Schema.Struct({
    provider: Schema.optionalKey(Schema.Literal("codex")),
    model: Schema.optionalKey(TrimmedNonEmptyString),
    options: Schema.optionalKey(ProviderOptionSelections),
  }),
  Schema.Struct({
    provider: Schema.optionalKey(Schema.Literal("claudeAgent")),
    model: Schema.optionalKey(TrimmedNonEmptyString),
    options: Schema.optionalKey(ProviderOptionSelections),
  }),
]);

const CodexSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  homePath: Schema.optionalKey(Schema.String),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

const ClaudeSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

const CursorSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  apiEndpoint: Schema.optionalKey(Schema.String),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

const OpenCodeSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  serverUrl: Schema.optionalKey(Schema.String),
  serverPassword: Schema.optionalKey(Schema.String),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

export const ServerSettingsPatch = Schema.Struct({
  enableAssistantStreaming: Schema.optionalKey(Schema.Boolean),
  automaticGitFetchInterval: Schema.optionalKey(Schema.DurationFromMillis),
  defaultThreadEnvMode: Schema.optionalKey(ThreadEnvMode),
  addProjectBaseDirectory: Schema.optionalKey(Schema.String),
  textGenerationModelSelection: Schema.optionalKey(ModelSelectionPatch),
  observability: Schema.optionalKey(
    Schema.Struct({
      otlpTracesUrl: Schema.optionalKey(Schema.String),
      otlpMetricsUrl: Schema.optionalKey(Schema.String),
    }),
  ),
  providerInstances: Schema.optionalKey(ProviderInstanceConfigMap),
  mcpServers: Schema.optionalKey(Schema.Record(McpServerId, McpServerDefinition)),
  defaultMcpServerIds: Schema.optionalKey(Schema.Array(McpServerId)),
  disabledBuiltInMcpServerIds: Schema.optionalKey(Schema.Array(McpServerId)),
  providers: Schema.optionalKey(
    Schema.Struct({
      codex: Schema.optionalKey(CodexSettingsPatch),
      claudeAgent: Schema.optionalKey(ClaudeSettingsPatch),
      cursor: Schema.optionalKey(CursorSettingsPatch),
      opencode: Schema.optionalKey(OpenCodeSettingsPatch),
    }),
  ),
});
export type ServerSettingsPatch = typeof ServerSettingsPatch.Type;
