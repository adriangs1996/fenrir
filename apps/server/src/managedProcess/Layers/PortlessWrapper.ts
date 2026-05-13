/**
 * PortlessWrapper - Layer implementation.
 *
 * Transforms managed-process commands for the portless proxy CLI and
 * observes PTY output for URL confirmation.
 *
 * @module ManagedProcess/Layers/PortlessWrapper
 */
import { Effect, Layer } from "effect";

import { runProcess } from "../../processRunner.ts";
import { sanitizeTerminalHistoryChunk } from "@fenrir/shared/ansiSanitizer";
import {
  PortlessWrapper,
  PortlessWrapperError,
  type PortlessWrapperShape,
  type PortlessUrlObserver,
} from "../Services/PortlessWrapper.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Shell-quote a string using single quotes with proper escaping.
 * Handles embedded single quotes by ending the quote, adding an escaped
 * single quote, and re-opening the quote.
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Slugify a branch name for portless subdomain naming.
 * Lowercase, replace `/` and any non-`[a-z0-9-]` with `-`,
 * collapse repeated `-`, trim leading/trailing `-`.
 */
function slugifyBranch(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Portless availability check (cached)
// ---------------------------------------------------------------------------

function makePortlessAvailabilityChecker(): () => Effect.Effect<boolean> {
  let cachedResult: boolean | null = null;
  let lastCheckAt = 0;
  const CACHE_TTL_MS = 60_000;

  return () =>
    Effect.promise(async () => {
      const now = Date.now();
      if (cachedResult !== null && now - lastCheckAt < CACHE_TTL_MS) {
        return cachedResult;
      }

      try {
        const result = await runProcess("which", ["portless"], {
          timeoutMs: 5_000,
        });
        cachedResult = result.code === 0;
      } catch {
        cachedResult = false;
      }
      lastCheckAt = Date.now();
      return cachedResult;
    });
}

// ---------------------------------------------------------------------------
// ANSI stripping for URL observation
// ---------------------------------------------------------------------------

/** Creates a stateful ANSI stripper that handles partial sequences across chunks. */
function makeAnsiStripper(): (chunk: string) => string {
  let pending = "";
  return (chunk: string) => {
    const result = sanitizeTerminalHistoryChunk(pending, chunk);
    pending = result.pendingControlSequence;
    return result.visibleText;
  };
}

// ---------------------------------------------------------------------------
// URL observation regex
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex -- intentional: strip ANSI escape start byte from URL match
const PORTLESS_URL_RE = /https?:\/\/[^\s\x1b]+\.localhost\b/;

// ---------------------------------------------------------------------------
// Layer constructor
// ---------------------------------------------------------------------------

const makePortlessWrapper = Effect.sync(() => {
  const portlessAvailable = makePortlessAvailabilityChecker();

  return {
    wrap: ({ definition, worktreePath, branchName }) =>
      Effect.gen(function* () {
        if (definition.proxy === null) {
          return { command: definition.command, urlEstimate: null, executable: null };
        }

        if (definition.proxy.kind !== "portless") {
          return { command: definition.command, urlEstimate: null, executable: null };
        }

        const ok = yield* portlessAvailable();
        if (!ok) {
          return yield* Effect.fail(
            new PortlessWrapperError(
              "portless-not-found",
              "portless not found on PATH; install with `npm i -g portless` or remove proxy from this definition",
            ),
          );
        }

        const appName = definition.proxy.appName ?? definition.id;
        const wrapped = `portless run --name ${shellQuote(appName)} sh -c ${shellQuote(definition.command)}`;

        const branchPrefix =
          worktreePath !== null && branchName ? `${slugifyBranch(branchName)}.` : "";
        const urlEstimate = `https://${branchPrefix}${appName}.localhost`;

        return { command: wrapped, urlEstimate, executable: "portless" as const };
      }),

    observeUrlConfirmation: ({ definition }): PortlessUrlObserver => {
      if (definition.proxy?.kind !== "portless") {
        return { observe: () => null };
      }

      const stripAnsi = makeAnsiStripper();
      let buffer = "";
      let resolved = false;

      return {
        observe(chunk: string): string | null {
          if (resolved) return null;
          buffer = (buffer + stripAnsi(chunk)).slice(-4096);
          const match = PORTLESS_URL_RE.exec(buffer);
          if (!match) return null;
          resolved = true;
          buffer = "";
          return match[0];
        },
      };
    },
  } satisfies PortlessWrapperShape;
});

export const PortlessWrapperLive: Layer.Layer<PortlessWrapper> = Layer.effect(
  PortlessWrapper,
  makePortlessWrapper,
);
