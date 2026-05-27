import {
  defaultInstanceIdForDriver,
  getProviderDisplayName,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
} from "@fenrir/contracts";

export type ProviderUpdateCandidate = ServerProvider & {
  readonly driver: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly versionAdvisory: NonNullable<ServerProvider["versionAdvisory"]> & {
    readonly status: "behind_latest";
    readonly latestVersion: string;
  };
};

export type ProviderUpdateToastType = "warning" | "loading" | "error" | "success";
export type ProviderUpdateToastPhase = "initial" | "running" | "failed" | "unchanged" | "succeeded";

export interface ProviderUpdateToastView {
  readonly phase: ProviderUpdateToastPhase;
  readonly type: ProviderUpdateToastType;
  readonly title: string;
  readonly description: string;
  readonly dismissAfterVisibleMs?: number;
}

export type ProviderUpdateSidebarPillTone = "loading" | "warning" | "error" | "success";

export interface ProviderUpdateSidebarPillView {
  readonly key: string;
  readonly tone: ProviderUpdateSidebarPillTone;
  readonly title: string;
  readonly description: string;
  readonly dismissible?: boolean;
  readonly dismissAfterVisibleMs?: number;
}

const PROVIDER_UPDATE_SUCCESS_VISIBLE_MS = 3_000;

function formatVersion(value: string): string {
  return value.startsWith("v") ? value : `v${value}`;
}

function providerName(provider: Pick<ServerProvider, "driver" | "provider">): string {
  return getProviderDisplayName(provider.driver ?? provider.provider ?? "provider");
}

function chooseRepresentativeProvider<T extends ServerProvider>(
  current: T | undefined,
  candidate: T,
): T {
  if (!current) {
    return candidate;
  }
  const defaultInstanceId = candidate.driver ? defaultInstanceIdForDriver(candidate.driver) : null;
  if (candidate.instanceId === defaultInstanceId) {
    return candidate;
  }
  if (current.instanceId === defaultInstanceId) {
    return current;
  }
  return candidate.checkedAt.localeCompare(current.checkedAt) >= 0 ? candidate : current;
}

function dedupeProvidersByDriver<T extends ServerProvider>(providers: ReadonlyArray<T>): T[] {
  const latestProviderByDriver = new Map<string, T>();

  for (const provider of providers) {
    const key = provider.driver ?? provider.provider ?? provider.instanceId ?? "unknown";
    latestProviderByDriver.set(
      key,
      chooseRepresentativeProvider(latestProviderByDriver.get(key), provider),
    );
  }

  return [...latestProviderByDriver.values()];
}

function dedupeProvidersByInstanceId<T extends ServerProvider>(providers: ReadonlyArray<T>): T[] {
  const latestProviderByInstanceId = new Map<string, T>();

  for (const provider of providers) {
    const key =
      provider.instanceId ?? `${provider.driver ?? provider.provider}:${provider.checkedAt}`;
    const current = latestProviderByInstanceId.get(key);
    if (!current || provider.checkedAt.localeCompare(current.checkedAt) >= 0) {
      latestProviderByInstanceId.set(key, provider);
    }
  }

  return [...latestProviderByInstanceId.values()];
}

export function isProviderUpdateCandidate(
  provider: ServerProvider,
): provider is ProviderUpdateCandidate {
  return (
    provider.enabled &&
    provider.driver !== undefined &&
    provider.instanceId !== undefined &&
    provider.versionAdvisory?.status === "behind_latest" &&
    provider.versionAdvisory.latestVersion !== null
  );
}

export function isProviderUpdateActive(provider: Pick<ServerProvider, "updateState">): boolean {
  return provider.updateState?.status === "queued" || provider.updateState?.status === "running";
}

export function collectProviderUpdateCandidates(
  providers: ReadonlyArray<ServerProvider>,
): ProviderUpdateCandidate[] {
  return dedupeProvidersByDriver(providers.filter(isProviderUpdateCandidate));
}

