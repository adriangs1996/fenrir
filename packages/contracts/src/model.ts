import { Effect, Schema, SchemaTransformation } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";
import type { ProviderKind, ProviderSelectionKind } from "./orchestration";

export const CodexReasoningEffort = Schema.Literals(["xhigh", "high", "medium", "low"]);
export type CodexReasoningEffort = typeof CodexReasoningEffort.Type;
export const ClaudeAgentEffort = Schema.Literals([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultrathink",
]);
export type ClaudeAgentEffort = typeof ClaudeAgentEffort.Type;
export type ProviderReasoningEffort = CodexReasoningEffort | ClaudeAgentEffort;

export const ProviderOptionDescriptorType = Schema.Literals(["select", "boolean"]);
export type ProviderOptionDescriptorType = typeof ProviderOptionDescriptorType.Type;

export const ProviderOptionChoice = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  isDefault: Schema.optional(Schema.Boolean),
});
export type ProviderOptionChoice = typeof ProviderOptionChoice.Type;

const ProviderOptionDescriptorBase = {
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
} as const;

export const SelectProviderOptionDescriptor = Schema.Struct({
  ...ProviderOptionDescriptorBase,
  type: Schema.Literal("select"),
  options: Schema.Array(ProviderOptionChoice),
  currentValue: Schema.optional(TrimmedNonEmptyString),
  promptInjectedValues: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});
export type SelectProviderOptionDescriptor = typeof SelectProviderOptionDescriptor.Type;

export const BooleanProviderOptionDescriptor = Schema.Struct({
  ...ProviderOptionDescriptorBase,
  type: Schema.Literal("boolean"),
  currentValue: Schema.optional(Schema.Boolean),
});
export type BooleanProviderOptionDescriptor = typeof BooleanProviderOptionDescriptor.Type;

export const ProviderOptionDescriptor = Schema.Union([
  SelectProviderOptionDescriptor,
  BooleanProviderOptionDescriptor,
]);
export type ProviderOptionDescriptor = typeof ProviderOptionDescriptor.Type;

export const ProviderOptionSelectionValue = Schema.Union([TrimmedNonEmptyString, Schema.Boolean]);
export type ProviderOptionSelectionValue = typeof ProviderOptionSelectionValue.Type;

export const ProviderOptionSelection = Schema.Struct({
  id: TrimmedNonEmptyString,
  value: ProviderOptionSelectionValue,
});
export type ProviderOptionSelection = typeof ProviderOptionSelection.Type;

export const CodexModelOptions = Schema.Struct({
  reasoningEffort: Schema.optional(CodexReasoningEffort),
  fastMode: Schema.optional(Schema.Boolean),
});
export type CodexModelOptions = typeof CodexModelOptions.Type;

export const ClaudeModelOptions = Schema.Struct({
  thinking: Schema.optional(Schema.Boolean),
  effort: Schema.optional(ClaudeAgentEffort),
  fastMode: Schema.optional(Schema.Boolean),
  contextWindow: Schema.optional(Schema.String),
});
export type ClaudeModelOptions = typeof ClaudeModelOptions.Type;

const LegacyProviderOptionSelectionsObject = Schema.Record(Schema.String, Schema.Unknown);

const ProviderOptionSelectionsFromLegacyObject = LegacyProviderOptionSelectionsObject.pipe(
  Schema.decodeTo(
    Schema.Array(ProviderOptionSelection),
    SchemaTransformation.transformOrFail({
      decode: (record) => Effect.succeed(coerceLegacyOptionsObjectToArray(record)),
      encode: (selections) => Effect.succeed(canonicalSelectionsToLegacyObject(selections)),
    }),
  ),
);

export type ProviderOptionSelections =
  | ReadonlyArray<ProviderOptionSelection>
  | Record<string, ProviderOptionSelectionValue | undefined>;

const ProviderOptionSelectionsCanonical = Schema.Union([
  Schema.Array(ProviderOptionSelection),
  ProviderOptionSelectionsFromLegacyObject,
]);

export const ProviderOptionSelections =
  ProviderOptionSelectionsCanonical as unknown as Schema.Codec<
    ProviderOptionSelections,
    Schema.Codec.Encoded<typeof ProviderOptionSelectionsCanonical>,
    Schema.Codec.DecodingServices<typeof ProviderOptionSelectionsCanonical>,
    Schema.Codec.EncodingServices<typeof ProviderOptionSelectionsCanonical>
  >;

function coerceLegacyOptionsObjectToArray(
  record: Record<string, unknown>,
): ReadonlyArray<ProviderOptionSelection> {
  const entries: Array<ProviderOptionSelection> = [];
  for (const [rawKey, rawValue] of Object.entries(record)) {
    const id = rawKey.trim();
    if (id.length === 0) {
      continue;
    }
    if (typeof rawValue === "string") {
      const value = rawValue.trim();
      if (value.length > 0) {
        entries.push({ id, value });
      }
      continue;
    }
    if (typeof rawValue === "boolean") {
      entries.push({ id, value: rawValue });
    }
  }
  return entries;
}

