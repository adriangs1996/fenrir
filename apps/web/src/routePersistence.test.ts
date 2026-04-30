import { afterEach, describe, expect, it, vi } from "vitest";

function createLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
}

function createTestWindow(
  initialUrl: string,
  options: { electron?: boolean } = {},
): Window & typeof globalThis {
  const url = new URL(initialUrl);
  const localStorage = createLocalStorageStub();
  const history = {
    replaceState: vi.fn(
      (_data: unknown, _unused: string, nextUrl: string | URL | null | undefined) => {
        if (typeof nextUrl === "string" || nextUrl instanceof URL) {
          const next = new URL(String(nextUrl), url.href);
          url.href = next.href;
        }
      },
    ),
  };

  const location = {
    get href() {
      return url.href;
    },
    get pathname() {
      return url.pathname;
    },
    get search() {
      return url.search;
    },
    get hash() {
      return url.hash;
    },
  } as Location;

  const testWindow = {
    localStorage,
    history,
    location,
    ...(options.electron ? { desktopBridge: {} } : {}),
  } as unknown as Window & typeof globalThis;

  vi.stubGlobal("window", testWindow);
  vi.stubGlobal("localStorage", localStorage);
  return testWindow;
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("routePersistence", () => {
  it("persists the current browser route", async () => {
    createTestWindow("https://app.example.com/settings/general?tab=editor");
    const { PERSISTED_ROUTE_KEY, persistCurrentRoute } = await import("./routePersistence");

    persistCurrentRoute();

    expect(window.localStorage.getItem(PERSISTED_ROUTE_KEY)).toBe(
      JSON.stringify({ path: "/settings/general?tab=editor" }),
    );
  });

  it("does not persist excluded routes", async () => {
    createTestWindow("https://app.example.com/pair");
    const { PERSISTED_ROUTE_KEY, persistCurrentRoute } = await import("./routePersistence");

    persistCurrentRoute();

    expect(window.localStorage.getItem(PERSISTED_ROUTE_KEY)).toBeNull();
  });

  it("restores the saved browser route only when opening at root", async () => {
    const testWindow = createTestWindow("https://app.example.com/");
    const { PERSISTED_ROUTE_KEY, restorePersistedRouteOnLoad } = await import("./routePersistence");
    testWindow.localStorage.setItem(
      PERSISTED_ROUTE_KEY,
      JSON.stringify({ path: "/plan-runner/feature-a/run?view=summary" }),
    );

    expect(restorePersistedRouteOnLoad()).toBe(true);
    expect(testWindow.history.replaceState).toHaveBeenCalled();
    expect(testWindow.location.href).toBe(
      "https://app.example.com/plan-runner/feature-a/run?view=summary",
    );
  });

  it("does not restore when the browser is already on a non-root route", async () => {
    const testWindow = createTestWindow("https://app.example.com/settings/general");
    const { PERSISTED_ROUTE_KEY, restorePersistedRouteOnLoad } = await import("./routePersistence");
    testWindow.localStorage.setItem(
      PERSISTED_ROUTE_KEY,
      JSON.stringify({ path: "/plan-runner/feature-a/run" }),
    );

    expect(restorePersistedRouteOnLoad()).toBe(false);
    expect(testWindow.history.replaceState).not.toHaveBeenCalled();
  });

  it("persists the current electron hash route", async () => {
    createTestWindow("file:///app/index.html#/settings/general?tab=editor", { electron: true });
    const { PERSISTED_ROUTE_KEY, persistCurrentRoute } = await import("./routePersistence");

    persistCurrentRoute();

    expect(window.localStorage.getItem(PERSISTED_ROUTE_KEY)).toBe(
      JSON.stringify({ path: "/settings/general?tab=editor" }),
    );
  });

  it("restores the saved electron hash route when opening at root", async () => {
    const testWindow = createTestWindow("file:///app/index.html#/", { electron: true });
    const { PERSISTED_ROUTE_KEY, restorePersistedRouteOnLoad } = await import("./routePersistence");
    testWindow.localStorage.setItem(
      PERSISTED_ROUTE_KEY,
      JSON.stringify({ path: "/plan-runner/run-1" }),
    );

    expect(restorePersistedRouteOnLoad()).toBe(true);
    expect(testWindow.location.href).toBe("file:///app/index.html#/plan-runner/run-1");
  });
});
