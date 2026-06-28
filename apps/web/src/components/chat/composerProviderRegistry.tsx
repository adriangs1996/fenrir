import {
  type ProviderKind,
  type ProviderModelOptions,
  type ProviderOptionSelection,
  type ProviderOptionSelections,
  type ProviderSelectionKind,
  type ScopedThreadRef,
  type ServerProviderModel,
} from "@fenrir/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionDescriptors,
  getProviderOptionStringSelectionValue,
  isClaudeUltrathinkPrompt,
  resolveEffort,
} from "@fenrir/shared/model";
import type { ReactNode } from "react";
import type { DraftId } from "../../composerDraftStore";
import { getProviderModelCapabilities } from "../../providerModels";
import { TraitsMenuContent, TraitsPicker } from "./TraitsPicker";
import {
  normalizeClaudeModelOptionsWithCapabilities,
  normalizeCodexModelOptionsWithCapabilities,
} from "@fenrir/shared/model";

export type ComposerProviderStateInput = {
  provider: ProviderSelectionKind;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  promptInjectionState?: ComposerPromptInjectionState;
  modelOptions: ProviderModelOptions | null | undefined;
};

export type ComposerPromptInjectionState = "none" | "ultrathink";

export type ComposerProviderState = {
  provider: ProviderSelectionKind;
  promptEffort: string | null;
  modelOptionsForDispatch: ReadonlyArray<ProviderOptionSelection> | undefined;
  composerFrameClassName?: string;
  composerSurfaceClassName?: string;
  modelPickerIconClassName?: string;
};

type ProviderRegistryEntry = {
  getState: (input: ComposerProviderStateInput) => ComposerProviderState;
  renderTraitsMenuContent: (input: {
    threadRef?: ScopedThreadRef;
    draftId?: DraftId;
    model: string;
    models: ReadonlyArray<ServerProviderModel>;
    modelOptions: ProviderOptionSelections | undefined;
    prompt: string;
    onPromptChange: (prompt: string) => void;
  }) => ReactNode;
  renderTraitsPicker: (input: {
    threadRef?: ScopedThreadRef;
    draftId?: DraftId;
    model: string;
    models: ReadonlyArray<ServerProviderModel>;
    modelOptions: ProviderOptionSelections | undefined;
    prompt: string;
    onPromptChange: (prompt: string) => void;
  }) => ReactNode;
};

function hasComposerTraitsTarget(input: {
  threadRef?: ScopedThreadRef | undefined;
  draftId?: DraftId | undefined;
}): boolean {
  return input.threadRef !== undefined || input.draftId !== undefined;
}

function getProviderStateFromCapabilities(
  input: ComposerProviderStateInput,
): ComposerProviderState {
  const { provider, model, models, promptInjectionState = "none", modelOptions } = input;
  const caps = getProviderModelCapabilities(models, model, provider);
  const providerOptions = modelOptions?.[provider];

  // Resolve effort
  const rawEffort =
    getProviderOptionStringSelectionValue(providerOptions, "effort") ??
    getProviderOptionStringSelectionValue(providerOptions, "reasoningEffort") ??
    null;
  const promptEffort = resolveEffort(caps, rawEffort) ?? null;

  // Normalize options for dispatch
  const normalizedOptions =
    provider === "codex"
      ? normalizeCodexModelOptionsWithCapabilities(caps, providerOptions)
      : provider === "claudeAgent"
        ? normalizeClaudeModelOptionsWithCapabilities(caps, providerOptions)
        : buildProviderOptionSelectionsFromDescriptors(
            getProviderOptionDescriptors({
              caps,
              selections: providerOptions,
              provider,
            }),
          );

  // Ultrathink styling (driven by capabilities data, not provider identity)
  const ultrathinkActive =
    caps.promptInjectedEffortLevels.length > 0 && promptInjectionState === "ultrathink";

  return {
    provider,
    promptEffort,
    modelOptionsForDispatch: normalizedOptions,
    ...(ultrathinkActive ? { composerFrameClassName: "ultrathink-frame" } : {}),
    ...(ultrathinkActive
      ? { composerSurfaceClassName: "shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset]" }
      : {}),
    ...(ultrathinkActive ? { modelPickerIconClassName: "ultrathink-chroma" } : {}),
  };
}

export function getComposerPromptInjectionState(prompt: string): ComposerPromptInjectionState {
  return isClaudeUltrathinkPrompt(prompt) ? "ultrathink" : "none";
}

