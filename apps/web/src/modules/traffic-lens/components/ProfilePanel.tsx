import { useMemo, useState } from "react";
import type { TrafficLensProfileId } from "@fenrir/contracts";
import { usePrimaryEnvironmentClient } from "~/environments/runtime";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useTrafficLensStore } from "../stores/useTrafficLensStore";
import { makeProfilePartitionKey, toProfileInput } from "../workbenchModels";
import { cn } from "~/lib/utils";

const DEFAULT_BROWSER_URL = "https://example.com";

export function ProfilePanel() {
  const profilesById = useTrafficLensStore((state) => state.profiles);
  const selectedProfileId = useTrafficLensStore((state) => state.selectedProfileId);
  const profiles = useMemo(
    () =>
      Object.values(profilesById).sort((left, right) =>
        left.id === "default"
          ? -1
          : right.id === "default"
            ? 1
            : left.name.localeCompare(right.name),
      ),
    [profilesById],
  );
  const [newProfileName, setNewProfileName] = useState("");
  const [userAgentPreset, setUserAgentPreset] = useState("");
  const rpcClient = usePrimaryEnvironmentClient();

  const handleCreateProfile = async () => {
    if (!rpcClient || !window.desktopBridge || !newProfileName.trim()) {
      return;
    }
    const runtimeProfile = await window.desktopBridge.trafficLensCreateProfile({
      name: newProfileName.trim(),
      partitionKey: makeProfilePartitionKey(newProfileName),
      userAgentPreset: userAgentPreset.trim() || undefined,
      notes: null,
      proxyPreset: null,
    });
    const persistedProfile = await rpcClient.trafficLens.upsertProfile({
      id: runtimeProfile.id,
      input: toProfileInput(runtimeProfile),
    });
    useTrafficLensStore
      .getState()
      .setProfiles([...Object.values(useTrafficLensStore.getState().profiles), persistedProfile]);
    useTrafficLensStore.getState().setSelectedProfile(persistedProfile.id);
    setNewProfileName("");
    setUserAgentPreset("");
  };

  const handleOpenTab = async (profileId: TrafficLensProfileId) => {
    const snapshot = await window.desktopBridge?.trafficLensCreateTabInProfile({
      profileId,
      url: DEFAULT_BROWSER_URL,
    });
    if (snapshot) {
      useTrafficLensStore.getState().upsertTab(snapshot);
      useTrafficLensStore.getState().setActiveTab(snapshot.tabId);
    }
  };

  const handleDeleteProfile = async (profileId: TrafficLensProfileId) => {
    if (!rpcClient || !window.desktopBridge || profileId === "default") {
      return;
    }
    await Promise.all([
      window.desktopBridge.trafficLensDeleteProfile(profileId),
      rpcClient.trafficLens.deleteProfile({ id: profileId }),
    ]);
    useTrafficLensStore
      .getState()
      .setProfiles(
        Object.values(useTrafficLensStore.getState().profiles).filter(
          (profile) => profile.id !== profileId,
        ),
      );
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)] overflow-hidden">
      <div className="border-r border-border/70 p-3">
        <div className="mb-3 text-xs font-medium text-muted-foreground">Create Profile</div>
        <div className="space-y-2">
          <Input
            nativeInput
            value={newProfileName}
            onChange={(event) => setNewProfileName(event.currentTarget.value)}
            placeholder="Anonymous"
          />
          <Input
            nativeInput
            value={userAgentPreset}
            onChange={(event) => setUserAgentPreset(event.currentTarget.value)}
            placeholder="Optional user agent override"
          />
          <Button className="w-full" size="sm" onClick={() => void handleCreateProfile()}>
            Add Profile
          </Button>
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto p-3">
        <div className="space-y-2">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className={cn(
                "rounded-xl border px-3 py-3",
                selectedProfileId === profile.id ? "border-border bg-muted/30" : "border-border/70",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">{profile.name}</div>
                  <div className="mt-1 break-all text-xs text-muted-foreground">
                    {profile.partitionKey}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="xs"
                    variant={selectedProfileId === profile.id ? "secondary" : "outline"}
                    onClick={() => useTrafficLensStore.getState().setSelectedProfile(profile.id)}
                  >
                    {selectedProfileId === profile.id ? "Selected" : "Select"}
                  </Button>
                  <Button size="xs" onClick={() => void handleOpenTab(profile.id)}>
                    New Tab
                  </Button>
                  {profile.id !== "default" ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => void handleDeleteProfile(profile.id)}
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
