import { Effect, Schema, Stream } from "effect";

export class RemoteConnectionError extends Schema.TaggedErrorClass<RemoteConnectionError>()(
  "RemoteConnectionError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export interface RemoteOutputChunk {
  readonly stream: "stdout" | "stderr" | "pty";
  readonly data: string;
}

export interface RemoteExit {
  readonly exitCode: number;
  readonly signal: string | null;
}

export interface RemoteProcess {
  readonly id: string;

  readonly write: (data: string) => Effect.Effect<void, RemoteConnectionError>;
  readonly closeInput: Effect.Effect<void, RemoteConnectionError>;

  readonly output: Stream.Stream<RemoteOutputChunk, RemoteConnectionError>;

  /**
   * Completes when the remote invocation exits.
   * For a one-off script this completes normally.
   * For a PTY/session it completes only when the session dies/is closed.
   */
  readonly exit: Effect.Effect<RemoteExit, RemoteConnectionError>;

  readonly kill: (signal?: string) => Effect.Effect<void, RemoteConnectionError>;
  readonly resize?: (cols: number, rows: number) => Effect.Effect<void, RemoteConnectionError>;
}
