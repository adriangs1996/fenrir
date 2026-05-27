import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  isBuiltInProviderKind,
  type ModelSelection,
  type ProviderKind,
  type ProviderSelectionKind,
  type ServerProvider,
} from "@fenrir/contracts";
import { normalizeModelSlug, resolveSelectableModel } from "@fenrir/shared/model";
import { getComposerProviderState } from "./components/chat/composerProviderRegistry";
import { UnifiedSettings } from "@fenrir/contracts/settings";
import {
  getDefaultServerModel,
  getProviderModels,
  getSelectableProviderKinds,
  resolveSelectableProvider,
} from "./providerModels";

const MAX_CUSTOM_MODEL_COUNT = 32;
export const MAX_CUSTOM_MODEL_LENGTH = 256;

export type ProviderCustomModelConfig = {
  provider: ProviderKind;
  title: string;
  description: string;
  placeholder: string;
  example: string;
};

export interface AppModelOption {
  slug: string;
  name: string;
  shortName?: string | undefined;
  subProvider?: string | undefined;
  isCustom: boolean;
}

const PROVIDER_CUSTOM_MODEL_CONFIG: Record<ProviderKind, ProviderCustomModelConfig> = {
  codex: {
    provider: "codex",
    title: "Codex",
    description: "Save additional Codex model slugs for the picker and `/model` command.",
    placeholder: "your-codex-model-slug",
    example: "gpt-6.7-codex-ultra-preview",
  },
  claudeAgent: {
    provider: "claudeAgent",
    title: "Claude",
    description: "Save additional Claude model slugs for the picker and `/model` command.",
    placeholder: "your-claude-model-slug",
    example: "claude-sonnet-5-0",
  },
};

export const MODEL_PROVIDER_SETTINGS = Object.values(PROVIDER_CUSTOM_MODEL_CONFIG);

export function normalizeCustomModelSlugs(
  models: Iterable<string | null | undefined>,
  builtInModelSlugs: ReadonlySet<string>,
  provider: ProviderKind = "codex",
): string[] {
  const normalizedModels: string[] = [];
  const seen = new Set<string>();

  for (const candidate of models) {
    const normalized = normalizeModelSlug(candidate, provider);
    if (
      !normalized ||
      normalized.length > MAX_CUSTOM_MODEL_LENGTH ||
      builtInModelSlugs.has(normalized) ||
      seen.has(normalized)
    ) {
      continue;
    }

    seen.add(normalized);
    normalizedModels.push(normalized);
    if (normalizedModels.length >= MAX_CUSTOM_MODEL_COUNT) {
      break;
    }
  }

  return normalizedModels;
}

export function getAppModelOptions(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderSelectionKind,
  selectedModel?: string | null,
): AppModelOption[] {
  const options: AppModelOption[] = getProviderModels(providers, provider).map(
    ({ slug, name, shortName, subProvider, isCustom }) => {
      const option: AppModelOption = { slug, name, isCustom };
      if (shortName) {
        option.shortName = shortName;
      }
      if (subProvider) {
        option.subProvider = subProvider;
      }
      return option;
    },
  );
  const seen = new Set(options.map((option) => option.slug));
  const trimmedSelectedModel = selectedModel?.trim().toLowerCase();
  const builtInModelSlugs = new Set(
    getProviderModels(providers, provider)
      .filter((model) => !model.isCustom)
      .map((model) => model.slug),
  );

  if (isBuiltInProviderKind(provider)) {
    const customModels = settings.providers[provider].customModels;
    for (const slug of normalizeCustomModelSlugs(customModels, builtInModelSlugs, provider)) {
      if (seen.has(slug)) {
        continue;
      }

      seen.add(slug);
      options.push({
        slug,
        name: slug,
        isCustom: true,
      });
    }
  }

  const normalizedSelectedModel = normalizeModelSlug(selectedModel, provider);
  const selectedModelMatchesExistingName =
    typeof trimmedSelectedModel === "string" &&
    options.some((option) => option.name.toLowerCase() === trimmedSelectedModel);
  if (
    normalizedSelectedModel &&
    !seen.has(normalizedSelectedModel) &&
    !selectedModelMatchesExistingName
  ) {
    options.push({
      slug: normalizedSelectedModel,
      name: normalizedSelectedModel,
      isCustom: true,
    });
  }

  return options;
}

export function resolveAppModelSelection(
  provider: ProviderSelectionKind,
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selectedModel: string | null | undefined,
): string {
  const resolvedProvider = resolveSelectableProvider(providers, provider);
  const options = getAppModelOptions(settings, providers, resolvedProvider, selectedModel);
  return (
    resolveSelectableModel(resolvedProvider, selectedModel, options) ??
    getDefaultServerModel(providers, resolvedProvider)
  );
}

export function getCustomModelOptionsByProvider(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selectedProvider?: ProviderSelectionKind | null,
  selectedModel?: string | null,
): Record<ProviderSelectionKind, ReadonlyArray<AppModelOption>> {
  return Object.fromEntries(
    getSelectableProviderKinds(providers).map((provider) => [
      provider,
      getAppModelOptions(
        settings,
        providers,
        provider,
        selectedProvider === provider ? selectedModel : undefined,
      ),
    ]),
  ) as Record<ProviderSelectionKind, ReadonlyArray<AppModelOption>>;
}

export function resolveAppModelSelectionState(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
): ModelSelection {
  const selection = settings.textGenerationModelSelection ?? {
    provider: "codex" as const,
    model: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER.codex,
  };
  const provider = resolveSelectableProvider(providers, selection.provider);

  // When the provider changed due to fallback (e.g. selected provider was disabled),
  // don't carry over the old provider's model — use the fallback provider's default.
  const selectedModel = provider === selection.provider ? selection.model : null;
  const model = resolveAppModelSelection(provider, settings, providers, selectedModel);
  const modelOptionsForDispatch = getComposerProviderState({
    provider,
    model,
    models: getProviderModels(providers, provider),
    prompt: "",
    modelOptions:
      provider === selection.provider && selection.options
        ? { [provider]: selection.options }
        : undefined,
  }).modelOptionsForDispatch;

  return {
    provider,
    model,
    ...(modelOptionsForDispatch ? { options: modelOptionsForDispatch } : {}),
  };
}
