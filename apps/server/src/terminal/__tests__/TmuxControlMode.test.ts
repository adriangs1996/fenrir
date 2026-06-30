import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";

import {
  decodeTmuxControlString,
  EMPTY_TMUX_CONTROL_MODE_PARSE_STATE,
  parseTmuxControlModeChunk,
  parseTmuxControlModeLine,
  quoteTmuxCommandArg,
  serializeTmuxControlCommand,
  TmuxControlModeAdapterLive,
} from "../Layers/TmuxControlMode";
import {
  PtyAdapter,
  PtyAdapterShape,
  PtyExitEvent,
  PtyProcess,
  PtySpawnInput,
  PtySpawnError,
} from "../Services/PTY";
import { TmuxControlModeAdapter, TmuxControlModeEvent } from "../Services/TmuxControlMode";

class FakeControlModePtyProcess implements PtyProcess {
  readonly writes: string[] = [];
  readonly kills: Array<string | undefined> = [];
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: PtyExitEvent) => void>();

  constructor(readonly pid: number) {}

  write(data: string): void {
    this.writes.push(data);
  }

  resize(_cols: number, _rows: number): void {}

  kill(signal?: string): void {
    this.kills.push(signal);
  }

  onData(callback: (data: string) => void): () => void {
    this.dataListeners.add(callback);
    return () => this.dataListeners.delete(callback);
  }

  onExit(callback: (event: PtyExitEvent) => void): () => void {
    this.exitListeners.add(callback);
    return () => this.exitListeners.delete(callback);
  }

  emitData(data: string): void {
    for (const listener of this.dataListeners) {
      listener(data);
    }
  }

  emitExit(event: PtyExitEvent): void {
    for (const listener of this.exitListeners) {
      listener(event);
    }
  }
}

class FakeControlModePtyAdapter implements PtyAdapterShape {
  readonly spawnCalls: PtySpawnInput[] = [];
  readonly processes: FakeControlModePtyProcess[] = [];
  readonly spawnFailures: Error[] = [];
  private nextPid = 2000;

  spawn(input: PtySpawnInput): Effect.Effect<PtyProcess, PtySpawnError> {
    this.spawnCalls.push(input);
    const failure = this.spawnFailures.shift();
    if (failure) {
      return Effect.fail(
        new PtySpawnError({
          adapter: "fake",
          message: failure.message,
          cause: failure,
        }),
      );
    }
    const process = new FakeControlModePtyProcess(this.nextPid++);
    this.processes.push(process);
    return Effect.succeed(process);
  }
}

function makeTestLayer(adapter = new FakeControlModePtyAdapter()) {
  return {
    adapter,
    layer: TmuxControlModeAdapterLive.pipe(Layer.provide(Layer.succeed(PtyAdapter, adapter))),
  };
}

