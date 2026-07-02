import { Deferred, Effect, Layer, Option, Ref, Semaphore } from "effect";

import { PtyAdapter, type PtyProcess } from "../Services/PTY";
import {
  TMUX_CONTROL_MODE_DEFAULT_COLS,
  TMUX_CONTROL_MODE_DEFAULT_ROWS,
  TmuxControlModeAdapter,
  TmuxControlModeConnection,
  TmuxControlModeConnectionStatus,
  TmuxControlModeError,
  TmuxControlModeEvent,
  type TmuxControlModeAdapterShape,
  type TmuxControlModeCommandInput,
  type TmuxControlModeConnectInput,
} from "../Services/TmuxControlMode";
import { execTmux } from "../tmuxRuntime";

export interface TmuxControlModeParseState {
  readonly bufferedLine: string;
}

export interface TmuxControlModeParseResult {
  readonly state: TmuxControlModeParseState;
  readonly events: readonly TmuxControlModeEvent[];
}

interface ActiveControlCommand {
  readonly commandId: string | null;
  readonly minimumFreshCommandNumber: bigint;
  readonly deferred: Deferred.Deferred<void, TmuxControlModeError>;
}

interface CommandCorrelationState {
  readonly lastObservedCommandNumber: bigint;
  readonly stalePreBeginTimeouts: number;
  readonly staleCommandIds: ReadonlySet<string>;
}

export const EMPTY_TMUX_CONTROL_MODE_PARSE_STATE: TmuxControlModeParseState = {
  bufferedLine: "",
};

const EMPTY_COMMAND_CORRELATION_STATE: CommandCorrelationState = {
  lastObservedCommandNumber: 0n,
  stalePreBeginTimeouts: 0,
  staleCommandIds: new Set(),
};

function nowIso(): string {
  return new Date().toISOString();
}

function tokenize(line: string): readonly string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quote !== null) {
      if (char === quote) {
        quote = null;
        continue;
      }
      token += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === " " || char === "\t") {
      if (token.length > 0) {
        tokens.push(token);
        token = "";
      }
      continue;
    }
    token += char;
  }

  if (token.length > 0) {
    tokens.push(token);
  }
  return tokens;
}

function restAfterTokens(line: string, tokenCount: number): string {
  let index = 0;
  let consumed = 0;

  while (index < line.length && consumed < tokenCount) {
    while (line[index] === " " || line[index] === "\t") {
      index += 1;
    }
    while (index < line.length && line[index] !== " " && line[index] !== "\t") {
      index += 1;
    }
    consumed += 1;
  }

  while (line[index] === " " || line[index] === "\t") {
    index += 1;
  }
  return line.slice(index);
}

export function decodeTmuxControlString(input: string): string {
  let output = "";
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (char !== "\\") {
      output += char;
      continue;
    }

    const next = input[index + 1];
    if (next === undefined) {
      output += "\\";
      continue;
    }

    if (/[0-7]/.test(next)) {
      const octal = input.slice(index + 1, index + 4);
      if (/^[0-7]{3}$/.test(octal)) {
        output += String.fromCharCode(Number.parseInt(octal, 8));
        index += 3;
        continue;
      }
    }

    switch (next) {
      case "\\":
        output += "\\";
        break;
      case "e":
        output += "\u001b";
        break;
      case "n":
        output += "\n";
        break;
      case "r":
        output += "\r";
        break;
      case "s":
        output += " ";
        break;
      case "t":
        output += "\t";
        break;
      default:
        output += next;
        break;
    }
    index += 1;
  }
  return output;
}

