import type { DesktopBridge } from "@fenrir/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { __resetServerAuthBootstrapForTests } from "../environments/primary";
import { fetchSystemFonts } from "./useFonts";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
    },
    status: 200,
    ...init,
  });
}

function createTestSessionStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function installDesktopBrowser() {
  const sessionStorage = createTestSessionStorage();
  vi.stubGlobal("window", {
    location: new URL("t3://app/"),
    sessionStorage,
    desktopBridge: {
      getLocalEnvironmentBootstrap: () => ({
        label: "Local environment",
        httpBaseUrl: "http://127.0.0.1:3773",
        wsBaseUrl: "ws://127.0.0.1:3773",
      }),
    } as DesktopBridge,
  });

  return { sessionStorage };
}

describe("fetchSystemFonts", () => {
  afterEach(() => {
    __resetServerAuthBootstrapForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses the packaged desktop bearer session when loading fonts", async () => {
    const { sessionStorage } = installDesktopBrowser();
    sessionStorage.setItem("fenrir.primaryDesktopBearerSessionToken", "desktop-bearer-token");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([{ family: "JetBrains Mono", category: "monospace" }]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSystemFonts(true)).resolves.toEqual([
      { family: "JetBrains Mono", category: "monospace" },
    ]);

    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:3773/api/fonts?refresh=1", {
      credentials: "omit",
      headers: {
        authorization: "Bearer desktop-bearer-token",
      },
    });
  });
});
