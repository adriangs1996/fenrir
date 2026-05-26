import { cn } from "~/lib/utils";
import { useTrafficLensStore } from "../stores/useTrafficLensStore";

const SEVERITY_STYLES: Record<string, string> = {
  info: "text-sky-400",
  low: "text-yellow-400",
  medium: "text-orange-400",
  high: "text-red-400",
};

export function FindingsPanel() {
  const findings = useTrafficLensStore((state) => state.findings);

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="space-y-2">
        {findings.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 p-3 text-sm text-muted-foreground">
            No passive findings have been emitted yet.
          </div>
        ) : (
          findings.map((finding) => (
            <button
              key={finding.id}
              type="button"
              className="block w-full rounded-xl border border-border/70 px-3 py-3 text-left transition-colors hover:bg-muted/40"
              onClick={() =>
                useTrafficLensStore.getState().setSelectedTraffic(finding.trafficId ?? null)
              }
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">{finding.title}</div>
                <div
                  className={cn("text-xs font-medium uppercase", SEVERITY_STYLES[finding.severity])}
                >
                  {finding.severity}
                </div>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">{finding.description}</div>
              <div className="mt-2 truncate font-mono text-[11px] text-muted-foreground">
                {finding.kind}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
