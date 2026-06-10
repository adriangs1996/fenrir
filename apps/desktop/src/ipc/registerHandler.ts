import { ipcMain } from "electron";

/**
 * Register an `ipcMain.handle` handler, removing any previously registered
 * handler for the channel first so re-registration is always safe.
 */
export function registerHandler(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown,
): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, handler);
}

/**
 * Register an `ipcMain.on` listener (fire-and-forget / sendSync channels),
 * removing any previously registered listeners for the channel first.
 */
export function registerListener(
  channel: string,
  listener: (event: Electron.IpcMainEvent, ...args: unknown[]) => void,
): void {
  ipcMain.removeAllListeners(channel);
  ipcMain.on(channel, listener);
}
