/**
 * ReadinessProbe - Layer implementation.
 *
 * Three probe strategies keyed off `definition.readiness.kind`:
 * - `none`: fires onReady immediately on start.
 * - `portless-http`: polls a URL with HEAD requests until any response.
 * - `log-pattern`: scans PTY chunks for a regex match.
 *
 * @module ManagedProcess/Layers/ReadinessProbe
 */
import { Effect, Layer } from "effect";

import { sanitizeTerminalHistoryChunk } from "@fenrir/shared/ansiSanitizer";
import {
  ReadinessProbe,
  type ReadinessProbeHandle,
  type ReadinessProbeShape,
} from "../Services/ReadinessProbe.ts";

// ---------------------------------------------------------------------------
// ANSI stripping for log-pattern probes
// ---------------------------------------------------------------------------

function makeAnsiStripper(): (chunk: string) => string {
  let pending = "";
  return (chunk: string) => {
    const result = sanitizeTerminalHistoryChunk(pending, chunk);
    pending = result.pendingControlSequence;
    return result.visibleText;
  };
}

// ---------------------------------------------------------------------------
// Handler registry helper
// ---------------------------------------------------------------------------

interface HandlerRegistry {
  readonly handlers: Set<() => void>;
  add(handler: () => void): { unsubscribe: () => void };
  fire(): void;
}

function createHandlerRegistry(): HandlerRegistry {
  const handlers = new Set<() => void>();
  return {
    handlers,
    add(handler: () => void) {
      handlers.add(handler);
      return { unsubscribe: () => handlers.delete(handler) };
    },
    fire() {
      for (const h of handlers) {
        try {
          h();
        } catch {
          /* swallow — handler errors must not crash the probe */
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Probe factories
// ---------------------------------------------------------------------------

function createNoneProbe(): ReadinessProbeHandle {
  const registry = createHandlerRegistry();
  return {
    start: () => registry.fire(),
    stop: () => {},
    observe: () => {},
    onReady: (handler) => registry.add(handler),
  };
}

function createPortlessHttpProbe(
  urlEstimate: string | null,
  urlConfirmed: () => string | null,
): ReadinessProbeHandle {
  const registry = createHandlerRegistry();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const scheduleNext = () => {
    timer = setTimeout(tick, 1_000);
  };

  const tick = async () => {
    if (stopped) return;
    const url = urlConfirmed() ?? urlEstimate;
    if (!url) {
      scheduleNext();
      return;
    }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2_000);
      await fetch(url, { method: "HEAD", signal: ctrl.signal });
      clearTimeout(t);
      // Re-check after await — stop() may have been called while waiting.
      if (stopped) return;
      // Any response (even 4xx) means the server is up.
      stopped = true;
      registry.fire();
      return;
    } catch {
      // connection refused / dns fail / timeout → keep probing
    }
    if (stopped) return;
    scheduleNext();
  };

  return {
    start: () => {
      stopped = false;
      tick();
    },
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    observe: () => {},
    onReady: (handler) => registry.add(handler),
  };
}

function createLogPatternProbe(pattern: string): ReadinessProbeHandle {
  const registry = createHandlerRegistry();
  const re = new RegExp(pattern);
  const stripAnsi = makeAnsiStripper();
  let stopped = false;
  let resolved = false;

  return {
    start: () => {
      stopped = false;
      resolved = false;
    },
    stop: () => {
      stopped = true;
    },
    observe: (chunk: string) => {
      if (stopped || resolved) return;
      const stripped = stripAnsi(chunk);
      if (re.test(stripped)) {
        resolved = true;
        registry.fire();
      }
    },
    onReady: (handler) => registry.add(handler),
  };
}

// ---------------------------------------------------------------------------
// Layer constructor
// ---------------------------------------------------------------------------

const makeReadinessProbe = Effect.sync(() => {
  return {
    create: ({ definition, urlEstimate, urlConfirmed }) => {
      switch (definition.readiness.kind) {
        case "none":
          return createNoneProbe();

        case "portless-http":
          return createPortlessHttpProbe(urlEstimate, urlConfirmed);

        case "log-pattern":
          return createLogPatternProbe(definition.readiness.pattern);
      }
    },
  } satisfies ReadinessProbeShape;
});

export const ReadinessProbeLayerLive: Layer.Layer<ReadinessProbe> = Layer.effect(
  ReadinessProbe,
  makeReadinessProbe,
);
