import { Effect, Context } from "effect";
import {
  type CreateRawTcpListenerInput,
  type RawTcpEvent,
  RawTcpListenerError,
  type RawTcpListenerSnapshot,
  RawTcpSessionError,
  type RawTcpSessionUpgradePtyInput,
  type RawTcpSessionSnapshot,
} from "@fenrir/contracts";

export interface RawTcpListenerServiceShape {
  readonly createListener: (
    input: CreateRawTcpListenerInput,
  ) => Effect.Effect<RawTcpListenerSnapshot, RawTcpListenerError>;
  readonly stopListener: (listenerId: string) => Effect.Effect<void, RawTcpListenerError>;
  readonly listListeners: () => Effect.Effect<readonly RawTcpListenerSnapshot[]>;
  readonly listSessions: () => Effect.Effect<readonly RawTcpSessionSnapshot[]>;
  readonly sessionWrite: (
    sessionId: string,
    data: string,
  ) => Effect.Effect<void, RawTcpSessionError>;
  readonly sessionUpgradePty: (
    input: RawTcpSessionUpgradePtyInput,
  ) => Effect.Effect<RawTcpSessionSnapshot, RawTcpSessionError>;
  readonly sessionClose: (sessionId: string) => Effect.Effect<void, RawTcpSessionError>;
  readonly subscribe: (callback: (event: RawTcpEvent) => void) => Effect.Effect<() => void>;
}

export class RawTcpListenerService extends Context.Service<
  RawTcpListenerService,
  RawTcpListenerServiceShape
>()("t3/raw-tcp/Services/RawTcpListenerService") {}
