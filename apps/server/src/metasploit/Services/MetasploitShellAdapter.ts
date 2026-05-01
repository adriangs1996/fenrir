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

export interface AttachOptions {
  /** Initial terminal columns for PTY stty sizing. */
  cols?: number | undefined;
  /** Initial terminal rows for PTY stty sizing. */
  rows?: number | undefined;
}

export interface MetasploitShellAdapterShape {
  /**
   * Attach to a Metasploit session, returning a push-based shell process.
   * Internally polls session.shell_read and converts to onData callbacks.
   * For raw shell sessions, automatically upgrades to a full PTY via python3.
   */
  readonly attach: (
    sessionId: string,
    options?: AttachOptions,
  ) => Effect.Effect<MsfShellProcess, MetasploitSessionError>;
}

export class MetasploitShellAdapter extends ServiceMap.Service<
  MetasploitShellAdapter,
  MetasploitShellAdapterShape
>()("t3/metasploit/Services/MetasploitShellAdapter") {}