describe("tmux control-mode parser", () => {
  it("decodes tmux escaped output strings", () => {
    expect(decodeTmuxControlString("hello\\sworld\\012\\033[31mred")).toBe(
      "hello world\n\u001b[31mred",
    );
  });

  it("serializes commands with shell-safe tmux arguments", () => {
    expect(quoteTmuxCommandArg("plain-arg")).toBe("plain-arg");
    expect(quoteTmuxCommandArg("two words")).toBe("'two words'");
    expect(quoteTmuxCommandArg("line one\nline two")).toBe('"line one\\012line two"');
    expect(serializeTmuxControlCommand({ command: "new-window", args: ["-n", "dev server"] })).toBe(
      "new-window -n 'dev server'",
    );
  });

  it("parses command responses and useful lifecycle notifications", () => {
    expect(parseTmuxControlModeLine("%begin 100 7 1")).toEqual({
      type: "command-begin",
      timestamp: "100",
      commandId: "7",
      flags: "1",
    });
    expect(parseTmuxControlModeLine("%end 101 7 1")).toEqual({
      type: "command-end",
      timestamp: "101",
      commandId: "7",
      flags: "1",
    });
    expect(parseTmuxControlModeLine("%error 102 8 1 no\\ssuch\\swindow")).toEqual({
      type: "command-error",
      timestamp: "102",
      commandId: "8",
      flags: "1",
      message: "no such window",
    });
    expect(parseTmuxControlModeLine("%window-add @3")).toEqual({
      type: "window-add",
      windowId: "@3",
    });
    expect(parseTmuxControlModeLine("%window-renamed @3 dev\\sserver")).toEqual({
      type: "window-renamed",
      windowId: "@3",
      name: "dev server",
    });
    expect(parseTmuxControlModeLine("%layout-change @3 layout visible *")).toEqual({
      type: "layout-change",
      windowId: "@3",
      layout: "layout",
      visibleLayout: "visible",
      flags: "*",
    });
    expect(parseTmuxControlModeLine("%pane-mode-changed %4 copy-mode")).toEqual({
      type: "pane-mode-changed",
      paneId: "%4",
      mode: "copy-mode",
    });
    expect(parseTmuxControlModeLine("%session-changed $1 fenrir-project")).toEqual({
      type: "session-changed",
      sessionId: "$1",
      name: "fenrir-project",
    });
  });

  it("parses pane output without mixing it into orchestration contracts", () => {
    expect(parseTmuxControlModeLine("%output %4 hello\\012")).toEqual({
      type: "pane-output",
      paneId: "%4",
      data: "hello\n",
    });
    expect(parseTmuxControlModeLine("%extended-output %4 12 : later\\012")).toEqual({
      type: "pane-extended-output",
      paneId: "%4",
      age: 12,
      data: "later\n",
    });
  });

  it("buffers partial control-mode chunks", () => {
    const first = parseTmuxControlModeChunk(
      "%window-add @1\n%window-close",
      EMPTY_TMUX_CONTROL_MODE_PARSE_STATE,
    );
    expect(first.events).toEqual([{ type: "window-add", windowId: "@1" }]);
    expect(first.state.bufferedLine).toBe("%window-close");

    const second = parseTmuxControlModeChunk(" @1\n", first.state);
    expect(second.events).toEqual([{ type: "window-close", windowId: "@1" }]);
    expect(second.state.bufferedLine).toBe("");
  });
});

