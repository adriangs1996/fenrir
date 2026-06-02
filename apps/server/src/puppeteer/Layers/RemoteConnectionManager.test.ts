import { it } from "@effect/vitest";
import { Effect, Exit, Stream } from "effect";
import { describe, expect } from "vitest";

import {
  executeRemoteCommand,
  RemoteConnectionManager,
  RemoteConnectionManagerLive,
  type RemoteConnection,
  type RemoteConnectionError,
  type RemoteExecutionResult,
  type RemoteExecutionRequest,
  type RemoteExit,
  type RemoteOutputChunk,
  type RemoteProcess,
} from "./RemoteConnectionManager";

interface RemoteExecutionRequestWithCommandCoreOptions extends RemoteExecutionRequest {
  readonly timeoutMs?: number;
  readonly outputBytesLimit?: number;
}

interface RemoteExecutionResultWithCommandCoreMetadata extends RemoteExecutionResult {
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly outputTruncated: boolean;
}

class FakeRemoteProcess implements RemoteProcess {
  readonly writes: string[] = [];
  readonly killSignals: Array<string | undefined> = [];
  closeInputCount = 0;

  readonly output: Stream.Stream<RemoteOutputChunk>;
  readonly exit: Effect.Effect<RemoteExit, RemoteConnectionError>;

  constructor(
    readonly id: string,
    output: ReadonlyArray<RemoteOutputChunk>,
    exit: RemoteExit | Effect.Effect<RemoteExit, RemoteConnectionError> = {
      exitCode: 0,
      signal: null,
    },
  ) {
    this.output = Stream.fromIterable(output);
    this.exit = Effect.isEffect(exit) ? exit : Effect.succeed(exit);
  }

  write(input: string): Effect.Effect<void> {
    this.writes.push(input);
    return Effect.void;
  }

  closeInput: Effect.Effect<void> = Effect.sync(() => {
    this.closeInputCount += 1;
  });

  kill(signal?: string): Effect.Effect<void> {
    this.killSignals.push(signal);
    return Effect.void;
  }
}

class FakeRemoteConnection implements RemoteConnection {
  readonly id = "connection-1";
  readonly spawnRequests: RemoteExecutionRequest[] = [];
  readonly processes: FakeRemoteProcess[] = [];
  private nextProcess: FakeRemoteProcess;

  constructor(process: FakeRemoteProcess) {
    this.nextProcess = process;
  }

  spawn(request: RemoteExecutionRequest): Effect.Effect<RemoteProcess> {
    this.spawnRequests.push(request);
    this.processes.push(this.nextProcess);
    return Effect.succeed(this.nextProcess);
  }

  close: Effect.Effect<void> = Effect.void;
}

