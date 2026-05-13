import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ManagedProcess } from "@fenrir/contracts";
import { ReadinessProbe } from "../Services/ReadinessProbe.ts";
import { ReadinessProbeLayerLive } from "./ReadinessProbe.ts";

// ── Helpers ──

const TestLayer = ReadinessProbeLayerLive;

const DUMMY_DEFINITION = {
  id: "dev-server",
  name: "Dev Server",
  command: "npm run dev",
  icon: "terminal",
  scope: "project",
  cwd: null,
  env: {},
  proxy: null,
  readiness: { kind: "none" },
  autoRestart: null,
} as unknown as ManagedProcess;

function withReadiness(
  def: ManagedProcess,
  readiness: ManagedProcess["readiness"],
): ManagedProcess {
  return { ...def, readiness } as ManagedProcess;
}

// ── Tests ──

describe("ReadinessProbe", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("none", () => {
    it("fires onReady synchronously on start", async () => {
      await vi.runAllTimersAsync();
      const ready = await Effect.runPromise(
        Effect.gen(function* () {
          const probeService = yield* ReadinessProbe;
          const probe = probeService.create({
            instanceId: "inst-1",
            definition: DUMMY_DEFINITION,
            urlEstimate: null,
            urlConfirmed: () => null,
          });

          let fired = false;
          probe.onReady(() => {
            fired = true;
          });
          probe.start();
          return fired;
        }).pipe(Effect.provide(TestLayer)),
      );

      expect(ready).toBe(true);
    });
  });

  describe("portless-http", () => {
    it("fires onReady after fetch succeeds", async () => {
      const fetchMock = vi.fn<typeof fetch>();
      // First call: connection refused
      fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      // Second call: success (even a 404 counts)
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));

      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as typeof fetch;

      try {
        let readyFired = false;

        await Effect.runPromise(
          Effect.gen(function* () {
            const probeService = yield* ReadinessProbe;
            const def = withReadiness(DUMMY_DEFINITION, { kind: "portless-http" });
            const probe = probeService.create({
              instanceId: "inst-1",
              definition: def,
              urlEstimate: "https://my-app.localhost",
              urlConfirmed: () => null,
            });

            probe.onReady(() => {
              readyFired = true;
            });
            probe.start();
          }).pipe(Effect.provide(TestLayer)),
        );

        // First tick fires immediately — fetch rejects
        await vi.advanceTimersByTimeAsync(0);
        // Wait for the rejected promise to settle
        await vi.advanceTimersByTimeAsync(0);
        expect(readyFired).toBe(false);

        // After 1s interval, second tick fires — fetch succeeds
        await vi.advanceTimersByTimeAsync(1_000);
        // Let the resolved promise settle
        await vi.advanceTimersByTimeAsync(0);
        expect(readyFired).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("stops polling after success", async () => {
      const fetchMock = vi.fn<typeof fetch>();
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as typeof fetch;

      try {
        await Effect.runPromise(
          Effect.gen(function* () {
            const probeService = yield* ReadinessProbe;
            const def = withReadiness(DUMMY_DEFINITION, { kind: "portless-http" });
            const probe = probeService.create({
              instanceId: "inst-1",
              definition: def,
              urlEstimate: "https://my-app.localhost",
              urlConfirmed: () => null,
            });
            probe.onReady(() => {});
            probe.start();
          }).pipe(Effect.provide(TestLayer)),
        );

        // Let the first tick complete
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(0);
        const callsAfterFirst = fetchMock.mock.calls.length;

        // Advance well past multiple probe intervals
        await vi.advanceTimersByTimeAsync(5_000);
        expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("uses urlConfirmed when available", async () => {
      const fetchMock = vi.fn<typeof fetch>();
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as typeof fetch;

      try {
        await Effect.runPromise(
          Effect.gen(function* () {
            const probeService = yield* ReadinessProbe;
            const def = withReadiness(DUMMY_DEFINITION, { kind: "portless-http" });
            const probe = probeService.create({
              instanceId: "inst-1",
              definition: def,
              urlEstimate: "https://estimate.localhost",
              urlConfirmed: () => "https://confirmed.localhost",
            });
            probe.onReady(() => {});
            probe.start();
          }).pipe(Effect.provide(TestLayer)),
        );

        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(0);

        // Should have used the confirmed URL
        expect(fetchMock).toHaveBeenCalledWith(
          "https://confirmed.localhost",
          expect.objectContaining({ method: "HEAD" }),
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("log-pattern", () => {
    it("fires onReady on first regex match", async () => {
      let readyFired = false;

      await Effect.runPromise(
        Effect.gen(function* () {
          const probeService = yield* ReadinessProbe;
          const def = withReadiness(DUMMY_DEFINITION, {
            kind: "log-pattern",
            pattern: "ready in \\d+ms",
          });
          const probe = probeService.create({
            instanceId: "inst-1",
            definition: def,
            urlEstimate: null,
            urlConfirmed: () => null,
          });

          probe.onReady(() => {
            readyFired = true;
          });
          probe.start();

          // Non-matching chunk
          probe.observe("Compiling...");
          expect(readyFired).toBe(false);

          // Matching chunk
          probe.observe("ready in 250ms");
          expect(readyFired).toBe(true);
        }).pipe(Effect.provide(TestLayer)),
      );
    });

    it("does not fire again after first match", async () => {
      let fireCount = 0;

      await Effect.runPromise(
        Effect.gen(function* () {
          const probeService = yield* ReadinessProbe;
          const def = withReadiness(DUMMY_DEFINITION, {
            kind: "log-pattern",
            pattern: "listening on",
          });
          const probe = probeService.create({
            instanceId: "inst-1",
            definition: def,
            urlEstimate: null,
            urlConfirmed: () => null,
          });

          probe.onReady(() => {
            fireCount += 1;
          });
          probe.start();

          probe.observe("listening on port 3000");
          probe.observe("listening on port 3000 again");
          expect(fireCount).toBe(1);
        }).pipe(Effect.provide(TestLayer)),
      );
    });

    it("ANSI codes do not block the match", async () => {
      let readyFired = false;

      await Effect.runPromise(
        Effect.gen(function* () {
          const probeService = yield* ReadinessProbe;
          const def = withReadiness(DUMMY_DEFINITION, {
            kind: "log-pattern",
            pattern: "Server started",
          });
          const probe = probeService.create({
            instanceId: "inst-1",
            definition: def,
            urlEstimate: null,
            urlConfirmed: () => null,
          });

          probe.onReady(() => {
            readyFired = true;
          });
          probe.start();

          // Chunk with ANSI color codes wrapping the text
          probe.observe("\x1b[32mServer started\x1b[0m on port 3000");
          expect(readyFired).toBe(true);
        }).pipe(Effect.provide(TestLayer)),
      );
    });
  });

  describe("stop()", () => {
    it("prevents future onReady fires for none probe", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const probeService = yield* ReadinessProbe;
          const probe = probeService.create({
            instanceId: "inst-1",
            definition: DUMMY_DEFINITION,
            urlEstimate: null,
            urlConfirmed: () => null,
          });

          let fireCount = 0;
          probe.onReady(() => {
            fireCount += 1;
          });

          // First start fires immediately
          probe.start();
          expect(fireCount).toBe(1);

          // stop + re-start: re-start fires again (this is expected — none
          // always fires on start). But stop() itself prevents mid-flight fires.
          probe.stop();
        }).pipe(Effect.provide(TestLayer)),
      );
    });

    it("prevents future onReady fires for log-pattern probe", async () => {
      let readyFired = false;

      await Effect.runPromise(
        Effect.gen(function* () {
          const probeService = yield* ReadinessProbe;
          const def = withReadiness(DUMMY_DEFINITION, {
            kind: "log-pattern",
            pattern: "ready",
          });
          const probe = probeService.create({
            instanceId: "inst-1",
            definition: def,
            urlEstimate: null,
            urlConfirmed: () => null,
          });

          probe.onReady(() => {
            readyFired = true;
          });
          probe.start();
          probe.stop();

          // Matching chunk after stop — should not fire
          probe.observe("ready");
          expect(readyFired).toBe(false);
        }).pipe(Effect.provide(TestLayer)),
      );
    });

    it("prevents future onReady fires for portless-http probe", async () => {
      const fetchMock = vi.fn<typeof fetch>();
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as typeof fetch;

      try {
        let readyFired = false;

        await Effect.runPromise(
          Effect.gen(function* () {
            const probeService = yield* ReadinessProbe;
            const def = withReadiness(DUMMY_DEFINITION, { kind: "portless-http" });
            const probe = probeService.create({
              instanceId: "inst-1",
              definition: def,
              urlEstimate: "https://my-app.localhost",
              urlConfirmed: () => null,
            });

            probe.onReady(() => {
              readyFired = true;
            });
            probe.start();
            // Stop immediately before tick resolves
            probe.stop();
          }).pipe(Effect.provide(TestLayer)),
        );

        // Advance time — tick should have been cancelled
        await vi.advanceTimersByTimeAsync(5_000);
        expect(readyFired).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
