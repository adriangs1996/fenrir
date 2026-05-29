import { assert, describe, expect, it } from "@effect/vitest";
import {
  PtyAdapter,
  PtyAdapterShape,
  PtyExitEvent,
  PtyProcess,
  PtySpawnError,
  PtySpawnInput,
} from "../Services/PTY";
import { Effect, Layer } from "effect";
import { TmuxSessionManager } from "../Services/TmuxSessionManager";
import { TmuxSessionManagerLive } from "../Layers/TmuxSessionManager";

class FakeTmuxPtyProcess implements PtyProcess {
  readonly writes: string[] = [];
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: PtyExitEvent) => void>();

  constructor(
    readonly pid: number,
    private readonly exitCode: number = 0,
  ) {
    queueMicrotask(() => {
      for (const listener of this.exitListeners) {
        listener({ exitCode: this.exitCode, signal: null });
      }
    });
  }

  write(data: string): void {
    this.writes.push(data);
  }

  resize(_cols: number, _rows: number): void {}

  kill(_signal?: string): void {}

  onData(callback: (data: string) => void): () => void {
    this.dataListeners.add(callback);
    return () => this.dataListeners.delete(callback);
  }

  onExit(callback: (event: PtyExitEvent) => void): () => void {
    this.exitListeners.add(callback);
    return () => this.exitListeners.delete(callback);
  }
}

class FakeTmuxPtyAdapter implements PtyAdapterShape {
  readonly spawnCalls: PtySpawnInput[] = [];
  readonly processes: FakeTmuxPtyProcess[] = [];
  private nextPid = 1000;
  // Map of tmux subcommand → exit code (default 0)
  exitCodeBySubcommand = new Map<string, number>();

  spawn(input: PtySpawnInput): Effect.Effect<PtyProcess, PtySpawnError> {
    this.spawnCalls.push(input);
    const subcommand = input.args?.[0] ?? "";
    const exitCode = this.exitCodeBySubcommand.get(subcommand) ?? 0;
    const process = new FakeTmuxPtyProcess(this.nextPid++, exitCode);
    this.processes.push(process);
    return Effect.succeed(process);
  }
}
describe("TmuxSessionManager", () => {
  const makeFakeLayer = (adapter?: FakeTmuxPtyAdapter) => {
    const ptyAdapter = adapter ?? new FakeTmuxPtyAdapter();
    const TestLayer = TmuxSessionManagerLive.pipe(
      Layer.provide(Layer.succeed(PtyAdapter, ptyAdapter)),
    );
    return { ptyAdapter, TestLayer };
  };

  it.effect("sessionName returns t3-prefixed name", () => {
    const { TestLayer } = makeFakeLayer();
    return Effect.gen(function* () {
      const manager = yield* TmuxSessionManager;
      assert.strictEqual(manager.sessionName("abc-123"), "fenrir-abc-123");
    }).pipe(Effect.provide(TestLayer));
  });

  it.effect("sessionName sanitizes dots and colons", () => {
    const { TestLayer } = makeFakeLayer();
    return Effect.gen(function* () {
      const manager = yield* TmuxSessionManager;
      const name = manager.sessionName("my.project:v2");
      expect(name).not.toContain(".");
      expect(name).not.toContain(":");
      assert.strictEqual(name, "fenrir-my-project-v2");
    }).pipe(Effect.provide(TestLayer));
  });

  it.effect("createSession spawns tmux new-session with correct args", () => {
    const ptyAdapter = new FakeTmuxPtyAdapter();
    const { TestLayer } = makeFakeLayer(ptyAdapter);

    return Effect.gen(function* () {
      const manager = yield* TmuxSessionManager;
      yield* manager.createSession("proj-1", "/home/user/project");
      expect(ptyAdapter.spawnCalls).toHaveLength(1);
      const call = ptyAdapter.spawnCalls[0]!;
      expect(call.shell).toBe("tmux");
      expect(call.args).toEqual([
        "new-session",
        "-d",
        "-s",
        "fenrir-proj-1",
        "-c",
        "/home/user/project",
      ]);
    }).pipe(Effect.provide(TestLayer));
  });

  it.effect("createSession succeeds when new-session loses a creation race", () => {
    const ptyAdapter = new FakeTmuxPtyAdapter();
    const { TestLayer } = makeFakeLayer(ptyAdapter);

    return Effect.gen(function* () {
      ptyAdapter.exitCodeBySubcommand.set("new-session", 1);
      const manager = yield* TmuxSessionManager;

      yield* manager.createSession("proj-1", "/tmp");

      expect(ptyAdapter.spawnCalls.map((call) => call.args?.[0])).toEqual([
        "new-session",
        "has-session",
      ]);
    }).pipe(Effect.provide(TestLayer));
  });

  it.effect("createSession fails when tmux exits non-zero", () => {
    const ptyAdapter = new FakeTmuxPtyAdapter();
    const { TestLayer } = makeFakeLayer(ptyAdapter);

    return Effect.gen(function* () {
      ptyAdapter.exitCodeBySubcommand.set("new-session", 1);
      ptyAdapter.exitCodeBySubcommand.set("has-session", 1);
      const manager = yield* TmuxSessionManager;

      const result = yield* Effect.exit(manager.createSession("proj-1", "/tmp"));
      assert.strictEqual(result._tag, "Failure");
    }).pipe(Effect.provide(TestLayer));
  });

  it.effect("hasSession returns true when tmux has-session exits 0", () => {
    const ptyAdapter = new FakeTmuxPtyAdapter();
    const { TestLayer } = makeFakeLayer(ptyAdapter);

    return Effect.gen(function* () {
      const manager = yield* TmuxSessionManager;

      const exists = yield* manager.hasSession("proj-1");
      assert.isTrue(exists);

      const call = ptyAdapter.spawnCalls[0]!;
      expect(call.args).toEqual(["has-session", "-t", "fenrir-proj-1"]);
    }).pipe(Effect.provide(TestLayer));
  });

  it.effect("hasSession returns false when tmux has-session exits non-zero", () => {
    const ptyAdapter = new FakeTmuxPtyAdapter();
    const { TestLayer } = makeFakeLayer(ptyAdapter);

    return Effect.gen(function* () {
      ptyAdapter.exitCodeBySubcommand.set("has-session", 1);
      const manager = yield* TmuxSessionManager;

      const exists = yield* manager.hasSession("proj-1");
      assert.isFalse(exists);
    }).pipe(Effect.provide(TestLayer));
  });

  it.effect("isTmuxAvailable returns true when tmux -V exits 0", () => {
    const ptyAdapter = new FakeTmuxPtyAdapter();
    const { TestLayer } = makeFakeLayer(ptyAdapter);

    return Effect.gen(function* () {
      const manager = yield* TmuxSessionManager;

      const available = yield* manager.isTmuxAvailable;
      assert.isTrue(available);
    }).pipe(Effect.provide(TestLayer));
  });

  it.effect("isTmuxAvailable returns true when tmux -V exits 0", () => {
    const ptyAdapter = new FakeTmuxPtyAdapter();
    const { TestLayer } = makeFakeLayer(ptyAdapter);

    return Effect.gen(function* () {
      const manager = yield* TmuxSessionManager;

      const available = yield* manager.isTmuxAvailable;
      assert.isTrue(available);
    }).pipe(Effect.provide(TestLayer));
  });
});