function canonicalSelectionsToLegacyObject(
  selections: ReadonlyArray<ProviderOptionSelection>,
): Record<string, string | boolean> {
  const record: Record<string, string | boolean> = {};
  for (const selection of selections) {
    record[selection.id] = selection.value;
  }
  return record;
}

export const ProviderModelOptions = Schema.Record(Schema.String, ProviderOptionSelections);
export type ProviderModelOptions = typeof ProviderModelOptions.Type;

export const EffortOption = Schema.Struct({
  value: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  isDefault: Schema.optional(Schema.Boolean),
});
export type EffortOption = typeof EffortOption.Type;

export const ContextWindowOption = Schema.Struct({
  value: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  isDefault: Schema.optional(Schema.Boolean),
});
export type ContextWindowOption = typeof ContextWindowOption.Type;

export const ModelCapabilities = Schema.Struct({
  optionDescriptors: Schema.optional(Schema.Array(ProviderOptionDescriptor)),
  reasoningEffortLevels: Schema.Array(EffortOption),
  supportsFastMode: Schema.Boolean,
  supportsThinkingToggle: Schema.Boolean,
  contextWindowOptions: Schema.Array(ContextWindowOption),
  promptInjectedEffortLevels: Schema.Array(TrimmedNonEmptyString),
});
export type ModelCapabilities = typeof ModelCapabilities.Type;

export const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderKind, string> = {
  codex: "gpt-5.4",
  claudeAgent: "claude-sonnet-4-6",
};

export const DEFAULT_MODEL = DEFAULT_MODEL_BY_PROVIDER.codex;

/** Per-provider text generation model defaults. */
export const DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER: Record<ProviderKind, string> = {
  codex: "gpt-5.4-mini",
  claudeAgent: "claude-haiku-4-5",
};

export const MODEL_SLUG_ALIASES_BY_PROVIDER: Record<ProviderKind, Record<string, string>> = {
  codex: {
    "5.5": "gpt-5.5",
    "gpt-5-codex": "gpt-5.4",
    "5.4": "gpt-5.4",
    "5.3": "gpt-5.3-codex",
    "gpt-5.3": "gpt-5.3-codex",
    "5.3-spark": "gpt-5.3-codex-spark",
    "gpt-5.3-spark": "gpt-5.3-codex-spark",
  },
  claudeAgent: {
    opus: "claude-opus-4-8",
    "opus-4.8": "claude-opus-4-8",
    "claude-opus-4.8": "claude-opus-4-8",
    "opus-4.7": "claude-opus-4-7",
    "claude-opus-4.7": "claude-opus-4-7",
    "opus-4.6": "claude-opus-4-6",
    "claude-opus-4.6": "claude-opus-4-6",
    "claude-opus-4-6-20251117": "claude-opus-4-6",
    sonnet: "claude-sonnet-4-6",
    "sonnet-4.6": "claude-sonnet-4-6",
    "claude-sonnet-4.6": "claude-sonnet-4-6",
    "claude-sonnet-4-6-20251117": "claude-sonnet-4-6",
    haiku: "claude-haiku-4-5",
    "haiku-4.5": "claude-haiku-4-5",
    "claude-haiku-4.5": "claude-haiku-4-5",
    "claude-haiku-4-5-20251001": "claude-haiku-4-5",
  },
};

// ── Provider display names ────────────────────────────────────────────

export const PROVIDER_DISPLAY_NAMES: Record<ProviderKind, string> = {
  codex: "Codex",
  claudeAgent: "Claude",
};

const isBuiltInProviderKind = (value: string): value is ProviderKind =>
  value === "codex" || value === "claudeAgent";

export function getDefaultModelByProvider(provider: ProviderSelectionKind | string): string {
  return isBuiltInProviderKind(provider) ? DEFAULT_MODEL_BY_PROVIDER[provider] : "";
}

export function getDefaultGitTextGenerationModelByProvider(
  provider: ProviderSelectionKind | string,
): string {
  return isBuiltInProviderKind(provider)
    ? DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[provider]
    : "";
}

export function getModelSlugAliasesByProvider(
  provider: ProviderSelectionKind | string,
): Record<string, string> {
  return isBuiltInProviderKind(provider) ? MODEL_SLUG_ALIASES_BY_PROVIDER[provider] : {};
}

export function getProviderDisplayName(provider: ProviderSelectionKind | string): string {
  return isBuiltInProviderKind(provider) ? PROVIDER_DISPLAY_NAMES[provider] : provider;
}
