import * as FS from "node:fs";
import * as Path from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = Path.resolve(__dirname);

describe("desktop architecture", () => {
  it("keeps the Electron entrypoint as a thin app bootstrap", () => {
    const mainSource = FS.readFileSync(Path.join(sourceRoot, "main.ts"), "utf8").trim();

    expect(mainSource).toBe('import "./app/DesktopApp";');
  });

  it("keeps upstream-aligned desktop architecture modules in place", () => {
    const expectedModules = [
      "app/DesktopApp.ts",
      "app/DesktopRuntimeArch.ts",
      "backend/DesktopBackendConfiguration.ts",
      "backend/DesktopServerExposure.ts",
      "electron/ElectronDialog.ts",
      "settings/DesktopAppSettings.ts",
      "settings/DesktopClientSettings.ts",
      "shell/DesktopShellEnvironment.ts",
      "updates/DesktopUpdates.ts",
      "updates/updateMachine.ts",
      "window/DesktopWindow.ts",
    ];

    for (const relativePath of expectedModules) {
      expect(FS.existsSync(Path.join(sourceRoot, relativePath)), relativePath).toBe(true);
    }
  });
});