const composerProviderRegistry: Record<ProviderKind, ProviderRegistryEntry> = {
  codex: {
    getState: (input) => getProviderStateFromCapabilities(input),
    renderTraitsMenuContent: ({
      threadRef,
      draftId,
      model,
      models,
      modelOptions,
      prompt,
      onPromptChange,
    }) =>
      !hasComposerTraitsTarget({ threadRef, draftId }) ? null : (
        <TraitsMenuContent
          provider="codex"
          models={models}
          {...(threadRef ? { threadRef } : {})}
          {...(draftId ? { draftId } : {})}
          model={model}
          modelOptions={modelOptions}
          prompt={prompt}
          onPromptChange={onPromptChange}
        />
      ),
    renderTraitsPicker: ({
      threadRef,
      draftId,
      model,
      models,
      modelOptions,
      prompt,
      onPromptChange,
    }) =>
      !hasComposerTraitsTarget({ threadRef, draftId }) ? null : (
        <TraitsPicker
          provider="codex"
          models={models}
          {...(threadRef ? { threadRef } : {})}
          {...(draftId ? { draftId } : {})}
          model={model}
          modelOptions={modelOptions}
          prompt={prompt}
          onPromptChange={onPromptChange}
        />
      ),
  },
  claudeAgent: {
    getState: (input) => getProviderStateFromCapabilities(input),
    renderTraitsMenuContent: ({
      threadRef,
      draftId,
      model,
      models,
      modelOptions,
      prompt,
      onPromptChange,
    }) =>
      !hasComposerTraitsTarget({ threadRef, draftId }) ? null : (
        <TraitsMenuContent
          provider="claudeAgent"
          models={models}
          {...(threadRef ? { threadRef } : {})}
          {...(draftId ? { draftId } : {})}
          model={model}
          modelOptions={modelOptions}
          prompt={prompt}
          onPromptChange={onPromptChange}
        />
      ),
    renderTraitsPicker: ({
      threadRef,
      draftId,
      model,
      models,
      modelOptions,
      prompt,
      onPromptChange,
    }) =>
      !hasComposerTraitsTarget({ threadRef, draftId }) ? null : (
        <TraitsPicker
          provider="claudeAgent"
          models={models}
          {...(threadRef ? { threadRef } : {})}
          {...(draftId ? { draftId } : {})}
          model={model}
          modelOptions={modelOptions}
          prompt={prompt}
          onPromptChange={onPromptChange}
        />
      ),
  },
};

export function getComposerProviderState(input: ComposerProviderStateInput): ComposerProviderState {
  return (
    composerProviderRegistry[input.provider as ProviderKind]?.getState(input) ??
    getProviderStateFromCapabilities(input)
  );
}

export function renderProviderTraitsMenuContent(input: {
  provider: ProviderSelectionKind;
  threadRef?: ScopedThreadRef;
  draftId?: DraftId;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ProviderOptionSelections | undefined;
  prompt: string;
  onPromptChange: (prompt: string) => void;
}): ReactNode {
  const entry = composerProviderRegistry[input.provider as ProviderKind];
  if (entry) {
    return entry.renderTraitsMenuContent({
      ...(input.threadRef ? { threadRef: input.threadRef } : {}),
      ...(input.draftId ? { draftId: input.draftId } : {}),
      model: input.model,
      models: input.models,
      modelOptions: input.modelOptions,
      prompt: input.prompt,
      onPromptChange: input.onPromptChange,
    });
  }
  if (!hasComposerTraitsTarget(input)) {
    return null;
  }
  return (
    <TraitsMenuContent
      provider={input.provider}
      models={input.models}
      {...(input.threadRef ? { threadRef: input.threadRef } : {})}
      {...(input.draftId ? { draftId: input.draftId } : {})}
      model={input.model}
      modelOptions={input.modelOptions}
      prompt={input.prompt}
      onPromptChange={input.onPromptChange}
    />
  );
}

export function renderProviderTraitsPicker(input: {
  provider: ProviderSelectionKind;
  threadRef?: ScopedThreadRef;
  draftId?: DraftId;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ProviderOptionSelections | undefined;
  prompt: string;
  onPromptChange: (prompt: string) => void;
}): ReactNode {
  const entry = composerProviderRegistry[input.provider as ProviderKind];
  if (entry) {
    return entry.renderTraitsPicker({
      ...(input.threadRef ? { threadRef: input.threadRef } : {}),
      ...(input.draftId ? { draftId: input.draftId } : {}),
      model: input.model,
      models: input.models,
      modelOptions: input.modelOptions,
      prompt: input.prompt,
      onPromptChange: input.onPromptChange,
    });
  }
  if (!hasComposerTraitsTarget(input)) {
    return null;
  }
  return (
    <TraitsPicker
      provider={input.provider}
      models={input.models}
      {...(input.threadRef ? { threadRef: input.threadRef } : {})}
      {...(input.draftId ? { draftId: input.draftId } : {})}
      model={input.model}
      modelOptions={input.modelOptions}
      prompt={input.prompt}
      onPromptChange={input.onPromptChange}
    />
  );
}
