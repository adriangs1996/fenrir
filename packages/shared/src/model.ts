import {
  getDefaultModelByProvider,
  getModelSlugAliasesByProvider,
  type ClaudeAgentEffort,
  type ModelCapabilities,
  type ModelSelection,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ProviderKind,
  type ProviderSelectionKind,
} from "@fenrir/contracts";

export interface SelectableModelOption {
  slug: string;
  name: string;
}

type ProviderOptionSelectionsInput =
  | ReadonlyArray<ProviderOptionSelection>
  | Record<string, unknown>
  | null
  | undefined;

export function createModelCapabilities(input: {
  optionDescriptors: ReadonlyArray<ProviderOptionDescriptor>;
}): ModelCapabilities {
  return {
    optionDescriptors: input.optionDescriptors.map(cloneDescriptor),
    reasoningEffortLevels: [],
    supportsFastMode: false,
    supportsThinkingToggle: false,
    contextWindowOptions: [],
    promptInjectedEffortLevels: [],
  };
}

function cloneDescriptor(descriptor: ProviderOptionDescriptor): ProviderOptionDescriptor {
  return descriptor.type === "select"
    ? {
        ...descriptor,
        options: [...descriptor.options],
        ...(descriptor.promptInjectedValues
          ? { promptInjectedValues: [...descriptor.promptInjectedValues] }
          : {}),
      }
    : { ...descriptor };
}

function getRawSelectionValueById(
  selections: ProviderOptionSelectionsInput,
  id: string,
): string | boolean | undefined {
  if (!selections || typeof selections !== "object") {
    return undefined;
  }
  if (globalThis.Array.isArray(selections)) {
    return selections.find((selection) => selection.id === id)?.value;
  }
  const value = (selections as Record<string, unknown>)[id];
  return typeof value === "string" || typeof value === "boolean" ? value : undefined;
}

export function getProviderOptionSelectionValue(
  selections: ProviderOptionSelectionsInput,
  id: string,
): string | boolean | undefined {
  return getRawSelectionValueById(selections, id);
}

