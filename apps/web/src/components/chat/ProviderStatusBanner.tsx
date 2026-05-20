import { PROVIDER_DISPLAY_NAMES, type ServerProvider } from "@fenrir/contracts";
import { memo } from "react";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { CircleAlertIcon } from "lucide-react";

export const ProviderStatusBanner = memo(function ProviderStatusBanner({
  status,
}: {
  status: ServerProvider | null;
}) {
  if (!status || status.status === "disabled") {
    return null;
  }

  const providerLabel =
    status.displayName?.trim() ||
    (status.provider ? PROVIDER_DISPLAY_NAMES[status.provider] : undefined) ||
    status.driver ||
    status.provider ||
    "Provider";
  const advisory = status.versionAdvisory;
  if (status.status === "ready" && advisory?.status !== "behind_latest") {
    return null;
  }

  const defaultMessage =
    advisory?.status === "behind_latest"
      ? (advisory.message ?? `${providerLabel} has an update available.`)
      : status.availability === "unavailable"
        ? (status.unavailableReason ??
          status.message ??
          `${providerLabel} is not available in this Fenrir build.`)
        : status.status === "error"
          ? `${providerLabel} provider is unavailable.`
          : `${providerLabel} provider has limited availability.`;
  const title =
    advisory?.status === "behind_latest"
      ? `${providerLabel} update available`
      : `${providerLabel} provider status`;
  const variant =
    advisory?.status === "behind_latest"
      ? "warning"
      : status.status === "error"
        ? "error"
        : "warning";

  return (
    <div className="pt-3 mx-auto max-w-3xl">
      <Alert variant={variant}>
        <CircleAlertIcon />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription className="line-clamp-3" title={status.message ?? defaultMessage}>
          {advisory?.status === "behind_latest"
            ? defaultMessage
            : (status.message ?? defaultMessage)}
        </AlertDescription>
      </Alert>
    </div>
  );
});
