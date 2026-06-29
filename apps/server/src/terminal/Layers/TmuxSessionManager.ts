import { Effect, Layer } from "effect";
import {
  TmuxNotFoundError,
  TmuxSessionError,
  TmuxSessionManager,
} from "../Services/TmuxSessionManager";
import { PtyAdapter, PtyProcess } from "../Services/PTY";
import { withPierreDarkLazygitThemeEnv } from "./LazygitTheme";
import { makeTmuxSessionName, TERMINAL_TMUX_SESSION_PREFIX } from "../tmuxRuntime";

function waitForExitCode(proc: PtyProcess) {
  return Effect.callback<number>((resume) => {
    proc.onExit((event) => resume(Effect.succeed(event.exitCode ?? 1)));
  });
}

export const TmuxSessionManagerLive = Layer.effect(
  TmuxSessionManager,
  Effect.gen(function* () {
    const ptyAdapter = yield* PtyAdapter;
    const tmuxEnv = yield* withPierreDarkLazygitThemeEnv(process.env as NodeJS.ProcessEnv);
    const attachedProcesses = new Map<string, PtyProcess>();

    const execTmux = (args: string[], sessionName: string) =>
      ptyAdapter
        .spawn({
          shell: "tmux",
          args,
          cwd: "/tmp",
          cols: 80,
          rows: 24,
          env: tmuxEnv,
        })
        .pipe(
          Effect.mapError((err) => {
            if (err.message.includes("ENOENT") || err.message.includes("not found")) {
              return new TmuxNotFoundError();
            }

            return new TmuxSessionError(sessionName, err.message, err.cause);
          }),
        );

    const hasSessionByName = (name: string) =>
      Effect.gen(function* () {
        const proc = yield* execTmux(["has-session", "-t", name], name).pipe(
          Effect.orElseSucceed(() => null),
        );
        if (!proc) return false;
        const exitCode = yield* waitForExitCode(proc);
        return exitCode === 0;
      });

    return {
      sessionName: (projectId: string) =>
        makeTmuxSessionName(TERMINAL_TMUX_SESSION_PREFIX, projectId),

      createSession: (projectId, cwd) =>
        Effect.gen(function* () {
          const name = makeTmuxSessionName(TERMINAL_TMUX_SESSION_PREFIX, projectId);
          const proc = yield* execTmux(["new-session", "-d", "-s", name, "-c", cwd], name);
          const exitCode = yield* waitForExitCode(proc);
          if (exitCode === 0) return;

          const existsAfterFailedCreate = yield* hasSessionByName(name);
          if (existsAfterFailedCreate) return;

          return yield* Effect.fail(
            new TmuxSessionError(name, `tmux new-session exited with code ${exitCode}`),
          );
        }),

      killSession: (projectId: string) => {
        const name = makeTmuxSessionName(TERMINAL_TMUX_SESSION_PREFIX, projectId);
        const proc = attachedProcesses.get(projectId);
        if (proc) {
          proc.kill();
          attachedProcesses.delete(projectId);
        }

        return Effect.gen(function* () {
          const killProc = yield* execTmux(["kill-session", "-t", name], name);
          yield* Effect.callback<void, TmuxSessionError>((resume) => {
            killProc.onExit((event) => {
              if (event.exitCode === 0) {
                resume(Effect.void);
              } else {
                resume(
                  Effect.fail(
                    new TmuxSessionError(
                      name,
                      `tmux kill-session exited with code ${event.exitCode}`,
                    ),
                  ),
                );
              }
            });
          });
        });
      },

      hasSession: (projectId: string) =>
        hasSessionByName(makeTmuxSessionName(TERMINAL_TMUX_SESSION_PREFIX, projectId)),

      isTmuxAvailable: Effect.gen(function* () {
        const proc = yield* ptyAdapter.spawn({
          shell: "tmux",
          args: ["-V"],
          cwd: "/tmp",
          cols: 80,
          rows: 24,
          env: tmuxEnv,
        });

        return yield* Effect.callback<boolean>((resume) => {
          proc.onExit((event) => {
            resume(Effect.succeed(event.exitCode === 0));
          });
        });
      }).pipe(Effect.orElseSucceed(() => false)),

      detachSession: (projectId: string) =>
        Effect.sync(() => {
          const proc = attachedProcesses.get(projectId);
          if (proc) {
            proc.kill();
            attachedProcesses.delete(projectId);
          }
        }),

      writeToSession: (projectId: string, data: string) =>
        Effect.sync(() => {
          const proc = attachedProcesses.get(projectId);
          if (proc) {
            proc.write(data);
          }
        }),

      resizeSession: (projectId: string, cols: number, rows: number) =>
        Effect.sync(() => {
          const proc = attachedProcesses.get(projectId);
          if (proc) {
            proc.resize(cols, rows);
          }
        }),

      attachSession: (projectId, cols, rows) =>
        Effect.gen(function* () {
          const name = makeTmuxSessionName(TERMINAL_TMUX_SESSION_PREFIX, projectId);
          const exists = yield* Effect.gen(function* () {
            const proc = yield* execTmux(["has-session", "-t", name], name);
            const exitCode = yield* waitForExitCode(proc);
            return exitCode === 0;
          }).pipe(Effect.orElseSucceed(() => false));

          if (!exists) {
            return yield* Effect.fail(new TmuxSessionError(name, `Session ${name} does not exist`));
          }

          // Kill previous attached client to avoid duplicate output forwarding
          const previousProc = attachedProcesses.get(projectId);
          if (previousProc) {
            previousProc.kill();
            attachedProcesses.delete(projectId);
          }

          const attachProc = yield* ptyAdapter.spawn({
            shell: "tmux",
            args: ["attach-session", "-t", name],
            cwd: "/tmp",
            cols,
            rows,
            env: tmuxEnv,
          });

          attachedProcesses.set(projectId, attachProc);
          return attachProc;
        }),
    };
  }),
);