export function getProviderOptionStringSelectionValue(
  selections: ProviderOptionSelectionsInput,
  id: string,
): string | undefined {
  const value = getProviderOptionSelectionValue(selections, id);
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getProviderOptionBooleanSelectionValue(
  selections: ProviderOptionSelectionsInput,
  id: string,
): boolean | undefined {
  const value = getProviderOptionSelectionValue(selections, id);
  return typeof value === "boolean" ? value : undefined;
}

export function getModelSelectionOptionValue(
  modelSelection: ModelSelection | null | undefined,
  id: string,
): string | boolean | undefined {
  return getProviderOptionSelectionValue(modelSelection?.options, id);
}

export function getModelSelectionStringOptionValue(
  modelSelection: ModelSelection | null | undefined,
  id: string,
): string | undefined {
  return getProviderOptionStringSelectionValue(modelSelection?.options, id);
}

export function getModelSelectionBooleanOptionValue(
  modelSelection: ModelSelection | null | undefined,
  id: string,
): boolean | undefined {
  return getProviderOptionBooleanSelectionValue(modelSelection?.options, id);
}

// ── Effort helpers ────────────────────────────────────────────────────

/** Check whether a capabilities object includes a given effort value. */
export function hasEffortLevel(caps: ModelCapabilities, value: string): boolean {
  return caps.reasoningEffortLevels.some((l) => l.value === value);
}

/** Return the default effort value for a capabilities object, or null if none. */
export function getDefaultEffort(caps: ModelCapabilities): string | null {
  return caps.reasoningEffortLevels.find((l) => l.isDefault)?.value ?? null;
}

/**
 * Resolve a raw effort option against capabilities.
 *
 * Returns the effective effort value — the explicit value if supported and not
 * prompt-injected, otherwise the model's default. Returns `undefined` only
 * when the model has no effort levels at all.
 *
 * Prompt-injected efforts (e.g. "ultrathink") are excluded because they are
 * applied via prompt text, not the effort API parameter.
 */
export function resolveEffort(
  caps: ModelCapabilities,
  raw: string | null | undefined,
): string | undefined {
  const defaultValue = getDefaultEffort(caps);
  const trimmed = typeof raw === "string" ? raw.trim() : null;
  if (
    trimmed &&
    !caps.promptInjectedEffortLevels.includes(trimmed) &&
    hasEffortLevel(caps, trimmed)
  ) {
    return trimmed;
  }
  return defaultValue ?? undefined;
}

// ── Context window helpers ───────────────────────────────────────────

/** Check whether a capabilities object includes a given context window value. */
export function hasContextWindowOption(caps: ModelCapabilities, value: string): boolean {
  return caps.contextWindowOptions.some((o) => o.value === value);
}

/** Return the default context window value, or `null` if none is defined. */
export function getDefaultContextWindow(caps: ModelCapabilities): string | null {
  return caps.contextWindowOptions.find((o) => o.isDefault)?.value ?? null;
}

/**
 * Resolve a raw `contextWindow` option against capabilities.
 *
 * Returns the effective context window value — the explicit value if supported,
 * otherwise the model's default. Returns `undefined` only when the model has
 * no context window options at all.
 *
 * Unlike effort levels (where the API has matching defaults), the context
 * window requires an explicit API suffix (e.g. `[1m]`), so we always preserve
 * the resolved value to avoid ambiguity between "user chose the default" and
 * "not specified".
 */
export function resolveContextWindow(
  caps: ModelCapabilities,
  raw: string | null | undefined,
): string | undefined {
  const defaultValue = getDefaultContextWindow(caps);
  if (!raw) return defaultValue ?? undefined;
  return hasContextWindowOption(caps, raw) ? raw : (defaultValue ?? undefined);
}

export function normalizeCodexModelOptionsWithCapabilities(
  caps: ModelCapabilities,
  modelOptions: ProviderOptionSelectionsInput,
): Array<ProviderOptionSelection> | undefined {
  const reasoningEffort = resolveEffort(
    caps,
    getProviderOptionStringSelectionValue(modelOptions, "reasoningEffort"),
  );
  const fastMode = caps.supportsFastMode
    ? getProviderOptionBooleanSelectionValue(modelOptions, "fastMode")
    : undefined;
  return compactProviderOptionSelections([
    ...(reasoningEffort ? [{ id: "reasoningEffort", value: reasoningEffort }] : []),
    ...(fastMode !== undefined ? [{ id: "fastMode", value: fastMode }] : []),
  ]);
}

export function normalizeClaudeModelOptionsWithCapabilities(
  caps: ModelCapabilities,
  modelOptions: ProviderOptionSelectionsInput,
): Array<ProviderOptionSelection> | undefined {
  const effort = resolveEffort(caps, getProviderOptionStringSelectionValue(modelOptions, "effort"));
  const thinking = caps.supportsThinkingToggle
    ? getProviderOptionBooleanSelectionValue(modelOptions, "thinking")
    : undefined;
  const fastMode = caps.supportsFastMode
    ? getProviderOptionBooleanSelectionValue(modelOptions, "fastMode")
    : undefined;
  const contextWindow = resolveContextWindow(
    caps,
    getProviderOptionStringSelectionValue(modelOptions, "contextWindow"),
  );
  return compactProviderOptionSelections([
    ...(thinking !== undefined ? [{ id: "thinking", value: thinking }] : []),
    ...(effort ? [{ id: "effort", value: effort }] : []),
    ...(fastMode !== undefined ? [{ id: "fastMode", value: fastMode }] : []),
    ...(contextWindow !== undefined ? [{ id: "contextWindow", value: contextWindow }] : []),
  ]);
}

function compactProviderOptionSelections(
  selections: ReadonlyArray<ProviderOptionSelection>,
): Array<ProviderOptionSelection> | undefined {
  return selections.length > 0 ? selections.map((selection) => ({ ...selection })) : undefined;
}

function resolveDescriptorChoiceValue(
  descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
  raw: string | null | undefined,
): string | undefined {
  const trimmed = trimOrNull(raw);
  if (!trimmed) {
    return descriptor.currentValue ?? descriptor.options.find((option) => option.isDefault)?.id;
  }
  if (descriptor.options.length === 0) {
    return trimmed;
  }
  if (
    descriptor.promptInjectedValues?.includes(trimmed) &&
    descriptor.options.some((option) => option.id === trimmed)
  ) {
    return descriptor.options.find((option) => option.isDefault)?.id;
  }
  if (descriptor.options.some((option) => option.id === trimmed)) {
    return trimmed;
  }
  return descriptor.currentValue ?? descriptor.options.find((option) => option.isDefault)?.id;
}

function withDescriptorCurrentValue(
  descriptor: ProviderOptionDescriptor,
  rawCurrentValue: string | boolean | undefined,
): ProviderOptionDescriptor {
  if (descriptor.type === "boolean") {
    return typeof rawCurrentValue === "boolean"
      ? { ...descriptor, currentValue: rawCurrentValue }
      : descriptor;
  }
  const currentValue =
    typeof rawCurrentValue === "string"
      ? resolveDescriptorChoiceValue(descriptor, rawCurrentValue)
      : resolveDescriptorChoiceValue(descriptor, descriptor.currentValue);
  if (!currentValue) {
    const { currentValue: _unusedCurrentValue, ...rest } = descriptor;
    return rest;
  }
  return { ...descriptor, currentValue };
}

function descriptorsFromLegacyCapabilities(
  caps: ModelCapabilities,
  provider: ProviderSelectionKind | string | null | undefined,
): ReadonlyArray<ProviderOptionDescriptor> {
  const descriptors: ProviderOptionDescriptor[] = [];
  if (caps.reasoningEffortLevels.length > 0) {
    descriptors.push({
      id: provider === "codex" ? "reasoningEffort" : "effort",
      label: "Effort",
      type: "select",
      options: caps.reasoningEffortLevels.map((option) => ({
        id: option.value,
        label: option.label,
        ...(option.isDefault !== undefined ? { isDefault: option.isDefault } : {}),
      })),
      ...(caps.promptInjectedEffortLevels.length > 0
        ? { promptInjectedValues: caps.promptInjectedEffortLevels }
        : {}),
    });
  }
  if (caps.supportsThinkingToggle) {
    descriptors.push({
      id: "thinking",
      label: "Thinking",
      type: "boolean",
      currentValue: true,
    });
  }
  if (caps.supportsFastMode) {
    descriptors.push({
      id: "fastMode",
      label: "Fast Mode",
      type: "boolean",
      currentValue: false,
    });
  }
  if (caps.contextWindowOptions.length > 1) {
    descriptors.push({
      id: "contextWindow",
      label: "Context Window",
      type: "select",
      options: caps.contextWindowOptions.map((option) => ({
        id: option.value,
        label: option.label,
        ...(option.isDefault !== undefined ? { isDefault: option.isDefault } : {}),
      })),
    });
  }
  return descriptors;
}

export function getProviderOptionDescriptors(input: {
  caps: ModelCapabilities;
  selections?: ProviderOptionSelectionsInput;
  provider?: ProviderSelectionKind | string | null | undefined;
}): ReadonlyArray<ProviderOptionDescriptor> {
  const descriptors = (
    input.caps.optionDescriptors ?? descriptorsFromLegacyCapabilities(input.caps, input.provider)
  ).map(cloneDescriptor);
  return descriptors.map((descriptor) =>
    withDescriptorCurrentValue(
      descriptor,
      getRawSelectionValueById(input.selections, descriptor.id) ?? descriptor.currentValue,
    ),
  );
}

export function getProviderOptionCurrentValue(
  descriptor: ProviderOptionDescriptor | null | undefined,
): string | boolean | undefined {
  if (!descriptor) return undefined;
  if (descriptor.type === "boolean") return descriptor.currentValue;
  return descriptor.currentValue ?? descriptor.options.find((option) => option.isDefault)?.id;
}

export function getProviderOptionCurrentLabel(
  descriptor: ProviderOptionDescriptor | null | undefined,
): string | undefined {
  if (!descriptor) return undefined;
  if (descriptor.type === "boolean") {
    return typeof descriptor.currentValue === "boolean"
      ? descriptor.currentValue
        ? "On"
        : "Off"
      : undefined;
  }
  const currentValue = getProviderOptionCurrentValue(descriptor);
  return typeof currentValue === "string"
    ? descriptor.options.find((option) => option.id === currentValue)?.label
    : undefined;
}

export function buildProviderOptionSelectionsFromDescriptors(
  descriptors: ReadonlyArray<ProviderOptionDescriptor> | null | undefined,
): Array<ProviderOptionSelection> | undefined {
  if (!descriptors || descriptors.length === 0) return undefined;
  const selections: ProviderOptionSelection[] = [];
  for (const descriptor of descriptors) {
    const value = getProviderOptionCurrentValue(descriptor);
    if (typeof value === "string" || typeof value === "boolean") {
      selections.push({ id: descriptor.id, value });
    }
  }
  return selections.length > 0 ? selections : undefined;
}

export function isClaudeUltrathinkPrompt(text: string | null | undefined): boolean {
  return typeof text === "string" && /\bultrathink\b/i.test(text);
}

export function normalizeModelSlug(
  model: string | null | undefined,
  provider: ProviderSelectionKind | string = "codex",
): string | null {
  if (typeof model !== "string") {
    return null;
  }

  const trimmed = model.trim();
  if (!trimmed) {
    return null;
  }

  const aliases = getModelSlugAliasesByProvider(provider);
  const aliased = Object.prototype.hasOwnProperty.call(aliases, trimmed)
    ? aliases[trimmed]
    : undefined;
  return typeof aliased === "string" ? aliased : trimmed;
}

export function resolveSelectableModel(
  provider: ProviderSelectionKind | string,
  value: string | null | undefined,
  options: ReadonlyArray<SelectableModelOption>,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const direct = options.find((option) => option.slug === trimmed);
  if (direct) {
    return direct.slug;
  }

  const byName = options.find((option) => option.name.toLowerCase() === trimmed.toLowerCase());
  if (byName) {
    return byName.slug;
  }

  const normalized = normalizeModelSlug(trimmed, provider);
  if (!normalized) {
    return null;
  }

  const resolved = options.find((option) => option.slug === normalized);
  return resolved ? resolved.slug : null;
}

export function resolveModelSlug(model: string | null | undefined, provider: ProviderKind): string {
  const normalized = normalizeModelSlug(model, provider);
  if (!normalized) {
    return getDefaultModelByProvider(provider);
  }
  return normalized;
}

export function resolveModelSlugForProvider(
  provider: ProviderSelectionKind | string,
  model: string | null | undefined,
): string {
  const normalized = normalizeModelSlug(model, provider);
  if (!normalized) {
    return getDefaultModelByProvider(provider);
  }
  return normalized;
}

/** Trim a string, returning null for empty/missing values. */
export function trimOrNull<T extends string>(value: T | null | undefined): T | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim() as T;
  return trimmed || null;
}

/**
 * Resolve the actual API model identifier from a model selection.
 *
 * Provider-aware: each provider can map `contextWindow` (or other options)
 * to whatever the API requires — a model-id suffix, a separate parameter, etc.
 * The canonical slug stored in the selection stays unchanged so the
 * capabilities system keeps working.
 *
 * Expects `contextWindow` to already be resolved (via `resolveContextWindow`)
 * to the effective value, not stripped to `undefined` for defaults.
 */
export function resolveApiModelId(modelSelection: ModelSelection): string {
  switch (modelSelection.provider) {
    case "claudeAgent": {
      switch (getModelSelectionStringOptionValue(modelSelection, "contextWindow")) {
        case "1m":
          return `${modelSelection.model}[1m]`;
        default:
          return modelSelection.model;
      }
    }
    default: {
      return modelSelection.model;
    }
  }
}

export function applyClaudePromptEffortPrefix(
  text: string,
  effort: ClaudeAgentEffort | null | undefined,
): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (effort !== "ultrathink") {
    return trimmed;
  }
  if (trimmed.startsWith("Ultrathink:")) {
    return trimmed;
  }
  return `Ultrathink:\n${trimmed}`;
}
