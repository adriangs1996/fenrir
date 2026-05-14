import type { EnvironmentId, ManagedProcess, ManagedProcessInstance } from "@fenrir/contracts";
import { useEffect, useRef, useState } from "react";

import { readEnvironmentConnection } from "~/environments/runtime";
import { subscribeToInstanceLog } from "~/managedProcessLogClient";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";

interface ManagedProcessLogDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly definition: ManagedProcess | null;
  readonly instance: ManagedProcessInstance | null;
}

function formatStatus(instance: ManagedProcessInstance | null): string {
  if (!instance) return "idle";
  if (instance.status === "running" && instance.ready) return "running (ready)";
  if (instance.status === "running") return "running (not ready)";
  return instance.status;
}

export function ManagedProcessLogDialog({
  open,
  onOpenChange,
  environmentId,
  definition,
  instance,
}: ManagedProcessLogDialogProps) {
  const instanceId = instance?.instanceId ?? null;
  const [logText, setLogText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    if (!open || instanceId === null) return;

    const conn = readEnvironmentConnection(environmentId);
    if (!conn) {
      setLogText("");
      setIsLoading(false);
      setIsTruncated(false);
      setError("Environment connection is unavailable.");
      return;
    }

    let cancelled = false;
    setLogText("");
    setIsLoading(true);
    setIsTruncated(false);
    setError(null);
    stickToBottomRef.current = true;

    const stream = subscribeToInstanceLog({
      instanceId,
      client: conn.client,
      onChunk: ({ bytes }) => {
        if (cancelled) return;
        setLogText((current) => current + bytes);
      },
    });

    void stream.backfillReceived
      .then((backfill) => {
        if (cancelled) return;
        setLogText(backfill.bytes);
        setIsTruncated(backfill.truncated);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
      stream.unsubscribe();
    };
  }, [environmentId, instanceId, open]);

  useEffect(() => {
    if (!open || !stickToBottomRef.current) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [logText, open]);

  return (
    <Dialog open={open && instance !== null} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{definition?.name ?? "Managed process logs"}</DialogTitle>
          <DialogDescription>
            {instance ? `${formatStatus(instance)} • ${definition?.command ?? ""}` : "No instance"}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          {isTruncated && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Showing the retained tail only. Older log output was truncated.
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
          <div
            ref={viewportRef}
            className="h-[min(60vh,42rem)] overflow-auto rounded-xl border border-border/60 bg-black/90 p-3 font-mono text-xs leading-5 text-white"
            onScroll={(event) => {
              const viewport = event.currentTarget;
              const distanceFromBottom =
                viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
              stickToBottomRef.current = distanceFromBottom < 24;
            }}
          >
            {isLoading && logText.length === 0 ? (
              <div className="text-white/50">Loading logs…</div>
            ) : logText.length === 0 ? (
              <div className="text-white/50">No log output captured yet.</div>
            ) : (
              <pre className="whitespace-pre-wrap break-words">{logText}</pre>
            )}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
