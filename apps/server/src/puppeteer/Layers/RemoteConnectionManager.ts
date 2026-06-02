import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable } from "node:stream";

import {
  type CommandTemplateRemoteTransport,
  type RemoteConnectionId,
  type RemoteConnectionSnapshot,
  type RemoteHostId,
  type RemoteTransport,
  TrimmedNonEmptyString,
} from "@fenrir/contracts";
import { Context, Effect, Fiber, Layer, Schema, Stream } from "effect";

export class RemoteConnectionError extends Schema.TaggedErrorClass<RemoteConnectionError>()(
  "RemoteConnectionError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export type RemoteOutputStream = "stdout" | "stderr" | "pty";

export interface RemoteOutputChunk {
  readonly stream: RemoteOutputStream;
  readonly data: string;
}

export interface RemoteExit {
  readonly exitCode: number | null;
  readonly signal: string | null;
}

export interface RemoteExecutionRequest {
  readonly command: string;
  readonly args?: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly stdin?: string;
  readonly timeoutMs?: number;
  readonly outputBytesLimit?: number;
  readonly tty?: boolean;
}

export interface RemoteExecutionResult extends RemoteExit {
  readonly stdout: string;
  readonly stderr: string;
  readonly combinedOutput: string;
  readonly output: ReadonlyArray<RemoteOutputChunk>;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly outputTruncated: boolean;
}

interface CappedOutput {
  readonly chunks: ReadonlyArray<RemoteOutputChunk>;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly outputTruncated: boolean;
}

export interface RemoteProcess {
  readonly id: string;
  readonly write: (input: string) => Effect.Effect<void, RemoteConnectionError>;
  readonly closeInput: Effect.Effect<void, RemoteConnectionError>;
  readonly output: Stream.Stream<RemoteOutputChunk, RemoteConnectionError>;
  readonly exit: Effect.Effect<RemoteExit, RemoteConnectionError>;
  readonly kill: (signal?: string) => Effect.Effect<void, RemoteConnectionError>;
  readonly resize?: (cols: number, rows: number) => Effect.Effect<void, RemoteConnectionError>;
}

export interface RemoteConnection {
  readonly id: string;
  readonly spawn: (
    request: RemoteExecutionRequest,
  ) => Effect.Effect<RemoteProcess, RemoteConnectionError>;
  readonly close: Effect.Effect<void, RemoteConnectionError>;
}

const toRemoteConnectionError = (message: string, cause?: unknown): RemoteConnectionError =>
  new RemoteConnectionError({
    message,
    ...(cause === undefined ? {} : { cause }),
  });

const streamProcessOutput = (
  readable: Readable,
  stream: RemoteOutputStream,
): Stream.Stream<RemoteOutputChunk, RemoteConnectionError> =>
  Stream.fromReadableStream({
    evaluate: () => Readable.toWeb(readable) as ReadableStream<Uint8Array>,
    onError: (cause) => toRemoteConnectionError(`Failed to read remote ${stream}.`, cause),
  }).pipe(
    Stream.map((chunk) => ({
      stream,
      data: Buffer.from(chunk).toString("utf8"),
    })),
  );

class ChildProcessRemoteProcess implements RemoteProcess {
  readonly output: Stream.Stream<RemoteOutputChunk, RemoteConnectionError>;
  readonly exit: Effect.Effect<RemoteExit, RemoteConnectionError>;

  constructor(
    readonly id: string,
    private readonly child: ChildProcessWithoutNullStreams,
  ) {
    this.output = streamProcessOutput(child.stdout, "stdout").pipe(
      Stream.merge(streamProcessOutput(child.stderr, "stderr")),
    );

    this.exit = Effect.tryPromise({
      try: () =>
        new Promise<RemoteExit>((resolve, reject) => {
          const cleanup = () => {
            child.off("error", onError);
            child.off("exit", onExit);
          };
          const onError = (error: Error) => {
            cleanup();
            reject(error);
          };
          const onExit = (exitCode: number | null, signal: NodeJS.Signals | null) => {
            cleanup();
            resolve({ exitCode, signal });
          };

          child.once("error", onError);
          child.once("exit", onExit);
        }),
      catch: (cause) => toRemoteConnectionError("Remote process failed.", cause),
    });
  }

  write(input: string): Effect.Effect<void, RemoteConnectionError> {
    return Effect.tryPromise({
      try: () =>
        new Promise<void>((resolve, reject) => {
          this.child.stdin.write(input, (error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
      catch: (cause) => toRemoteConnectionError("Failed to write remote process stdin.", cause),
    });
  }

  closeInput: Effect.Effect<void, RemoteConnectionError> = Effect.tryPromise({
    try: () =>
      new Promise<void>((resolve) => {
        this.child.stdin.end(() => {
          resolve();
        });
      }),
    catch: (cause) => toRemoteConnectionError("Failed to close remote process stdin.", cause),
  });

  kill(signal?: string): Effect.Effect<void, RemoteConnectionError> {
    return Effect.sync(() => {
      this.child.kill(signal as NodeJS.Signals | undefined);
    });
  }
}

const renderCommandTemplate = (
  values: ReadonlyArray<string>,
  placeholder: string,
  remoteCommand: string,
): ReadonlyArray<string> => values.map((value) => value.replaceAll(placeholder, remoteCommand));

class CommandTemplateRemoteConnection implements RemoteConnection {
  private nextProcessId = 1;

  constructor(
    readonly id: string,
    private readonly transport: CommandTemplateRemoteTransport,
  ) {}

  spawn(request: RemoteExecutionRequest): Effect.Effect<RemoteProcess, RemoteConnectionError> {
    return Effect.try({
      try: () => {
        const placeholder = this.transport.commandPlaceholder ?? "{command}";
        const args = renderCommandTemplate(
          this.transport.args ?? [placeholder],
          placeholder,
          request.command,
        );
        const child = spawn(this.transport.command, args, {
          cwd: request.cwd ?? this.transport.cwd,
          env: {
            ...process.env,
            ...this.transport.env,
            ...request.env,
          },
          stdio: "pipe",
        });

        return new ChildProcessRemoteProcess(`${this.id}-${this.nextProcessId++}`, child);
      },
      catch: (cause) => toRemoteConnectionError("Failed to spawn remote command transport.", cause),
    });
  }

  close: Effect.Effect<void, RemoteConnectionError> = Effect.void;
}

const collectResult = (
  exit: RemoteExit,
  chunks: ReadonlyArray<RemoteOutputChunk>,
): RemoteExecutionResult => ({
  ...exit,
  stdout: chunks
    .filter((chunk) => chunk.stream === "stdout")
    .map((chunk) => chunk.data)
    .join(""),
  stderr: chunks
    .filter((chunk) => chunk.stream === "stderr")
    .map((chunk) => chunk.data)
    .join(""),
  combinedOutput: chunks.map((chunk) => chunk.data).join(""),
  output: chunks,
  stdoutTruncated: false,
  stderrTruncated: false,
  outputTruncated: false,
});

const applyOutputBytesLimit = (
  chunks: ReadonlyArray<RemoteOutputChunk>,
  outputBytesLimit: number | undefined,
): CappedOutput => {
  if (outputBytesLimit === undefined) {
    return {
      chunks,
      stdoutTruncated: false,
      stderrTruncated: false,
      outputTruncated: false,
    };
  }

  const limit = Math.max(0, Math.floor(outputBytesLimit));
  const bytesByStream: Record<RemoteOutputStream, number> = {
    stdout: 0,
    stderr: 0,
    pty: 0,
  };
  let stdoutTruncated = false;
  let stderrTruncated = false;
  let outputTruncated = false;
  const cappedChunks: RemoteOutputChunk[] = [];

  for (const chunk of chunks) {
    const chunkBuffer = Buffer.from(chunk.data);
    const remaining = limit - bytesByStream[chunk.stream];
    if (remaining <= 0) {
      outputTruncated = true;
      if (chunk.stream === "stdout") stdoutTruncated = true;
      if (chunk.stream === "stderr") stderrTruncated = true;
      continue;
    }

    if (chunkBuffer.length <= remaining) {
      bytesByStream[chunk.stream] += chunkBuffer.length;
      cappedChunks.push(chunk);
      continue;
    }

    outputTruncated = true;
    if (chunk.stream === "stdout") stdoutTruncated = true;
    if (chunk.stream === "stderr") stderrTruncated = true;
    bytesByStream[chunk.stream] += remaining;
    cappedChunks.push({
      stream: chunk.stream,
      data: chunkBuffer.subarray(0, remaining).toString("utf8"),
    });
  }

  return {
    chunks: cappedChunks,
    stdoutTruncated,
    stderrTruncated,
    outputTruncated,
  };
};

const collectCappedResult = (
  exit: RemoteExit,
  chunks: ReadonlyArray<RemoteOutputChunk>,
  outputBytesLimit: number | undefined,
): RemoteExecutionResult => {
  const capped = applyOutputBytesLimit(chunks, outputBytesLimit);
  return {
    ...collectResult(exit, capped.chunks),
    stdoutTruncated: capped.stdoutTruncated,
    stderrTruncated: capped.stderrTruncated,
    outputTruncated: capped.outputTruncated,
  };
};

const waitForExit = (
  process: RemoteProcess,
  timeoutMs: number | undefined,
): Effect.Effect<RemoteExit, RemoteConnectionError> =>
  Effect.gen(function* () {
    if (timeoutMs === undefined) {
      return yield* process.exit;
    }

    const timeout = Effect.callback<never, RemoteConnectionError>((resume) => {
      const timeoutId = setTimeout(() => {
        resume(
          Effect.fail(
            new RemoteConnectionError({
              message: `Remote command timed out after ${timeoutMs}ms.`,
            }),
          ),
        );
      }, timeoutMs);
      return Effect.sync(() => clearTimeout(timeoutId));
    }).pipe(Effect.tapError(() => process.kill("SIGTERM")));

    return yield* process.exit.pipe(Effect.raceFirst(timeout));
  });

export const executeRemoteCommand = (
  connection: RemoteConnection,
  request: RemoteExecutionRequest,
): Effect.Effect<RemoteExecutionResult, RemoteConnectionError> =>
  Effect.gen(function* () {
    const process = yield* connection.spawn(request);
    const outputFiber = yield* Stream.runCollect(process.output).pipe(Effect.forkChild);

    if (request.stdin !== undefined) {
      yield* process.write(request.stdin);
    }
    yield* process.closeInput;

    const exit = yield* waitForExit(process, request.timeoutMs).pipe(
      Effect.tapError(() => Fiber.interrupt(outputFiber)),
    );
    const output = yield* Fiber.join(outputFiber);
    return collectCappedResult(exit, output, request.outputBytesLimit);
  });

export interface RemoteConnectionManagerShape {
  readonly startConnection: (
    input: ResolvedRemoteConnectionStartInput,
  ) => Effect.Effect<RemoteConnectionSnapshot, RemoteConnectionError>;
  readonly stopConnection: (
    connectionId: string,
  ) => Effect.Effect<RemoteConnectionSnapshot, RemoteConnectionError>;
  readonly listConnections: () => Effect.Effect<readonly RemoteConnectionSnapshot[]>;
  readonly getConnection: (
    connectionId: string,
  ) => Effect.Effect<RemoteConnection, RemoteConnectionError>;
}

export class RemoteConnectionManager extends Context.Service<
  RemoteConnectionManager,
  RemoteConnectionManagerShape
>()("fenrir/puppeteer/RemoteConnectionManager") {}

export interface ResolvedRemoteConnectionStartInput {
  readonly connectionId?: RemoteConnectionId;
  readonly hostId?: RemoteHostId;
  readonly label: string;
  readonly transport: RemoteTransport;
}

const makeConnection = (connectionId: string, transport: RemoteTransport): RemoteConnection => {
  switch (transport.type) {
    case "command-template":
      return new CommandTemplateRemoteConnection(connectionId, transport);
  }
};

export const RemoteConnectionManagerLive = Layer.effect(
  RemoteConnectionManager,
  Effect.sync(() => {
    const connections = new Map<string, RemoteConnection>();
    const snapshots = new Map<string, RemoteConnectionSnapshot>();

    return {
      startConnection: (input) =>
        Effect.gen(function* () {
          const connectionId = input.connectionId?.trim() || `remote-${crypto.randomUUID()}`;
          if (connections.has(connectionId)) {
            return yield* toRemoteConnectionError(
              `Remote connection ${connectionId} already exists.`,
            );
          }

          const connection = makeConnection(connectionId, input.transport);
          const snapshot: RemoteConnectionSnapshot = {
            connectionId: connectionId as RemoteConnectionId,
            ...(input.hostId === undefined ? {} : { hostId: input.hostId }),
            label: input.label,
            transportType: input.transport.type,
            status: "connected",
            state: { path: "." },
            startedAt: new Date().toISOString(),
          };
          connections.set(connectionId, connection);
          snapshots.set(connectionId, snapshot);
          return snapshot;
        }),

      stopConnection: (connectionId) =>
        Effect.gen(function* () {
          const snapshot = snapshots.get(connectionId);
          if (!snapshot) {
            return yield* toRemoteConnectionError(`Remote connection ${connectionId} not found.`);
          }
          const connection = connections.get(connectionId);
          if (connection) {
            yield* connection.close;
            connections.delete(connectionId);
          }
          const stopped: RemoteConnectionSnapshot = {
            ...snapshot,
            status: "disconnected",
            stoppedAt: new Date().toISOString(),
          };
          snapshots.set(connectionId, stopped);
          return stopped;
        }),

      listConnections: () => Effect.sync(() => Array.from(snapshots.values())),

      getConnection: (connectionId) =>
        Effect.gen(function* () {
          const connection = connections.get(connectionId);
          if (!connection) {
            return yield* toRemoteConnectionError(`Remote connection ${connectionId} not found.`);
          }
          return connection;
        }),
    };
  }),
);
