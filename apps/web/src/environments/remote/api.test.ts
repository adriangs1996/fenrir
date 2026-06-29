import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  bootstrapRemoteBearerSession,
  fetchRemoteEnvironmentDescriptor,
  fetchRemoteSessionState,
  issueRemoteWebSocketToken,
  isRemoteAuthBlockedStatus,
  isRemoteEnvironmentAuthHttpError,
  resolveRemoteWebSocketConnectionUrl,
} from "./api";
import { resolveRemotePairingTarget } from "./target";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        origin: "https://app.example.com",
      },
    },
  });
  vi.restoreAllMocks();
});

describe("remote environment api", () => {
  it("derives backend urls and token from a pairing url", () => {
    expect(
      resolveRemotePairingTarget({
        pairingUrl: "https://remote.example.com/pair#token=pairing-token",
      }),
    ).toEqual({
      credential: "pairing-token",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
    });
  });

  it("accepts pairing urls that still use a query token", () => {
    expect(
      resolveRemotePairingTarget({
        pairingUrl: "https://remote.example.com/pair?token=pairing-token",
      }),
    ).toEqual({
      credential: "pairing-token",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
    });
  });

  it("accepts websocket pairing url protocols", () => {
    expect(
      resolveRemotePairingTarget({
        pairingUrl: "ws://remote.example.com/pair#token=pairing-token",
      }),
    ).toEqual({
      credential: "pairing-token",
      httpBaseUrl: "http://remote.example.com/",
      wsBaseUrl: "ws://remote.example.com/",
    });

    expect(
      resolveRemotePairingTarget({
        pairingUrl: "wss://remote.example.com/pair#token=pairing-token",
      }),
    ).toEqual({
      credential: "pairing-token",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
    });
  });

  it("derives backend urls from a host and pairing code", () => {
    expect(
      resolveRemotePairingTarget({
        host: "https://remote.example.com",
        pairingCode: "pairing-token",
      }),
    ).toEqual({
      credential: "pairing-token",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
    });
  });

  it("preserves host ports when normalizing a bare host input", () => {
    expect(
      resolveRemotePairingTarget({
        host: "myserver.com:3000",
        pairingCode: "pairing-token",
      }),
    ).toEqual({
      credential: "pairing-token",
      httpBaseUrl: "https://myserver.com:3000/",
      wsBaseUrl: "wss://myserver.com:3000/",
    });
  });

  it("rejects unsupported pairing url protocols", () => {
    expect(() =>
      resolveRemotePairingTarget({
        pairingUrl: "ftp://remote.example.com/pair#token=pairing-token",
      }),
    ).toThrow("Remote backend URL uses unsupported protocol ftp:");
  });

  it("rejects unsupported host protocols", () => {
    expect(() =>
      resolveRemotePairingTarget({
        host: "ftp://remote.example.com",
        pairingCode: "pairing-token",
      }),
    ).toThrow("Remote backend URL uses unsupported protocol ftp:");
  });

  it("bootstraps bearer auth against a remote backend", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          authenticated: true,
          role: "client",
          sessionMethod: "bearer-session-token",
          expiresAt: "2026-05-01T12:00:00.000Z",
          sessionToken: "bearer-token",
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      bootstrapRemoteBearerSession({
        httpBaseUrl: "https://remote.example.com/",
        credential: "pairing-token",
      }),
    ).resolves.toMatchObject({
      sessionMethod: "bearer-session-token",
      sessionToken: "bearer-token",
    });

    expect(fetchMock).toHaveBeenCalledWith("https://remote.example.com/api/auth/bootstrap/bearer", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        credential: "pairing-token",
      }),
    });
  });

  it("loads remote session state and websocket tokens over bearer auth", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            environmentId: "environment-remote",
            label: "Remote environment",
            platform: {
              os: "linux",
              arch: "x64",
            },
            serverVersion: "0.0.0-test",
            capabilities: {
              repositoryIdentity: true,
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authenticated: true,
            auth: {
              policy: "remote-reachable",
              bootstrapMethods: ["one-time-token"],
              sessionMethods: ["browser-session-cookie", "bearer-session-token"],
              sessionCookieName: "t3_session",
            },
            role: "client",
            sessionMethod: "bearer-session-token",
            expiresAt: "2026-05-01T12:00:00.000Z",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            token: "ws-token",
            expiresAt: "2026-05-01T12:05:00.000Z",
          }),
          { status: 200 },
        ),
      );
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      fetchRemoteEnvironmentDescriptor({
        httpBaseUrl: "https://remote.example.com/",
      }),
    ).resolves.toMatchObject({
      environmentId: "environment-remote",
      label: "Remote environment",
    });

    await expect(
      fetchRemoteSessionState({
        httpBaseUrl: "https://remote.example.com/",
        bearerToken: "bearer-token",
      }),
    ).resolves.toMatchObject({
      authenticated: true,
      role: "client",
    });

    await expect(
      issueRemoteWebSocketToken({
        httpBaseUrl: "https://remote.example.com/",
        bearerToken: "bearer-token",
      }),
    ).resolves.toMatchObject({
      token: "ws-token",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://remote.example.com/.well-known/t3/environment",
      {
        method: "GET",
        headers: {},
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://remote.example.com/api/auth/session", {
      method: "GET",
      headers: {
        authorization: "Bearer bearer-token",
      },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, "https://remote.example.com/api/auth/ws-token", {
      method: "POST",
      headers: {
        authorization: "Bearer bearer-token",
      },
    });
  });

  it("mints a websocket url with a short-lived ws token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          token: "ws-token",
          expiresAt: "2026-05-01T12:05:00.000Z",
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      resolveRemoteWebSocketConnectionUrl({
        wsBaseUrl: "wss://remote.example.com/",
        httpBaseUrl: "https://remote.example.com/",
        bearerToken: "bearer-token",
      }),
    ).resolves.toBe("wss://remote.example.com/?wsToken=ws-token");
  });

  it("classifies 401 and 403 remote auth failures as auth-blocking", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "pairing required" }), {
        status: 401,
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    let caught: unknown;
    try {
      await fetchRemoteSessionState({
        httpBaseUrl: "https://remote.example.com/",
        bearerToken: "expired-token",
      });
    } catch (error) {
      caught = error;
    }

    expect(isRemoteEnvironmentAuthHttpError(caught)).toBe(true);
    expect(isRemoteEnvironmentAuthHttpError(caught) ? caught.status : null).toBe(401);
    expect(isRemoteAuthBlockedStatus(401)).toBe(true);
    expect(isRemoteAuthBlockedStatus(403)).toBe(true);
    expect(isRemoteAuthBlockedStatus(503)).toBe(false);
  });

  it("keeps transient remote auth fetch failures retryable", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    globalThis.fetch = fetchMock as typeof fetch;

    let caught: unknown;
    try {
      await issueRemoteWebSocketToken({
        httpBaseUrl: "https://remote.example.com/",
        bearerToken: "bearer-token",
      });
    } catch (error) {
      caught = error;
    }

    expect(isRemoteEnvironmentAuthHttpError(caught)).toBe(false);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("Failed to fetch remote auth endpoint");
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});
