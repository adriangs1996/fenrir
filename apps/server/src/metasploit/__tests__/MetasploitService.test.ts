/**
 * MetasploitService — service-level behavior tests.
 *
 * Uses a scriptable FakeMsfrpcClient injected via __testSeams and a fake
 * PtyAdapter so no real msfrpcd process is spawned.
 */
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PtyAdapter, type PtyProcess } from "../../terminal/Services/PTY";
import { MetasploitService } from "../Services/MetasploitService";
import { MetasploitServiceLive, __testSeams, type MsfrpcClient } from "../Layers/MetasploitService";
import { createFakeMsfrpcClient, type FakeMsfrpcClient } from "./fakeClient";
import type { CreateListenerInput, MetasploitEvent } from "@fenrir/contracts";

// ─── Fake PtyAdapter ─────────────────────────────────────────────────────────

function makeFakePtyProcess(): PtyProcess {
  return {
    pid: 12345,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn((_cb: (data: string) => void) => () => {}),
    onExit: vi.fn((_cb: (event: { exitCode: number; signal: number | null }) => void) => () => {}),
  } as unknown as PtyProcess;
}

const ptyLayer = Layer.succeed(
  PtyAdapter,
  PtyAdapter.of({ spawn: () => Effect.succeed(makeFakePtyProcess()) }),
);

// ─── Seam save/restore ───────────────────────────────────────────────────────

const ORIGINAL_SEAMS = { ...__testSeams };

// ─── Helpers ─────────────────────────────────────────────────────────────────

