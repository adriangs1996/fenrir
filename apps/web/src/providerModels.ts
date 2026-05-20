import {
  DEFAULT_MODEL_BY_PROVIDER,
  defaultInstanceIdForDriver,
  getDefaultModelByProvider,
  getProviderDisplayName,
  isBuiltInProviderKind,
  type ModelCapabilities,
  type ProviderInstanceId,
  type ProviderSelectionKind,
  type ServerProvider,
  type ServerProviderModel,
} from "@fenrir/contracts";
import { normalizeModelSlug } from "@fenrir/shared/model";

const EMPTY_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

export function getProviderSelectionKey(
  provider: Pick<ServerProvider, "provider" | "driver" | "instanceId">,
): ProviderSelectionKind | undefined {
  return provider.provider ?? provider.driver;
}

function matchesProviderSelection(
  candidate: ServerProvider,
  provider: ProviderSelectionKind,
): boolean {
  return candidate.provider === provider || candidate.driver === provider;
}

export function getProviderModels(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderSelectionKind,
): ReadonlyArray<ServerProviderModel> {
  return getProviderSnapshot(providers, provider)?.models ?? [];
}

export function getProviderSnapshot(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderSelectionKind,
): ServerProvider | undefined {
  const defaultInstanceId = defaultInstanceIdForDriver(provider);
  return (
    providers.find((candidate) => candidate.instanceId === defaultInstanceId) ??
    providers.find((candidate) => matchesProviderSelection(candidate, provider))
  );
}

export function getProviderSnapshotByInstanceId(
  providers: ReadonlyArray<ServerProvider>,
  providerInstanceId: ProviderInstanceId | string | null | undefined,
): ServerProvider | undefined {
  if (!providerInstanceId) {
    return undefined;
  }
  return providers.find((candidate) => candidate.instanceId === providerInstanceId);
}

export function getProviderSnapshotsForKind(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderSelectionKind,
): ReadonlyArray<ServerProvider> {
  return providers.filter((candidate) => matchesProviderSelection(candidate, provider));
}

export function isProviderEnabled(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderSelectionKind,
): boolean {
  return getProviderSnapshot(providers, provider)?.enabled ?? true;
}

export function resolveSelectableProvider(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderSelectionKind | null | undefined,
): ProviderSelectionKind {
  const requested = provider ?? "codex";
  if (isProviderEnabled(providers, requested)) {
    return requested;
  }
  const fallback = providers.find((candidate) => candidate.enabled);
  return (fallback ? getProviderSelectionKey(fallback) : undefined) ?? requested;
}

export function getProviderModelCapabilities(
  models: ReadonlyArray<ServerProviderModel>,
  model: string | null | undefined,
  provider: ProviderSelectionKind,
): ModelCapabilities {
  const slug = normalizeModelSlug(model, provider);
  return models.find((candidate) => candidate.slug === slug)?.capabilities ?? EMPTY_CAPABILITIES;
}

export function getDefaultServerModel(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderSelectionKind,
): string {
  const models = getProviderModels(providers, provider);
  return (
    models.find((model) => !model.isCustom)?.slug ??
    models[0]?.slug ??
    getDefaultModelByProvider(provider)
  );
}

export function getProviderOptionLabel(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderSelectionKind,
): string {
  return (
    getProviderSnapshot(providers, provider)?.displayName ??
    getProviderSnapshot(providers, provider)?.instanceId ??
    getProviderDisplayName(provider)
  );
}

export function getSelectableProviderKinds(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ProviderSelectionKind> {
  const kinds: ProviderSelectionKind[] = [];
  const seen = new Set<string>();
  for (const provider of providers) {
    const key = getProviderSelectionKey(provider);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    kinds.push(key);
  }
  for (const builtIn of Object.keys(DEFAULT_MODEL_BY_PROVIDER) as Array<
    keyof typeof DEFAULT_MODEL_BY_PROVIDER
  >) {
    if (!seen.has(builtIn)) {
      kinds.push(builtIn);
    }
  }
  return kinds;
}

export function hasProviderTraits(
  provider: ProviderSelectionKind,
): provider is keyof typeof DEFAULT_MODEL_BY_PROVIDER {
  return isBuiltInProviderKind(provider);
}
