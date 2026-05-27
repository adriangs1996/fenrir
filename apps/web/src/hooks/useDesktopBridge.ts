import { useEffect, useState } from "react";

/**
 * Returns true when running inside the Electron shell (desktopBridge present).
 * Safe to call server-side or in plain browser — always returns false there.
 */
export function useDesktopBridgeAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(window.desktopBridge);
}

/**
 * Returns true when the current BrowserWindow is the main (first) window.
 * Only the main window receives nvim frames. Returns false outside Electron.
 */
export function useIsMainWindow(): boolean {
  return useDesktopBridgeAvailable() && window.desktopBridge!.isMainWindow();
}

/**
 * Async probe: resolves to true when nvim binary is found on PATH.
 * Returns false until the probe resolves (or when outside Electron).
 */
export function useNvimAvailable(): boolean {
  const bridgeAvailable = useDesktopBridgeAvailable();
  const [available, setAvailable] = useState<boolean>(false);

  useEffect(() => {
    if (!bridgeAvailable) return;
    let cancelled = false;
    void window.desktopBridge!.nvimAvailable().then((v) => {
      if (!cancelled) setAvailable(v);
    });
    return () => {
      cancelled = true;
    };
  }, [bridgeAvailable]);

  return available;
}

/**
 * Async probe: resolves to true when a supported VS Code web server binary
 * (code-server or openvscode-server) is found on PATH.
 */
export function useVSCodeWebAvailable(): boolean {
  const bridgeAvailable = useDesktopBridgeAvailable();
  const [available, setAvailable] = useState<boolean>(false);

  useEffect(() => {
    if (!bridgeAvailable) return;
    const probe = window.desktopBridge?.vscodeAvailable;
    if (!probe) return;
    let cancelled = false;
    void probe()
      .then((value) => {
        if (!cancelled) setAvailable(value);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bridgeAvailable]);

  return available;
}