describe("RemoteConnection", () => {
  it.effect("starts a command-template connection and resolves it by connection id", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return;

      const manager = yield* RemoteConnectionManager;
      const handle = yield* manager.startConnection({
        connectionId: "local-shell" as never,
        label: "Local shell template",
        transport: {
          type: "command-template",
          command: "sh",
          args: ["-lc", "{command}"],
        },
      });
      const connection = yield* manager.getConnection(handle.connectionId);
      const result = yield* executeRemoteCommand(connection, {
        command: "printf 'remote-output'",
      });

      expect(handle).toMatchObject({
        connectionId: "local-shell",
        label: "Local shell template",
        transportType: "command-template",
        status: "connected",
      });
      expect(handle.startedAt).toEqual(expect.any(String));
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("remote-output");
    }).pipe(Effect.provide(RemoteConnectionManagerLive)),
  );

  it.effect("rejects duplicate started connection ids", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return;

      const manager = yield* RemoteConnectionManager;
      yield* manager.startConnection({
        connectionId: "duplicate-connection" as never,
        label: "Duplicate shell",
        transport: {
          type: "command-template",
          command: "sh",
          args: ["-lc", "{command}"],
        },
      });

      const error = yield* manager
        .startConnection({
          connectionId: "duplicate-connection" as never,
          label: "Duplicate shell",
          transport: {
            type: "command-template",
            command: "sh",
            args: ["-lc", "{command}"],
          },
        })
        .pipe(Effect.flip);

      expect(error._tag).toBe("RemoteConnectionError");
      expect(error.message).toBe("Remote connection duplicate-connection already exists.");
    }).pipe(Effect.provide(RemoteConnectionManagerLive)),
  );

  it.effect("executes one-off remote commands by collecting output and exit status", () =>
    Effect.gen(function* () {
      const process = new FakeRemoteProcess(
        "process-1",
        [
          { stream: "stdout", data: "out\n" },
          { stream: "stderr", data: "err\n" },
        ],
        { exitCode: 7, signal: null },
      );
      const connection = new FakeRemoteConnection(process);
      const request = {
        command: "ssh",
        args: ["host.example", "sh", "-lc", "echo out; echo err >&2; exit 7"],
        stdin: "input\n",
      } satisfies RemoteExecutionRequest;

      const result = yield* executeRemoteCommand(connection, request);

      expect(connection.spawnRequests).toEqual([request]);
      expect(process.writes).toEqual(["input\n"]);
      expect(process.closeInputCount).toBe(1);
      expect(result).toMatchObject({
        exitCode: 7,
        signal: null,
        stdout: "out\n",
        stderr: "err\n",
        combinedOutput: "out\nerr\n",
      });
      expect(result.output).toEqual([
        { stream: "stdout", data: "out\n" },
        { stream: "stderr", data: "err\n" },
      ]);
    }),
  );

  it.effect("preserves PTY output separately from stdout and stderr", () =>
    Effect.gen(function* () {
      const process = new FakeRemoteProcess("process-pty", [
        { stream: "pty", data: "$ " },
        { stream: "pty", data: "echo hi\r\nhi\r\n$ " },
      ]);
      const connection = new FakeRemoteConnection(process);

      const result = yield* executeRemoteCommand(connection, {
        command: "ssh",
        args: ["host.example"],
        tty: true,
      });

      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(result.combinedOutput).toBe("$ echo hi\r\nhi\r\n$ ");
      expect(result.output).toEqual([
        { stream: "pty", data: "$ " },
        { stream: "pty", data: "echo hi\r\nhi\r\n$ " },
      ]);
    }),
  );

  it.effect("exposes spawned processes as writable streams for long-lived sessions", () =>
    Effect.gen(function* () {
      const process = new FakeRemoteProcess("interactive-1", [{ stream: "pty", data: "ready\n" }]);
      const connection = new FakeRemoteConnection(process);

      const spawned = yield* connection.spawn({
        command: "ssh",
        args: ["host.example"],
        tty: true,
      });
      yield* spawned.write("ls\n");

      const output = yield* spawned.output.pipe(Stream.runCollect);

      expect(process.writes).toEqual(["ls\n"]);
      expect(process.closeInputCount).toBe(0);
      expect(Array.from(output)).toEqual([{ stream: "pty", data: "ready\n" }]);
    }),
  );

  describe("command core", () => {
    it.effect(
      "treats non-zero command exit as a completed result instead of transport failure",
      () =>
        Effect.gen(function* () {
          const process = new FakeRemoteProcess(
            "failed-command",
            [
              { stream: "stdout", data: "partial output\n" },
              { stream: "stderr", data: "permission denied\n" },
            ],
            { exitCode: 126, signal: null },
          );
          const connection = new FakeRemoteConnection(process);

          const exit = yield* executeRemoteCommand(connection, {
            command: "cat /root/flag.txt",
          }).pipe(Effect.exit);

          expect(Exit.isSuccess(exit)).toBe(true);
          if (Exit.isSuccess(exit)) {
            expect(exit.value).toMatchObject({
              exitCode: 126,
              signal: null,
              stdout: "partial output\n",
              stderr: "permission denied\n",
            });
          }
        }),
    );

    it.effect("times out a one-off command that never exits and attempts to kill it", () =>
      Effect.gen(function* () {
        const process = new FakeRemoteProcess(
          "hung-command",
          [],
          Effect.promise(
            () =>
              new Promise<RemoteExit>((resolve) => {
                setTimeout(() => {
                  resolve({ exitCode: 0, signal: null });
                }, 30);
              }),
          ),
        );
        const connection = new FakeRemoteConnection(process);
        const request = {
          command: "sleep 999999",
          timeoutMs: 10,
        } satisfies RemoteExecutionRequestWithCommandCoreOptions;

        const exit = yield* executeRemoteCommand(connection, request).pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
        expect(process.killSignals.length).toBeGreaterThan(0);
      }),
    );

    it.effect("caps collected command output and records truncation metadata", () =>
      Effect.gen(function* () {
        const process = new FakeRemoteProcess("chatty-command", [
          { stream: "stdout", data: "abcdef" },
          { stream: "stderr", data: "uvwxyz" },
        ]);
        const connection = new FakeRemoteConnection(process);
        const request = {
          command: "cat very-large-file",
          outputBytesLimit: 4,
        } satisfies RemoteExecutionRequestWithCommandCoreOptions;

        const result = (yield* executeRemoteCommand(
          connection,
          request,
        )) as RemoteExecutionResultWithCommandCoreMetadata;

        expect(result.stdout).toBe("abcd");
        expect(result.stderr).toBe("uvwx");
        expect(result.combinedOutput).toBe("abcduvwx");
        expect(result.stdoutTruncated).toBe(true);
        expect(result.stderrTruncated).toBe(true);
        expect(result.outputTruncated).toBe(true);
      }),
    );

    it.effect("preserves shell-style command strings without argv splitting", () =>
      Effect.gen(function* () {
        const process = new FakeRemoteProcess("rce-command", []);
        const connection = new FakeRemoteConnection(process);
        const request = {
          command: "printf '%s\\n' \"$USER\" && id",
        } satisfies RemoteExecutionRequest;

        yield* executeRemoteCommand(connection, request);

        expect(connection.spawnRequests).toEqual([request]);
      }),
    );
  });
});