export function canOneClickUpdateProviderCandidate(
  candidate: ProviderUpdateCandidate,
  providers: ReadonlyArray<ServerProvider>,
): boolean {
  if (
    isProviderUpdateActive(candidate) ||
    candidate.versionAdvisory.canUpdate !== true ||
    candidate.versionAdvisory.updateCommand === null
  ) {
    return false;
  }

  const driverProviders = providers.filter((provider) => provider.driver === candidate.driver);
  const updateCommands = new Set<string>();
  for (const provider of driverProviders) {
    if (!isProviderUpdateCandidate(provider)) {
      continue;
    }
    const advisory = provider.versionAdvisory;
    if (advisory.canUpdate !== true || advisory.updateCommand === null) {
      return false;
    }
    updateCommands.add(advisory.updateCommand);
  }

  return updateCommands.size === 1;
}

export function providerUpdateNotificationKey(
  providers: ReadonlyArray<ProviderUpdateCandidate>,
): string | null {
  const parts = dedupeProvidersByDriver(providers)
    .map((provider) => `${provider.driver}:${provider.versionAdvisory.latestVersion}`)
    .toSorted();
  return parts.length > 0 ? parts.join("|") : null;
}

export function providerUpdateCandidateKey(provider: ProviderUpdateCandidate): string {
  return providerUpdateNotificationKey([provider])!;
}

export function formatProviderList(providers: ReadonlyArray<ServerProvider>) {
  const names = providers.map(providerName);
  if (names.length <= 2) {
    return names.join(" and ");
  }
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function getProviderUpdateInitialToastView(input: {
  readonly updateProviders: ReadonlyArray<ProviderUpdateCandidate>;
  readonly oneClickProviders: ReadonlyArray<ProviderUpdateCandidate>;
}): ProviderUpdateToastView {
  const firstProvider = input.updateProviders[0];
  return {
    phase: "initial",
    type: "warning",
    title:
      input.updateProviders.length === 1 && firstProvider
        ? `Update available: ${providerName(firstProvider)} ${formatVersion(firstProvider.versionAdvisory.latestVersion)}`
        : `Updates available: ${input.updateProviders.length} providers`,
    description:
      input.oneClickProviders.length > 0
        ? "Install the update now or review provider settings."
        : `${formatProviderList(input.updateProviders)} can be updated from provider settings.`,
  };
}

export function getProviderUpdateRunningToastView(providerCount: number): ProviderUpdateToastView {
  return {
    phase: "running",
    type: "loading",
    title: providerCount === 1 ? "Updating provider" : "Updating providers",
    description: "Running provider update command.",
  };
}

export function getProviderUpdateRejectedToastView(
  providerCount: number,
  message: string,
): ProviderUpdateToastView {
  return {
    phase: "failed",
    type: "error",
    title: providerCount === 1 ? "Provider update failed" : "Provider updates failed",
    description: message,
  };
}

export function getProviderUpdateProgressToastView(input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly providerCount: number;
}): ProviderUpdateToastView {
  const providers = dedupeProvidersByDriver(input.providers);
  const failedProvider = providers.find((provider) => provider.updateState?.status === "failed");
  if (failedProvider) {
    return {
      phase: "failed",
      type: "error",
      title: `${providerName(failedProvider)} update failed`,
      description: failedProvider.updateState?.message ?? "Provider update failed.",
    };
  }

  const unchangedProvider = providers.find(
    (provider) => provider.updateState?.status === "unchanged",
  );
  if (unchangedProvider) {
    return {
      phase: "unchanged",
      type: "warning",
      title: `${providerName(unchangedProvider)} still needs an update`,
      description:
        unchangedProvider.updateState?.message ??
        "The update command completed, but the provider still appears outdated.",
    };
  }

  if (providers.some(isProviderUpdateActive)) {
    return getProviderUpdateRunningToastView(input.providerCount);
  }

  const allUpdated =
    providers.length >= input.providerCount &&
    providers.every(
      (provider) =>
        provider.updateState?.status === "succeeded" || !isProviderUpdateCandidate(provider),
    );
  if (allUpdated) {
    return {
      phase: "succeeded",
      type: "success",
      title: input.providerCount === 1 ? "Provider updated" : "Provider updates finished",
      description: "New sessions will use the updated provider.",
      dismissAfterVisibleMs: PROVIDER_UPDATE_SUCCESS_VISIBLE_MS,
    };
  }

  return getProviderUpdateRunningToastView(input.providerCount);
}

export function getSingleProviderUpdateProgressToastView(
  provider: ServerProvider,
): ProviderUpdateToastView {
  return getProviderUpdateProgressToastView({ providers: [provider], providerCount: 1 });
}

