import * as NodeHttp from "node:http";

import { describe, expect, it, vi } from "vitest";

import { type DiscoveredLocalServer, ThreadId, TrimmedNonEmptyString } from "@fenrir/contracts";

import {
  filterRelevantLocalServers,
  isKnownNoiseLocalServerProcessName,
  isLikelyDevServerProcessName,
  makeCachedLocalServerHttpProbe,
  parseLsofOutput,
  parsePortFromLsofName,
  parseWindowsListenerOutput,
  probeLocalHttpServer,
  shouldProbeLocalServerCandidate,
} from "./LocalServerDiscovery";

function makeServer(overrides: Partial<DiscoveredLocalServer> = {}): DiscoveredLocalServer {
  const port = (overrides.port ?? 3000) as DiscoveredLocalServer["port"];
  return {
    host: "localhost",
    port,
    url: `http://localhost:${port}`,
    processName: "node",
    pid: 1234 as NonNullable<DiscoveredLocalServer["pid"]>,
    source: "lsof",
    terminal: null,
    ...overrides,
  };
}

describe("LocalServerDiscovery parser", () => {
  it("extracts local listeners from lsof field output", () => {
    const terminalOwner = {
      threadId: ThreadId.make("thread-1"),
      terminalId: TrimmedNonEmptyString.make("default"),
    };
    const servers = parseLsofOutput(
      [
        "p1234",
        "cnode",
        "n*:5173",
        "n192.168.1.10:5173",
        "p2000",
        "cvite",
        "n[::1]:3000 (LISTEN)",
        "n10.0.0.1:9000",
      ].join("\n"),
      new Map([[2000, terminalOwner]]),
    );

    expect(servers).toEqual([
      {
        host: "localhost",
        port: 3000,
        url: "http://localhost:3000",
        processName: "vite",
        pid: 2000,
        source: "lsof",
        terminal: terminalOwner,
      },
      {
        host: "localhost",
        port: 5173,
        url: "http://localhost:5173",
        processName: "node",
        pid: 1234,
        source: "lsof",
        terminal: null,
      },
    ]);
  });

  it("ignores invalid or non-local lsof names", () => {
    expect(parsePortFromLsofName("192.168.1.10:5173")).toBeNull();
    expect(parsePortFromLsofName("localhost:not-a-port")).toBeNull();
    expect(parsePortFromLsofName("localhost:70000")).toBeNull();
    expect(parsePortFromLsofName("127.0.0.1:8080")).toBe(8080);
  });

  it("extracts local listeners from PowerShell output", () => {
    const servers = parseWindowsListenerOutput(
      ["127.0.0.1|3000|100|node", "0.0.0.0|8080|200|vite", "10.0.0.2|9000|300|ignored"].join(
        "\r\n",
      ),
    );

    expect(servers).toEqual([
      {
        host: "localhost",
        port: 3000,
        url: "http://localhost:3000",
        processName: "node",
        pid: 100,
        source: "powershell",
        terminal: null,
      },
      {
        host: "localhost",
        port: 8080,
        url: "http://localhost:8080",
        processName: "vite",
        pid: 200,
        source: "powershell",
        terminal: null,
      },
    ]);
  });

  it("classifies noisy desktop app processes and likely dev server processes", () => {
    expect(isKnownNoiseLocalServerProcessName("Slack Helper")).toBe(true);
    expect(isKnownNoiseLocalServerProcessName("Spotify.exe")).toBe(true);
    expect(isKnownNoiseLocalServerProcessName("opencode")).toBe(true);
    expect(isKnownNoiseLocalServerProcessName("node")).toBe(false);

    expect(isLikelyDevServerProcessName("node")).toBe(true);
    expect(isLikelyDevServerProcessName("python3.12")).toBe(true);
    expect(isLikelyDevServerProcessName("vite")).toBe(true);
    expect(isLikelyDevServerProcessName("Slack")).toBe(false);
  });

  it("drops known desktop app listeners before probing", async () => {
    const probe = vi.fn(async () => true);
    const servers = [
      makeServer({ processName: "Slack Helper", port: 3000 as DiscoveredLocalServer["port"] }),
      makeServer({ processName: "Spotify", port: 8080 as DiscoveredLocalServer["port"] }),
      makeServer({ processName: "opencode", port: 5173 as DiscoveredLocalServer["port"] }),
    ];

    await expect(filterRelevantLocalServers(servers, probe)).resolves.toEqual([]);
    expect(probe).not.toHaveBeenCalled();
  });

  it("keeps terminal-owned listeners without requiring an HTTP probe", async () => {
    const terminalOwner = {
      threadId: ThreadId.make("thread-1"),
      terminalId: TrimmedNonEmptyString.make("default"),
    };
    const server = makeServer({
      terminal: terminalOwner,
      port: 49_200 as DiscoveredLocalServer["port"],
    });
    const probe = vi.fn(async () => false);

    await expect(filterRelevantLocalServers([server], probe)).resolves.toEqual([server]);
    expect(probe).not.toHaveBeenCalled();
  });

  it("requires an HTTP response for common dev ports", async () => {
    const server = makeServer({
      processName: null,
      port: 5173 as DiscoveredLocalServer["port"],
      url: "http://localhost:5173",
    });

    expect(shouldProbeLocalServerCandidate(server)).toBe(true);
    await expect(filterRelevantLocalServers([server], async () => false)).resolves.toEqual([]);
    await expect(filterRelevantLocalServers([server], async () => true)).resolves.toEqual([server]);
  });

  it("probes custom-port dev processes and ignores unrelated custom-port apps", async () => {
    const devServer = makeServer({
      processName: "node",
      port: 49_200 as DiscoveredLocalServer["port"],
      url: "http://localhost:49200",
    });
    const unrelatedServer = makeServer({
      processName: "Calendar",
      port: 49_201 as DiscoveredLocalServer["port"],
      url: "http://localhost:49201",
    });
    const probe = vi.fn(async (server: DiscoveredLocalServer) => server.port === devServer.port);

    await expect(filterRelevantLocalServers([devServer, unrelatedServer], probe)).resolves.toEqual([
      devServer,
    ]);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith(devServer);
    expect(shouldProbeLocalServerCandidate(unrelatedServer)).toBe(false);
  });

  it("caches HTTP probe results by listener identity", async () => {
    let now = 1_000;
    const server = makeServer();
    const rawProbe = vi.fn(async () => true);
    const cachedProbe = makeCachedLocalServerHttpProbe(rawProbe, () => now, 500);

    await expect(cachedProbe(server)).resolves.toBe(true);
    await expect(cachedProbe(server)).resolves.toBe(true);
    expect(rawProbe).toHaveBeenCalledTimes(1);

    now = 1_600;
    await expect(cachedProbe(server)).resolves.toBe(true);
    expect(rawProbe).toHaveBeenCalledTimes(2);
  });

  it("detects an HTTP listener with the local HTTP probe", async () => {
    const httpServer = NodeHttp.createServer((_request, response) => {
      response.writeHead(204);
      response.end();
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = httpServer.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected an ephemeral TCP address");
      }

      const server = makeServer({
        host: "127.0.0.1",
        port: address.port as DiscoveredLocalServer["port"],
        url: `http://127.0.0.1:${address.port}`,
      });

      await expect(probeLocalHttpServer(server)).resolves.toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});
