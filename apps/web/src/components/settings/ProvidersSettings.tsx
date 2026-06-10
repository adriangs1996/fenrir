import {
  ChevronDownIcon,
  DownloadIcon,
  InfoIcon,
  LoaderIcon,
  PlusIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type ProviderInstanceConfig,
  type ProviderKind,
  type ServerProvider,
  type ServerProviderModel,
  type ServerProviderVersionAdvisory,
} from "@fenrir/contracts";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@fenrir/contracts/settings";
import { normalizeModelSlug } from "@fenrir/shared/model";
import { Equal } from "effect";
import { MAX_CUSTOM_MODEL_LENGTH, resolveAppModelSelectionState } from "../../modelSelection";
import { ensureLocalApi } from "../../localApi";
import { getProviderSnapshot } from "../../providerModels";
import { formatRelativeTime } from "../../lib/formatting";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingResetButton, SettingsSection, useRelativeTimeTick } from "./settingsLayout";
import { useServerProviders } from "../../rpc/serverState";
import {
  PROVIDER_DRIVER_DEFINITIONS,
  getProviderDriverDefinition,
  getProviderDriverLabel,
} from "./providerDriverMeta";
import {
  getSingleProviderUpdateProgressToastView,
  isProviderUpdateActive,
} from "../ProviderUpdateLaunchNotification.logic";

type SupportedProviderInstanceDriver = "codex" | "claudeAgent" | "cursor" | "opencode";

