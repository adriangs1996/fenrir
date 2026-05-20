import { memo } from "react";
import { isBuiltInProviderKind, type ProviderKind, type ServerProvider } from "@fenrir/contracts";
import { ProviderModelPicker } from "~/components/chat/ProviderModelPicker";

interface PlanRunnerModelSelectionPanelProps {
  provider: ProviderKind;
  model: string;
  providers: ReadonlyArray<ServerProvider>;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>>;
  onProviderModelChange: (provider: ProviderKind, model: string) => void;
}

export const PlanRunnerModelSelectionPanel = memo(function PlanRunnerModelSelectionPanel({
  provider,
  model,
  providers,
  modelOptionsByProvider,
  onProviderModelChange,
}: PlanRunnerModelSelectionPanelProps) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Model
      </h3>
      <ProviderModelPicker
        provider={provider}
        model={model}
        lockedProvider={null}
        providers={providers}
        modelOptionsByProvider={modelOptionsByProvider}
        triggerVariant="outline"
        onProviderModelChange={(nextProvider, nextModel) => {
          if (!isBuiltInProviderKind(nextProvider)) {
            return;
          }
          onProviderModelChange(nextProvider, nextModel);
        }}
      />
    </div>
  );
});
