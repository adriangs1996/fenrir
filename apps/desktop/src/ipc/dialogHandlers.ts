import { BrowserWindow, dialog, Menu, nativeTheme, shell } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import type { ContextMenuItem } from "@fenrir/contracts";
import {
  CONFIRM_CHANNEL,
  CONTEXT_MENU_CHANNEL,
  OPEN_EXTERNAL_CHANNEL,
  PICK_FILE_CHANNEL,
  PICK_FOLDER_CHANNEL,
  SET_THEME_CHANNEL,
} from "@fenrir/contracts";

import { getSafeExternalUrl, getSafeTheme } from "../electron/SafeInputs";
import { showDesktopConfirmDialog } from "../electron/ElectronDialog";
import { registerHandler } from "./registerHandler";

export interface DialogHandlersDeps {
  readonly getMainWindow: () => BrowserWindow | null;
  readonly getDestructiveMenuIcon: () => Electron.NativeImage | undefined;
}

export function registerDialogHandlers(deps: DialogHandlersDeps): void {
  registerHandler(PICK_FOLDER_CHANNEL, async (_event, rawOptions) => {
    const options = rawOptions as { initialPath?: string } | undefined;
    const owner = BrowserWindow.getFocusedWindow() ?? deps.getMainWindow();
    const result = owner
      ? await dialog.showOpenDialog(owner, {
          properties: ["openDirectory", "createDirectory"],
          ...(options?.initialPath ? { defaultPath: options.initialPath } : {}),
        })
      : await dialog.showOpenDialog({
          properties: ["openDirectory", "createDirectory"],
          ...(options?.initialPath ? { defaultPath: options.initialPath } : {}),
        });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });

  registerHandler(PICK_FILE_CHANNEL, async (_event, options: unknown) => {
    const owner = BrowserWindow.getFocusedWindow() ?? deps.getMainWindow();
    const filters =
      options && typeof options === "object" && "filters" in options
        ? (options as { filters: Electron.FileFilter[] }).filters
        : [];
    const result = owner
      ? await dialog.showOpenDialog(owner, {
          properties: ["openFile"],
          filters,
        })
      : await dialog.showOpenDialog({ properties: ["openFile"], filters });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });

  registerHandler(CONFIRM_CHANNEL, async (_event, message: unknown) => {
    // Silent semantics: non-string messages resolve to `false`.
    if (typeof message !== "string") {
      return false;
    }

    const owner = BrowserWindow.getFocusedWindow() ?? deps.getMainWindow();
    return showDesktopConfirmDialog(message, owner);
  });

  registerHandler(SET_THEME_CHANNEL, async (_event, rawTheme: unknown) => {
    // Silent semantics: invalid themes are ignored.
    const theme = getSafeTheme(rawTheme);
    if (!theme) {
      return;
    }

    nativeTheme.themeSource = theme;
  });

  registerHandler(CONTEXT_MENU_CHANNEL, async (_event, rawItems, rawPosition) => {
    const items = rawItems as ContextMenuItem[];
    const position = rawPosition as { x: number; y: number } | undefined;
    const normalizedItems = items
      .filter((item) => typeof item.id === "string" && typeof item.label === "string")
      .map((item) => ({
        id: item.id,
        label: item.label,
        destructive: item.destructive === true,
        disabled: item.disabled === true,
      }));
    if (normalizedItems.length === 0) {
      return null;
    }

    const popupPosition =
      position &&
      Number.isFinite(position.x) &&
      Number.isFinite(position.y) &&
      position.x >= 0 &&
      position.y >= 0
        ? {
            x: Math.floor(position.x),
            y: Math.floor(position.y),
          }
        : null;

    const window = BrowserWindow.getFocusedWindow() ?? deps.getMainWindow();
    if (!window) return null;

    return new Promise<string | null>((resolve) => {
      const template: MenuItemConstructorOptions[] = [];
      let hasInsertedDestructiveSeparator = false;
      for (const item of normalizedItems) {
        if (item.destructive && !hasInsertedDestructiveSeparator && template.length > 0) {
          template.push({ type: "separator" });
          hasInsertedDestructiveSeparator = true;
        }
        const itemOption: MenuItemConstructorOptions = {
          label: item.label,
          enabled: !item.disabled,
          click: () => resolve(item.id),
        };
        if (item.destructive) {
          const destructiveIcon = deps.getDestructiveMenuIcon();
          if (destructiveIcon) {
            itemOption.icon = destructiveIcon;
          }
        }
        template.push(itemOption);
      }

      const menu = Menu.buildFromTemplate(template);
      menu.popup({
        window,
        ...popupPosition,
        callback: () => resolve(null),
      });
    });
  });

  registerHandler(OPEN_EXTERNAL_CHANNEL, async (_event, rawUrl: unknown) => {
    // Silent semantics: invalid / non-http(s) URLs resolve to `false`.
    const externalUrl = getSafeExternalUrl(rawUrl);
    if (!externalUrl) {
      return false;
    }

    try {
      await shell.openExternal(externalUrl);
      return true;
    } catch {
      return false;
    }
  });
}
