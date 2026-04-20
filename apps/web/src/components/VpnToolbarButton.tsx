import { memo, useCallback, useState } from "react";
import {
  CheckIcon,
  ClipboardCopyIcon,
  Loader2Icon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldIcon,
  ShieldOffIcon,
} from "lucide-react";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useVpnState } from "~/hooks/useVpnState";
import { Button } from "./ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { cn } from "~/lib/utils";

export const VpnToolbarButton = memo(function VpnToolbarButton() {
  const { state, profiles, isDesktop, connect, disconnect } = useVpnState();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard({ timeout: 1500 });

  const handleConnect = useCallback(async () => {
    const profileId = selectedProfileId ?? profiles[0]?.id;
    if (!profileId) return;
    setActionPending(true);
    try {
      await connect(profileId);
    } catch {
      // error state is pushed via onVpnStateChange
    } finally {
      setActionPending(false);
    }
  }, [selectedProfileId, profiles, connect]);

  const handleDisconnect = useCallback(async () => {
    setActionPending(true);
    try {
      await disconnect();
    } catch {
      // error state is pushed via onVpnStateChange
    } finally {
      setActionPending(false);
    }
  }, [disconnect]);

  // Only render in desktop mode
  if (!isDesktop || !state) return null;

  const isConnected = state.status === "connected";
  const isConnecting = state.status === "connecting";
  const isDisconnecting = state.status === "disconnecting";
  const isError = state.status === "error";
  const isBusy = isConnecting || isDisconnecting || actionPending;

  const activeProfile = state.activeProfileId
    ? profiles.find((p) => p.id === state.activeProfileId)
    : null;

  const tooltipText = isConnected
    ? `VPN: ${state.assignedIp ?? "connected"} via ${activeProfile?.label ?? "unknown"} — click IP to copy`
    : isConnecting
      ? "VPN: Connecting..."
      : isDisconnecting
        ? "VPN: Disconnecting..."
        : isError
          ? `VPN Error: ${state.errorMessage ?? "unknown error"}`
          : "VPN: Disconnected";

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                    "border-input bg-popover shadow-xs/5",
                    "hover:bg-accent/50 dark:hover:bg-input/64",
                    isConnected && "border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
                    isError && "border-red-500/30 text-red-600 dark:text-red-400",
                    !isConnected && !isError && "text-muted-foreground",
                  )}
                >
                  <StatusIcon status={state.status} isBusy={isBusy} />
                  {isConnected && state.assignedIp && (
                    <span
                      className="hidden cursor-copy sm:inline"
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(state.assignedIp!, undefined as void);
                      }}
                    >
                      {isCopied ? "Copied!" : state.assignedIp}
                    </span>
                  )}
                </button>
              }
            />
          }
        />
        <TooltipPopup side="bottom">{tooltipText}</TooltipPopup>
      </Tooltip>

      <PopoverPopup side="bottom" align="end" className="w-64">
        <div className="flex flex-col gap-3">
          <div className="text-sm font-semibold">VPN Profiles</div>

          {profiles.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No profiles configured. Add one in Settings.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {profiles.map((profile) => {
                const isActive = state.activeProfileId === profile.id;
                const isSelected =
                  selectedProfileId === profile.id ||
                  (!selectedProfileId && profiles[0]?.id === profile.id);
                return (
                  <label
                    key={profile.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
                      "hover:bg-accent/50",
                      isActive && "bg-emerald-500/10",
                    )}
                  >
                    <input
                      type="radio"
                      name="vpn-profile"
                      checked={isSelected}
                      onChange={() => setSelectedProfileId(profile.id)}
                      disabled={isBusy}
                      className="accent-emerald-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{profile.label}</div>
                      <div className="truncate text-muted-foreground">{profile.configPath}</div>
                    </div>
                    {isActive && isConnected && (
                      <span className="shrink-0 text-[10px] text-emerald-600 dark:text-emerald-400">
                        Active
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}

          {/* Status message */}
          {isError && state.errorMessage && (
            <div className="rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-600 dark:text-red-400">
              {state.errorMessage}
            </div>
          )}

          {isConnected && state.assignedIp && (
            <button
              type="button"
              onClick={() => copyToClipboard(state.assignedIp!, undefined as void)}
              className="flex w-full cursor-pointer items-center justify-between rounded-md bg-emerald-500/10 px-2 py-1.5 text-xs text-emerald-600 transition-colors hover:bg-emerald-500/20 dark:text-emerald-400"
            >
              <span>
                {state.assignedIp}
                {activeProfile ? ` via ${activeProfile.label}` : ""}
              </span>
              {isCopied ? (
                <CheckIcon className="size-3 shrink-0" />
              ) : (
                <ClipboardCopyIcon className="size-3 shrink-0 opacity-50" />
              )}
            </button>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            {isConnected || isDisconnecting ? (
              <Button
                size="xs"
                variant="destructive-outline"
                disabled={isBusy}
                onClick={handleDisconnect}
                className="flex-1"
              >
                {isDisconnecting ? (
                  <>
                    <Loader2Icon className="size-3 animate-spin" />
                    Disconnecting...
                  </>
                ) : (
                  "Disconnect"
                )}
              </Button>
            ) : (
              <Button
                size="xs"
                variant="default"
                disabled={isBusy || profiles.length === 0}
                onClick={handleConnect}
                className="flex-1"
              >
                {isConnecting ? (
                  <>
                    <Loader2Icon className="size-3 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  "Connect"
                )}
              </Button>
            )}
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
});

function StatusIcon({ status, isBusy }: { status: string; isBusy: boolean }) {
  if (isBusy) {
    return <Loader2Icon className="size-3.5 animate-spin" />;
  }
  switch (status) {
    case "connected":
      return <ShieldCheckIcon className="size-3.5" />;
    case "error":
      return <ShieldAlertIcon className="size-3.5" />;
    case "disconnected":
      return <ShieldOffIcon className="size-3.5" />;
    default:
      return <ShieldIcon className="size-3.5" />;
  }
}
