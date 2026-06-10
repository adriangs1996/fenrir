import type { EnvironmentApi, EnvironmentId } from "@fenrir/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { addToastMock, readEnvironmentApiMock, readLocalApiMock } = vi.hoisted(() => ({
  addToastMock: vi.fn(),
  readEnvironmentApiMock: vi.fn(),
  readLocalApiMock: vi.fn(),
}));

vi.mock("../components/ui/toast", () => ({
  toastManager: { add: addToastMock },
}));

vi.mock("../environmentApi", () => ({
  readEnvironmentApi: readEnvironmentApiMock,
}));

vi.mock("../localApi", () => ({
  readLocalApi: readLocalApiMock,
}));

import { environmentRpcQueryFn, rpcErrorMessage, runEnvironmentRpc, runLocalRpc } from "./useRpc";

const environmentId = "environment-1" as EnvironmentId;
const fakeApi = { marker: true } as unknown as EnvironmentApi;

beforeEach(() => {
  addToastMock.mockReset();
  readEnvironmentApiMock.mockReset();
  readLocalApiMock.mockReset();
});

describe("rpcErrorMessage", () => {
  it("uses the error message when available", () => {
    expect(rpcErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("falls back for non-Error values", () => {
    expect(rpcErrorMessage("boom")).toBe("An error occurred.");
    expect(rpcErrorMessage("boom", "Custom fallback.")).toBe("Custom fallback.");
  });
});

describe("runEnvironmentRpc", () => {
  it("runs the call and returns its result when the api is available", async () => {
    readEnvironmentApiMock.mockReturnValue(fakeApi);
    const result = await runEnvironmentRpc(environmentId, async (api) => {
      expect(api).toBe(fakeApi);
      return "result";
    });
    expect(result).toBe("result");
    expect(addToastMock).not.toHaveBeenCalled();
  });

  it("resolves undefined silently when the environment id is unset", async () => {
    const run = vi.fn();
    expect(await runEnvironmentRpc(null, run)).toBeUndefined();
    expect(run).not.toHaveBeenCalled();
    expect(addToastMock).not.toHaveBeenCalled();
  });

  it("shows the unavailable toast when the api is missing and a toast is configured", async () => {
    readEnvironmentApiMock.mockReturnValue(undefined);
    const result = await runEnvironmentRpc(environmentId, async () => "result", {
      unavailableToast: { title: "Unavailable", description: "Not connected." },
    });
    expect(result).toBeUndefined();
    expect(addToastMock).toHaveBeenCalledWith({
      type: "error",
      title: "Unavailable",
      description: "Not connected.",
    });
  });

  it("shows the error toast and resolves undefined when the call fails", async () => {
    readEnvironmentApiMock.mockReturnValue(fakeApi);
    const result = await runEnvironmentRpc(
      environmentId,
      async () => {
        throw new Error("boom");
      },
      { errorToast: { title: "Failed" } },
    );
    expect(result).toBeUndefined();
    expect(addToastMock).toHaveBeenCalledWith({
      type: "error",
      title: "Failed",
      description: "boom",
    });
  });

  it("uses the fallback description for non-Error failures", async () => {
    readEnvironmentApiMock.mockReturnValue(fakeApi);
    await runEnvironmentRpc(
      environmentId,
      async () => {
        throw "boom";
      },
      { errorToast: { title: "Failed", fallbackDescription: "Something broke." } },
    );
    expect(addToastMock).toHaveBeenCalledWith({
      type: "error",
      title: "Failed",
      description: "Something broke.",
    });
  });

  it("rethrows after toasting when rethrow is set", async () => {
    readEnvironmentApiMock.mockReturnValue(fakeApi);
    const failure = new Error("boom");
    await expect(
      runEnvironmentRpc(
        environmentId,
        async () => {
          throw failure;
        },
        { errorToast: { title: "Failed" }, rethrow: true },
      ),
    ).rejects.toBe(failure);
    expect(addToastMock).toHaveBeenCalledTimes(1);
  });

  it("propagates errors unchanged when no error toast is configured", async () => {
    readEnvironmentApiMock.mockReturnValue(fakeApi);
    const failure = new Error("boom");
    await expect(
      runEnvironmentRpc(environmentId, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(addToastMock).not.toHaveBeenCalled();
  });

  it("runs the call synchronously up to its first await", async () => {
    readEnvironmentApiMock.mockReturnValue(fakeApi);
    let started = false;
    const pending = runEnvironmentRpc(environmentId, async () => {
      started = true;
      return "result";
    });
    expect(started).toBe(true);
    await pending;
  });
});

describe("runLocalRpc", () => {
  it("runs the call when the local api is available", async () => {
    const localApi = { marker: "local" };
    readLocalApiMock.mockReturnValue(localApi);
    const result = await runLocalRpc(async (api) => api);
    expect(result).toBe(localApi);
  });

  it("treats a throwing readLocalApi as unavailable", async () => {
    readLocalApiMock.mockImplementation(() => {
      throw new Error("no primary connection");
    });
    const run = vi.fn();
    expect(await runLocalRpc(run)).toBeUndefined();
    expect(run).not.toHaveBeenCalled();
    expect(addToastMock).not.toHaveBeenCalled();
  });
});

describe("environmentRpcQueryFn", () => {
  it("returns the query result when the api is available", async () => {
    readEnvironmentApiMock.mockReturnValue(fakeApi);
    const queryFn = environmentRpcQueryFn(environmentId, async () => "data");
    expect(await queryFn()).toBe("data");
  });

  it("throws when the environment is not connected", async () => {
    readEnvironmentApiMock.mockReturnValue(undefined);
    const queryFn = environmentRpcQueryFn(environmentId, async () => "data");
    await expect(async () => queryFn()).rejects.toThrowError("Environment is not connected.");
  });
});
