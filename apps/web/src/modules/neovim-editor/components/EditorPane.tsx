import type { ResolvedKeybindingsConfig } from "@fenrir/contracts";
import { useEffect, useState } from "react";
import { RenderSurface } from "~/components/RenderSurface";
import {
  useDesktopBridgeAvailable,
  useIsMainWindow,
  useNvimAvailable,
  useVSCodeWebAvailable,
} from "~/hooks/useDesktopBridge";
import { useSettings } from "~/hooks/useSettings";
import { resolveActiveEmbeddedEditor } from "../embeddedEditor";
import { NvimMissingCard } from "./NvimMissingCard";
import { VSCodePane } from "./VSCodePane";

interface Props {
  /**
   * When true, pane is visible. When false, pane is hidden via display:none
   * but stays mounted so canvas state, GL renderer and frame stream stay warm.
   */
  visible: boolean;
  focusRequestId?: number;
  keybindings: ResolvedKeybindingsConfig;
  terminalOpen?: boolean;
  cwd: string | null;
}

/**
 * Renderer-side container around `RenderSurface` for the chat tab. Owns
 * availability gating (bridge present, main window, nvim binary) and the
 * mount-and-hide visibility lifecycle.
 *
 * cwd push is handled at the app shell via `useEditorCwdSync` — this pane
 * only renders the surface.
 */
export function EditorPane({
  visible,
  focusRequestId = 0,
  keybindings,
  terminalOpen = false,
  cwd,
}: Props) {
  const bridge = useDesktopBridgeAvailable();
  const main = useIsMainWindow();
  const nvimReady = useNvimAvailable();
  const vscodeReady = useVSCodeWebAvailable();
  const preferredEmbeddedEditor = useSettings((state) => state.embeddedEditor);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!bridge) return;
    const probe = window.desktopBridge?.nvimProbeDetail;
    if (!probe) return;
    let cancelled = false;
    void probe().then((d) => {
      if (cancelled) return;
      setProbeError(d.available ? null : d.error);
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, retryToken]);

  if (!bridge || !main) {
    // Defensive null — the chat tab bar already gates editor visibility on
    // these conditions, so this branch should be unreachable in practice.
    return null;
  }

  if (!nvimReady && !vscodeReady) {
    return (
      <div
        className="min-h-0 flex-1"
        style={{ display: visible ? "flex" : "none" }}
        data-testid="editor-pane-missing"
      >
        <NvimMissingCard errorDetail={probeError} onRetry={() => setRetryToken((n) => n + 1)} />
      </div>
    );
  }

  const selectedEditor = resolveActiveEmbeddedEditor({
    preferredEditor: preferredEmbeddedEditor,
    nvimReady,
    vscodeReady,
  });

  return (
    <div
      className="min-h-0 flex-1 flex-col"
      style={{ display: visible ? "flex" : "none" }}
      data-testid="editor-pane"
    >
      {selectedEditor === "neovim" ? (
        <div className="min-h-0 flex-1">
          <RenderSurface
            fps={120}
            keybindings={keybindings}
            terminalOpen={terminalOpen}
            visible={visible}
            focusRequestId={focusRequestId}
            style={{ width: "100%", height: "100%" }}
          />
        </div>
      ) : (
        <VSCodePane
          cwd={cwd}
          keybindings={keybindings}
          terminalOpen={terminalOpen}
          visible={visible}
        />
      )}
    </div>
  );
}