describe("TmuxControlModeAdapterLive", () => {
  it.effect("spawns tmux -C new-session -A when createIfMissing is requested", () => {
    const { adapter, layer } = makeTestLayer();

    return Effect.gen(function* () {
      const control = yield* TmuxControlModeAdapter;
      const connection = yield* control.connect({
        sessionName: "fenrir-proj-1",
        cwd: "/tmp/project",
        createIfMissing: true,
      });

      expect(yield* connection.pid).toBe(2000);
      expect(yield* connection.status).toBe("running");
      expect(adapter.spawnCalls[0]).toMatchObject({
        shell: "tmux",
        args: ["-C", "new-session", "-A", "-s", "fenrir-proj-1", "-c", "/tmp/project"],
        cwd: "/tmp/project",
        cols: 120,
        rows: 40,
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("fails initial connect when tmux control-mode cannot spawn", () => {
    const { adapter, layer } = makeTestLayer();
    adapter.spawnFailures.push(new Error("tmux executable unavailable"));

    return Effect.gen(function* () {
      const control = yield* TmuxControlModeAdapter;
      const result = yield* Effect.exit(
        control.connect({
          sessionName: "fenrir-proj-1",
          cwd: "/tmp/project",
        }),
      );

      expect(result._tag).toBe("Failure");
      expect(adapter.spawnCalls).toHaveLength(1);
      expect(adapter.processes).toHaveLength(0);
    }).pipe(Effect.provide(layer));
  });

  it.effect("writes serialized commands and waits for tmux command end", () => {
    const { adapter, layer } = makeTestLayer();

    return Effect.gen(function* () {
      const control = yield* TmuxControlModeAdapter;
      const connection = yield* control.connect({
        sessionName: "fenrir-proj-1",
        cwd: "/tmp/project",
      });

      yield* Effect.sync(() => {
        setTimeout(() => adapter.processes[0]?.emitData("%begin 100 1 1\n%end 101 1 1\n"), 10);
      });
      yield* connection.command({
        command: "split-window",
        args: ["-h", "-c", "/tmp/project"],
      });

      expect(adapter.spawnCalls[0]?.args).toEqual(["-C", "attach-session", "-t", "fenrir-proj-1"]);
      expect(adapter.processes[0]?.writes).toEqual(["split-window -h -c /tmp/project\n"]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("fails commands when tmux returns a correlated command error", () => {
    const { adapter, layer } = makeTestLayer();

    return Effect.gen(function* () {
      const control = yield* TmuxControlModeAdapter;
      const connection = yield* control.connect({
        sessionName: "fenrir-proj-1",
        cwd: "/tmp/project",
      });

      yield* Effect.sync(() => {
        setTimeout(
          () => adapter.processes[0]?.emitData("%begin 100 2 1\n%error 101 2 1 no\\ssuch\\spane\n"),
          10,
        );
      });
      const result = yield* Effect.exit(
        connection.command({ command: "send-keys", args: ["-t", "%missing", "Enter"] }),
      );

      expect(adapter.processes[0]?.writes).toEqual(["send-keys -t %missing Enter\n"]);
      expect(result._tag).toBe("Failure");
    }).pipe(Effect.provide(layer));
  });

  it.effect("ignores late stale command responses before the next command begin", () => {
    const { adapter, layer } = makeTestLayer();

    return Effect.gen(function* () {
      const eventsRef = yield* Ref.make<ReadonlyArray<TmuxControlModeEvent>>([]);
      const control = yield* TmuxControlModeAdapter;
      const connection = yield* control.connect({
        sessionName: "fenrir-proj-1",
        cwd: "/tmp/project",
      });
      yield* connection.subscribe((event) => Ref.update(eventsRef, (events) => [...events, event]));

      const timedOut = yield* connection
        .command({ command: "display-message", args: ["first"] })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      adapter.processes[0]?.emitData("%begin 100 1 1\n");
      yield* Effect.yieldNow;
      yield* TestClock.adjust("5 seconds");
      const timeoutResult = yield* Effect.exit(Fiber.join(timedOut));

      expect(timeoutResult._tag).toBe("Failure");

      const second = yield* connection
        .command({ command: "display-message", args: ["second"] })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      adapter.processes[0]?.emitData("%end 101 1 1\n");
      yield* Effect.yieldNow;
      expect(second.pollUnsafe()).toBeUndefined();

      adapter.processes[0]?.emitData("%begin 102 2 1\n%end 103 2 1\n");
      const secondResult = yield* Effect.exit(Fiber.join(second));
      expect(secondResult._tag).toBe("Success");

      const events = yield* Ref.get(eventsRef);
      expect(adapter.processes[0]?.writes).toEqual([
        "display-message first\n",
        "display-message second\n",
      ]);
      expect(events).toContainEqual({
        type: "command-begin",
        timestamp: "102",
        commandId: "2",
        flags: "1",
      });
      expect(events).toContainEqual({
        type: "command-end",
        timestamp: "103",
        commandId: "2",
        flags: "1",
      });
    }).pipe(Effect.provide(Layer.merge(layer, TestClock.layer())));
  });

  it.effect("ignores a delayed stale begin and end before the next command begin", () => {
    const { adapter, layer } = makeTestLayer();

    return Effect.gen(function* () {
      const control = yield* TmuxControlModeAdapter;
      const connection = yield* control.connect({
        sessionName: "fenrir-proj-1",
        cwd: "/tmp/project",
      });

      const timedOut = yield* connection
        .command({ command: "display-message", args: ["first"] })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      yield* TestClock.adjust("5 seconds");
      const timeoutResult = yield* Effect.exit(Fiber.join(timedOut));

      expect(timeoutResult._tag).toBe("Failure");

      const second = yield* connection
        .command({ command: "display-message", args: ["second"] })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      adapter.processes[0]?.emitData("%begin 100 1 1\n%end 101 1 1\n");
      yield* Effect.yieldNow;

      expect(second.pollUnsafe()).toBeUndefined();

      adapter.processes[0]?.emitData("%begin 102 2 1\n%end 103 2 1\n");
      const secondResult = yield* Effect.exit(Fiber.join(second));

      expect(secondResult._tag).toBe("Success");
      expect(adapter.processes[0]?.writes).toEqual([
        "display-message first\n",
        "display-message second\n",
      ]);
    }).pipe(Effect.provide(Layer.merge(layer, TestClock.layer())));
  });

  it.effect("ignores a delayed stale begin and error before the next command begin", () => {
    const { adapter, layer } = makeTestLayer();

    return Effect.gen(function* () {
      const control = yield* TmuxControlModeAdapter;
      const connection = yield* control.connect({
        sessionName: "fenrir-proj-1",
        cwd: "/tmp/project",
      });

      const timedOut = yield* connection
        .command({ command: "display-message", args: ["first"] })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      yield* TestClock.adjust("5 seconds");
      const timeoutResult = yield* Effect.exit(Fiber.join(timedOut));

      expect(timeoutResult._tag).toBe("Failure");

      const second = yield* connection
        .command({ command: "display-message", args: ["second"] })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      adapter.processes[0]?.emitData("%begin 100 1 1\n%error 101 1 1 stale\\sfailure\n");
      yield* Effect.yieldNow;

      expect(second.pollUnsafe()).toBeUndefined();

      adapter.processes[0]?.emitData("%begin 102 2 1\n%end 103 2 1\n");
      const secondResult = yield* Effect.exit(Fiber.join(second));

      expect(secondResult._tag).toBe("Success");
      expect(adapter.processes[0]?.writes).toEqual([
        "display-message first\n",
        "display-message second\n",
      ]);
    }).pipe(Effect.provide(Layer.merge(layer, TestClock.layer())));
  });

  it.effect("accepts the next command after a stale begin arrives while idle", () => {
    const { adapter, layer } = makeTestLayer();

    return Effect.gen(function* () {
      const control = yield* TmuxControlModeAdapter;
      const connection = yield* control.connect({
        sessionName: "fenrir-proj-1",
        cwd: "/tmp/project",
      });

      const timedOut = yield* connection
        .command({ command: "display-message", args: ["first"] })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      yield* TestClock.adjust("5 seconds");
      const timeoutResult = yield* Effect.exit(Fiber.join(timedOut));

      expect(timeoutResult._tag).toBe("Failure");

      adapter.processes[0]?.emitData("%begin 100 1 1\n%end 101 1 1\n");
      yield* Effect.yieldNow;

      const second = yield* connection
        .command({ command: "display-message", args: ["second"] })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      adapter.processes[0]?.emitData("%begin 102 2 1\n%end 103 2 1\n");
      const secondResult = yield* Effect.exit(Fiber.join(second));

      expect(secondResult._tag).toBe("Success");
      expect(adapter.processes[0]?.writes).toEqual([
        "display-message first\n",
        "display-message second\n",
      ]);
    }).pipe(Effect.provide(Layer.merge(layer, TestClock.layer())));
  });

  it.effect("accepts the next command when its begin arrives before a delayed stale begin", () => {
    const { adapter, layer } = makeTestLayer();

    return Effect.gen(function* () {
      const control = yield* TmuxControlModeAdapter;
      const connection = yield* control.connect({
        sessionName: "fenrir-proj-1",
        cwd: "/tmp/project",
      });

      const timedOut = yield* connection
        .command({ command: "display-message", args: ["first"] })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      yield* TestClock.adjust("5 seconds");
      const timeoutResult = yield* Effect.exit(Fiber.join(timedOut));

      expect(timeoutResult._tag).toBe("Failure");

      const second = yield* connection
        .command({ command: "display-message", args: ["second"] })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      adapter.processes[0]?.emitData("%begin 100 2 1\n%end 101 2 1\n");
      const secondResult = yield* Effect.exit(Fiber.join(second));

      expect(secondResult._tag).toBe("Success");

      adapter.processes[0]?.emitData("%begin 102 1 1\n%end 103 1 1\n");
      yield* Effect.yieldNow;

      const third = yield* connection
        .command({ command: "display-message", args: ["third"] })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      adapter.processes[0]?.emitData("%begin 104 3 1\n%end 105 3 1\n");
      const thirdResult = yield* Effect.exit(Fiber.join(third));

      expect(thirdResult._tag).toBe("Success");
      expect(adapter.processes[0]?.writes).toEqual([
        "display-message first\n",
        "display-message second\n",
        "display-message third\n",
      ]);
    }).pipe(Effect.provide(Layer.merge(layer, TestClock.layer())));
  });

  it.effect(
    "does not fail the next command when a delayed stale error arrives after its begin",
    () => {
      const { adapter, layer } = makeTestLayer();

      return Effect.gen(function* () {
        const control = yield* TmuxControlModeAdapter;
        const connection = yield* control.connect({
          sessionName: "fenrir-proj-1",
          cwd: "/tmp/project",
        });

        const timedOut = yield* connection
          .command({ command: "display-message", args: ["first"] })
          .pipe(Effect.forkScoped);
        yield* Effect.yieldNow;
        yield* TestClock.adjust("5 seconds");
        const timeoutResult = yield* Effect.exit(Fiber.join(timedOut));

        expect(timeoutResult._tag).toBe("Failure");

        const second = yield* connection
          .command({ command: "display-message", args: ["second"] })
          .pipe(Effect.forkScoped);
        yield* Effect.yieldNow;

        adapter.processes[0]?.emitData("%begin 100 2 1\n");
        yield* Effect.yieldNow;
        adapter.processes[0]?.emitData("%begin 101 1 1\n%error 102 1 1 stale\\sfailure\n");
        yield* Effect.yieldNow;

        expect(second.pollUnsafe()).toBeUndefined();

        adapter.processes[0]?.emitData("%end 103 2 1\n");
        const secondResult = yield* Effect.exit(Fiber.join(second));

        expect(secondResult._tag).toBe("Success");
        expect(adapter.processes[0]?.writes).toEqual([
          "display-message first\n",
          "display-message second\n",
        ]);
      }).pipe(Effect.provide(Layer.merge(layer, TestClock.layer())));
    },
  );

  it.effect("clears pre-begin timeout correlation state on restart", () => {
    const { adapter, layer } = makeTestLayer();

    return Effect.gen(function* () {
      const control = yield* TmuxControlModeAdapter;
      const connection = yield* control.connect({
        sessionName: "fenrir-proj-1",
        cwd: "/tmp/project",
      });

      const timedOut = yield* connection
        .command({ command: "display-message", args: ["first"] })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      yield* TestClock.adjust("5 seconds");
      const timeoutResult = yield* Effect.exit(Fiber.join(timedOut));

      expect(timeoutResult._tag).toBe("Failure");

      yield* connection.restart;
      expect(adapter.processes).toHaveLength(2);

      const second = yield* connection
        .command({ command: "display-message", args: ["second"] })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      adapter.processes[1]?.emitData("%begin 100 1 1\n%end 101 1 1\n");
      const secondResult = yield* Effect.exit(Fiber.join(second));

      expect(secondResult._tag).toBe("Success");
      expect(adapter.processes[1]?.writes).toEqual(["display-message second\n"]);
    }).pipe(Effect.provide(Layer.merge(layer, TestClock.layer())));
  });

  it.effect("encodes argument line breaks before writing control-mode commands", () => {
    const { adapter, layer } = makeTestLayer();

    return Effect.gen(function* () {
      const control = yield* TmuxControlModeAdapter;
      const connection = yield* control.connect({
        sessionName: "fenrir-proj-1",
        cwd: "/tmp/project",
      });

      yield* Effect.sync(() => {
        setTimeout(() => adapter.processes[0]?.emitData("%begin 100 3 1\n%end 101 3 1\n"), 10);
      });
      yield* connection.command({
        command: "send-keys",
        args: ["-t", "%1", "-l", "echo hello\n"],
      });

      expect(adapter.processes[0]?.writes).toEqual(['send-keys -t %1 -l "echo hello\\012"\n']);
    }).pipe(Effect.provide(layer));
  });

  it.effect("publishes parsed events from process output", () => {
    const { adapter, layer } = makeTestLayer();

    return Effect.gen(function* () {
      const eventsRef = yield* Ref.make<ReadonlyArray<TmuxControlModeEvent>>([]);
      const control = yield* TmuxControlModeAdapter;
      const connection = yield* control.connect({
        sessionName: "fenrir-proj-1",
        cwd: "/tmp/project",
      });
      yield* connection.subscribe((event) => Ref.update(eventsRef, (events) => [...events, event]));

      adapter.processes[0]?.emitData("%window-add @2\n%output %1 hello\\012\n");
      yield* Effect.yieldNow;

      const events = yield* Ref.get(eventsRef);
      expect(events).toContainEqual({ type: "window-add", windowId: "@2" });
      expect(events).toContainEqual({ type: "pane-output", paneId: "%1", data: "hello\n" });
    }).pipe(Effect.provide(layer));
  });

  it.effect("updates status and emits exit events when the control process exits", () => {
    const { adapter, layer } = makeTestLayer();

    return Effect.gen(function* () {
      const eventsRef = yield* Ref.make<ReadonlyArray<TmuxControlModeEvent>>([]);
      const control = yield* TmuxControlModeAdapter;
      const connection = yield* control.connect({
        sessionName: "fenrir-proj-1",
        cwd: "/tmp/project",
      });
      yield* connection.subscribe((event) => Ref.update(eventsRef, (events) => [...events, event]));

      adapter.processes[0]?.emitExit({ exitCode: 1, signal: null });
      yield* Effect.yieldNow;

      expect(yield* connection.status).toBe("exited");
      expect((yield* Ref.get(eventsRef)).some((event) => event.type === "client-exited")).toBe(
        true,
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("restarts by killing the old control process and spawning a new one", () => {
    const { adapter, layer } = makeTestLayer();

    return Effect.gen(function* () {
      const control = yield* TmuxControlModeAdapter;
      const connection = yield* control.connect({
        sessionName: "fenrir-proj-1",
        cwd: "/tmp/project",
      });

      yield* connection.restart;

      expect(adapter.processes).toHaveLength(2);
      expect(adapter.processes[0]?.kills).toHaveLength(1);
      expect(yield* connection.pid).toBe(2001);
      expect(yield* connection.status).toBe("running");

      adapter.processes[0]?.emitExit({ exitCode: 0, signal: null });
      yield* Effect.yieldNow;
      expect(yield* connection.status).toBe("running");
    }).pipe(Effect.provide(layer));
  });

  it.effect("moves to error and ignores stale process callbacks when restart spawn fails", () => {
    const { adapter, layer } = makeTestLayer();

    return Effect.gen(function* () {
      const eventsRef = yield* Ref.make<ReadonlyArray<TmuxControlModeEvent>>([]);
      const control = yield* TmuxControlModeAdapter;
      const connection = yield* control.connect({
        sessionName: "fenrir-proj-1",
        cwd: "/tmp/project",
      });
      yield* connection.subscribe((event) => Ref.update(eventsRef, (events) => [...events, event]));

      adapter.spawnFailures.push(new Error("restart spawn failed"));
      const result = yield* Effect.exit(connection.restart);

      expect(result._tag).toBe("Failure");
      expect(adapter.processes).toHaveLength(1);
      expect(adapter.processes[0]?.kills).toHaveLength(1);
      expect(yield* connection.pid).toBe(0);
      expect(yield* connection.status).toBe("error");

      adapter.processes[0]?.emitData("%window-add @stale\n");
      adapter.processes[0]?.emitExit({ exitCode: 0, signal: null });
      yield* Effect.yieldNow;

      expect(yield* connection.status).toBe("error");
      const events = yield* Ref.get(eventsRef);
      expect(events.some((event) => event.type === "client-restarting")).toBe(true);
      expect(events.some((event) => event.type === "client-error")).toBe(true);
      expect(events).not.toContainEqual({ type: "window-add", windowId: "@stale" });
      expect(events.some((event) => event.type === "client-exited")).toBe(false);
    }).pipe(Effect.provide(layer));
  });
});
