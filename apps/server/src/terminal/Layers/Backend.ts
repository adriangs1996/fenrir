import { TmuxError } from "@fenrir/contracts";
import { Effect, Layer } from "effect";

import { TerminalBackend, type TerminalBackendShape } from "../Services/Backend";
import { TerminalManager } from "../Services/Manager";
import { TmuxSessionManager } from "../Services/TmuxSessionManager";

function toTmuxError(err: unknown, fallbackMessage: string): TmuxError {
  const message =
    err instanceof Error && typeof err.message === "string" && err.message.length > 0
      ? err.message
      : fallbackMessage;
  return new TmuxError({ message });
}

export const TerminalBackendLive = Layer.effect(
  TerminalBackend,
  Effect.gen(function* () {
    const terminalManager = yield* TerminalManager;
    const tmuxSessionManager = yield* TmuxSessionManager;
    const services = yield* Effect.context<never>();
    const runFork = Effect.runForkWith(services);
    const activeTmuxProcesses = new Map<string, { pid: number }>();

    return {
      open: (input) => terminalManager.open(input),
      write: (input) => terminalManager.write(input),
      resize: (input) => terminalManager.resize(input),
      close: (input) => terminalManager.close(input),

      detachTmux: (input) =>
        Effect.gen(function* () {
          // Clear active process ref BEFORE detach so the stale guard
          // suppresses the exit event from the killed process.
          activeTmuxProcesses.delete(input.projectId);
          yield* tmuxSessionManager.detachSession(input.projectId);
        }).pipe(Effect.mapError((err) => toTmuxError(err, "Tmux detach failed"))),

      writeTmux: (input) =>
        tmuxSessionManager
          .writeToSession(input.projectId, input.data)
          .pipe(Effect.mapError((err) => toTmuxError(err, "Tmux write failed"))),

      resizeTmux: (input) =>
        tmuxSessionManager
          .resizeSession(input.projectId, input.cols, input.rows)
          .pipe(Effect.mapError((err) => toTmuxError(err, "Tmux resize failed"))),

      attachTmux: (input) =>
        Effect.gen(function* () {
          const exists = yield* tmuxSessionManager.hasSession(input.projectId);
          if (!exists) {
            yield* tmuxSessionManager.createSession(input.projectId, input.cwd);
          }

          const ptyProcess = yield* tmuxSessionManager.attachSession(
            input.projectId,
            input.cols,
            input.rows,
          );

          const processRef = { pid: ptyProcess.pid };
          activeTmuxProcesses.set(input.projectId, processRef);

          ptyProcess.onData((data) => {
            if (activeTmuxProcesses.get(input.projectId) !== processRef) return;
            runFork(terminalManager.publishTmuxOutput(input.projectId, data));
          });

          ptyProcess.onExit((event) => {
            if (activeTmuxProcesses.get(input.projectId) !== processRef) return;
            activeTmuxProcesses.delete(input.projectId);
            runFork(
              terminalManager.publishTmuxExit(
                input.projectId,
                event.exitCode,
                event.signal ?? null,
              ),
            );
          });

          return {
            projectId: input.projectId,
            sessionName: tmuxSessionManager.sessionName(input.projectId),
            pid: ptyProcess.pid,
          };
        }).pipe(Effect.mapError((err) => toTmuxError(err, "Tmux operation failed"))),
    } satisfies TerminalBackendShape;
  }),
);
