import { useNavigate } from "@tanstack/react-router";
import { CircleCheckIcon, DownloadIcon, LoaderIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ServerProvider } from "@fenrir/contracts";

import { useServerProviders } from "../../rpc/serverState";
import {
  getProviderUpdateSidebarPillView,
  type ProviderUpdateSidebarPillView,
} from "../ProviderUpdateLaunchNotification.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const PROVIDER_UPDATE_PILL_STYLES = {
  loading: "bg-primary/15 text-primary hover:bg-primary/22",
  success: "bg-success/12 text-success hover:bg-success/18",
  warning: "bg-warning/12 text-warning hover:bg-warning/18",
  error: "bg-destructive/12 text-destructive hover:bg-destructive/18",
} as const;

function latestProviderCheckedAt(
  providers: ReadonlyArray<Pick<ServerProvider, "checkedAt">>,
): string | undefined {
  return providers.reduce<string | undefined>(
    (latest, provider) =>
      latest === undefined || provider.checkedAt > latest ? provider.checkedAt : latest,
    undefined,
  );
}

function ProviderUpdatePillIcon({ tone }: { tone: ProviderUpdateSidebarPillView["tone"] }) {
  if (tone === "loading") {
    return <LoaderIcon className="size-3.5 animate-spin" />;
  }
  if (tone === "success") {
    return <CircleCheckIcon className="size-3.5" />;
  }
  if (tone === "error") {
    return <TriangleAlertIcon className="size-3.5" />;
  }
  return <DownloadIcon className="size-3.5" />;
}

export function SidebarProviderUpdatePill() {
  const navigate = useNavigate();
  const providers = useServerProviders();
  const [dismissedKeys, setDismissedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [visibleAfterIso, setVisibleAfterIso] = useState<string | undefined>();
  const effectiveVisibleAfterIso = visibleAfterIso ?? latestProviderCheckedAt(providers);
  const view = getProviderUpdateSidebarPillView(providers, {
    ...(effectiveVisibleAfterIso !== undefined
      ? { visibleAfterIso: effectiveVisibleAfterIso }
      : {}),
    dismissedKeys,
  });

  useEffect(() => {
    if (visibleAfterIso === undefined && effectiveVisibleAfterIso !== undefined) {
      setVisibleAfterIso(effectiveVisibleAfterIso);
    }
  }, [effectiveVisibleAfterIso, visibleAfterIso]);

  useEffect(() => {
    if (!view?.dismissAfterVisibleMs) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setDismissedKeys((previous) => new Set(previous).add(view.key));
    }, view.dismissAfterVisibleMs);
    return () => window.clearTimeout(timeoutId);
  }, [view]);

  const openProviderSettings = useCallback(() => {
    void navigate({ to: "/settings/general" });
  }, [navigate]);

  if (!view) {
    return null;
  }

  return (
    <div
      className={`mb-2 flex h-7 w-full items-center overflow-hidden rounded-lg text-xs font-medium transition-colors ${PROVIDER_UPDATE_PILL_STYLES[view.tone]}`}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={view.description}
              className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left"
              onClick={openProviderSettings}
            >
              <ProviderUpdatePillIcon tone={view.tone} />
              <span className="min-w-0 truncate">{view.title}</span>
            </button>
          }
        />
        <TooltipPopup side="top">{view.description}</TooltipPopup>
      </Tooltip>
      {view.dismissible ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Dismiss provider update notice"
                className="flex h-full w-7 shrink-0 items-center justify-center opacity-70 transition-opacity hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  setDismissedKeys((previous) => new Set(previous).add(view.key));
                }}
              >
                <XIcon className="size-3.5" />
              </button>
            }
          />
          <TooltipPopup side="top">Dismiss</TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  );
}
