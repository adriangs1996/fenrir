/**
 * TerminalBackend - Narrow server-side terminal backend boundary.
 *
 * The current compatibility backend delegates thread-scoped terminals to
 * TerminalManager (node-pty/Bun PTY underneath) and exposes tmux operations
 * needed by existing WebSocket routes. Future native backends should fit this
 * boundary before changing client-facing contracts.
 *
 * @module TerminalBackend
 */
import type {
  TerminalCloseInput,
  TerminalError,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
  TmuxAttachInput,
  TmuxDetachInput,
  TmuxError,
  TmuxResizeInput,
  TmuxSessionSnapshot,
  TmuxWriteInput,
} from "@fenrir/contracts";
import { Context, Effect } from "effect";

export interface TerminalBackendShape {
  readonly open: (
    input: TerminalOpenInput,
  ) => Effect.Effect<TerminalSessionSnapshot, TerminalError>;
  readonly write: (input: TerminalWriteInput) => Effect.Effect<void, TerminalError>;
  readonly resize: (input: TerminalResizeInput) => Effect.Effect<void, TerminalError>;
  readonly close: (input: TerminalCloseInput) => Effect.Effect<void, TerminalError>;

  readonly attachTmux: (input: TmuxAttachInput) => Effect.Effect<TmuxSessionSnapshot, TmuxError>;
  readonly detachTmux: (input: TmuxDetachInput) => Effect.Effect<void, TmuxError>;
  readonly writeTmux: (input: TmuxWriteInput) => Effect.Effect<void, TmuxError>;
  readonly resizeTmux: (input: TmuxResizeInput) => Effect.Effect<void, TmuxError>;
}

export class TerminalBackend extends Context.Service<TerminalBackend, TerminalBackendShape>()(
  "t3/terminal/Services/Backend/TerminalBackend",
) {}
