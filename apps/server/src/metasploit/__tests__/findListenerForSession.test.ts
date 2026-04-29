import { describe, expect, it } from "vitest";
import { __findListenerForSessionForTests as findListenerForSession } from "../Layers/MetasploitService";
import type { ListenerSnapshot } from "@fenrir/contracts";

/** Build a minimal ListenerState entry for the listeners map. */
function L(
  overrides: Partial<ListenerSnapshot> & { listenerId: string },
): [string, { snapshot: ListenerSnapshot; jobId: string | null }] {
  const snapshot = {
    listenerId: overrides.listenerId,
    name: overrides.name ?? "test",
    payload: overrides.payload ?? "linux/x86/meterpreter/reverse_tcp",
    lhost: overrides.lhost ?? "0.0.0.0",
    lport: overrides.lport ?? 4444,
    status: overrides.status ?? "active",
    jobId: overrides.jobId ?? "1",
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  } as ListenerSnapshot;
  return [overrides.listenerId, { snapshot, jobId: overrides.jobId ?? "1" }];
}

describe("findListenerForSession", () => {
  it("matches payload + port with wildcard listener LHOST", () => {
    const listeners = new Map([L({ listenerId: "L1", lhost: "0.0.0.0", lport: 4444 })]);
    const result = findListenerForSession(
      { via_exploit: "linux/x86/meterpreter/reverse_tcp", tunnel_local: "10.0.0.1:4444" },
      listeners,
    );
    expect(result).toBe("L1");
  });

  it("returns null when payload doesn't match", () => {
    const listeners = new Map([L({ listenerId: "L1" })]);
    const result = findListenerForSession(
      { via_exploit: "windows/meterpreter/reverse_tcp", tunnel_local: "10.0.0.1:4444" },
      listeners,
    );
    expect(result).toBeNull();
  });

  it("returns null when port doesn't match", () => {
    const listeners = new Map([L({ listenerId: "L1", lport: 4444 })]);
    const result = findListenerForSession(
      { via_exploit: "linux/x86/meterpreter/reverse_tcp", tunnel_local: "10.0.0.1:5555" },
      listeners,
    );
    expect(result).toBeNull();
  });

  it("returns null when via_exploit is missing", () => {
    const listeners = new Map([L({ listenerId: "L1" })]);
    const result = findListenerForSession({}, listeners);
    expect(result).toBeNull();
  });

  it("returns null when via_exploit is empty string", () => {
    const listeners = new Map([L({ listenerId: "L1" })]);
    const result = findListenerForSession({ via_exploit: "" }, listeners);
    expect(result).toBeNull();
  });

  it("disambiguates multiple candidates by exact host match", () => {
    const listeners = new Map([
      L({ listenerId: "wildcard", lhost: "0.0.0.0", lport: 4444 }),
      L({ listenerId: "exact", lhost: "10.0.0.1", lport: 4444 }),
    ]);
    const result = findListenerForSession(
      { via_exploit: "linux/x86/meterpreter/reverse_tcp", tunnel_local: "10.0.0.1:4444" },
      listeners,
    );
    expect(result).toBe("exact");
  });

  it("falls back to wildcard when no exact host match exists", () => {
    const listeners = new Map([L({ listenerId: "wildcard", lhost: "::", lport: 4444 })]);
    const result = findListenerForSession(
      { via_exploit: "linux/x86/meterpreter/reverse_tcp", tunnel_local: "[::1]:4444" },
      listeners,
    );
    expect(result).toBe("wildcard");
  });

  it("permissive on unparseable tunnel_local (skips port match)", () => {
    const listeners = new Map([L({ listenerId: "L1", lport: 4444 })]);
    const result = findListenerForSession(
      { via_exploit: "linux/x86/meterpreter/reverse_tcp", tunnel_local: "garbage" },
      listeners,
    );
    // "garbage" has no colon → lastColon = -1 → sessionPort = NaN → havePort = false → port check skipped.
    expect(result).toBe("L1");
  });
});
