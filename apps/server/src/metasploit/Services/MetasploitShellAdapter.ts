/**
 * MetasploitShellAdapter — Bridges MSFRPC poll-based shell I/O
 * into a push-based stream for xterm.js and agent consumption.
 *
 * @module MetasploitShellAdapter
 */
import { Effect, ServiceMap } from "effect";
import type { MetasploitSessionError } from "@fenrir/contracts";

export interface MsfShellProcess {
  readonly sessionId: string;
  write(data: string): void;
  onData(callback: (data: string) => void): () => void;
  onExit(callback: () => void): () => void;
  resize(cols: number, rows: number): void;
  close(): void;
}

export interface MetasploitShellAdapterShape {
  /**
   * Attach to a Metasploit session, returning a push-based shell process.
   * Internally polls session.shell_read and converts to onData callbacks.
   */
  readonly attach: (
    sessionId: string,
  ) => Effect.Effect<MsfShellProcess, MetasploitSessionError>;
}

export class MetasploitShellAdapter extends ServiceMap.Service<
  MetasploitShellAdapter,
  MetasploitShellAdapterShape
>()("t3/metasploit/Services/MetasploitShellAdapter") {}
