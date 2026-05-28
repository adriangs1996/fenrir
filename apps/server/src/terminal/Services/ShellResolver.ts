/**
 * TerminalShellResolver - Internal service for shell candidate resolution.
 *
 * Resolves which shell binary to use for terminal sessions with platform-aware
 * fallback chains. Also handles environment variable filtering for PTY spawn.
 *
 * @module TerminalShellResolver
 * @internal Consumed only by TerminalManager layer.
 */
import { Context } from "effect";
import { PtySpawnError } from "./PTY";

export { PtySpawnError };

export interface ShellCandidate {
  shell: string;
  args?: string[];
}

/**
 * TerminalShellResolverShape - Service API for shell resolution and env creation.
 */
export interface TerminalShellResolverShape {
  /**
   * Resolve an ordered list of shell candidates for spawning.
   * Platform-aware: zsh/bash/sh on POSIX, powershell/cmd on Windows.
   */
  readonly resolve: () => ShellCandidate[];

  /**
   * Create a filtered environment for PTY spawn.
   * Strips FENRIR_*, VITE_*, and other blocklisted variables.
   */
  readonly createSpawnEnv: (
    baseEnv: NodeJS.ProcessEnv,
    runtimeEnv?: Record<string, string> | null,
  ) => NodeJS.ProcessEnv;

  /**
   * Format a shell candidate for display (e.g. "zsh -o nopromptsp").
   */
  readonly formatCandidate: (candidate: ShellCandidate) => string;

  /**
   * Check if a spawn error is retryable (shell not found, ENOENT, etc.).
   */
  readonly isRetryableSpawnError: (error: PtySpawnError) => boolean;

  /**
   * Normalize a runtime env record: sort keys, return null if empty.
   */
  readonly normalizeRuntimeEnv: (
    env: Record<string, string> | undefined,
  ) => Record<string, string> | null;
}

/**
 * TerminalShellResolver - Service tag for shell resolution.
 */
export class TerminalShellResolver extends Context.Service<
  TerminalShellResolver,
  TerminalShellResolverShape
>()("t3/terminal/Services/ShellResolver/TerminalShellResolver") {}
