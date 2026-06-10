import type { BrowserWindow } from "electron";
import {
  EDITOR_CMD_CHANNEL,
  EDITOR_EVENT_CHANNEL,
  EDITOR_INVOKE_BRIDGE_CHANNEL,
  EDITOR_OPEN_FILE_CHANNEL,
  EDITOR_SEND_TO_COMPOSER_CHANNEL,
} from "@fenrir/contracts";

import type { NeovimSource } from "../neovim";
import { registerHandler } from "./registerHandler";
import { requireString, ValidationError } from "./validators";

export interface EditorHandlersDeps {
  readonly getMainWindow: () => BrowserWindow | null;
  readonly neovimSource: NeovimSource;
}

export function registerEditorHandlers(deps: EditorHandlersDeps): void {
  registerHandler(EDITOR_OPEN_FILE_CHANNEL, async (_event, payload: unknown) => {
    const input = payload as { path?: string; line?: number; col?: number };
    if (!input?.path) throw new ValidationError("editor open-file path");
    await deps.neovimSource.openFile(input.path, input.line, input.col);
  });

  // Forward NeovimSource fenrir events to renderer, tagged by __source.
  deps.neovimSource.onFenrirEvent((ev) => {
    if (ev.__source === "fenrir_autocmd") {
      deps.getMainWindow()?.webContents.send(EDITOR_EVENT_CHANNEL, ev.payload);
    } else if (ev.__source === "fenrir_send_to_composer") {
      deps.getMainWindow()?.webContents.send(EDITOR_SEND_TO_COMPOSER_CHANNEL, ev.payload);
    } else if (ev.__source === "fenrir_cmd") {
      deps.getMainWindow()?.webContents.send(EDITOR_CMD_CHANNEL, ev.payload);
    }
  });

  registerHandler(EDITOR_INVOKE_BRIDGE_CHANNEL, async (_event, fn: unknown) => {
    const validFn = requireString("editor bridge function", fn);
    await deps.neovimSource.invokeBridge(validFn);
  });
}
