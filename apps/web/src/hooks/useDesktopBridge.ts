import { useEffect, useState } from "react";
import type { DesktopHostAdapter } from "@fenrir/contracts";

/**
 * Returns the host-shell adapter exposed by the current desktop runtime.
 *
 * Today this wraps Electron's `window.desktopBridge`; future native desktop
 * shells should provide an equivalent adapter so web modules do not need to
 * encode Electron assumptions.
 */
export function getDesktopHostAdapter(): DesktopHostAdapter | null {
  if (typeof window === "undefined" || !window.desktopBridge) return null;
  return { kind: "electron", bridge: window.desktopBridge };
}

/**
 * Returns true when a desktop host adapter is present. Safe to call server-side
 * or in plain browser — always returns false there.
 */
export function useDesktopBridgeAvailable(): boolean {
  return getDesktopHostAdapter() !== null;
}

/**
 * Returns true when the current desktop host surface is the primary editor
 * surface. Electron reports this as the main BrowserWindow; other hosts should
 * preserve the same adapter semantics.
 */
export function useIsMainWindow(): boolean {
  return getDesktopHostAdapter()?.bridge.isMainWindow() ?? false;
}

/**
 * Async probe: resolves to true when nvim binary is found on PATH.
 * Returns false until the probe resolves (or when outside Electron).
 */
export function useNvimAvailable(): boolean {
  const bridgeAvailable = useDesktopBridgeAvailable();
  const [available, setAvailable] = useState<boolean>(false);

  useEffect(() => {
    const adapter = getDesktopHostAdapter();
    if (!bridgeAvailable || !adapter) return;
    let cancelled = false;
    void adapter.bridge.nvimAvailable().then((v) => {
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
    const probe = getDesktopHostAdapter()?.bridge.vscodeAvailable;
    if (!bridgeAvailable || !probe) return;
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
