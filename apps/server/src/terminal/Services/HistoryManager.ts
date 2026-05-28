/**
 * TerminalHistoryManager - Internal service for terminal history persistence.
 *
 * Owns reading, writing, capping, migrating, and deleting terminal history
 * files on disk. Uses debounced coalescing to minimize filesystem writes.
 *
 * @module TerminalHistoryManager
 * @internal Consumed only by TerminalManager layer.
 */
import { TerminalHistoryError } from "@fenrir/contracts";
import { Effect, Context } from "effect";

export { TerminalHistoryError };

/**
 * TerminalHistoryManagerShape - Service API for terminal history persistence.
 */
export interface TerminalHistoryManagerShape {
  /**
   * Read terminal history from disk, capping to configured line limit.
   * Handles legacy path migration for default terminal sessions.
   */
  readonly read: (
    threadId: string,
    terminalId: string,
  ) => Effect.Effect<string, TerminalHistoryError>;

  /**
   * Immediately persist history to disk and drain any pending writes.
   */
  readonly persist: (threadId: string, terminalId: string, history: string) => Effect.Effect<void>;

  /**
   * Queue a debounced history persist (40ms coalescing window).
   */
  readonly queuePersist: (
    threadId: string,
    terminalId: string,
    history: string,
  ) => Effect.Effect<void>;

  /**
   * Drain any pending persist operations for a session.
   */
  readonly flushPersist: (threadId: string, terminalId: string) => Effect.Effect<void>;

  /**
   * Delete history file for a single terminal session.
   */
  readonly delete: (threadId: string, terminalId: string) => Effect.Effect<void>;

  /**
   * Delete all history files for a thread.
   */
  readonly deleteAllForThread: (threadId: string) => Effect.Effect<void>;
}

/**
 * TerminalHistoryManager - Service tag for terminal history persistence.
 */
export class TerminalHistoryManager extends Context.Service<
  TerminalHistoryManager,
  TerminalHistoryManagerShape
>()("t3/terminal/Services/HistoryManager/TerminalHistoryManager") {}
