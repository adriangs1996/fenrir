import { describe, expect, it } from "vitest";

import { ThreadId, TrimmedNonEmptyString } from "@fenrir/contracts";

import {
  parseLsofOutput,
  parsePortFromLsofName,
  parseWindowsListenerOutput,
} from "./LocalServerDiscovery";

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
});