const LISTENER_INPUT = {
  name: "t",
  payload: "linux/x86/meterpreter/reverse_tcp",
  lhost: "0.0.0.0",
  lport: 4444,
} as CreateListenerInput;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("MetasploitService — bug coverage", () => {
  let fake: FakeMsfrpcClient;

  beforeEach(() => {
    fake = createFakeMsfrpcClient();
    __testSeams.createClient = () => fake as unknown as MsfrpcClient;
    __testSeams.startupDelay = "10 millis";
    __testSeams.upgradeDelay = "10 millis";
    __testSeams.sessionPollInterval = "100 millis";
    __testSeams.jobPollInterval = "100 millis";
  });

  afterEach(() => {
    Object.assign(__testSeams, ORIGINAL_SEAMS);
    vi.restoreAllMocks();
  });

  /** Build a fresh Layer per test so state is isolated. */
  function makeLayer() {
    return MetasploitServiceLive.pipe(Layer.provide(ptyLayer));
  }

  // ── Bug #5: status() auto-starts ensureStarted ──────────────────────────

  it("Bug #5: status() auto-starts ensureStarted (best-effort)", async () => {
    fake.whenCalled("session.list", () => ({}));
    fake.whenCalled("job.list", () => ({}));
    fake.whenCalled("core.version", () => ({ version: "6.4.10" }));

    const program = Effect.gen(function* () {
      const svc = yield* MetasploitService;
      const result = yield* svc.status();
      yield* svc.stop();
      return result;
    });

    const snapshot = await Effect.runPromise(program.pipe(Effect.provide(makeLayer())));
    expect(snapshot.connected).toBe(true);
    expect(snapshot.version).toBe("6.4.10");
    expect(fake.authenticate).toHaveBeenCalled();
  });

  // ── Bug #7: connection.changed emitted on transition only, with version ─

  it("Bug #7: connection.changed emitted on transition only, with version", async () => {
    fake.whenCalled("session.list", () => ({}));
    fake.whenCalled("job.list", () => ({}));
    fake.whenCalled("core.version", () => ({ version: "6.4.10" }));

    const events: MetasploitEvent[] = [];

    const program = Effect.gen(function* () {
      const svc = yield* MetasploitService;
      // status() triggers ensureStarted — emits connection.changed(true) internally.
      yield* svc.status();

      // subscribe() does NOT re-emit connection.changed via emitConnectionChanged
      // because lastEmittedConnected is already true. It does deliver a one-shot seed.
      const unsubscribe = yield* svc.subscribe((e) => events.push(e));

      // Calling status() again — no new connection.changed event.
      yield* svc.status();
      yield* svc.status();

      unsubscribe();
      yield* svc.stop();
    });

    await Effect.runPromise(program.pipe(Effect.provide(makeLayer())));

    const connEvents = events.filter((e) => e.type === "connection.changed");
    // Only the seed event from subscribe.
    expect(connEvents).toHaveLength(1);
    expect(connEvents[0]!.type === "connection.changed" && connEvents[0]!.connected).toBe(true);
    expect(connEvents[0]!.type === "connection.changed" ? connEvents[0]!.version : undefined).toBe(
      "6.4.10",
    );
  });

  // ── Bug #6: listener flips waiting → active when job appears ────────────

  it("Bug #6: listener flips waiting → active when job appears", async () => {
    fake.whenCalled("core.version", () => ({ version: "6.4.10" }));
    fake.whenCalled("session.list", () => ({}));
    fake.whenCalled("module.execute", () => ({ job_id: 42 }));
    fake.whenCalled("job.list", () => ({ "42": "Exploit: multi/handler" }));

    const events: MetasploitEvent[] = [];

    const program = Effect.gen(function* () {
      const svc = yield* MetasploitService;
      yield* svc.subscribe((e) => events.push(e));

      yield* svc.createListener(LISTENER_INPUT);

      // Wait for job poll ticks to flip waiting → active.
      yield* Effect.sleep("500 millis");
      yield* svc.stop();
    });

    await Effect.runPromise(program.pipe(Effect.provide(makeLayer())));

    const updated = events.find(
      (e) => e.type === "listener.updated" && e.snapshot.status === "active",
    );
    expect(updated).toBeDefined();
  });

  // ── Bug #2 + #4: sessionUpgrade uses listener LHOST/LPORT ──────────────

  it("Bug #2 + #4: sessionUpgrade uses listener LHOST/LPORT and emits session.closed for old id", async () => {
    fake.whenCalled("core.version", () => ({ version: "6.4.10" }));
    fake.whenCalled("module.execute", () => ({ job_id: 42 }));
    fake.whenCalled("job.list", () => ({ "42": "Exploit: multi/handler" }));

    // Phase-based session.list: empty → shell visible → post-upgrade meterpreter.
    let phase: "empty" | "shell" | "meterpreter" = "empty";

    fake.whenCalled("session.list", () => {
      switch (phase) {
        case "empty":
          return {};
        case "shell":
          return {
            "1": {
              type: "shell",
              via_exploit: "linux/x86/meterpreter/reverse_tcp",
              tunnel_local: "10.0.0.1:4444",
              session_host: "10.0.0.99",
              platform: "linux",
              info: "uid=0(root)",
            },
          };
        case "meterpreter":
          return {
            "2": {
              type: "meterpreter",
              via_exploit: "linux/x86/meterpreter/reverse_tcp",
              tunnel_local: "10.0.0.1:4444",
              session_host: "10.0.0.99",
              platform: "linux",
              info: "Meterpreter root @ target",
            },
          };
      }
    });

    fake.whenCalled("session.shell_upgrade", () => {
      phase = "meterpreter";
      return { result: "success" };
    });

    const events: MetasploitEvent[] = [];

    const program = Effect.gen(function* () {
      const svc = yield* MetasploitService;
      yield* svc.subscribe((e) => events.push(e));
      yield* svc.createListener(LISTENER_INPUT);

      // Wait for job poll → listener active.
      yield* Effect.sleep("300 millis");

      // Make shell session visible, wait for session poll discovery.
      phase = "shell";
      yield* Effect.sleep("300 millis");

      // Now upgrade.
      yield* svc.sessionUpgrade("1");
      yield* svc.stop();
    });

    await Effect.runPromise(program.pipe(Effect.provide(makeLayer())));

    // Verify session.shell_upgrade was called with listener's lhost/lport (NOT 127.0.0.1/0).
    const upgradeCall = fake.call.mock.calls.find((c) => c[0] === "session.shell_upgrade");
    expect(upgradeCall).toBeDefined();
    expect(upgradeCall![1]).toEqual(["1", "0.0.0.0", "4444"]);

    // Verify event ordering: session.closed for "1" appears before session.upgraded.
    const closeIdx = events.findIndex((e) => e.type === "session.closed" && e.sessionId === "1");
    const upgIdx = events.findIndex(
      (e) => e.type === "session.upgraded" && e.previousSessionId === "1",
    );
    expect(closeIdx).toBeGreaterThanOrEqual(0);
    expect(upgIdx).toBeGreaterThan(closeIdx);
  });

  // ── Q5b: orphan upgrade rejects ─────────────────────────────────────────

  it("Q5b: orphan upgrade rejects with MetasploitListenerLookupError + emits session.closed", async () => {
    fake.whenCalled("core.version", () => ({ version: "6.4.10" }));
    fake.whenCalled("job.list", () => ({}));
    // Session with empty via_exploit → orphan (no listener match).
    fake.whenCalled("session.list", () => ({
      "9": {
        type: "shell",
        via_exploit: "",
        tunnel_local: "10.0.0.1:9999",
        session_host: "10.0.0.99",
        platform: "linux",
        info: "?",
      },
    }));

    const events: MetasploitEvent[] = [];

    const program = Effect.gen(function* () {
      const svc = yield* MetasploitService;
      yield* svc.subscribe((e) => events.push(e));

      // Session "9" is hydrated during ensureStarted with listenerId: null.
      // Wait a tick for subscribe's ensureStarted to complete.
      yield* Effect.sleep("200 millis");

      let caughtError: unknown = null;
      yield* svc.sessionUpgrade("9").pipe(
        Effect.catch((e) =>
          Effect.sync(() => {
            caughtError = e;
          }),
        ),
      );
      yield* svc.stop();
      return caughtError;
    });

    const caughtError = await Effect.runPromise(program.pipe(Effect.provide(makeLayer())));

    expect(caughtError).not.toBeNull();
    expect((caughtError as { _tag: string })._tag).toBe("MetasploitListenerLookupError");

    const closed = events.find((e) => e.type === "session.closed" && e.sessionId === "9");
    expect(closed).toBeDefined();
  });

  // ── Q10: emitSessionOutput delivers events correctly ────────────────────

  it("Q10: emitSessionOutput delivers events to subscribers", async () => {
    fake.whenCalled("core.version", () => ({ version: "6.4.10" }));
    fake.whenCalled("job.list", () => ({}));
    fake.whenCalled("session.list", () => ({}));

    const events: MetasploitEvent[] = [];

    const program = Effect.gen(function* () {
      const svc = yield* MetasploitService;
      yield* svc.subscribe((e) => events.push(e));
      yield* svc.emitSessionOutput("1", "hello");
      yield* svc.emitSessionOutput("1", "world");
      yield* svc.stop();
    });

    await Effect.runPromise(program.pipe(Effect.provide(makeLayer())));

    const outputs = events.filter((e) => e.type === "session.output");
    expect(outputs).toHaveLength(2);
    expect(outputs[0]!.type === "session.output" && outputs[0]!.data).toBe("hello");
    expect(outputs[1]!.type === "session.output" && outputs[1]!.data).toBe("world");
  });
});
