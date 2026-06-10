import {
  CodexReasoningEffort,
  getDefaultModelByProvider,
  isBuiltInProviderKind,
  ModelSelection,
  ProviderKind,
  ProviderInstanceId,
  ProviderSelectionKind,
  ProviderModelOptions,
  ProviderOptionSelections,
  type ServerProvider,
  type ProviderOptionSelection,
} from "@fenrir/contracts";
import * as Schema from "effect/Schema";
import { normalizeModelSlug } from "@fenrir/shared/model";
import { resolveAppModelSelection } from "../modelSelection";
import { getDefaultServerModel } from "../providerModels";
import { UnifiedSettings } from "@fenrir/contracts/settings";
import type { ComposerThreadDraftState, EffectiveComposerModelState } from "./types";

export const LegacyCodexFields = Schema.Struct({
  effort: Schema.optionalKey(CodexReasoningEffort),
  codexFastMode: Schema.optionalKey(Schema.Boolean),
  serviceTier: Schema.optionalKey(Schema.String),
});
export type LegacyCodexFields = typeof LegacyCodexFields.Type;

const isCodexReasoningEffort = Schema.is(CodexReasoningEffort);
const decodeProviderOptionSelectionsOption = Schema.decodeUnknownOption(ProviderOptionSelections);

export function providerModelOptionsFromSelection(
  modelSelection: ModelSelection | null | undefined,
): ProviderModelOptions | null {
  if (!modelSelection?.options) {
    return null;
  }

  return {
    [modelSelection.provider]: modelSelection.options,
  };
}

export function modelSelectionByProviderToOptions(
  map: Partial<Record<ProviderSelectionKind, ModelSelection>> | null | undefined,
): ProviderModelOptions | null {
  if (!map) return null;
  const result: Record<string, unknown> = {};
  for (const [provider, selection] of Object.entries(map)) {
    if (selection?.options) {
      result[provider] = selection.options;
    }
  }
  return Object.keys(result).length > 0 ? (result as ProviderModelOptions) : null;
}

export function normalizeProviderKind(value: unknown): ProviderSelectionKind | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? (trimmed as ProviderSelectionKind) : null;
}

export function normalizeProviderInstanceId(value: unknown): ProviderInstanceId | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? ProviderInstanceId.make(trimmed) : null;
}

export function normalizeProviderInstanceIdByProvider(
  value: unknown,
): Partial<Record<ProviderSelectionKind, ProviderInstanceId>> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const next: Partial<Record<ProviderSelectionKind, ProviderInstanceId>> = {};
  for (const [provider, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const normalizedProvider = normalizeProviderKind(provider);
    const instanceId = normalizeProviderInstanceId(rawValue);
    if (normalizedProvider === null || instanceId === null) {
      continue;
    }
    next[normalizedProvider] = instanceId;
  }
  return next;
}

export function normalizeProviderSelectionMap(
  value: unknown,
): Partial<Record<ProviderSelectionKind, ModelSelection>> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const next: Partial<Record<ProviderSelectionKind, ModelSelection>> = {};
  for (const [provider, rawSelection] of Object.entries(value as Record<string, unknown>)) {
    const normalizedProvider = normalizeProviderKind(provider);
    const selection = normalizeModelSelection(rawSelection, { provider });
    if (normalizedProvider === null || selection === null) {
      continue;
    }
    next[normalizedProvider] = selection;
  }
  return next;
}

export function normalizeProviderSpecificModelOptions(
  provider: ProviderSelectionKind,
  nextProviderOptions: ProviderOptionSelections | null | undefined,
): ProviderModelOptions | null {
  return normalizeProviderModelOptions({ [provider]: nextProviderOptions }, provider);
}

export function getDefaultModelForProvider(provider: ProviderSelectionKind): string {
  return getDefaultModelByProvider(provider);
}

function normalizeExternalModelSelection(
  provider: ProviderSelectionKind,
  rawModel: unknown,
): ModelSelection | null {
  if (typeof rawModel !== "string") {
    return null;
  }
  const model = normalizeModelSlug(rawModel, provider);
  if (!model) {
    return null;
  }
  return { provider, model };
}

export function normalizeModelSelection(
  value: unknown,
  legacy?: {
    provider?: unknown;
    model?: unknown;
    modelOptions?: unknown;
    legacyCodex?: LegacyCodexFields;
  },
): ModelSelection | null {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const provider = normalizeProviderKind(candidate?.provider ?? legacy?.provider);
  if (provider === null) {
    return null;
  }
  const rawModel = candidate?.model ?? legacy?.model;
  if (!isBuiltInProviderKind(provider)) {
    return normalizeExternalModelSelection(provider, rawModel);
  }
  if (typeof rawModel !== "string") {
    return null;
  }
  const model = normalizeModelSlug(rawModel, provider);
  if (!model) {
    return null;
  }
  const modelOptions = normalizeProviderModelOptions(
    candidate?.options ? { [provider]: candidate.options } : legacy?.modelOptions,
    provider,
    provider === "codex" ? legacy?.legacyCodex : undefined,
  );
  const options = provider === "codex" ? modelOptions?.codex : modelOptions?.claudeAgent;
  return {
    provider,
    model,
    ...(options ? { options } : {}),
  };
}
export function normalizeProviderModelOptions(
  value: unknown,
  provider?: ProviderSelectionKind | null,
  legacy?: LegacyCodexFields,
): ProviderModelOptions | null {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!candidate) return null;

  const result: Record<string, ReadonlyArray<ProviderOptionSelection>> = {};
  for (const [providerKey, rawProviderOptions] of Object.entries(candidate)) {
    const normalizedProvider = normalizeProviderKind(providerKey);
    if (normalizedProvider === null) {
      continue;
    }
    const decoded = decodeProviderOptionSelections(rawProviderOptions);
    if (decoded) {
      result[normalizedProvider] = decoded;
    }
  }

  if (provider === "codex" && legacy) {
    const legacySelections: ProviderOptionSelection[] = [];
    if (isCodexReasoningEffort(legacy.effort)) {
      legacySelections.push({ id: "reasoningEffort", value: legacy.effort });
    }
    if (
      legacy.codexFastMode === true ||
      (typeof legacy.serviceTier === "string" && legacy.serviceTier === "fast")
    ) {
      legacySelections.push({ id: "fastMode", value: true });
    }
    if (legacySelections.length > 0 && result.codex === undefined) {
      result.codex = legacySelections;
    }
  }

  return Object.keys(result).length > 0 ? (result as ProviderModelOptions) : null;
}

