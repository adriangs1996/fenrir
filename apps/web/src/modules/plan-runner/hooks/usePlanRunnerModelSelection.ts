import { useCallback, useEffect, useMemo, useState } from "react";
import type { ModelSelection, ProviderKind, ServerProvider } from "@fenrir/contracts";
import { useSettings } from "~/hooks/useSettings";
import { resolveAppModelSelectionState } from "~/modelSelection";
import { getProviderModels } from "~/providerModels";
import { useServerProviders } from "~/rpc/serverState";

type ModelOptionsByProvider = Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>>;

interface PlanRunnerModelSelectionState {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly selectedProvider: ProviderKind;
  readonly selectedModel: string;
  readonly modelSelection: ModelSelection;
  readonly modelOptionsByProvider: ModelOptionsByProvider;
  readonly handleProviderModelChange: (provider: ProviderKind, model: string) => void;
}

export function usePlanRunnerModelSelection(): PlanRunnerModelSelectionState {
  const settings = useSettings();
  const providers = useServerProviders();

  const defaultProvider = useMemo(() => {
    try {
      return resolveAppModelSelectionState(settings, providers).provider;
    } catch {
      return "codex" as ProviderKind;
    }
  }, [settings, providers]);

  const defaultModel = useMemo(() => {
    try {
      return resolveAppModelSelectionState(settings, providers).model;
    } catch {
      return "";
    }
  }, [settings, providers]);

  const [selectedProvider, setSelectedProvider] = useState<ProviderKind>(defaultProvider);
  const [selectedModel, setSelectedModel] = useState<string>(defaultModel);
  const [hasUserSelected, setHasUserSelected] = useState(false);

  useEffect(() => {
    if (!hasUserSelected && defaultProvider && defaultModel) {
      setSelectedProvider(defaultProvider);
      setSelectedModel(defaultModel);
    }
  }, [hasUserSelected, defaultProvider, defaultModel]);

  const modelOptionsByProvider = useMemo<ModelOptionsByProvider>(
    () => ({
      codex: getProviderModels(providers, "codex"),
      claudeAgent: getProviderModels(providers, "claudeAgent"),
    }),
    [providers],
  );

  const handleProviderModelChange = useCallback((provider: ProviderKind, model: string) => {
    setHasUserSelected(true);
    setSelectedProvider(provider);
    setSelectedModel(model);
  }, []);

  const modelSelection = useMemo<ModelSelection>(
    () => ({
      provider: selectedProvider,
      model: selectedModel,
    }),
    [selectedProvider, selectedModel],
  );

  return {
    providers,
    selectedProvider,
    selectedModel,
    modelSelection,
    modelOptionsByProvider,
    handleProviderModelChange,
  };
}
