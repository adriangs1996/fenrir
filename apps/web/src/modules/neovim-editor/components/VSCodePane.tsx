import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "~/components/ui/spinner";
import { VSCodeMissingCard } from "./VSCodeMissingCard";

interface Props {
  cwd: string | null;
  visible: boolean;
}

type PaneStatus = "idle" | "starting" | "ready" | "error";

export function VSCodePane({ cwd, visible }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number>(0);
  const [status, setStatus] = useState<PaneStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const updateBounds = useCallback(() => {
    const bridge = window.desktopBridge;
    const el = containerRef.current;
    if (!bridge?.vscodeSetBounds || !el) return;

    const rect = el.getBoundingClientRect();
    const bounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };

    if (bounds.width > 0 && bounds.height > 0) {
      void bridge.vscodeSetBounds(bounds);
    }
  }, []);

  useEffect(() => {
    const probe = window.desktopBridge?.vscodeProbeDetail;
    if (!probe) return;
    let cancelled = false;
    void probe()
      .then((detail) => {
        if (!cancelled) {
          setProbeError(detail.available ? null : detail.error);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setProbeError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [retryToken]);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!visible) {
      void bridge?.vscodeHide?.();
      return;
    }

    if (!bridge?.vscodeStart || !bridge.vscodeShow || !bridge.vscodeSetBounds) {
      setStatus("error");
      setError("Embedded VS Code bridge is unavailable.");
      return;
    }

    if (!cwd) {
      setStatus("error");
      setError("No project workspace is available for Embedded VS Code.");
      return;
    }

    let cancelled = false;
    setStatus("starting");
    setError(null);

    void bridge
      .vscodeStart(cwd)
      .then(() => {
        if (cancelled) return;
        setStatus("ready");
        updateBounds();
        void bridge.vscodeShow?.();
      })
      .catch((cause) => {
        if (cancelled) return;
        setStatus("error");
        setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
    };
  }, [cwd, retryToken, updateBounds, visible]);

  useEffect(() => {
    if (!visible) return;
    const el = containerRef.current;
    const bridge = window.desktopBridge;
    if (!el || !bridge?.vscodeSetBounds) return;

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateBounds);
    });

    observer.observe(el);
    updateBounds();
    void bridge.vscodeShow?.();

    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafRef.current);
      void bridge.vscodeHide?.();
    };
  }, [updateBounds, visible]);

  return (
    <div
      ref={containerRef}
      className="relative min-h-0 flex-1 bg-background"
      style={{ display: visible ? "flex" : "none" }}
      data-testid="vscode-pane"
    >
      {status === "starting" ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
          <Spinner className="mr-2 size-4" />
          Starting VS Code
        </div>
      ) : null}
      {status === "error" ? (
        <VSCodeMissingCard
          errorDetail={error ?? probeError}
          onRetry={() => setRetryToken((value) => value + 1)}
        />
      ) : null}
    </div>
  );
}
