import { Context, Effect, Schema } from "effect";

export const TMUX_CONTROL_MODE_DEFAULT_COLS = 120;
export const TMUX_CONTROL_MODE_DEFAULT_ROWS = 40;

export type TmuxControlModeConnectionStatus =
  | "starting"
  | "running"
  | "restarting"
  | "exited"
  | "error"
  | "stopped";

export interface TmuxControlModeConnectInput {
  readonly sessionName: string;
  readonly cwd: string;
  readonly cols?: number;
  readonly rows?: number;
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Use `tmux -C new-session -A` so bootstrap can create the session when it is
   * absent. Plain attach is used when false.
   */
  readonly createIfMissing?: boolean;
}

export interface TmuxControlModeCommandInput {
  readonly command: string;
  readonly args?: readonly string[];
}

export interface TmuxControlModeCommandResponse {
  readonly commandId: string;
  readonly timestamp: string;
  readonly flags: string;
}

export type TmuxControlModeEvent =
  | {
      readonly type: "client-started";
      readonly sessionName: string;
      readonly pid: number;
      readonly createdAt: string;
    }
  | {
      readonly type: "client-restarting";
      readonly sessionName: string;
      readonly previousPid: number;
      readonly createdAt: string;
    }
  | {
      readonly type: "client-exited";
      readonly sessionName: string;
      readonly exitCode: number;
      readonly signal: number | null;
      readonly createdAt: string;
    }
  | {
      readonly type: "client-error";
      readonly sessionName: string;
      readonly message: string;
      readonly createdAt: string;
    }
  | ({ readonly type: "command-begin" } & TmuxControlModeCommandResponse)
  | ({ readonly type: "command-end" } & TmuxControlModeCommandResponse)
  | ({ readonly type: "command-error"; readonly message: string } & TmuxControlModeCommandResponse)
  | { readonly type: "window-add"; readonly windowId: string }
  | { readonly type: "window-close"; readonly windowId: string }
  | { readonly type: "window-renamed"; readonly windowId: string; readonly name: string }
  | {
      readonly type: "layout-change";
      readonly windowId: string;
      readonly layout: string;
      readonly visibleLayout: string | null;
      readonly flags: string | null;
    }
  | { readonly type: "pane-mode-changed"; readonly paneId: string; readonly mode: string | null }
  | { readonly type: "session-changed"; readonly sessionId: string; readonly name: string }
  | { readonly type: "pane-output"; readonly paneId: string; readonly data: string }
  | {
      readonly type: "pane-extended-output";
      readonly paneId: string;
      readonly age: number | null;
      readonly data: string;
    }
  | { readonly type: "exit"; readonly reason: string | null }
  | { readonly type: "unrecognized"; readonly line: string };

export interface TmuxControlModeConnection {
  readonly sessionName: string;
  readonly pid: Effect.Effect<number>;
  readonly status: Effect.Effect<TmuxControlModeConnectionStatus>;
  readonly command: (
    input: TmuxControlModeCommandInput,
  ) => Effect.Effect<void, TmuxControlModeError>;
  readonly restart: Effect.Effect<void, TmuxControlModeError>;
  readonly stop: Effect.Effect<void>;
  readonly subscribe: (
    listener: (event: TmuxControlModeEvent) => Effect.Effect<void>,
  ) => Effect.Effect<() => void>;
}

export class TmuxControlModeError extends Schema.TaggedErrorClass<TmuxControlModeError>()(
  "TmuxControlModeError",
  {
    code: Schema.Literals(["spawn-failed", "not-running", "command-failed", "admin-failed"]),
    message: Schema.String,
    sessionName: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface TmuxControlModeAdapterShape {
  readonly connect: (
    input: TmuxControlModeConnectInput,
  ) => Effect.Effect<TmuxControlModeConnection, TmuxControlModeError>;

  /**
   * Bootstrap/admin fallback for bounded, non-streaming tmux commands. Control
   * mode should be used for normal state synchronization.
   */
  readonly adminCommand: (
    args: readonly string[],
    options?: { readonly timeoutMs?: number },
  ) => Effect.Effect<string, TmuxControlModeError>;
}

export class TmuxControlModeAdapter extends Context.Service<
  TmuxControlModeAdapter,
  TmuxControlModeAdapterShape
>()("t3/terminal/Services/TmuxControlModeAdapter") {}
