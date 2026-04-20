import { memo, useCallback, useState } from "react";
import { ShieldCheckIcon, ShieldOffIcon, PlusIcon, TrashIcon, FolderOpenIcon } from "lucide-react";
import { useVpnState } from "~/hooks/useVpnState";
import { Button } from "../ui/button";
import { SettingsPageContainer, SettingsSection, SettingsRow } from "./settingsLayout";

export const VpnSettings = memo(function VpnSettings() {
  const {
    state,
    profiles,
    isDesktop,
    connect,
    disconnect,
    addProfile,
    removeProfile,
    pickOvpnFile,
  } = useVpnState();

  const [isAddingProfile, setIsAddingProfile] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newConfigPath, setNewConfigPath] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handlePickFile = useCallback(async () => {
    const path = await pickOvpnFile();
    if (path) {
      setNewConfigPath(path);
      // Auto-fill label from filename if empty
      if (!newLabel) {
        const filename = path.split("/").pop()?.replace(".ovpn", "") ?? "";
        setNewLabel(filename);
      }
    }
  }, [pickOvpnFile, newLabel]);

  const handleAddProfile = useCallback(async () => {
    if (!newLabel.trim() || !newConfigPath.trim()) return;
    setError(null);
    try {
      await addProfile(newLabel.trim(), newConfigPath.trim());
      setNewLabel("");
      setNewConfigPath("");
      setIsAddingProfile(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add profile.");
    }
  }, [newLabel, newConfigPath, addProfile]);

  const handleRemoveProfile = useCallback(
    async (profileId: string) => {
      setError(null);
      try {
        await removeProfile(profileId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to remove profile.");
      }
    },
    [removeProfile],
  );

  if (!isDesktop) {
    return (
      <SettingsPageContainer>
        <SettingsSection title="VPN">
          <SettingsRow
            title="VPN"
            description="VPN management is only available in the desktop app."
          />
        </SettingsSection>
      </SettingsPageContainer>
    );
  }

  const isConnected = state?.status === "connected";
  const isBusy = state?.status === "connecting" || state?.status === "disconnecting";

  return (
    <SettingsPageContainer>
      {/* Connection status */}
      <SettingsSection
        title="Connection Status"
        icon={
          isConnected ? (
            <ShieldCheckIcon className="size-3.5 text-emerald-500" />
          ) : (
            <ShieldOffIcon className="size-3.5 text-muted-foreground/60" />
          )
        }
      >
        <SettingsRow
          title="Status"
          description={
            isConnected
              ? `Connected to ${state?.assignedIp ?? "VPN"}`
              : state?.status === "connecting"
                ? "Connecting..."
                : state?.status === "error"
                  ? (state.errorMessage ?? "Connection error")
                  : "Not connected"
          }
          status={
            isConnected && state?.connectedAt
              ? `Connected since ${new Date(state.connectedAt).toLocaleTimeString()}`
              : undefined
          }
          control={
            isConnected ? (
              <Button
                size="xs"
                variant="destructive-outline"
                disabled={isBusy}
                onClick={() => void disconnect()}
              >
                Disconnect
              </Button>
            ) : undefined
          }
        />
      </SettingsSection>

      {/* Profiles */}
      <SettingsSection
        title="VPN Profiles"
        headerAction={
          !isAddingProfile ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setIsAddingProfile(true)}
              className="gap-1 text-xs"
            >
              <PlusIcon className="size-3" />
              Add Profile
            </Button>
          ) : undefined
        }
      >
        {/* Add profile form */}
        {isAddingProfile && (
          <div className="border-b border-border/60 px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-3">
              <div className="text-[13px] font-semibold">New Profile</div>
              <div className="flex flex-col gap-2">
                <input
                  type="text"
                  placeholder="Profile name (e.g. HackTheBox)"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  className="rounded-md border border-input bg-transparent px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="/path/to/config.ovpn"
                    value={newConfigPath}
                    onChange={(e) => setNewConfigPath(e.target.value)}
                    className="min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
                  />
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => void handlePickFile()}
                    className="shrink-0 gap-1"
                  >
                    <FolderOpenIcon className="size-3" />
                    Browse
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="xs"
                  variant="default"
                  disabled={!newLabel.trim() || !newConfigPath.trim()}
                  onClick={() => void handleAddProfile()}
                >
                  Add
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setIsAddingProfile(false);
                    setNewLabel("");
                    setNewConfigPath("");
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Profile list */}
        {profiles.length === 0 && !isAddingProfile ? (
          <SettingsRow
            title="No profiles"
            description="Add an OpenVPN profile (.ovpn) to get started."
          />
        ) : (
          profiles.map((profile) => {
            const isActive = state?.activeProfileId === profile.id && isConnected;
            return (
              <SettingsRow
                key={profile.id}
                title={
                  <span className="flex items-center gap-2">
                    {profile.label}
                    {isActive && (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        Connected
                      </span>
                    )}
                  </span>
                }
                description={profile.configPath}
                control={
                  <div className="flex items-center gap-2">
                    {!isActive && (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => void connect(profile.id)}
                      >
                        Connect
                      </Button>
                    )}
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={isActive || isBusy}
                      onClick={() => void handleRemoveProfile(profile.id)}
                      className="text-muted-foreground hover:text-red-500"
                    >
                      <TrashIcon className="size-3" />
                    </Button>
                  </div>
                }
              />
            );
          })
        )}
      </SettingsSection>

      {/* Error display */}
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-xs text-red-600 dark:text-red-400">
          {error}
        </div>
      )}
    </SettingsPageContainer>
  );
});
