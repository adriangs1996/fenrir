import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { it } from "@effect/vitest";
import { Effect, Fiber, Stream } from "effect";
import { describe, expect } from "vitest";

import {
  executeRemoteCommand,
  RemoteConnectionError,
  type RemoteConnection,
  type RemoteExecutionRequest,
  type RemoteExit,
  type RemoteOutputChunk,
  type RemoteOutputStream,
  type RemoteProcess,
} from "./RemoteConnectionManager";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rceSimulatorPath = path.join(currentDir, "..", "fixtures", "rce-exploit-sim.mjs");

const toRemoteConnectionError = (message: string, cause?: unknown): RemoteConnectionError =>
  new RemoteConnectionError({
    message,
    cause,
  });

const streamOutput = (
  readable: Readable,
  stream: RemoteOutputStream,
): Stream.Stream<RemoteOutputChunk, RemoteConnectionError> =>
  Stream.fromReadableStream({
    evaluate: () => Readable.toWeb(readable) as ReadableStream<Uint8Array>,
    onError: (cause) => toRemoteConnectionError(`Failed to read ${stream}.`, cause),
  }).pipe(
    Stream.map((chunk) => ({
      stream,
      data: Buffer.from(chunk).toString("utf8"),
    })),
  );

class ScriptRceRemoteProcess implements RemoteProcess {
  readonly output: Stream.Stream<RemoteOutputChunk, RemoteConnectionError>;
  readonly exit: Effect.Effect<RemoteExit, RemoteConnectionError>;

  constructor(
    readonly id: string,
    private readonly child: ChildProcessWithoutNullStreams,
  ) {
    this.output = streamOutput(child.stdout, "stdout").pipe(
      Stream.merge(streamOutput(child.stderr, "stderr")),
    );

    this.exit = Effect.tryPromise({
      try: () =>
        new Promise<RemoteExit>((resolve, reject) => {
          child.once("error", reject);
          child.once("exit", (exitCode, signal) => {
            resolve({
              exitCode,
              signal,
            });
          });
        }),
      catch: (cause) => toRemoteConnectionError("RCE process failed.", cause),
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
      catch: (cause) => toRemoteConnectionError("Failed to write RCE process stdin.", cause),
    });
  }

  closeInput: Effect.Effect<void, RemoteConnectionError> = Effect.tryPromise({
    try: () =>
      new Promise<void>((resolve, reject) => {
        this.child.stdin.end((error?: Error | null) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
    catch: (cause) => toRemoteConnectionError("Failed to close RCE process stdin.", cause),
  });

  kill(signal?: string): Effect.Effect<void, RemoteConnectionError> {
    return Effect.sync(() => {
      this.child.kill(signal as NodeJS.Signals | undefined);
    });
  }
}

class ScriptRceRemoteConnection implements RemoteConnection {
  readonly id = "script-rce";
  private nextProcessId = 1;

  constructor(private readonly scriptPath: string) {}

  spawn(request: RemoteExecutionRequest): Effect.Effect<RemoteProcess, RemoteConnectionError> {
    return Effect.try({
      try: () => {
        const child = spawn(process.execPath, [this.scriptPath, request.command], {
          cwd: request.cwd,
          env: {
            ...process.env,
            ...request.env,
          },
          stdio: "pipe",
        });
        return new ScriptRceRemoteProcess(`script-rce-${this.nextProcessId++}`, child);
      },
      catch: (cause) => toRemoteConnectionError("Failed to spawn RCE simulator.", cause),
    });
  }

  close: Effect.Effect<void, RemoteConnectionError> = Effect.void;
}

describe("Script RCE remote connection", () => {
  it.effect("executes shell commands through the exploit simulator script", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return;

      const connection = new ScriptRceRemoteConnection(rceSimulatorPath);

      const result = yield* executeRemoteCommand(connection, {
        command: "printf 'stdout-value'; printf 'stderr-value' >&2",
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("stdout-value");
      expect(result.stderr).toBe("stderr-value");
      expect(result.combinedOutput).toContain("stdout-value");
      expect(result.combinedOutput).toContain("stderr-value");
    }),
  );

  it.effect("writes stdin to a command executed by the exploit simulator script", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return;

      const connection = new ScriptRceRemoteConnection(rceSimulatorPath);

      const result = yield* executeRemoteCommand(connection, {
        command: "cat",
        stdin: "interactive input\n",
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("interactive input\n");
      expect(result.stderr).toBe("");
    }),
  );

  it.effect("exposes the simulator subprocess as a writable RemoteProcess", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return;

      const connection = new ScriptRceRemoteConnection(rceSimulatorPath);
      const remoteProcess = yield* connection.spawn({ command: "cat" });
      const outputFiber = yield* Stream.runCollect(remoteProcess.output).pipe(Effect.forkChild);

      yield* remoteProcess.write("hello from remote process\n");
      yield* remoteProcess.closeInput;

      const exit = yield* remoteProcess.exit;
      const output = yield* Fiber.join(outputFiber);

      expect(exit.exitCode).toBe(0);
      expect(output.map((chunk) => chunk.data).join("")).toBe("hello from remote process\n");
    }),
  );
});
