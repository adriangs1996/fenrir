import { Effect, ServiceMap } from "effect";
import { PtyProcess, PtySpawnError } from "./PTY";

export class TmuxNotFoundError extends Error {
  readonly _tag = "TmuxNotFoundError";

  constructor() {
    super(
      "tmux binary not found on $PATH. Install tmux or ensure it is in your $PATH",
    );
  }
}

export class TmuxSessionError extends Error {
  readonly _tag = "TmuxSessionError";

  constructor(
    readonly sessionName: string,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

export interface TmuxSessionManagerShape {
  readonly createSession: (
    projectId: string,
    cwd: string,
  ) => Effect.Effect<void, TmuxSessionError | TmuxNotFoundError>;

  readonly attachSession: (
    projectId: string,
    cols: number,
    rows: number,
  ) => Effect.Effect<PtyProcess, TmuxSessionError | PtySpawnError>;

  readonly detachSession: (
    projectId: string,
  ) => Effect.Effect<void, TmuxSessionError | TmuxNotFoundError>;

  readonly killSession: (
    projectId: string,
  ) => Effect.Effect<void, TmuxSessionError | TmuxNotFoundError>;

  readonly hasSession: (projectId: string) => Effect.Effect<boolean>;

  readonly isTmuxAvailable: Effect.Effect<boolean>;

  readonly writeToSession: (
    projectId: string,
    data: string,
  ) => Effect.Effect<void, TmuxSessionError>;

  readonly resizeSession: (
    projectId: string,
    cols: number,
    rows: number,
  ) => Effect.Effect<void, TmuxSessionError>;

  readonly sessionName: (projectId: string) => string;
}

export class TmuxSessionManager extends ServiceMap.Service<
  TmuxSessionManager,
  TmuxSessionManagerShape
>()("t3/terminal/Services/TmuxSessionManager") {}
