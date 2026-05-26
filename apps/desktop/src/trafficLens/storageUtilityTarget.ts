import { WebContentsView } from "electron";

export function createStorageUtilityTarget(partition: string): WebContentsView {
  return new WebContentsView({
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
  });
}
