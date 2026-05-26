import { useMemo, useState } from "react";
import type { TrafficLensOverrideId } from "@fenrir/contracts";
import { getPrimaryEnvironmentConnection } from "~/environments/runtime/service";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useTrafficLensStore } from "../stores/useTrafficLensStore";
import { encodeTextToBase64 } from "../httpSerialization";
import { toOverrideInput } from "../workbenchModels";

export function OverridesPanel() {
  const overridesById = useTrafficLensStore((state) => state.overrides);
  const overrides = useMemo(
    () =>
      Object.values(overridesById).sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
    [overridesById],
  );
  const [name, setName] = useState("Mock response");
  const [urlPattern, setUrlPattern] = useState("*api*");
  const [statusCode, setStatusCode] = useState("200");
  const [contentType, setContentType] = useState("application/json");
  const [bodyText, setBodyText] = useState('{"ok":true}');
  const rpcClient = useMemo(() => {
    try {
      return getPrimaryEnvironmentConnection().client;
    } catch {
      return null;
    }
  }, []);

  const handleCreateOverride = async () => {
    if (!rpcClient || !window.desktopBridge) {
      return;
    }
    const runtimeOverride = await window.desktopBridge.trafficLensCreateOverride({
      name,
      enabled: true,
      match: { urlPattern },
      response: {
        statusCode: Number(statusCode) || 200,
        headers: { "content-type": contentType },
        body: encodeTextToBase64(bodyText),
      },
    });
    const persistedOverride = await rpcClient.trafficLens.upsertOverride({
      id: runtimeOverride.id,
      input: toOverrideInput(runtimeOverride),
    });
    useTrafficLensStore
      .getState()
      .setOverrides([
        ...Object.values(useTrafficLensStore.getState().overrides).filter(
          (candidate) => candidate.id !== persistedOverride.id,
        ),
        persistedOverride,
      ]);
  };

  const handleToggleOverride = async (overrideId: TrafficLensOverrideId, enabled: boolean) => {
    if (!rpcClient || !window.desktopBridge) {
      return;
    }
    const existingOverride = useTrafficLensStore.getState().overrides[overrideId];
    if (!existingOverride) {
      return;
    }
    await window.desktopBridge.trafficLensSetOverrideEnabled(overrideId, enabled);
    const persistedOverride = await rpcClient.trafficLens.upsertOverride({
      id: overrideId,
      input: {
        ...toOverrideInput(existingOverride),
        enabled,
      },
    });
    useTrafficLensStore
      .getState()
      .setOverrides(
        Object.values(useTrafficLensStore.getState().overrides).map((override) =>
          override.id === persistedOverride.id ? persistedOverride : override,
        ),
      );
  };

  const handleDeleteOverride = async (overrideId: TrafficLensOverrideId) => {
    if (!rpcClient || !window.desktopBridge) {
      return;
    }
    await Promise.all([
      window.desktopBridge.trafficLensDeleteOverride(overrideId),
      rpcClient.trafficLens.deleteOverride({ id: overrideId }),
    ]);
    useTrafficLensStore
      .getState()
      .setOverrides(
        Object.values(useTrafficLensStore.getState().overrides).filter(
          (override) => override.id !== overrideId,
        ),
      );
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[340px_minmax(0,1fr)] overflow-hidden">
      <div className="border-r border-border/70 p-3">
        <div className="mb-3 text-xs font-medium text-muted-foreground">Create Override</div>
        <div className="space-y-2">
          <Input
            nativeInput
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <Input
            nativeInput
            value={urlPattern}
            onChange={(event) => setUrlPattern(event.currentTarget.value)}
            placeholder="*feature-flags*"
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              nativeInput
              value={statusCode}
              onChange={(event) => setStatusCode(event.currentTarget.value)}
            />
            <Input
              nativeInput
              value={contentType}
              onChange={(event) => setContentType(event.currentTarget.value)}
            />
          </div>
          <textarea
            className="min-h-48 w-full rounded-md border border-input bg-background p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={bodyText}
            onChange={(event) => setBodyText(event.currentTarget.value)}
          />
          <Button className="w-full" size="sm" onClick={() => void handleCreateOverride()}>
            Save Override
          </Button>
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto p-3">
        <div className="space-y-2">
          {overrides.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 p-3 text-sm text-muted-foreground">
              No local overrides configured yet.
            </div>
          ) : (
            overrides.map((override) => (
              <div key={override.id} className="rounded-xl border border-border/70 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">{override.name}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {override.match.urlPattern ?? "*"}
                      {" -> "}
                      {override.response.statusCode}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="xs"
                      variant={override.enabled ? "secondary" : "outline"}
                      onClick={() => void handleToggleOverride(override.id, !override.enabled)}
                    >
                      {override.enabled ? "On" : "Off"}
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => void handleDeleteOverride(override.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
