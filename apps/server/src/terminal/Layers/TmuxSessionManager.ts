import { Effect, Layer } from "effect";
import {
  TmuxNotFoundError,
  TmuxSessionError,
  TmuxSessionManager,
} from "../Services/TmuxSessionManager";
import { PtyAdapter, PtyProcess } from "../Services/PTY";

const SESSION_PREFIX = "t3-";

function sanitizeSessionName(projectId: string): string {
  return `${SESSION_PREFIX}${projectId.replace(/[.:]/g, "-")}`;
}

export const TmuxSessionManagerLive = Layer.effect(
  TmuxSessionManager,
  Effect.gen(function* () {
    const ptyAdapter = yield* PtyAdapter;
    const attachedProcesses = new Map<string, PtyProcess>();

    const execTmux = (args: string[], sessionName: string) =>
      ptyAdapter
        .spawn({
          shell: "tmux",
          args,
          cwd: "/tmp",
          cols: 80,
          rows: 24,
          env: process.env as NodeJS.ProcessEnv,
        })
        .pipe(
          Effect.mapError((err) => {
            if (
              err.message.includes("ENOENT") ||
              err.message.includes("not found")
            ) {
              return new TmuxNotFoundError();
            }

            return new TmuxSessionError(sessionName, err.message, err.cause);
          }),
        );

    return {
      sessionName: (projectId: string) => sanitizeSessionName(projectId),

      createSession: (projectId, cwd) =>
        Effect.gen(function* () {
          const name = sanitizeSessionName(projectId);
          const proc = yield* execTmux(
            ["new-session", "-d", "-s", name, "-c", cwd],
            name,
          );
          yield* Effect.callback<void, TmuxSessionError>((resume) => {
            proc.onExit((event) => {
              if (event.exitCode === 0) {
                resume(Effect.void);
              } else {
                resume(
                  Effect.fail(
                    new TmuxSessionError(
                      name,
                      `tmux new-session exited with code ${event.exitCode}`,
                    ),
                  ),
                );
              }
            });
          });
        }),

      killSession: (projectId: string) => {
        const name = sanitizeSessionName(projectId);
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
        Effect.gen(function* () {
          const name = sanitizeSessionName(projectId);
          const proc = yield* execTmux(["has-session", "-t", name], name).pipe(
            Effect.orElseSucceed(() => null),
          );
          if (!proc) return false;
          return yield* Effect.callback<boolean>((resume) => {
            proc.onExit((event) =>
              resume(Effect.succeed(event.exitCode === 0)),
            );
          });
        }),

      isTmuxAvailable: Effect.gen(function* () {
        const proc = yield* ptyAdapter.spawn({
          shell: "tmux",
          args: ["-V"],
          cwd: "/tmp",
          cols: 80,
          rows: 24,
          env: process.env as NodeJS.ProcessEnv,
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

      attachSession: (projectId, cols, rows) =>
        Effect.gen(function* () {
          const name = sanitizeSessionName(projectId);
          const exists = yield* Effect.gen(function* () {
            const proc = yield* execTmux(["has-session", "-t", name], name);
            return yield* Effect.callback<boolean>((resume) => {
              proc.onExit((event) =>
                resume(Effect.succeed(event.exitCode === 0)),
              );
            });
          }).pipe(Effect.orElseSucceed(() => false));

          if (!exists) {
            return yield* Effect.fail(
              new TmuxSessionError(name, `Session ${name} does not exist`),
            );
          }

          const attachProc = yield* ptyAdapter.spawn({
            shell: "tmux",
            args: ["attach-sesion", "-t", name],
            cwd: "/tmp",
            cols,
            rows,
            env: process.env as NodeJS.ProcessEnv,
          });

          attachedProcesses.set(projectId, attachProc);
          return attachProc;
        }),
    };
  }),
);
