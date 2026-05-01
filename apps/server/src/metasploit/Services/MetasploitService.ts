/**
 * MetasploitService — Service contract for Metasploit Framework integration.
 *
 * Manages the msfrpcd lifecycle, listener creation, session tracking,
 * and event subscriptions. Mirrors TmuxSessionManager pattern.
 *
 * @module MetasploitService
 */
import { Effect, ServiceMap } from "effect";
import type {
  CreateListenerInput,
  ListenerSnapshot,
  MetasploitConnectionError,
  MetasploitEvent,
  MetasploitListenerError,
  MetasploitListenerLookupError,
  MetasploitNotFoundError,
  MetasploitSessionError,
  MetasploitStatusSnapshot,
  MsfSessionSnapshot,
} from "@fenrir/contracts";

export interface MetasploitServiceShape {
  /** Check if msfrpcd binary is available on $PATH */
  readonly isAvailable: Effect.Effect<boolean>;

  /** Spawn msfrpcd and connect via MSFRPC */
  readonly start: () => Effect.Effect<void, MetasploitNotFoundError | MetasploitConnectionError>;

  /** Kill msfrpcd process and cleanup */
  readonly stop: () => Effect.Effect<void>;

  /** Get current Metasploit connection/session status */
  readonly status: () => Effect.Effect<MetasploitStatusSnapshot, MetasploitConnectionError>;

  /** Create a multi/handler listener */
  readonly createListener: (
    input: CreateListenerInput,
  ) => Effect.Effect<
    ListenerSnapshot,
    MetasploitListenerError | MetasploitConnectionError | MetasploitNotFoundError
  >;

  /** Stop and remove a listener */
  readonly stopListener: (listenerId: string) => Effect.Effect<void, MetasploitListenerError>;

  /** List all active listeners */
  readonly listListeners: () => Effect.Effect<ListenerSnapshot[], MetasploitConnectionError>;

  /** List all active sessions */
  readonly listSessions: () => Effect.Effect<MsfSessionSnapshot[], MetasploitConnectionError>;

  /** Write data to a session shell */
  readonly sessionWrite: (
    sessionId: string,
    data: string,
  ) => Effect.Effect<void, MetasploitSessionError>;

  /** Read buffered output from a session shell */
  readonly sessionRead: (sessionId: string) => Effect.Effect<string, MetasploitSessionError>;

  /** Upgrade a raw shell session to Meterpreter */
  readonly sessionUpgrade: (
    sessionId: string,
  ) => Effect.Effect<MsfSessionSnapshot, MetasploitSessionError | MetasploitListenerLookupError>;

  /** Close/kill a session */
  readonly sessionClose: (sessionId: string) => Effect.Effect<void, MetasploitSessionError>;

  /** Subscribe to metasploit events (listeners, sessions) */
  readonly subscribe: (listener: (event: MetasploitEvent) => void) => Effect.Effect<() => void>;

  /**
   * @internal
   * Emit a `session.output` event on the internal PubSub.
   * Called only by the ws layer to bridge `MetasploitShellAdapter.onData`
   * callbacks into the event stream that web clients subscribe to.
   */
  readonly emitSessionOutput: (sessionId: string, data: string) => Effect.Effect<void>;

  /**
   * @internal
   * Get the raw TCP socket for a direct-TCP session.
   * Returns null for MSFRPC-managed sessions.
   */
  readonly getRawTcpSocket: (sessionId: string) => Effect.Effect<import("node:net").Socket | null>;
}

export class MetasploitService extends ServiceMap.Service<
  MetasploitService,
  MetasploitServiceShape
>()("t3/metasploit/Services/MetasploitService") {}