function decodeProviderOptionSelections(
  value: unknown,
): ReadonlyArray<ProviderOptionSelection> | undefined {
  const decoded = decodeProviderOptionSelectionsOption(value);
  if (decoded._tag === "None") {
    return undefined;
  }
  if (Array.isArray(decoded.value)) {
    return decoded.value.length > 0 ? decoded.value : undefined;
  }
  const selections: ProviderOptionSelection[] = [];
  for (const [id, optionValue] of Object.entries(decoded.value)) {
    if (id.trim().length === 0) continue;
    if (optionValue === undefined) continue;
    selections.push({ id, value: optionValue });
  }
  return selections.length > 0 ? selections : undefined;
}

// ── Legacy sync helpers (used only during migration from v2 storage) ──

export function legacySyncModelSelectionOptions(
  modelSelection: ModelSelection | null,
  modelOptions: ProviderModelOptions | null | undefined,
): ModelSelection | null {
  if (modelSelection === null) {
    return null;
  }
  if (!isBuiltInProviderKind(modelSelection.provider)) {
    return modelSelection;
  }
  const options = modelOptions?.[modelSelection.provider];
  return {
    provider: modelSelection.provider,
    model: modelSelection.model,
    ...(options ? { options } : {}),
  };
}

export function legacyMergeModelSelectionIntoProviderModelOptions(
  modelSelection: ModelSelection | null,
  currentModelOptions: ProviderModelOptions | null | undefined,
): ProviderModelOptions | null {
  if (modelSelection?.options === undefined) {
    return normalizeProviderModelOptions(currentModelOptions);
  }
  if (!isBuiltInProviderKind(modelSelection.provider)) {
    return normalizeProviderModelOptions(currentModelOptions);
  }
  return legacyReplaceProviderModelOptions(
    normalizeProviderModelOptions(currentModelOptions),
    modelSelection.provider,
    modelSelection.options,
  );
}

function legacyReplaceProviderModelOptions(
  currentModelOptions: ProviderModelOptions | null | undefined,
  provider: ProviderKind,
  nextProviderOptions: ProviderModelOptions[ProviderKind] | null | undefined,
): ProviderModelOptions | null {
  const { [provider]: _discardedProviderModelOptions, ...otherProviderModelOptions } =
    currentModelOptions ?? {};
  const normalizedNextProviderOptions = normalizeProviderModelOptions(
    { [provider]: nextProviderOptions },
    provider,
  );

  return normalizeProviderModelOptions({
    ...otherProviderModelOptions,
    ...(normalizedNextProviderOptions ? normalizedNextProviderOptions : {}),
  });
}

// ── New helpers for the consolidated representation ────────────────────

export function legacyToModelSelectionByProvider(
  modelSelection: ModelSelection | null,
  modelOptions: ProviderModelOptions | null | undefined,
): Partial<Record<ProviderSelectionKind, ModelSelection>> {
  const result: Partial<Record<ProviderSelectionKind, ModelSelection>> = {};
  // Add entries from the options bag (for non-active providers)
  if (modelOptions) {
    for (const provider of Object.keys(modelOptions) as ProviderSelectionKind[]) {
      const options = modelOptions[provider];
      if (options && Object.keys(options).length > 0) {
        const model =
          modelSelection?.provider === provider
            ? modelSelection.model
            : getDefaultModelForProvider(provider);
        if (model.length === 0) {
          continue;
        }
        result[provider] = {
          provider,
          model,
          options,
        };
      }
    }
  }
  // Add/overwrite the active selection (it's authoritative for its provider)
  if (modelSelection) {
    result[modelSelection.provider] = modelSelection;
  }
  return result;
}

export function deriveEffectiveComposerModelState(input: {
  draft:
    | Pick<ComposerThreadDraftState, "modelSelectionByProvider" | "activeProvider">
    | null
    | undefined;
  providers: ReadonlyArray<ServerProvider>;
  selectedProvider: ProviderSelectionKind;
  threadModelSelection: ModelSelection | null | undefined;
  projectModelSelection: ModelSelection | null | undefined;
  settings: UnifiedSettings;
}): EffectiveComposerModelState {
  const baseModel =
    normalizeModelSlug(
      input.threadModelSelection?.model ?? input.projectModelSelection?.model,
      input.selectedProvider,
    ) ?? getDefaultServerModel(input.providers, input.selectedProvider);
  const activeSelection = input.draft?.modelSelectionByProvider?.[input.selectedProvider];
  const selectedModel = activeSelection?.model
    ? resolveAppModelSelection(
        input.selectedProvider,
        input.settings,
        input.providers,
        activeSelection.model,
      )
    : baseModel;
  const modelOptions =
    modelSelectionByProviderToOptions(input.draft?.modelSelectionByProvider) ??
    providerModelOptionsFromSelection(input.threadModelSelection) ??
    providerModelOptionsFromSelection(input.projectModelSelection) ??
    null;

  return {
    selectedModel,
    modelOptions,
  };
}
