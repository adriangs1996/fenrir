import type { VSCodeShortcutState } from "@fenrir/contracts";
import {
  VSCODE_AVAILABLE_CHANNEL,
  VSCODE_HIDE_CHANNEL,
  VSCODE_OPEN_FILE_CHANNEL,
  VSCODE_PROBE_DETAIL_CHANNEL,
  VSCODE_SET_BOUNDS_CHANNEL,
  VSCODE_SET_SHORTCUT_STATE_CHANNEL,
  VSCODE_SHOW_CHANNEL,
  VSCODE_START_CHANNEL,
} from "@fenrir/contracts";

import { probeVSCodeWeb, type VSCodeWebManager } from "../vscode";
import { registerHandler } from "./registerHandler";
import { requireNonEmptyString, requireObject, ValidationError } from "./validators";

export interface VSCodeHandlersDeps {
  readonly ensureManager: () => VSCodeWebManager;
  /** Nullable accessor used by handlers that intentionally no-op when no manager exists. */
  readonly getManager: () => VSCodeWebManager | null;
  readonly ensureShellEnvironmentSynced: (reason: string) => void;
}

export function registerVSCodeHandlers(deps: VSCodeHandlersDeps): void {
  registerHandler(VSCODE_AVAILABLE_CHANNEL, async () => {
    deps.ensureShellEnvironmentSynced("vscode-probe");
    const result = await probeVSCodeWeb();
    return result.available;
  });

  registerHandler(VSCODE_PROBE_DETAIL_CHANNEL, async () => {
    deps.ensureShellEnvironmentSynced("vscode-probe-detail");
    return probeVSCodeWeb();
  });

  registerHandler(VSCODE_START_CHANNEL, async (_event, cwd: unknown) => {
    const validCwd = requireNonEmptyString("VS Code cwd", cwd);
    deps.ensureShellEnvironmentSynced("vscode-start");
    return deps.ensureManager().ensureStarted(validCwd);
  });

  registerHandler(VSCODE_OPEN_FILE_CHANNEL, async (_event, payload: unknown) => {
    const input = requireObject("VS Code file payload", payload) as {
      path?: unknown;
      line?: unknown;
      col?: unknown;
    };
    const path = requireNonEmptyString("VS Code file path", input.path);
    deps.ensureShellEnvironmentSynced("vscode-open-file");
    return deps.ensureManager().openFile({
      path,
      ...(typeof input.line === "number" ? { line: input.line } : {}),
      ...(typeof input.col === "number" ? { col: input.col } : {}),
    });
  });

  registerHandler(VSCODE_SET_BOUNDS_CHANNEL, async (_event, bounds: unknown) => {
    const b = requireObject("VS Code bounds", bounds);
    if (
      typeof b.x !== "number" ||
      typeof b.y !== "number" ||
      typeof b.width !== "number" ||
      typeof b.height !== "number"
    ) {
      throw new ValidationError("VS Code bounds shape");
    }
    deps.ensureManager().setBounds({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
    });
  });

  registerHandler(VSCODE_SHOW_CHANNEL, async () => {
    deps.ensureManager().show();
  });

  registerHandler(VSCODE_HIDE_CHANNEL, async () => {
    // Silent semantics: hiding without a live manager is a no-op.
    deps.getManager()?.hide();
  });

  registerHandler(VSCODE_SET_SHORTCUT_STATE_CHANNEL, async (_event, state: unknown) => {
    const validState = requireObject("VS Code shortcut state", state);
    deps.ensureManager().setShortcutState(validState as unknown as VSCodeShortcutState);
  });
}
