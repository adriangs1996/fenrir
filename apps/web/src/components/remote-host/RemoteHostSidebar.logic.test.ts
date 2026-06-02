import { describe, expect, it } from "vitest";

import { parseRemoteHostArgsText, remoteHostSidebarHeaderClassName } from "./RemoteHostSidebar";

describe("parseRemoteHostArgsText", () => {
  it("preserves one argument per line for command-template transports", () => {
    expect(parseRemoteHostArgsText("edge-01\nsh\n-lc\n{command}\n")).toEqual([
      "edge-01",
      "sh",
      "-lc",
      "{command}",
    ]);
  });

  it("drops blank whitespace-only argument lines", () => {
    expect(parseRemoteHostArgsText("\n  -lc  \n\n  {command}\n")).toEqual(["-lc", "{command}"]);
  });
});

describe("remoteHostSidebarHeaderClassName", () => {
  it("reserves the macOS traffic-light titlebar space in Electron", () => {
    const className = remoteHostSidebarHeaderClassName({ isElectron: true });

    expect(className).toContain("drag-region");
    expect(className).toContain("h-[52px]");
    expect(className).toContain("pl-[90px]");
    expect(className).toContain("wco:h-[env(titlebar-area-height)]");
  });

  it("keeps the compact web header outside Electron", () => {
    const className = remoteHostSidebarHeaderClassName({ isElectron: false });

    expect(className).toContain("px-3");
    expect(className).not.toContain("pl-[90px]");
  });
});
