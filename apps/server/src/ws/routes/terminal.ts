import { Effect, Queue, Stream } from "effect";

import { type TerminalEvent, WS_METHODS } from "@fenrir/contracts";

import { LocalServerDiscovery } from "../../localServers/Services/LocalServerDiscovery";
import { TerminalBackend } from "../../terminal/Services/Backend";
import { TerminalManager } from "../../terminal/Services/Manager";
import { makeControlPlaneDomain } from "../controlPlane";

export const makeTerminalRoutes = Effect.gen(function* () {
  const terminalBackend = yield* TerminalBackend;
  const terminalManager = yield* TerminalManager;
  const localServerDiscovery = yield* LocalServerDiscovery;

  const terminal = makeControlPlaneDomain("terminal");
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
      terminalBackend.detachTmux(input),
    ),

    [WS_METHODS.terminalWriteTmux]: terminal.effect(WS_METHODS.terminalWriteTmux, (input) =>
      terminalBackend.writeTmux(input),
    ),

    [WS_METHODS.terminalResizeTmux]: terminal.effect(WS_METHODS.terminalResizeTmux, (input) =>
      terminalBackend.resizeTmux(input),
    ),

    [WS_METHODS.terminalAttachTmux]: terminal.effect(WS_METHODS.terminalAttachTmux, (input) =>
      terminalBackend.attachTmux(input),
    ),

    [WS_METHODS.terminalOpen]: terminal.effect(WS_METHODS.terminalOpen, (input) =>
      terminalBackend.open(input).pipe(
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
      terminalBackend.write(input),
    ),
    [WS_METHODS.terminalResize]: terminal.effect(WS_METHODS.terminalResize, (input) =>
      terminalBackend.resize(input),
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
      terminalBackend.close(input).pipe(
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