export function collectUpdatedProviderSnapshots(input: {
  readonly results: ReadonlyArray<
    PromiseSettledResult<{ readonly providers: ReadonlyArray<ServerProvider> }>
  >;
  readonly providerInstanceIds: ReadonlySet<ProviderInstanceId>;
}): ServerProvider[] {
  const matchedProviders: ServerProvider[] = [];

  for (const result of input.results) {
    if (result.status !== "fulfilled") {
      continue;
    }
    for (const provider of result.value.providers) {
      if (provider.instanceId && input.providerInstanceIds.has(provider.instanceId)) {
        matchedProviders.push(provider);
      }
    }
  }

  return dedupeProvidersByInstanceId(matchedProviders);
}

export function firstRejectedProviderUpdateMessage(
  results: ReadonlyArray<PromiseSettledResult<unknown>>,
): string | null {
  const rejected = results.find((result) => result.status === "rejected");
  if (!rejected) {
    return null;
  }
  return rejected.reason instanceof Error ? rejected.reason.message : "Provider update failed.";
}

function terminalStateVisible(provider: ServerProvider, visibleAfterIso: string | undefined) {
  const status = provider.updateState?.status;
  if (status !== "failed" && status !== "unchanged" && status !== "succeeded") {
    return false;
  }
  const finishedAt = provider.updateState?.finishedAt ?? null;
  return visibleAfterIso === undefined || (finishedAt !== null && finishedAt >= visibleAfterIso);
}

export function getProviderUpdateSidebarPillView(
  providers: ReadonlyArray<ServerProvider>,
  options?: {
    readonly visibleAfterIso?: string;
    readonly dismissedKeys?: ReadonlySet<string>;
  },
): ProviderUpdateSidebarPillView | null {
  const dedupedProviders = dedupeProvidersByDriver(providers);
  const activeProvider = dedupedProviders.find(isProviderUpdateActive);
  if (activeProvider) {
    return {
      key: `active:${activeProvider.instanceId ?? activeProvider.driver}`,
      tone: "loading",
      title: `Updating ${providerName(activeProvider)}`,
      description: activeProvider.updateState?.message ?? "Provider update in progress.",
    };
  }

  const terminalProvider = dedupedProviders.find((provider) =>
    terminalStateVisible(provider, options?.visibleAfterIso),
  );
  if (terminalProvider?.updateState?.status === "failed") {
    const key = `failed:${terminalProvider.instanceId}:${terminalProvider.updateState.finishedAt}`;
    return options?.dismissedKeys?.has(key)
      ? null
      : {
          key,
          tone: "error",
          title: `${providerName(terminalProvider)} update failed`,
          description: terminalProvider.updateState.message ?? "Provider update failed.",
          dismissible: true,
        };
  }
  if (terminalProvider?.updateState?.status === "unchanged") {
    const key = `unchanged:${terminalProvider.instanceId}:${terminalProvider.updateState.finishedAt}`;
    return options?.dismissedKeys?.has(key)
      ? null
      : {
          key,
          tone: "warning",
          title: `${providerName(terminalProvider)} still needs an update`,
          description:
            terminalProvider.updateState.message ??
            "The update command completed, but the provider still appears outdated.",
          dismissible: true,
        };
  }
  if (terminalProvider?.updateState?.status === "succeeded") {
    const key = `succeeded:${terminalProvider.instanceId}:${terminalProvider.updateState.finishedAt}`;
    return options?.dismissedKeys?.has(key)
      ? null
      : {
          key,
          tone: "success",
          title: `${providerName(terminalProvider)} updated`,
          description: "New sessions will use the updated provider.",
          dismissAfterVisibleMs: PROVIDER_UPDATE_SUCCESS_VISIBLE_MS,
        };
  }

  const updateCandidate = collectProviderUpdateCandidates(dedupedProviders)[0];
  if (!updateCandidate) {
    return null;
  }
  const key = providerUpdateCandidateKey(updateCandidate);
  return options?.dismissedKeys?.has(key)
    ? null
    : {
        key,
        tone: "warning",
        title: `${providerName(updateCandidate)} update available`,
        description: `${providerName(updateCandidate)} ${formatVersion(updateCandidate.versionAdvisory.latestVersion)} is available.`,
        dismissible: true,
      };
}