export function quoteTmuxCommandArg(arg: string): string {
  if (!arg.startsWith("%") && /^[A-Za-z0-9_@%:.,/+=-]+$/.test(arg)) {
    return arg;
  }
  if (
    Array.from(arg).some((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    let encoded = "";
    for (let index = 0; index < arg.length; index += 1) {
      const char = arg[index]!;
      const code = char.charCodeAt(0);
      if (char === "\\" || char === '"') {
        encoded += `\\${char}`;
      } else if (code < 32 || code === 127) {
        encoded += `\\${code.toString(8).padStart(3, "0")}`;
      } else {
        encoded += char;
      }
    }
    return `"${encoded}"`;
  }
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export function serializeTmuxControlCommand(input: TmuxControlModeCommandInput): string {
  const args = input.args ?? [];
  return [input.command, ...args.map(quoteTmuxCommandArg)].join(" ");
}

function containsControlModeLineBreak(input: TmuxControlModeCommandInput): boolean {
  return input.command.includes("\n") || input.command.includes("\r");
}

function parseCommandNumber(commandId: string): bigint | null {
  return /^\d+$/.test(commandId) ? BigInt(commandId) : null;
}

export function parseTmuxControlModeLine(rawLine: string): TmuxControlModeEvent | null {
  const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
  if (line.length === 0) return null;
  if (!line.startsWith("%")) {
    return { type: "unrecognized", line };
  }

  const tokens = tokenize(line);
  const marker = tokens[0];
  if (!marker) return null;

  switch (marker) {
    case "%begin":
    case "%end":
    case "%error": {
      const timestamp = tokens[1] ?? "";
      const commandId = tokens[2] ?? "";
      const flags = tokens[3] ?? "";
      if (marker === "%error") {
        return {
          type: "command-error",
          timestamp,
          commandId,
          flags,
          message: decodeTmuxControlString(restAfterTokens(line, 4)),
        };
      }
      return {
        type: marker === "%begin" ? "command-begin" : "command-end",
        timestamp,
        commandId,
        flags,
      };
    }
    case "%window-add":
      return tokens[1]
        ? { type: "window-add", windowId: tokens[1] }
        : { type: "unrecognized", line };
    case "%window-close":
      return tokens[1]
        ? { type: "window-close", windowId: tokens[1] }
        : { type: "unrecognized", line };
    case "%window-renamed":
      return tokens[1]
        ? {
            type: "window-renamed",
            windowId: tokens[1],
            name: decodeTmuxControlString(restAfterTokens(line, 2)),
          }
        : { type: "unrecognized", line };
    case "%layout-change":
      return tokens[1] && tokens[2]
        ? {
            type: "layout-change",
            windowId: tokens[1],
            layout: tokens[2],
            visibleLayout: tokens[3] ?? null,
            flags: tokens[4] ?? null,
          }
        : { type: "unrecognized", line };
    case "%pane-mode-changed":
      return tokens[1]
        ? { type: "pane-mode-changed", paneId: tokens[1], mode: tokens[2] ?? null }
        : { type: "unrecognized", line };
    case "%session-changed":
      return tokens[1] && tokens[2]
        ? {
            type: "session-changed",
            sessionId: tokens[1],
            name: decodeTmuxControlString(restAfterTokens(line, 2)),
          }
        : { type: "unrecognized", line };
    case "%output":
      return tokens[1]
        ? {
            type: "pane-output",
            paneId: tokens[1],
            data: decodeTmuxControlString(restAfterTokens(line, 2)),
          }
        : { type: "unrecognized", line };
    case "%extended-output": {
      if (!tokens[1]) return { type: "unrecognized", line };
      const age = tokens[2] && /^\d+$/.test(tokens[2]) ? Number.parseInt(tokens[2], 10) : null;
      const colonIndex = line.indexOf(" : ");
      return {
        type: "pane-extended-output",
        paneId: tokens[1],
        age,
        data: decodeTmuxControlString(colonIndex >= 0 ? line.slice(colonIndex + 3) : ""),
      };
    }
    case "%exit":
      return {
        type: "exit",
        reason: restAfterTokens(line, 1) ? decodeTmuxControlString(restAfterTokens(line, 1)) : null,
      };
    default:
      return { type: "unrecognized", line };
  }
}

export function parseTmuxControlModeChunk(
  chunk: string,
  state: TmuxControlModeParseState = EMPTY_TMUX_CONTROL_MODE_PARSE_STATE,
): TmuxControlModeParseResult {
  const input = `${state.bufferedLine}${chunk}`;
  const lines = input.split("\n");
  const bufferedLine = lines.pop() ?? "";
  const events = lines
    .map(parseTmuxControlModeLine)
    .filter((event): event is TmuxControlModeEvent => event !== null);

  return {
    state: { bufferedLine },
    events,
  };
}

function tmuxControlModeArgs(input: TmuxControlModeConnectInput): string[] {
  if (input.createIfMissing) {
    return ["-C", "new-session", "-A", "-s", input.sessionName, "-c", input.cwd];
  }
  return ["-C", "attach-session", "-t", input.sessionName];
}

export const TmuxControlModeAdapterLive = Layer.effect(
  TmuxControlModeAdapter,
  Effect.gen(function* () {
    const ptyAdapter = yield* PtyAdapter;
    const services = yield* Effect.context<never>();
    const runFork = Effect.runForkWith(services);

    const makeConnection = (
      input: TmuxControlModeConnectInput,
    ): Effect.Effect<TmuxControlModeConnection, TmuxControlModeError> =>
      Effect.gen(function* () {
        const listeners = new Set<(event: TmuxControlModeEvent) => Effect.Effect<void>>();
        const statusRef = yield* Ref.make<TmuxControlModeConnectionStatus>("starting");
        const processRef = yield* Ref.make<PtyProcess | null>(null);
        const parseStateRef = yield* Ref.make<TmuxControlModeParseState>(
          EMPTY_TMUX_CONTROL_MODE_PARSE_STATE,
        );
        const activeCommandRef = yield* Ref.make<ActiveControlCommand | null>(null);
        const commandCorrelationRef = yield* Ref.make<CommandCorrelationState>(
          EMPTY_COMMAND_CORRELATION_STATE,
        );
        const commandSemaphore = yield* Semaphore.make(1);

        const publish = (event: TmuxControlModeEvent): Effect.Effect<void> =>
          Effect.forEach(
            [...listeners],
            (listener) => listener(event).pipe(Effect.catchCause(() => Effect.void)),
            { discard: true },
          );

        const commandFailed = (message: string, cause?: unknown): TmuxControlModeError =>
          new TmuxControlModeError({
            code: "command-failed",
            message,
            sessionName: input.sessionName,
            ...(cause === undefined ? {} : { cause }),
          });

        const failActiveCommand = (message: string): Effect.Effect<void> =>
          Ref.getAndSet(activeCommandRef, null).pipe(
            Effect.flatMap((active) =>
              active
                ? Deferred.fail(active.deferred, commandFailed(message)).pipe(Effect.asVoid)
                : Effect.void,
            ),
          );

        const resetCommandCorrelation = Ref.set(
          commandCorrelationRef,
          EMPTY_COMMAND_CORRELATION_STATE,
        );

        const observeCommandEvent = (event: TmuxControlModeEvent): Effect.Effect<void> => {
          if (event.type === "command-begin") {
            return Ref.get(activeCommandRef).pipe(
              Effect.flatMap((active) =>
                Ref.modify(commandCorrelationRef, (state) => {
                  const commandNumber = parseCommandNumber(event.commandId);
                  const isActiveWaitingForBegin = active !== null && active.commandId === null;
                  const isAlreadyObserved =
                    commandNumber !== null && commandNumber <= state.lastObservedCommandNumber;
                  const isUnboundTimedOutCommand =
                    !isActiveWaitingForBegin && state.stalePreBeginTimeouts > 0;
                  const isReservedForTimedOutCommand =
                    isActiveWaitingForBegin &&
                    state.stalePreBeginTimeouts > 0 &&
                    (commandNumber === null || commandNumber < active.minimumFreshCommandNumber);
                  const staleCommandIds =
                    isAlreadyObserved || isUnboundTimedOutCommand || isReservedForTimedOutCommand
                      ? new Set([...state.staleCommandIds, event.commandId])
                      : state.staleCommandIds;
                  const lastObservedCommandNumber =
                    commandNumber !== null && commandNumber > state.lastObservedCommandNumber
                      ? commandNumber
                      : state.lastObservedCommandNumber;

                  if (
                    isAlreadyObserved ||
                    isUnboundTimedOutCommand ||
                    isReservedForTimedOutCommand
                  ) {
                    return [
                      "stale",
                      {
                        lastObservedCommandNumber,
                        stalePreBeginTimeouts:
                          (isUnboundTimedOutCommand || isReservedForTimedOutCommand) &&
                          state.stalePreBeginTimeouts > 0
                            ? state.stalePreBeginTimeouts - 1
                            : state.stalePreBeginTimeouts,
                        staleCommandIds,
                      },
                    ] as const;
                  }

                  return [
                    isActiveWaitingForBegin ? "bind" : "ignore",
                    {
                      lastObservedCommandNumber,
                      stalePreBeginTimeouts: isActiveWaitingForBegin
                        ? 0
                        : state.stalePreBeginTimeouts,
                      staleCommandIds,
                    },
                  ] as const;
                }).pipe(
                  Effect.flatMap((decision) =>
                    decision === "bind"
                      ? Ref.update(activeCommandRef, (current) =>
                          current && current.commandId === null
                            ? { ...current, commandId: event.commandId }
                            : current,
                        )
                      : Effect.void,
                  ),
                ),
              ),
            );
          }
          if (event.type !== "command-end" && event.type !== "command-error") return Effect.void;

          return Ref.modify(commandCorrelationRef, (state) => {
            if (!state.staleCommandIds.has(event.commandId)) {
              return [false, state] as const;
            }
            const staleCommandIds = new Set(state.staleCommandIds);
            staleCommandIds.delete(event.commandId);
            return [true, { ...state, staleCommandIds }] as const;
          }).pipe(
            Effect.flatMap((isStaleCompletion) => {
              if (isStaleCompletion) return Effect.void;
              return Ref.modify(activeCommandRef, (active) => {
                if (!active || active.commandId === null || active.commandId !== event.commandId) {
                  return [null, active] as const;
                }
                return [active, null] as const;
              }).pipe(
                Effect.flatMap((active) => {
                  if (!active) return Effect.void;
                  if (event.type === "command-error") {
                    return Deferred.fail(active.deferred, commandFailed(event.message)).pipe(
                      Effect.asVoid,
                    );
                  }
                  return Deferred.succeed(active.deferred, undefined).pipe(Effect.asVoid);
                }),
              );
            }),
          );
        };

        const spawn = Effect.gen(function* () {
          yield* failActiveCommand("tmux control-mode client is restarting");
          yield* resetCommandCorrelation;
          yield* Ref.set(statusRef, "starting");
          yield* Ref.set(parseStateRef, EMPTY_TMUX_CONTROL_MODE_PARSE_STATE);
          const proc = yield* ptyAdapter
            .spawn({
              shell: "tmux",
              args: tmuxControlModeArgs(input),
              cwd: input.cwd,
              cols: input.cols ?? TMUX_CONTROL_MODE_DEFAULT_COLS,
              rows: input.rows ?? TMUX_CONTROL_MODE_DEFAULT_ROWS,
              env: input.env ?? (process.env as NodeJS.ProcessEnv),
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new TmuxControlModeError({
                    code: "spawn-failed",
                    message: cause.message,
                    sessionName: input.sessionName,
                    cause,
                  }),
              ),
              Effect.tapError((error) =>
                Ref.set(processRef, null).pipe(
                  Effect.andThen(Ref.set(statusRef, "error")),
                  Effect.andThen(
                    publish({
                      type: "client-error",
                      sessionName: input.sessionName,
                      message: error.message,
                      createdAt: nowIso(),
                    }),
                  ),
                ),
              ),
            );

          yield* Ref.set(processRef, proc);
          yield* Ref.set(statusRef, "running");

          proc.onData((data) => {
            runFork(
              Ref.get(processRef).pipe(
                Effect.flatMap((currentProc) => {
                  if (currentProc !== proc) return Effect.void;
                  return Ref.modify(parseStateRef, (state) => {
                    const result = parseTmuxControlModeChunk(data, state);
                    return [result.events, result.state] as const;
                  }).pipe(
                    Effect.flatMap((events) =>
                      Effect.forEach(
                        events,
                        (event) => observeCommandEvent(event).pipe(Effect.andThen(publish(event))),
                        { discard: true },
                      ),
                    ),
                  );
                }),
              ),
            );
          });

          proc.onExit((event) => {
            runFork(
              Ref.get(processRef).pipe(
                Effect.flatMap((currentProc) => {
                  if (currentProc !== proc) return Effect.void;
                  return Ref.set(statusRef, "exited").pipe(
                    Effect.andThen(
                      failActiveCommand("tmux control-mode client exited before command ack"),
                    ),
                    Effect.andThen(resetCommandCorrelation),
                    Effect.andThen(
                      publish({
                        type: "client-exited",
                        sessionName: input.sessionName,
                        exitCode: event.exitCode,
                        signal: event.signal,
                        createdAt: nowIso(),
                      }),
                    ),
                  );
                }),
              ),
            );
          });

          yield* publish({
            type: "client-started",
            sessionName: input.sessionName,
            pid: proc.pid,
            createdAt: nowIso(),
          });
        });

        yield* spawn;

        const connection: TmuxControlModeConnection = {
          sessionName: input.sessionName,
          pid: Ref.get(processRef).pipe(Effect.map((proc) => proc?.pid ?? 0)),
          status: Ref.get(statusRef),
          command: (commandInput) =>
            commandSemaphore.withPermit(
              Effect.gen(function* () {
                const proc = yield* Ref.get(processRef);
                const status = yield* Ref.get(statusRef);
                if (!proc || status !== "running") {
                  return yield* new TmuxControlModeError({
                    code: "not-running",
                    message: `tmux control-mode client is not running for ${input.sessionName}`,
                    sessionName: input.sessionName,
                  });
                }
                if (containsControlModeLineBreak(commandInput)) {
                  return yield* new TmuxControlModeError({
                    code: "command-failed",
                    message: "tmux control-mode commands cannot contain raw line breaks",
                    sessionName: input.sessionName,
                  });
                }
                const deferred = yield* Deferred.make<void, TmuxControlModeError>();
                const correlation = yield* Ref.get(commandCorrelationRef);
                yield* Ref.set(activeCommandRef, {
                  commandId: null,
                  minimumFreshCommandNumber:
                    correlation.lastObservedCommandNumber +
                    BigInt(correlation.stalePreBeginTimeouts) +
                    1n,
                  deferred,
                });
                proc.write(`${serializeTmuxControlCommand(commandInput)}\n`);

                const result = yield* Deferred.await(deferred).pipe(
                  Effect.timeoutOption("5 seconds"),
                );
                if (Option.isNone(result)) {
                  const active = yield* Ref.get(activeCommandRef);
                  if (active?.deferred === deferred) {
                    if (active.commandId === null) {
                      yield* Ref.update(commandCorrelationRef, (state) => ({
                        ...state,
                        stalePreBeginTimeouts: state.stalePreBeginTimeouts + 1,
                      }));
                    }
                    yield* Ref.set(activeCommandRef, null);
                  }
                  return yield* commandFailed("tmux control-mode command timed out");
                }
              }),
            ),
          restart: Effect.gen(function* () {
            const proc = yield* Ref.get(processRef);
            if (proc) {
              yield* failActiveCommand("tmux control-mode client is restarting");
              yield* Ref.set(processRef, null);
              yield* Ref.set(statusRef, "restarting");
              yield* publish({
                type: "client-restarting",
                sessionName: input.sessionName,
                previousPid: proc.pid,
                createdAt: nowIso(),
              });
              proc.kill();
            }
            yield* spawn;
          }),
          stop: Effect.gen(function* () {
            const proc = yield* Ref.get(processRef);
            yield* failActiveCommand("tmux control-mode client stopped before command ack");
            yield* resetCommandCorrelation;
            yield* Ref.set(statusRef, "stopped");
            yield* Ref.set(processRef, null);
            if (proc) {
              proc.kill();
            }
          }),
          subscribe: (listener) =>
            Effect.sync(() => {
              listeners.add(listener);
              return () => {
                listeners.delete(listener);
              };
            }),
        };

        return connection;
      });
    return {
      connect: makeConnection,
      adminCommand: (args, options) =>
        Effect.tryPromise({
          try: () => execTmux(args, options),
          catch: (cause) => {
            const message = cause instanceof Error ? cause.message : "tmux admin command failed";
            return new TmuxControlModeError({
              code: "admin-failed",
              message,
              cause,
            });
          },
        }),
    } satisfies TmuxControlModeAdapterShape;
  }),
);
