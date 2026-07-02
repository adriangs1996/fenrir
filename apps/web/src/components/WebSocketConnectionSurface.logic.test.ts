import { describe, expect, it } from "vitest";

import type { WsConnectionStatus } from "../rpc/wsConnectionState";
import {
  HEARTBEAT_WATCHDOG_GRACE_MS,
  shouldAutoReconnect,
  shouldRestartStalledReconnect,
  shouldScheduleExhaustedRetry,
  shouldWatchdogReconnect,
} from "./WebSocketConnectionSurface";

function makeStatus(overrides: Partial<WsConnectionStatus> = {}): WsConnectionStatus {
  return {
    attemptCount: 0,
    closeCode: null,
    closeReason: null,
    connectedAt: null,
    disconnectedAt: null,
    hasConnected: false,
    lastError: null,
    lastErrorAt: null,
    nextRetryAt: null,
    online: true,
    phase: "idle",
    reconnectAttemptCount: 0,
    reconnectMaxAttempts: 8,
    reconnectPhase: "idle",
    socketUrl: null,
    ...overrides,
  };
}

describe("WebSocketConnectionSurface.logic", () => {
  it("forces reconnect on online when the app was offline", () => {
    expect(
      shouldAutoReconnect(
        makeStatus({
          disconnectedAt: "2026-04-03T20:00:00.000Z",
          online: false,
          phase: "disconnected",
        }),
        "online",
      ),
    ).toBe(true);
  });

  it("forces reconnect on focus only for previously connected disconnected states", () => {
    expect(
      shouldAutoReconnect(
        makeStatus({
          hasConnected: true,
          online: true,
          phase: "disconnected",
          reconnectAttemptCount: 3,
          reconnectPhase: "waiting",
        }),
        "focus",
      ),
    ).toBe(true);

    expect(
      shouldAutoReconnect(
        makeStatus({
          hasConnected: false,
          online: true,
          phase: "disconnected",
          reconnectAttemptCount: 1,
          reconnectPhase: "waiting",
        }),
        "focus",
      ),
    ).toBe(false);
  });

  it("forces reconnect on focus for exhausted reconnect loops", () => {
    expect(
      shouldAutoReconnect(
        makeStatus({
          hasConnected: true,
          online: true,
          phase: "disconnected",
          reconnectAttemptCount: 8,
          reconnectPhase: "exhausted",
        }),
        "focus",
      ),
    ).toBe(true);
  });

  it("does not force reconnect while a reconnect attempt is already active", () => {
    expect(
      shouldAutoReconnect(
        makeStatus({
          hasConnected: true,
          online: true,
          phase: "connecting",
          reconnectAttemptCount: 2,
          reconnectPhase: "attempting",
        }),
        "focus",
      ),
    ).toBe(false);
  });

  it("watchdog-reconnects a connected socket with a stale heartbeat after the grace period", () => {
    const connectedAt = "2026-04-03T20:00:00.000Z";
    const connectedStatus = makeStatus({
      connectedAt,
      hasConnected: true,
      phase: "connected",
    });
    const pastGraceMs = new Date(connectedAt).getTime() + HEARTBEAT_WATCHDOG_GRACE_MS;

    expect(
      shouldWatchdogReconnect(connectedStatus, { nowMs: pastGraceMs, heartbeatFresh: false }),
    ).toBe(true);
    expect(
      shouldWatchdogReconnect(connectedStatus, { nowMs: pastGraceMs, heartbeatFresh: true }),
    ).toBe(false);
    expect(
      shouldWatchdogReconnect(connectedStatus, {
        nowMs: pastGraceMs - 1_000,
        heartbeatFresh: false,
      }),
    ).toBe(false);
    expect(
      shouldWatchdogReconnect(
        { ...connectedStatus, phase: "disconnected" },
        { nowMs: pastGraceMs, heartbeatFresh: false },
      ),
    ).toBe(false);
  });

  it("keeps retrying on a slow cadence after the retry budget is exhausted", () => {
    expect(
      shouldScheduleExhaustedRetry(
        makeStatus({
          hasConnected: true,
          online: true,
          phase: "disconnected",
          reconnectPhase: "exhausted",
        }),
      ),
    ).toBe(true);

    expect(
      shouldScheduleExhaustedRetry(
        makeStatus({
          hasConnected: false,
          online: true,
          phase: "disconnected",
          reconnectPhase: "exhausted",
        }),
      ),
    ).toBe(true);

    expect(
      shouldScheduleExhaustedRetry(
        makeStatus({
          online: false,
          phase: "disconnected",
          reconnectPhase: "exhausted",
        }),
      ),
    ).toBe(false);

    expect(
      shouldScheduleExhaustedRetry(
        makeStatus({
          online: true,
          phase: "disconnected",
          reconnectPhase: "waiting",
        }),
      ),
    ).toBe(false);
  });

  it("restarts a stalled reconnect window after the scheduled retry time passes", () => {
    expect(
      shouldRestartStalledReconnect(
        makeStatus({
          hasConnected: true,
          nextRetryAt: "2026-04-03T20:00:01.000Z",
          online: true,
          phase: "disconnected",
          reconnectAttemptCount: 3,
          reconnectPhase: "waiting",
        }),
        "2026-04-03T20:00:01.000Z",
      ),
    ).toBe(true);

    expect(
      shouldRestartStalledReconnect(
        makeStatus({
          hasConnected: true,
          nextRetryAt: "2026-04-03T20:00:01.000Z",
          online: true,
          phase: "disconnected",
          reconnectAttemptCount: 3,
          reconnectPhase: "attempting",
        }),
        "2026-04-03T20:00:01.000Z",
      ),
    ).toBe(false);
  });
});