function isBuiltInProviderKind(value: string): value is ProviderKind {
  return value === "codex" || value === "claudeAgent";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readConfigString(config: unknown, key: string): string {
  if (!isRecord(config)) {
    return "";
  }
  const value = config[key];
  return typeof value === "string" ? value : "";
}

function normalizeProviderInstanceConfig(
  driver: string,
  entry: ProviderInstanceConfig | null | undefined,
): ProviderInstanceConfig | null {
  if (!entry) {
    return null;
  }
  const next: ProviderInstanceConfig = {
    driver: entry.driver,
    ...(entry.displayName && entry.displayName.trim().length > 0
      ? { displayName: entry.displayName.trim() }
      : {}),
    ...(entry.accentColor ? { accentColor: entry.accentColor } : {}),
    ...(typeof entry.enabled === "boolean" ? { enabled: entry.enabled } : {}),
    ...(entry.config !== undefined ? { config: entry.config } : {}),
  };

  return next.driver === driver &&
    next.displayName === undefined &&
    next.accentColor === undefined &&
    next.enabled === undefined &&
    next.config === undefined
    ? null
    : next;
}

type ProviderSettingsCard = {
  cardKey: string;
  instanceId: string;
  driver: string;
  provider: ProviderKind | null;
  displayName: string;
  providerDisplayName: string;
  instanceDisplayNameInput: string;
  isDefaultInstance: boolean;
  supportsLegacySettings: boolean;
  isDirty: boolean;
  liveProvider: ServerProvider | undefined;
  models: ReadonlyArray<ServerProviderModel>;
  statusStyle: (typeof PROVIDER_STATUS_STYLES)[keyof typeof PROVIDER_STATUS_STYLES];
  summary: ReturnType<typeof getProviderSummary>;
  versionLabel: string | null;
  versionAdvisory: ReturnType<typeof getProviderVersionAdvisoryPresentation>;
  providerConfig: (typeof DEFAULT_UNIFIED_SETTINGS.providers)[ProviderKind] | undefined;
};

const PROVIDER_STATUS_STYLES = {
  disabled: {
    dot: "bg-amber-400",
  },
  error: {
    dot: "bg-destructive",
  },
  ready: {
    dot: "bg-success",
  },
  warning: {
    dot: "bg-warning",
  },
} as const;

function getProviderSummary(provider: ServerProvider | undefined) {
  if (!provider) {
    return {
      headline: "Checking provider status",
      detail: "Waiting for the server to report installation and authentication details.",
    };
  }
  if (provider.availability === "unavailable") {
    return {
      headline: "Driver unavailable",
      detail:
        provider.unavailableReason ??
        provider.message ??
        "This configured provider driver is not available in this Fenrir build.",
    };
  }
  if (!provider.enabled) {
    return {
      headline: "Disabled",
      detail:
        provider.message ?? "This provider is installed but disabled for new sessions in Fenrir.",
    };
  }
  if (!provider.installed) {
    return {
      headline: "Not found",
      detail: provider.message ?? "CLI not detected on PATH.",
    };
  }
  if (provider.auth.status === "authenticated") {
    const authLabel = provider.auth.label ?? provider.auth.type;
    return {
      headline: authLabel ? `Authenticated · ${authLabel}` : "Authenticated",
      detail: provider.message ?? null,
    };
  }
  if (provider.auth.status === "unauthenticated") {
    return {
      headline: "Not authenticated",
      detail: provider.message ?? null,
    };
  }
  if (provider.status === "warning") {
    return {
      headline: "Needs attention",
      detail:
        provider.message ?? "The provider is installed, but the server could not fully verify it.",
    };
  }
  if (provider.status === "error") {
    return {
      headline: "Unavailable",
      detail: provider.message ?? "The provider failed its startup checks.",
    };
  }
  return {
    headline: "Available",
    detail: provider.message ?? "Installed and ready, but authentication could not be verified.",
  };
}

function getProviderVersionLabel(version: string | null | undefined) {
  if (!version) return null;
  return version.startsWith("v") ? version : `v${version}`;
}

function getProviderVersionAdvisoryPresentation(
  advisory: ServerProviderVersionAdvisory | undefined,
): {
  readonly detail: string;
  readonly emphasis: "normal" | "strong";
} | null {
  if (!advisory || advisory.status === "current" || advisory.status === "unknown") {
    return null;
  }

  const versionLabel = getProviderVersionLabel(advisory.latestVersion);
  return {
    detail:
      advisory.message ??
      (versionLabel
        ? `Update available: install ${versionLabel}.`
        : "Update available: install the latest provider version."),
    emphasis: "normal",
  };
}

function ProviderLastChecked({ lastCheckedAt }: { lastCheckedAt: string | null }) {
  useRelativeTimeTick();
  const lastCheckedRelative = lastCheckedAt ? formatRelativeTime(lastCheckedAt) : null;

  if (!lastCheckedRelative) {
    return null;
  }

  return (
    <span className="text-[11px] text-muted-foreground/60">
      {lastCheckedRelative.suffix ? (
        <>
          Checked <span className="font-mono tabular-nums">{lastCheckedRelative.value}</span>{" "}
          {lastCheckedRelative.suffix}
        </>
      ) : (
        <>Checked {lastCheckedRelative.value}</>
      )}
    </span>
  );
}

export function ProvidersSettingsSection(props: {
  settings: UnifiedSettings;
  updateSettings: (patch: Partial<UnifiedSettings>) => void;
}) {
  const { settings, updateSettings } = props;
  const [openProviderDetails, setOpenProviderDetails] = useState<Record<string, boolean>>({
    codex: Boolean(
      settings.providers.codex.binaryPath !== DEFAULT_UNIFIED_SETTINGS.providers.codex.binaryPath ||
      settings.providers.codex.homePath !== DEFAULT_UNIFIED_SETTINGS.providers.codex.homePath ||
      settings.providers.codex.customModels.length > 0,
    ),
    claudeAgent: Boolean(
      settings.providers.claudeAgent.binaryPath !==
        DEFAULT_UNIFIED_SETTINGS.providers.claudeAgent.binaryPath ||
      settings.providers.claudeAgent.customModels.length > 0,
    ),
  });
  const [customModelInputByProvider, setCustomModelInputByProvider] = useState<
    Record<ProviderKind, string>
  >({
    codex: "",
    claudeAgent: "",
  });
  const [newProviderInstanceDriver, setNewProviderInstanceDriver] =
    useState<SupportedProviderInstanceDriver>("codex");
  const [newProviderInstanceId, setNewProviderInstanceId] = useState("");
  const [newProviderInstanceDisplayName, setNewProviderInstanceDisplayName] = useState("");
  const [newProviderInstanceError, setNewProviderInstanceError] = useState<string | null>(null);
  const [customModelErrorByProvider, setCustomModelErrorByProvider] = useState<
    Partial<Record<ProviderKind, string | null>>
  >({});
  const [isRefreshingProviders, setIsRefreshingProviders] = useState(false);
  const refreshingRef = useRef(false);
  const modelListRefs = useRef<Partial<Record<ProviderKind, HTMLDivElement | null>>>({});
  const refreshProviders = useCallback(() => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setIsRefreshingProviders(true);
    void ensureLocalApi()
      .server.refreshProviders()
      .catch((error: unknown) => {
        console.warn("Failed to refresh providers", error);
      })
      .finally(() => {
        refreshingRef.current = false;
        setIsRefreshingProviders(false);
      });
  }, []);

  const runProviderUpdate = useCallback((provider: ServerProvider) => {
    if (!provider.driver || !provider.instanceId || isProviderUpdateActive(provider)) {
      return;
    }
    const driver = provider.driver;
    const instanceId = provider.instanceId;

    const toastId = toastManager.add({
      type: "loading",
      title: `Updating ${getProviderDriverLabel(driver)}`,
      description: "Running provider update command.",
      timeout: 0,
      data: { hideCopyButton: true },
    });

    void ensureLocalApi()
      .server.updateProvider({
        provider: driver,
        instanceId,
      })
      .then(({ providers }) => {
        const updatedProvider =
          providers.find((candidate) => candidate.instanceId === instanceId) ?? provider;
        const view = getSingleProviderUpdateProgressToastView(updatedProvider);
        toastManager.update(toastId, {
          type: view.type,
          title: view.title,
          description: view.description,
          timeout: 0,
          data: {
            hideCopyButton: true,
            ...(view.dismissAfterVisibleMs !== undefined
              ? { dismissAfterVisibleMs: view.dismissAfterVisibleMs }
              : {}),
          },
        });
      })
      .catch((error: unknown) => {
        toastManager.update(toastId, {
          type: "error",
          title: `Could not update ${getProviderDriverLabel(driver)}`,
          description: error instanceof Error ? error.message : "Provider update failed.",
          timeout: 0,
        });
      });
  }, []);

  const serverProviders = useServerProviders();
  const providerInstanceMap = settings.providerInstances as Record<string, ProviderInstanceConfig>;
  const updateProviderInstanceEntry = useCallback(
    (
      instanceId: string,
      driver: string,
      updater: (current: ProviderInstanceConfig | undefined) => ProviderInstanceConfig | null,
    ) => {
      const nextProviderInstances: Record<string, ProviderInstanceConfig> = {
        ...providerInstanceMap,
      };
      const nextEntry = normalizeProviderInstanceConfig(
        driver,
        updater(providerInstanceMap[instanceId]),
      );

      if (nextEntry === null) {
        delete nextProviderInstances[instanceId];
      } else {
        nextProviderInstances[instanceId] = nextEntry;
      }

      updateSettings({
        providerInstances: nextProviderInstances as typeof settings.providerInstances,
      });
    },
    [providerInstanceMap, updateSettings],
  );
  const updateProviderDriverConfigField = useCallback(
    (providerCard: ProviderSettingsCard, fieldKey: string, value: string) => {
      const builtInProvider = providerCard.provider;
      if (
        providerCard.supportsLegacySettings &&
        providerCard.isDefaultInstance &&
        builtInProvider
      ) {
        updateSettings({
          providers: {
            ...settings.providers,
            [builtInProvider]: {
              ...settings.providers[builtInProvider],
              [fieldKey]: value,
            },
          },
        });
        return;
      }

      updateProviderInstanceEntry(providerCard.instanceId, providerCard.driver, (current) => {
        const base = current ?? { driver: ProviderDriverKind.make(providerCard.driver) };
        const currentConfig = isRecord(base.config) ? { ...base.config } : {};
        if (value.length > 0) {
          currentConfig[fieldKey] = value;
        } else {
          delete currentConfig[fieldKey];
        }
        const { config: _existingConfig, ...rest } = base;
        return {
          ...rest,
          ...(Object.keys(currentConfig).length > 0 ? { config: currentConfig } : {}),
        };
      });
    },
    [settings.providers, updateProviderInstanceEntry, updateSettings],
  );
  const addProviderInstance = useCallback(() => {
    const instanceId = newProviderInstanceId.trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(instanceId)) {
      setNewProviderInstanceError(
        "Instance ids must start with a letter and use only letters, numbers, underscores, or dashes.",
      );
      return;
    }
    if (providerInstanceMap[instanceId] !== undefined) {
      setNewProviderInstanceError("That provider instance id already exists.");
      return;
    }
    const nextProviderInstances: Record<string, ProviderInstanceConfig> = {
      ...providerInstanceMap,
      [instanceId]: {
        driver: ProviderDriverKind.make(newProviderInstanceDriver),
        ...(newProviderInstanceDisplayName.trim().length > 0
          ? { displayName: newProviderInstanceDisplayName.trim() }
          : {}),
      },
    };
    updateSettings({
      providerInstances: nextProviderInstances as typeof settings.providerInstances,
    });
    setOpenProviderDetails((existing) => ({ ...existing, [instanceId]: true }));
    setNewProviderInstanceId("");
    setNewProviderInstanceDisplayName("");
    setNewProviderInstanceError(null);
  }, [
    newProviderInstanceDisplayName,
    newProviderInstanceDriver,
    newProviderInstanceId,
    providerInstanceMap,
    updateSettings,
  ]);

  const textGenerationModelSelection = resolveAppModelSelectionState(settings, serverProviders);
  const textGenProvider = textGenerationModelSelection.provider;

  const addCustomModel = useCallback(
    (provider: ProviderKind) => {
      const customModelInput = customModelInputByProvider[provider];
      const customModels = settings.providers[provider].customModels;
      const normalized = normalizeModelSlug(customModelInput, provider);
      if (!normalized) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "Enter a model slug.",
        }));
        return;
      }
      if (
        serverProviders
          .find((candidate) => candidate.provider === provider)
          ?.models.some((option) => !option.isCustom && option.slug === normalized)
      ) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "That model is already built in.",
        }));
        return;
      }
      if (normalized.length > MAX_CUSTOM_MODEL_LENGTH) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: `Model slugs must be ${MAX_CUSTOM_MODEL_LENGTH} characters or less.`,
        }));
        return;
      }
      if (customModels.includes(normalized)) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "That custom model is already saved.",
        }));
        return;
      }

      updateSettings({
        providers: {
          ...settings.providers,
          [provider]: {
            ...settings.providers[provider],
            customModels: [...customModels, normalized],
          },
        },
      });
      setCustomModelInputByProvider((existing) => ({
        ...existing,
        [provider]: "",
      }));
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));

      const el = modelListRefs.current[provider];
      if (!el) return;
      const scrollToEnd = () => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      requestAnimationFrame(scrollToEnd);
      const observer = new MutationObserver(() => {
        scrollToEnd();
        observer.disconnect();
      });
      observer.observe(el, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 2_000);
    },
    [customModelInputByProvider, serverProviders, settings, updateSettings],
  );

  const removeCustomModel = useCallback(
    (provider: ProviderKind, slug: string) => {
      updateSettings({
        providers: {
          ...settings.providers,
          [provider]: {
            ...settings.providers[provider],
            customModels: settings.providers[provider].customModels.filter(
              (model) => model !== slug,
            ),
          },
        },
      });
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));
    },
    [settings, updateSettings],
  );

  const providerCards = useMemo<ProviderSettingsCard[]>(() => {
    const cards: ProviderSettingsCard[] = [];
    const representedInstanceIds = new Set<string>();

    for (const provider of ["codex", "claudeAgent"] as const) {
      const instanceId = defaultInstanceIdForDriver(provider);
      const liveProvider = getProviderSnapshot(serverProviders, provider);
      const providerConfig = settings.providers[provider];
      const defaultProviderConfig = DEFAULT_UNIFIED_SETTINGS.providers[provider];
      const explicitInstanceConfig = providerInstanceMap[instanceId];
      const statusKey = liveProvider?.status ?? (providerConfig.enabled ? "warning" : "disabled");
      const summary = getProviderSummary(liveProvider);
      const versionAdvisory = getProviderVersionAdvisoryPresentation(liveProvider?.versionAdvisory);
      const models: ReadonlyArray<ServerProviderModel> =
        liveProvider?.models ??
        providerConfig.customModels.map((slug) => ({
          slug,
          name: slug,
          isCustom: true,
          capabilities: null,
        }));

      representedInstanceIds.add(instanceId);
      cards.push({
        cardKey: instanceId,
        instanceId,
        driver: provider,
        provider,
        displayName:
          liveProvider?.displayName ??
          explicitInstanceConfig?.displayName ??
          getProviderDriverLabel(provider),
        providerDisplayName: getProviderDriverLabel(provider),
        instanceDisplayNameInput: explicitInstanceConfig?.displayName ?? "",
        isDefaultInstance: true,
        supportsLegacySettings: true,
        isDirty:
          !Equal.equals(providerConfig, defaultProviderConfig) ||
          explicitInstanceConfig !== undefined,
        liveProvider,
        models,
        statusStyle: PROVIDER_STATUS_STYLES[statusKey],
        summary,
        versionLabel: getProviderVersionLabel(liveProvider?.version),
        versionAdvisory,
        providerConfig,
      });
    }

    for (const [instanceId, instanceConfig] of Object.entries(providerInstanceMap)) {
      if (representedInstanceIds.has(instanceId)) {
        continue;
      }

      const driver = instanceConfig.driver;
      const provider = isBuiltInProviderKind(driver) ? (driver as ProviderKind) : null;
      const liveProvider = serverProviders.find((candidate) => candidate.instanceId === instanceId);
      const statusKey =
        liveProvider?.status ?? ((instanceConfig.enabled ?? true) ? "warning" : "disabled");
      const summary =
        liveProvider !== undefined
          ? getProviderSummary(liveProvider)
          : {
              headline: "Configured instance",
              detail:
                "This provider instance is saved in settings, but Fenrir does not route it yet.",
            };

      cards.push({
        cardKey: instanceId,
        instanceId,
        driver,
        provider,
        displayName: liveProvider?.displayName ?? instanceConfig.displayName ?? instanceId,
        providerDisplayName: getProviderDriverLabel(driver),
        instanceDisplayNameInput: instanceConfig.displayName ?? "",
        isDefaultInstance: false,
        supportsLegacySettings: false,
        isDirty: true,
        liveProvider,
        models: liveProvider?.models ?? [],
        statusStyle: PROVIDER_STATUS_STYLES[statusKey],
        summary,
        versionLabel: getProviderVersionLabel(liveProvider?.version),
        versionAdvisory: getProviderVersionAdvisoryPresentation(liveProvider?.versionAdvisory),
        providerConfig: undefined,
      });
    }

    return cards;
  }, [providerInstanceMap, serverProviders, settings.providers]);

  const lastCheckedAt =
    serverProviders.length > 0
      ? serverProviders.reduce(
          (latest, provider) => (provider.checkedAt > latest ? provider.checkedAt : latest),
          serverProviders[0]!.checkedAt,
        )
      : null;

  return (
    <SettingsSection
      title="Providers"
      headerAction={
        <div className="flex items-center gap-1.5">
          <ProviderLastChecked lastCheckedAt={lastCheckedAt} />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                  disabled={isRefreshingProviders}
                  onClick={() => void refreshProviders()}
                  aria-label="Refresh provider status"
                >
                  {isRefreshingProviders ? (
                    <LoaderIcon className="size-3 animate-spin" />
                  ) : (
                    <RefreshCwIcon className="size-3" />
                  )}
                </Button>
              }
            />
            <TooltipPopup side="top">Refresh provider status</TooltipPopup>
          </Tooltip>
        </div>
      }
    >
      <div className="border-t border-border/60 px-4 py-3 first:border-t-0 sm:px-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="grid gap-1">
            <span className="text-xs font-medium text-foreground">Driver</span>
            <Select
              value={newProviderInstanceDriver}
              onValueChange={(value) => {
                if (
                  value === "codex" ||
                  value === "claudeAgent" ||
                  value === "cursor" ||
                  value === "opencode"
                ) {
                  setNewProviderInstanceDriver(value);
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="New provider instance driver">
                <SelectValue>{getProviderDriverLabel(newProviderInstanceDriver)}</SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {PROVIDER_DRIVER_DEFINITIONS.map((provider) => (
                  <SelectItem key={provider.value} value={provider.value}>
                    {provider.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </label>
          <label className="grid flex-1 gap-1">
            <span className="text-xs font-medium text-foreground">Instance ID</span>
            <Input
              value={newProviderInstanceId}
              onChange={(event) => {
                setNewProviderInstanceId(event.target.value);
                if (newProviderInstanceError) {
                  setNewProviderInstanceError(null);
                }
              }}
              placeholder="codex_work"
              spellCheck={false}
            />
          </label>
          <label className="grid flex-1 gap-1">
            <span className="text-xs font-medium text-foreground">Display name</span>
            <Input
              value={newProviderInstanceDisplayName}
              onChange={(event) => setNewProviderInstanceDisplayName(event.target.value)}
              placeholder="Optional"
              spellCheck={false}
            />
          </label>
          <Button size="sm" className="gap-1.5" onClick={addProviderInstance}>
            <PlusIcon className="size-3.5" />
            Add instance
          </Button>
        </div>
        {newProviderInstanceError ? (
          <p className="mt-2 text-xs text-destructive">{newProviderInstanceError}</p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Create provider instances with their own display name, config, and routing identity.
          </p>
        )}
      </div>
      {providerCards.map((providerCard) => {
        const builtInProvider = providerCard.provider;
        const driverDefinition = getProviderDriverDefinition(providerCard.driver);
        const customModelInput =
          builtInProvider !== null ? customModelInputByProvider[builtInProvider] : "";
        const customModelError =
          builtInProvider !== null ? (customModelErrorByProvider[builtInProvider] ?? null) : null;
        const providerDisplayName = providerCard.displayName;
        const isOpen = openProviderDetails[providerCard.cardKey] ?? false;
        const persistedInstanceConfig = providerInstanceMap[providerCard.instanceId];
        const instanceConfigValue =
          providerCard.supportsLegacySettings && builtInProvider && providerCard.providerConfig
            ? providerCard.providerConfig
            : persistedInstanceConfig?.config;
        const instanceEnabled =
          providerCard.supportsLegacySettings && providerCard.providerConfig
            ? providerCard.providerConfig.enabled
            : (persistedInstanceConfig?.enabled ?? providerCard.liveProvider?.enabled ?? true);

        return (
          <div key={providerCard.cardKey} className="border-t border-border first:border-t-0">
            <div className="px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex min-h-5 items-center gap-1.5">
                    <span
                      className={cn("size-2 shrink-0 rounded-full", providerCard.statusStyle.dot)}
                    />
                    <h3 className="text-sm font-medium text-foreground">{providerDisplayName}</h3>
                    {providerCard.versionLabel ? (
                      <code className="text-xs text-muted-foreground">
                        {providerCard.versionLabel}
                      </code>
                    ) : null}
                    {!providerCard.isDefaultInstance ? (
                      <code className="truncate text-[11px] text-muted-foreground/70">
                        {providerCard.instanceId}
                      </code>
                    ) : null}
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                      {providerCard.isDirty ? (
                        <SettingResetButton
                          label={`${providerDisplayName} provider settings`}
                          onClick={() => {
                            if (providerCard.isDefaultInstance && builtInProvider) {
                              const nextProviderInstances = { ...providerInstanceMap };
                              delete nextProviderInstances[providerCard.instanceId];
                              updateSettings({
                                providers: {
                                  ...settings.providers,
                                  [builtInProvider]:
                                    DEFAULT_UNIFIED_SETTINGS.providers[builtInProvider],
                                },
                                providerInstances:
                                  nextProviderInstances as typeof settings.providerInstances,
                              });
                              setCustomModelErrorByProvider((existing) => ({
                                ...existing,
                                [builtInProvider]: null,
                              }));
                              return;
                            }

                            updateProviderInstanceEntry(
                              providerCard.instanceId,
                              providerCard.driver,
                              () => null,
                            );
                          }}
                        />
                      ) : null}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {providerCard.summary.headline}
                    {providerCard.summary.detail ? ` - ${providerCard.summary.detail}` : null}
                  </p>
                  {providerCard.versionAdvisory ? (
                    <p
                      className={cn(
                        "text-xs",
                        providerCard.versionAdvisory.emphasis === "strong"
                          ? "font-medium text-foreground"
                          : "text-amber-700 dark:text-amber-300",
                      )}
                    >
                      {providerCard.versionAdvisory.detail}
                    </p>
                  ) : null}
                  {providerCard.liveProvider?.versionAdvisory?.canUpdate === true &&
                  providerCard.liveProvider.versionAdvisory.updateCommand !== null ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        disabled={isProviderUpdateActive(providerCard.liveProvider)}
                        onClick={() => runProviderUpdate(providerCard.liveProvider!)}
                      >
                        {isProviderUpdateActive(providerCard.liveProvider) ? (
                          <LoaderIcon className="size-3.5 animate-spin" />
                        ) : (
                          <DownloadIcon className="size-3.5" />
                        )}
                        Update
                      </Button>
                      <code className="rounded border border-border/70 bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {providerCard.liveProvider.versionAdvisory.updateCommand}
                      </code>
                    </div>
                  ) : null}
                </div>
                <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setOpenProviderDetails((existing) => ({
                        ...existing,
                        [providerCard.cardKey]: !existing[providerCard.cardKey],
                      }))
                    }
                    aria-label={`Toggle ${providerDisplayName} details`}
                  >
                    <ChevronDownIcon
                      className={cn("size-3.5 transition-transform", isOpen && "rotate-180")}
                    />
                  </Button>
                  <Switch
                    checked={instanceEnabled}
                    onCheckedChange={(checked) => {
                      if (providerCard.supportsLegacySettings && builtInProvider) {
                        const isDisabling = !checked;
                        const shouldClearModelSelection =
                          isDisabling && textGenProvider === builtInProvider;
                        updateSettings({
                          providers: {
                            ...settings.providers,
                            [builtInProvider]: {
                              ...settings.providers[builtInProvider],
                              enabled: Boolean(checked),
                            },
                          },
                          ...(shouldClearModelSelection
                            ? {
                                textGenerationModelSelection:
                                  DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                              }
                            : {}),
                        });
                        return;
                      }

                      updateProviderInstanceEntry(
                        providerCard.instanceId,
                        providerCard.driver,
                        (current) => ({
                          ...(current ?? {
                            driver: ProviderDriverKind.make(providerCard.driver),
                          }),
                          enabled: Boolean(checked),
                        }),
                      );
                    }}
                    aria-label={`Enable ${providerDisplayName}`}
                  />
                </div>
              </div>
            </div>

            <Collapsible
              open={isOpen}
              onOpenChange={(open) =>
                setOpenProviderDetails((existing) => ({
                  ...existing,
                  [providerCard.cardKey]: open,
                }))
              }
            >
              <CollapsibleContent>
                <div className="space-y-0">
                  <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                    <label htmlFor={`provider-instance-${providerCard.instanceId}-name`}>
                      <span className="text-xs font-medium text-foreground">Display name</span>
                      <Input
                        id={`provider-instance-${providerCard.instanceId}-name`}
                        className="mt-1.5"
                        value={providerCard.instanceDisplayNameInput}
                        onChange={(event) =>
                          updateProviderInstanceEntry(
                            providerCard.instanceId,
                            providerCard.driver,
                            (current) => ({
                              ...(current ?? {
                                driver: ProviderDriverKind.make(providerCard.driver),
                              }),
                              displayName: event.target.value,
                            }),
                          )
                        }
                        placeholder={providerCard.providerDisplayName}
                        spellCheck={false}
                      />
                      <span className="mt-1 block text-xs text-muted-foreground">
                        Optional label shown in the UI for this provider instance.
                      </span>
                    </label>
                  </div>

                  <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                    <div className="text-xs font-medium text-foreground">Instance metadata</div>
                    <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                      <div>
                        <span className="block text-[11px] uppercase tracking-[0.08em] text-muted-foreground/65">
                          Driver
                        </span>
                        <code className="mt-1 block text-foreground/85">{providerCard.driver}</code>
                      </div>
                      <div>
                        <span className="block text-[11px] uppercase tracking-[0.08em] text-muted-foreground/65">
                          Instance ID
                        </span>
                        <code className="mt-1 block break-all text-foreground/85">
                          {providerCard.instanceId}
                        </code>
                      </div>
                    </div>
                  </div>

                  {driverDefinition && driverDefinition.settingsFields.length > 0 ? (
                    <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                      <div className="text-xs font-medium text-foreground">Configuration</div>
                      <div className="mt-3 grid gap-3">
                        {driverDefinition.settingsFields.map((field) => (
                          <label
                            key={`${providerCard.instanceId}:${field.key}`}
                            htmlFor={`provider-config-${providerCard.instanceId}-${field.key}`}
                            className="block"
                          >
                            <span className="text-xs font-medium text-foreground">
                              {field.label}
                            </span>
                            <Input
                              id={`provider-config-${providerCard.instanceId}-${field.key}`}
                              className="mt-1.5"
                              type={field.control === "password" ? "password" : "text"}
                              value={readConfigString(instanceConfigValue, field.key)}
                              onChange={(event) =>
                                updateProviderDriverConfigField(
                                  providerCard,
                                  field.key,
                                  event.target.value,
                                )
                              }
                              placeholder={field.placeholder}
                              spellCheck={false}
                            />
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {field.description}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {providerCard.supportsLegacySettings && builtInProvider ? (
                    <>
                      <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                        <div className="text-xs font-medium text-foreground">Models</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {providerCard.models.length} model
                          {providerCard.models.length === 1 ? "" : "s"} available.
                        </div>
                        <div
                          ref={(el) => {
                            modelListRefs.current[builtInProvider] = el;
                          }}
                          className="mt-2 max-h-40 overflow-y-auto pb-1"
                        >
                          {providerCard.models.map((model) => {
                            const caps = model.capabilities;
                            const capLabels: string[] = [];
                            if (caps?.supportsFastMode) capLabels.push("Fast mode");
                            if (caps?.supportsThinkingToggle) capLabels.push("Thinking");
                            if (
                              caps?.reasoningEffortLevels &&
                              caps.reasoningEffortLevels.length > 0
                            ) {
                              capLabels.push("Reasoning");
                            }
                            const hasDetails = capLabels.length > 0 || model.name !== model.slug;

                            return (
                              <div
                                key={`${providerCard.instanceId}:${model.slug}`}
                                className="flex items-center gap-2 py-1"
                              >
                                <span className="min-w-0 truncate text-xs text-foreground/90">
                                  {model.name}
                                </span>
                                {hasDetails ? (
                                  <Tooltip>
                                    <TooltipTrigger
                                      render={
                                        <button
                                          type="button"
                                          className="shrink-0 text-muted-foreground/40 transition-colors hover:text-muted-foreground"
                                          aria-label={`Details for ${model.name}`}
                                        />
                                      }
                                    >
                                      <InfoIcon className="size-3" />
                                    </TooltipTrigger>
                                    <TooltipPopup side="top" className="max-w-56">
                                      <div className="space-y-1">
                                        <code className="block text-[11px] text-foreground">
                                          {model.slug}
                                        </code>
                                        {capLabels.length > 0 ? (
                                          <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                                            {capLabels.map((label) => (
                                              <span
                                                key={label}
                                                className="text-[10px] text-muted-foreground"
                                              >
                                                {label}
                                              </span>
                                            ))}
                                          </div>
                                        ) : null}
                                      </div>
                                    </TooltipPopup>
                                  </Tooltip>
                                ) : null}
                                {model.isCustom ? (
                                  <div className="ml-auto flex shrink-0 items-center gap-1.5">
                                    <span className="text-[10px] text-muted-foreground">
                                      custom
                                    </span>
                                    <button
                                      type="button"
                                      className="text-muted-foreground transition-colors hover:text-foreground"
                                      aria-label={`Remove ${model.slug}`}
                                      onClick={() => removeCustomModel(builtInProvider, model.slug)}
                                    >
                                      <XIcon className="size-3" />
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>

                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                          <Input
                            id={`custom-model-${builtInProvider}`}
                            value={customModelInput}
                            onChange={(event) => {
                              const value = event.target.value;
                              setCustomModelInputByProvider((existing) => ({
                                ...existing,
                                [builtInProvider]: value,
                              }));
                              if (customModelError) {
                                setCustomModelErrorByProvider((existing) => ({
                                  ...existing,
                                  [builtInProvider]: null,
                                }));
                              }
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter") return;
                              event.preventDefault();
                              addCustomModel(builtInProvider);
                            }}
                            placeholder={
                              builtInProvider === "codex"
                                ? "gpt-6.7-codex-ultra-preview"
                                : "claude-sonnet-5-0"
                            }
                            spellCheck={false}
                          />
                          <Button
                            className="shrink-0"
                            variant="outline"
                            onClick={() => addCustomModel(builtInProvider)}
                          >
                            <PlusIcon className="size-3.5" />
                            Add
                          </Button>
                        </div>

                        {customModelError ? (
                          <p className="mt-2 text-xs text-destructive">{customModelError}</p>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                      <div className="text-xs font-medium text-foreground">
                        Additional instance status
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {providerCard.liveProvider?.message ??
                          "This configured provider instance is recorded in settings, but Fenrir does not route it yet."}
                      </p>
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        );
      })}
    </SettingsSection>
  );
}
