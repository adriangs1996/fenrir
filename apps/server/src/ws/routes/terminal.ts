import { Effect, Queue, Stream } from "effect";

import { type TerminalEvent, TmuxError, WS_METHODS } from "@fenrir/contracts";

import { LocalServerDiscovery } from "../../localServers/Services/LocalServerDiscovery";
import { TerminalManager } from "../../terminal/Services/Manager";
import { TmuxSessionManager } from "../../terminal/Services/TmuxSessionManager";
import { makeRpcDomain } from "../handlers";

export const makeTerminalRoutes = Effect.gen(function* () {
  const terminalManager = yield* TerminalManager;
  const tmuxSessionManager = yield* TmuxSessionManager;
  const localServerDiscovery = yield* LocalServerDiscovery;
  const activeTmuxProcesses = new Map<string, { pid: number }>();

  const terminal = makeRpcDomain("terminal");
  const syncTerminalOwner = (event: TerminalEvent) => {
    switch (event.type) {
      case "started":
      case "restarted": {
        const pid = event.snapshot.pid;
        if (pid === null) {
          return localServerDiscovery.unregisterTerminal({
            threadId: event.threadId,
            terminalId: event.terminalId,
          });
        }
        return localServerDiscovery.registerTerminalProcesses({
          threadId: event.threadId,
          terminalId: event.terminalId,
          processIds: [pid],
        });
      }
      case "exited":
      case "error":
        return localServerDiscovery.unregisterTerminal({
          threadId: event.threadId,
          terminalId: event.terminalId,
        });
      case "activity":
      case "cleared":
      case "output":
        return Effect.void;
    }
  };

  return {
    [WS_METHODS.terminalDetachTmux]: terminal.effect(WS_METHODS.terminalDetachTmux, (input) =>
      Effect.gen(function* () {
        // Clear active process ref BEFORE detach so the stale guard
        // suppresses the exit event from the killed process.
        activeTmuxProcesses.delete(input.projectId);
        yield* tmuxSessionManager.detachSession(input.projectId);
      }).pipe(
        Effect.mapError(
          (err) =>
            new TmuxError({
              message: err.message ?? "Tmux detach failed",
            }),
        ),
      ),
    ),

    [WS_METHODS.terminalWriteTmux]: terminal.effect(WS_METHODS.terminalWriteTmux, (input) =>
      tmuxSessionManager.writeToSession(input.projectId, input.data).pipe(
        Effect.mapError(
          (err) =>
            new TmuxError({
              message: err.message ?? "Tmux write failed",
            }),
        ),
      ),
    ),

    [WS_METHODS.terminalResizeTmux]: terminal.effect(WS_METHODS.terminalResizeTmux, (input) =>
      tmuxSessionManager.resizeSession(input.projectId, input.cols, input.rows).pipe(
        Effect.mapError(
          (err) =>
            new TmuxError({
              message: err.message ?? "Tmux resize failed",
            }),
        ),
      ),
    ),

    [WS_METHODS.terminalAttachTmux]: terminal.effect(WS_METHODS.terminalAttachTmux, (input) =>
      Effect.gen(function* () {
        const services = yield* Effect.context<never>();
        const runFork = Effect.runForkWith(services);

        const exists = yield* tmuxSessionManager.hasSession(input.projectId);
        if (!exists) {
          yield* tmuxSessionManager.createSession(input.projectId, input.cwd);
        }

        const ptyProcess = yield* tmuxSessionManager.attachSession(
          input.projectId,
          input.cols,
          input.rows,
        );

        // Track active process so stale handlers become no-ops
        const processRef = { pid: ptyProcess.pid };
        activeTmuxProcesses.set(input.projectId, processRef);

        // Wire the PTY output to the Terminal Manager event bus
        ptyProcess.onData((data) => {
          if (activeTmuxProcesses.get(input.projectId) !== processRef) return;
          runFork(terminalManager.publishTmuxOutput(input.projectId, data));
        });

        ptyProcess.onExit((event) => {
          if (activeTmuxProcesses.get(input.projectId) !== processRef) return;
          activeTmuxProcesses.delete(input.projectId);
          runFork(
            terminalManager.publishTmuxExit(input.projectId, event.exitCode, event.signal ?? null),
          );
        });

        return {
          projectId: input.projectId,
          sessionName: tmuxSessionManager.sessionName(input.projectId),
          pid: ptyProcess.pid,
        };
      }).pipe(
        Effect.mapError(
          (err) =>
            new TmuxError({
              message: err.message ?? "Tmux operation failed",
            }),
        ),
      ),
    ),

    [WS_METHODS.terminalOpen]: terminal.effect(WS_METHODS.terminalOpen, (input) =>
      terminalManager.open(input).pipe(
        Effect.tap((snapshot) =>
          snapshot.pid === null
            ? localServerDiscovery.unregisterTerminal({
                threadId: snapshot.threadId,
                terminalId: snapshot.terminalId,
              })
            : localServerDiscovery.registerTerminalProcesses({
                threadId: snapshot.threadId,
                terminalId: snapshot.terminalId,
                processIds: [snapshot.pid],
              }),
        ),
      ),
    ),
    [WS_METHODS.terminalWrite]: terminal.effect(WS_METHODS.terminalWrite, (input) =>
      terminalManager.write(input),
    ),
    [WS_METHODS.terminalResize]: terminal.effect(WS_METHODS.terminalResize, (input) =>
      terminalManager.resize(input),
    ),
    [WS_METHODS.terminalClear]: terminal.effect(WS_METHODS.terminalClear, (input) =>
      terminalManager.clear(input),
    ),
    [WS_METHODS.terminalRestart]: terminal.effect(WS_METHODS.terminalRestart, (input) =>
      terminalManager.restart(input).pipe(
        Effect.tap((snapshot) =>
          snapshot.pid === null
            ? localServerDiscovery.unregisterTerminal({
                threadId: snapshot.threadId,
                terminalId: snapshot.terminalId,
              })
            : localServerDiscovery.registerTerminalProcesses({
                threadId: snapshot.threadId,
                terminalId: snapshot.terminalId,
                processIds: [snapshot.pid],
              }),
        ),
      ),
    ),
    [WS_METHODS.terminalClose]: terminal.effect(WS_METHODS.terminalClose, (input) =>
      terminalManager.close(input).pipe(
        Effect.tap(() =>
          input.terminalId
            ? localServerDiscovery.unregisterTerminal({
                threadId: input.threadId,
                terminalId: input.terminalId,
              })
            : localServerDiscovery.unregisterThread({ threadId: input.threadId }),
        ),
      ),
    ),
    [WS_METHODS.subscribeTerminalEvents]: terminal.stream(
      WS_METHODS.subscribeTerminalEvents,
      (_input) =>
        Stream.callback<TerminalEvent>((queue) =>
          Effect.acquireRelease(
            terminalManager.subscribe((event) =>
              syncTerminalOwner(event).pipe(
                Effect.catchCause(() => Effect.void),
                Effect.andThen(Queue.offer(queue, event)),
              ),
            ),
            (unsubscribe) => Effect.sync(unsubscribe),
          ),
        ),
    ),
  };
});
