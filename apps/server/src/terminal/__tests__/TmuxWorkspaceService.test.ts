import {
  AuthSessionId,
  ProjectId,
  ThreadId,
  TmuxWorkspaceId,
  type TmuxKernelEvent,
  type TmuxNeovimPaneMetadata,
} from "@fenrir/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Ref, Stream } from "effect";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { AgentFeedHookCredential } from "../../agentFeed/Services/AgentFeedService";
import { ServerConfig } from "../../config";
import { makeTmuxWorkspaceServiceLive } from "../Layers/TmuxWorkspaceService";
import { TmuxPaneStreamServiceLive } from "../Layers/TmuxPaneStreamService";
import {
  TmuxControlModeAdapter,
  TmuxControlModeError,
  type TmuxControlModeAdapterShape,
  type TmuxControlModeCommandInput,
  type TmuxControlModeConnectInput,
  type TmuxControlModeConnection,
  type TmuxControlModeConnectionStatus,
  type TmuxControlModeEvent,
} from "../Services/TmuxControlMode";
import { TmuxWorkspaceService } from "../Services/TmuxWorkspaceService";

const FIELD_SEPARATOR = "\u001f";
const AUTH_ACTOR = {
  sessionId: AuthSessionId.make("auth-session-1"),
  subject: "owner",
} as const;
const AUTH_GRANT = {
  actor: AUTH_ACTOR,
  permissions: [
    "workspace:read",
    "workspace:control",
    "window:control",
    "pane:read",
    "pane:write",
    "pane:control",
    "process:spawn",
    "neovim:launch",
    "session:destroy",
    "permissions:admin",
  ] as const,
  grantedAt: "2026-01-01T00:00:00.000Z",
  expiresAt: null,
};
const READ_ONLY_GRANT = {
  ...AUTH_GRANT,
  permissions: ["workspace:read"] as const,
};
const NO_PANE_READ_GRANT = {
  ...AUTH_GRANT,
  permissions: [
    "workspace:read",
    "workspace:control",
    "window:control",
    "pane:write",
    "pane:control",
  ] as const,
};
const NO_PANE_WRITE_GRANT = {
  ...AUTH_GRANT,
  permissions: [
    "workspace:read",
    "workspace:control",
    "window:control",
    "pane:read",
    "pane:control",
  ] as const,
};
const NO_WORKSPACE_CONTROL_GRANT = {
  ...AUTH_GRANT,
  permissions: [
    "workspace:read",
    "window:control",
    "pane:read",
    "pane:write",
    "pane:control",
  ] as const,
};
const NO_WINDOW_CONTROL_GRANT = {
  ...AUTH_GRANT,
  permissions: [
    "workspace:read",
    "workspace:control",
    "pane:read",
    "pane:write",
    "pane:control",
  ] as const,
};
const NO_PROCESS_SPAWN_GRANT = {
  ...AUTH_GRANT,
  permissions: [
    "workspace:read",
    "workspace:control",
    "window:control",
    "pane:read",
    "pane:write",
    "pane:control",
  ] as const,
};
const NO_NEOVIM_LAUNCH_GRANT = {
  ...AUTH_GRANT,
  permissions: [
    "workspace:read",
    "workspace:control",
    "window:control",
    "pane:read",
    "pane:write",
    "pane:control",
    "process:spawn",
  ] as const,
};
const NO_SESSION_DESTROY_GRANT = {
  ...AUTH_GRANT,
  permissions: [
    "workspace:read",
    "workspace:control",
    "window:control",
    "pane:read",
    "pane:write",
    "pane:control",
  ] as const,
};
const OTHER_ACTOR = {
  sessionId: AuthSessionId.make("auth-session-2"),
  subject: "owner",
} as const;
const OTHER_GRANT = {
  ...AUTH_GRANT,
  actor: OTHER_ACTOR,
};
const FOREIGN_SUBJECT_ACTOR = {
  sessionId: AuthSessionId.make("auth-session-3"),
  subject: "someone-else",
} as const;

interface FakePane {
  id: string;
  cwd: string;
  x: number;
  y: number;
  cols: number;
  rows: number;
  active: boolean;
}

interface FakeWindow {
  id: string;
  index: number;
  name: string;
  active: boolean;
  cols: number;
  rows: number;
  panes: FakePane[];
}

interface FakeSession {
  name: string;
  cwd: string;
  windows: FakeWindow[];
  options: Map<string, string>;
  environment: Map<string, string>;
}

class FakeControlModeConnection implements TmuxControlModeConnection {
  readonly commands: TmuxControlModeCommandInput[] = [];
  readonly commandFailures: Error[] = [];
  readonly listeners = new Set<(event: TmuxControlModeEvent) => Effect.Effect<void>>();
  statusValue: TmuxControlModeConnectionStatus = "running";
  restartCount = 0;
  stopped = false;

  constructor(
    readonly sessionName: string,
    readonly pidNumber: number,
    private readonly onCommand: (
      connection: FakeControlModeConnection,
      input: TmuxControlModeCommandInput,
    ) => Effect.Effect<void> = () => Effect.void,
  ) {}

  get pid() {
    return Effect.succeed(this.pidNumber);
  }

  get status() {
    return Effect.succeed(this.statusValue);
  }

  command(input: TmuxControlModeCommandInput) {
    this.commands.push(input);
    const failure = this.commandFailures.shift();
    if (failure) {
      return Effect.fail(
        new TmuxControlModeError({
          code: "command-failed",
          message: failure.message,
          sessionName: this.sessionName,
          cause: failure,
        }),
      );
    }
    return this.onCommand(this, input);
  }

  get restart() {
    return Effect.sync(() => {
      this.restartCount += 1;
      this.statusValue = "running";
    });
  }

  get stop() {
    return Effect.sync(() => {
      this.stopped = true;
      this.statusValue = "stopped";
    });
  }

  subscribe(listener: (event: TmuxControlModeEvent) => Effect.Effect<void>) {
    return Effect.sync(() => {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    });
  }

  emit(event: TmuxControlModeEvent) {
    return Effect.forEach([...this.listeners], (listener) => listener(event), { discard: true });
  }
}

class FakeControlModeAdapter implements TmuxControlModeAdapterShape {
  readonly connections: FakeControlModeConnection[] = [];
  readonly connectCalls: TmuxControlModeConnectInput[] = [];
  readonly adminCalls: string[][] = [];
  readonly adminFailures: Error[] = [];
  readonly adminFailuresByCommand = new Map<string, Error>();
  readonly connectFailures: Error[] = [];
  readonly capturedScreens = new Map<string, string>();
  nvimAvailable = true;
  private nextPid = 3000;
  private nextWindow = 1;
  private nextPane = 1;
  private readonly outputEnabledPanes = new Set<string>();
  private readonly sessions = new Map<string, FakeSession>();

  connect(input: TmuxControlModeConnectInput) {
    this.connectCalls.push(input);
    const failure = this.connectFailures.shift();
    if (failure) {
      return Effect.fail(
        new TmuxControlModeError({
          code: "command-failed",
          message: failure.message,
          sessionName: input.sessionName,
          cause: failure,
        }),
      );
    }
    let session = this.sessions.get(input.sessionName);
    if (!session) {
      session = {
        name: input.sessionName,
        cwd: input.cwd,
        windows: [this.makeWindow("shell", input.cwd, true)],
        options: new Map(),
        environment: new Map(),
      };
      this.sessions.set(input.sessionName, session);
    }
    const connection = new FakeControlModeConnection(
      input.sessionName,
      this.nextPid++,
      (conn, command) => this.handleConnectionCommand(conn, command),
    );
    this.connections.push(connection);
    return Effect.succeed(connection);
  }

  adminCommand(args: readonly string[]) {
    this.adminCalls.push([...args]);
    const commandFailure = this.adminFailuresByCommand.get(args[0] ?? "");
    if (commandFailure) {
      this.adminFailuresByCommand.delete(args[0] ?? "");
      return Effect.fail(
        new TmuxControlModeError({
          code: "command-failed",
          message: commandFailure.message,
          cause: commandFailure,
        }),
      );
    }
    const failure = this.adminFailures.shift();
    if (failure) {
      return Effect.fail(
        new TmuxControlModeError({
          code: "command-failed",
          message: failure.message,
          cause: failure,
        }),
      );
    }
    return Effect.sync(() => this.runAdmin(args));
  }

  recreateSession(sessionName: string, cwd: string) {
    this.nextWindow = 1;
    this.nextPane = 1;
    this.sessions.set(sessionName, {
      name: sessionName,
      cwd,
      windows: [this.makeWindow("shell", cwd, true)],
      options: new Map(),
      environment: new Map(),
    });
  }

  isCommandAvailable(command: string): boolean {
    return command === "nvim" ? this.nvimAvailable : true;
  }

  private handleConnectionCommand(
    connection: FakeControlModeConnection,
    input: TmuxControlModeCommandInput,
  ): Effect.Effect<void> {
    const outputEnabledPanes = this.outputEnabledPanes;
    return Effect.gen(function* () {
      if (input.command === "refresh-client") {
        const paneState = input.args?.[input.args.indexOf("-A") + 1] ?? "";
        const [paneId, state] = paneState.split(":", 2);
        if (paneId && state === "on") outputEnabledPanes.add(paneId);
        if (paneId && state === "off") outputEnabledPanes.delete(paneId);
        return;
      }
      if (input.command === "send-keys") {
        const paneId = input.args?.[input.args.indexOf("-t") + 1] ?? "";
        const data = input.args?.[input.args.indexOf("-l") + 1] ?? "";
        if (paneId && outputEnabledPanes.has(paneId)) {
          yield* connection.emit({ type: "pane-output", paneId, data });
        }
      }
    });
  }

  private makeWindow(name: string, cwd: string, active: boolean): FakeWindow {
    return {
      id: `@${this.nextWindow++}`,
      index: this.nextWindow - 2,
      name,
      active,
      cols: 80,
      rows: 24,
      panes: [this.makePane(cwd, true)],
    };
  }

  private makePane(cwd: string, active: boolean): FakePane {
    return {
      id: `%${this.nextPane++}`,
      cwd,
      x: 0,
      y: 0,
      cols: 120,
      rows: 40,
      active,
    };
  }

  private sessionByTarget(target: string): FakeSession {
    const sessionName = target.split(":")[0] ?? target;
    const session = this.sessions.get(sessionName);
    if (!session) throw new Error(`missing fake session ${sessionName}`);
    return session;
  }

  private findWindow(target: string): { session: FakeSession; window: FakeWindow } {
    for (const session of this.sessions.values()) {
      const window = session.windows.find((candidate) => candidate.id === target);
      if (window) return { session, window };
    }
    const session = this.sessionByTarget(target);
    const active = session.windows.find((window) => window.active) ?? session.windows[0];
    if (!active) throw new Error(`missing fake window ${target}`);
    return { session, window: active };
  }

  private findPane(target: string): { session: FakeSession; window: FakeWindow; pane: FakePane } {
    for (const session of this.sessions.values()) {
      for (const window of session.windows) {
        const pane = window.panes.find((candidate) => candidate.id === target);
        if (pane) return { session, window, pane };
      }
    }
    throw new Error(`missing fake pane ${target}`);
  }

  private format(session: FakeSession): string {
    return session.windows
      .flatMap((window) =>
        window.panes.map((pane) =>
          [
            window.id,
            String(window.index),
            window.name,
            window.active ? "1" : "0",
            pane.id,
            pane.cwd,
            String(pane.x),
            String(pane.y),
            String(pane.cols),
            String(pane.rows),
            pane.active ? "1" : "0",
          ].join(FIELD_SEPARATOR),
        ),
      )
      .join("\n");
  }

  private runAdmin(args: readonly string[]): string {
    const command = args[0];
    if (command === "display-message") {
      const target = args[args.indexOf("-t") + 1] ?? "";
      const window = [...this.sessions.values()]
        .flatMap((session) => session.windows)
        .find((candidate) => candidate.id === target);
      if (window) {
        return (args.at(-1) ?? "")
          .replaceAll("#{window_width}", String(window.cols))
          .replaceAll("#{window_height}", String(window.rows))
          .replaceAll("#{window_panes}", String(window.panes.length));
      }
      const session = this.sessionByTarget(target);
      const format = args.at(-1) ?? "";
      const match = /^#\{(.+)\}$/.exec(format);
      return match ? (session.options.get(match[1]!) ?? "") : "";
    }
    if (command === "set-option") {
      const session = this.sessionByTarget(args[args.indexOf("-t") + 1] ?? "");
      session.options.set(args.at(-2) ?? "", args.at(-1) ?? "");
      return "";
    }
    if (command === "set-environment") {
      const session = this.sessionByTarget(args[args.indexOf("-t") + 1] ?? "");
      session.environment.set(args.at(-2) ?? "", args.at(-1) ?? "");
      return "";
    }
    if (command === "list-panes") {
      if (args.includes("-a")) {
        return [...this.sessions.values()]
          .map((session) => this.format(session))
          .filter((output) => output.length > 0)
          .join("\n");
      }
      return this.format(this.sessionByTarget(args[args.indexOf("-t") + 1] ?? ""));
    }
    if (command === "new-window") {
      const session = this.sessionByTarget(args[args.indexOf("-t") + 1] ?? "");
      const name = args.includes("-n") ? (args[args.indexOf("-n") + 1] ?? "shell") : "shell";
      const cwd = args.includes("-c") ? (args[args.indexOf("-c") + 1] ?? session.cwd) : session.cwd;
      for (const window of session.windows) {
        window.active = false;
        for (const pane of window.panes) pane.active = false;
      }
      session.windows.push(this.makeWindow(name, cwd, true));
      return this.format(session);
    }
    if (command === "rename-window") {
      const target = args[args.indexOf("-t") + 1] ?? "";
      this.findWindow(target).window.name = args.at(-1) ?? "renamed";
      return "";
    }
    if (command === "select-window") {
      const { session, window } = this.findWindow(args[args.indexOf("-t") + 1] ?? "");
      for (const candidate of session.windows) candidate.active = candidate === window;
      return "";
    }
    if (command === "split-window") {
      const { session, window } = this.findWindow(args[args.indexOf("-t") + 1] ?? "");
      const cwd = args.includes("-c") ? (args[args.indexOf("-c") + 1] ?? session.cwd) : session.cwd;
      for (const pane of window.panes) pane.active = false;
      window.panes.push(this.makePane(cwd, true));
      return this.format(session);
    }
    if (command === "select-pane") {
      const { window, pane } = this.findPane(args[args.indexOf("-t") + 1] ?? "");
      for (const candidate of window.panes) candidate.active = candidate === pane;
      return "";
    }
    if (command === "resize-pane") {
      const pane = this.findPane(args[args.indexOf("-t") + 1] ?? "").pane;
      pane.cols = Number(args[args.indexOf("-x") + 1] ?? pane.cols);
      pane.rows = Number(args[args.indexOf("-y") + 1] ?? pane.rows);
      return "";
    }
    if (command === "resize-window") {
      const { window } = this.findWindow(args[args.indexOf("-t") + 1] ?? "");
      window.cols = Number(args[args.indexOf("-x") + 1] ?? window.cols);
      window.rows = Number(args[args.indexOf("-y") + 1] ?? window.rows);
      return "";
    }
    if (command === "capture-pane") {
      const { pane } = this.findPane(args[args.indexOf("-t") + 1] ?? "");
      return this.capturedScreens.get(pane.id) ?? "";
    }
    if (command === "kill-pane") {
      const { window, pane } = this.findPane(args[args.indexOf("-t") + 1] ?? "");
      window.panes = window.panes.filter((candidate) => candidate !== pane);
      return "";
    }
    if (command === "kill-window") {
      const { session, window } = this.findWindow(args[args.indexOf("-t") + 1] ?? "");
      session.windows = session.windows.filter((candidate) => candidate !== window);
      return "";
    }
    throw new Error(`unsupported fake tmux command ${command}`);
  }
}

function makeLayer(
  adapter = new FakeControlModeAdapter(),
  baseDirOrPrefix: string | { readonly prefix: string } = { prefix: "fenrir-tmux-workspace-" },
) {
  const configLayer = ServerConfig.layerTest(process.cwd(), baseDirOrPrefix).pipe(
    Layer.provide(NodeServices.layer),
  );
  return {
    adapter,
    layer: makeTmuxWorkspaceServiceLive({
      isCommandAvailable: (command) => adapter.isCommandAvailable(command),
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          NodeServices.layer,
          configLayer,
          Layer.succeed(TmuxControlModeAdapter, adapter),
          TmuxPaneStreamServiceLive,
        ),
      ),
    ),
  };
}

describe("TmuxWorkspaceServiceLive", () => {
  it.effect("ensures a workspace and reconciles tmux windows and panes", () => {
    const { adapter, layer } = makeLayer();

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const snapshot = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-1"),
        cwd: "/tmp/project",
        initialGrants: [AUTH_GRANT],
      });

      expect(snapshot.workspace.tmuxSessionName).toBe("fenrir-ws-project-1");
      expect(snapshot.workspace.status).toBe("running");
      expect(snapshot.windows).toHaveLength(1);
      expect(snapshot.panes).toHaveLength(1);
      expect(adapter.connections).toHaveLength(1);
      expect(adapter.adminCalls.some((args) => args[0] === "list-panes")).toBe(true);
    }).pipe(Effect.provide(layer));
  });

  it.effect("exports workspace identity and server URL into the tmux session environment", () => {
    const { adapter, layer } = makeLayer();

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const snapshot = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-env"),
        cwd: "/tmp/project",
        initialGrants: [AUTH_GRANT],
      });

      const environmentCalls = adapter.adminCalls.filter((args) => args[0] === "set-environment");
      const exportedKeys = environmentCalls.map((args) => args.at(-2));
      expect(exportedKeys).toContain("FENRIR_WORKSPACE_ID");
      expect(exportedKeys).toContain("FENRIR_SERVER_URL");
      // No agent-feed credential provided: the hook token must not appear.
      expect(exportedKeys).not.toContain("FENRIR_HOOK_TOKEN");
      const workspaceIdCall = environmentCalls.find(
        (args) => args.at(-2) === "FENRIR_WORKSPACE_ID",
      );
      expect(workspaceIdCall?.at(-1)).toBe(snapshot.workspace.workspaceId);
      // The same entries ride `new-session -e` so the session's INITIAL pane
      // (spawned before any set-environment can run) inherits them too.
      const connectEnvironmentKeys = (adapter.connectCalls[0]?.environment ?? []).map(
        ([key]) => key,
      );
      expect(connectEnvironmentKeys).toContain("FENRIR_WORKSPACE_ID");
      expect(connectEnvironmentKeys).toContain("FENRIR_SERVER_URL");
      expect(connectEnvironmentKeys).not.toContain("FENRIR_HOOK_TOKEN");
    }).pipe(Effect.provide(layer));
  });

  it.effect("exports the agent-feed hook token when the credential is provided", () => {
    const adapter = new FakeControlModeAdapter();
    const configLayer = ServerConfig.layerTest(process.cwd(), {
      prefix: "fenrir-tmux-workspace-",
    }).pipe(Layer.provide(NodeServices.layer));
    const layer = makeTmuxWorkspaceServiceLive({
      isCommandAvailable: (command) => adapter.isCommandAvailable(command),
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          NodeServices.layer,
          configLayer,
          Layer.succeed(TmuxControlModeAdapter, adapter),
          TmuxPaneStreamServiceLive,
          Layer.succeed(AgentFeedHookCredential, { token: "hook-token-test" }),
        ),
      ),
    );

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-env-token"),
        cwd: "/tmp/project",
        initialGrants: [AUTH_GRANT],
      });

      const tokenCall = adapter.adminCalls.find(
        (args) => args[0] === "set-environment" && args.at(-2) === "FENRIR_HOOK_TOKEN",
      );
      expect(tokenCall?.at(-1)).toBe("hook-token-test");
      // The token must also be present at session creation so agents started
      // in the very first pane can authenticate to the approval-feed endpoint.
      const connectToken = (adapter.connectCalls[0]?.environment ?? []).find(
        ([key]) => key === "FENRIR_HOOK_TOKEN",
      );
      expect(connectToken?.[1]).toBe("hook-token-test");
    }).pipe(Effect.provide(layer));
  });

  it.effect("uses the requested workspace id when ensuring a new workspace", () => {
    const { layer } = makeLayer();

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const snapshot = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        workspaceId: TmuxWorkspaceId.make("native-workspace-1"),
        projectId: ProjectId.make("project-1"),
        cwd: "/tmp/project",
        initialGrants: [AUTH_GRANT],
      });

      expect(snapshot.workspace.workspaceId).toBe("native-workspace-1");
      expect(snapshot.windows.every((window) => window.workspaceId === "native-workspace-1")).toBe(
        true,
      );
      expect(snapshot.panes.every((pane) => pane.workspaceId === "native-workspace-1")).toBe(true);
    }).pipe(Effect.provide(layer));
  });

  it.effect("reconciles pane snapshots from only the target workspace tmux session", () => {
    const { adapter, layer } = makeLayer();

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const first = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        workspaceId: TmuxWorkspaceId.make("native-debug-old"),
        projectId: ProjectId.make("project-old"),
        cwd: "/tmp/project-old",
        initialGrants: [AUTH_GRANT],
      });
      const firstTmuxPaneIds = new Set(first.panes.map((pane) => pane.tmuxPaneId));

      const second = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        workspaceId: TmuxWorkspaceId.make("native-debug-new"),
        projectId: ProjectId.make("project-new"),
        cwd: "/tmp/project-new",
        initialGrants: [AUTH_GRANT],
      });
      const paneListCalls = adapter.adminCalls.filter((args) => args[0] === "list-panes");

      expect(second.workspace.tmuxSessionName).toBe("fenrir-ws-project-new");
      expect(second.panes).toHaveLength(1);
      expect(second.panes.some((pane) => firstTmuxPaneIds.has(pane.tmuxPaneId))).toBe(false);
      expect(
        paneListCalls.every(
          (args) =>
            !args.includes("-a") &&
            args.includes("-t") &&
            args[args.indexOf("-t") + 1]?.startsWith("fenrir-ws-"),
        ),
      ).toBe(true);
    }).pipe(Effect.provide(layer));
  });

  it.effect("rejects duplicate requested workspace ids across projects", () => {
    const { layer } = makeLayer();

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const requestedId = TmuxWorkspaceId.make("native-workspace-collision");
      const initial = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        workspaceId: requestedId,
        projectId: ProjectId.make("project-1"),
        cwd: "/tmp/project",
        initialGrants: [AUTH_GRANT],
      });

      const duplicate = yield* Effect.exit(
        service.ensureWorkspace({
          actor: AUTH_ACTOR,
          workspaceId: requestedId,
          projectId: ProjectId.make("project-2"),
          cwd: "/tmp/project-2",
          initialGrants: [AUTH_GRANT],
        }),
      );
      const projectSnapshot = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-1"),
        cwd: "/tmp/project",
        initialGrants: [AUTH_GRANT],
      });

      expect(duplicate._tag).toBe("Failure");
      if (duplicate._tag === "Failure") {
        expect(String(duplicate.cause)).toContain(
          "requested tmux workspace id is already assigned to another project",
        );
      }
      expect(projectSnapshot.workspace.workspaceId).toBe(initial.workspace.workspaceId);
      expect(projectSnapshot.workspace.projectId).toBe("project-1");
    }).pipe(Effect.provide(layer));
  });

  it.effect("reports empty control-mode connect errors without schema defects", () => {
    const { adapter, layer } = makeLayer();
    adapter.connectFailures.push(new Error(""));

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const exit = yield* Effect.exit(
        service.ensureWorkspace({
          actor: AUTH_ACTOR,
          workspaceId: TmuxWorkspaceId.make("native-workspace-empty-error"),
          projectId: ProjectId.make("project-empty-error"),
          cwd: "/tmp/project",
          initialGrants: [AUTH_GRANT],
        }),
      );

      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        expect(String(exit.cause)).toContain("tmux control-mode connection failed");
      }
    }).pipe(Effect.provide(layer));
  });

  it.effect("scopes workspace list revision to workspaces visible to the actor", () => {
    const { layer } = makeLayer();

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const visible = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-visible"),
        cwd: "/tmp/project-visible",
        initialGrants: [AUTH_GRANT],
      });
      const hidden = yield* service.ensureWorkspace({
        actor: OTHER_ACTOR,
        projectId: ProjectId.make("project-hidden"),
        cwd: "/tmp/project-hidden",
        initialGrants: [OTHER_GRANT],
      });
      yield* service.createPane({
        actor: OTHER_ACTOR,
        workspaceId: hidden.workspace.workspaceId,
        windowId: hidden.windows[0]!.windowId,
        kind: "shell",
        split: "horizontal",
      });

      const listed = yield* service.listWorkspaces({ actor: AUTH_ACTOR });

      expect(listed.workspaces.map((workspace) => workspace.projectId)).toEqual([
        visible.workspace.projectId,
      ]);
      expect(listed.revision).toBe(visible.revision);
    }).pipe(Effect.provide(layer));
  });

  it.effect("requires workspace:control before workspace bootstrap or revival side effects", () => {
    const { adapter, layer } = makeLayer();

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const deniedCreate = yield* Effect.exit(
        service.ensureWorkspace({
          actor: AUTH_ACTOR,
          projectId: ProjectId.make("project-read-only"),
          cwd: "/tmp/project-read-only",
          initialGrants: [READ_ONLY_GRANT],
        }),
      );
      expect(deniedCreate._tag).toBe("Failure");
      expect(adapter.connections).toHaveLength(0);

      const snapshot = yield* service.ensureWorkspace({
        actor: OTHER_ACTOR,
        projectId: ProjectId.make("project-1"),
        cwd: "/tmp/project",
        initialGrants: [OTHER_GRANT, NO_WORKSPACE_CONTROL_GRANT],
      });
      const connectionsAfterCreate = adapter.connections.length;
      const adminCallsAfterCreate = adapter.adminCalls.length;

      const deniedEnsureExisting = yield* Effect.exit(
        service.ensureWorkspace({
          actor: AUTH_ACTOR,
          projectId: ProjectId.make("project-1"),
          cwd: "/tmp/project",
          initialGrants: [NO_WORKSPACE_CONTROL_GRANT],
        }),
      );

      const denied = yield* Effect.exit(
        service.reconnectWorkspace({
          actor: AUTH_ACTOR,
          workspaceId: snapshot.workspace.workspaceId,
        }),
      );

      expect(deniedEnsureExisting._tag).toBe("Failure");
      expect(denied._tag).toBe("Failure");
      expect(adapter.connections).toHaveLength(connectionsAfterCreate);
      expect(adapter.adminCalls).toHaveLength(adminCallsAfterCreate);
      expect(adapter.connections[0]?.restartCount).toBe(0);
    }).pipe(Effect.provide(layer));
  });

  it.effect("requires window:control for window creation, focus, rename, and detach", () => {
    const { adapter, layer } = makeLayer();

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const snapshot = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-1"),
        cwd: "/tmp/project",
        initialGrants: [NO_WINDOW_CONTROL_GRANT],
      });
      const window = snapshot.windows[0]!;

      const create = yield* Effect.exit(
        service.createWindow({
          actor: AUTH_ACTOR,
          workspaceId: snapshot.workspace.workspaceId,
          name: "ops",
        }),
      );
      const focus = yield* Effect.exit(
        service.focusWindow({
          actor: AUTH_ACTOR,
          workspaceId: snapshot.workspace.workspaceId,
          windowId: window.windowId,
        }),
      );
      const rename = yield* Effect.exit(
        service.renameWindow({
          actor: AUTH_ACTOR,
          workspaceId: snapshot.workspace.workspaceId,
          windowId: window.windowId,
          name: "renamed",
        }),
      );
      const detach = yield* Effect.exit(
        service.closeWindow({
          actor: AUTH_ACTOR,
          workspaceId: snapshot.workspace.workspaceId,
          windowId: window.windowId,
          mode: "detach",
        }),
      );

      expect(create._tag).toBe("Failure");
      expect(focus._tag).toBe("Failure");
      expect(rename._tag).toBe("Failure");
      expect(detach._tag).toBe("Failure");
      expect(adapter.adminCalls.some((args) => args[0] === "new-window")).toBe(false);
      expect(adapter.adminCalls.some((args) => args[0] === "select-window")).toBe(false);
      expect(adapter.adminCalls.some((args) => args[0] === "rename-window")).toBe(false);
      expect(adapter.adminCalls.some((args) => args[0] === "kill-window")).toBe(false);
    }).pipe(Effect.provide(layer));
  });

  it.effect("requires session:destroy for destructive window close", () => {
    const { adapter, layer } = makeLayer();

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const snapshot = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-1"),
        cwd: "/tmp/project",
        initialGrants: [NO_SESSION_DESTROY_GRANT],
      });

      const denied = yield* Effect.exit(
        service.closeWindow({
          actor: AUTH_ACTOR,
          workspaceId: snapshot.workspace.workspaceId,
          windowId: snapshot.windows[0]!.windowId,
          mode: "destroy",
        }),
      );

      expect(denied._tag).toBe("Failure");
      expect(adapter.adminCalls.some((args) => args[0] === "kill-window")).toBe(false);
    }).pipe(Effect.provide(layer));
  });

  it.effect("allows authorized window and pane control operations", () => {
    const { adapter, layer } = makeLayer();

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const snapshot = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-1"),
        cwd: "/tmp/project",
        initialGrants: [AUTH_GRANT],
      });
      const afterWindow = yield* service.createWindow({
        actor: AUTH_ACTOR,
        workspaceId: snapshot.workspace.workspaceId,
        name: "ops",
      });
      const opsWindow = afterWindow.windows.find((window) => window.name === "ops")!;
      const pane = afterWindow.panes.find(
        (candidate) => candidate.windowId === opsWindow.windowId,
      )!;

      const focusedWindow = yield* service.focusWindow({
        actor: AUTH_ACTOR,
        workspaceId: snapshot.workspace.workspaceId,
        windowId: opsWindow.windowId,
      });
      const renamedWindow = yield* service.renameWindow({
        actor: AUTH_ACTOR,
        workspaceId: snapshot.workspace.workspaceId,
        windowId: opsWindow.windowId,
        name: "ops-renamed",
      });
      const focusedPane = yield* service.focusPane({
        actor: AUTH_ACTOR,
        workspaceId: snapshot.workspace.workspaceId,
        paneId: pane.paneId,
      });

      expect(focusedWindow.workspace.activeWindowId).toBe(opsWindow.windowId);
      expect(renamedWindow.name).toBe("ops-renamed");
      expect(
        focusedPane.windows.find((window) => window.windowId === opsWindow.windowId)?.activePaneId,
      ).toBe(pane.paneId);
      expect(adapter.adminCalls.some((args) => args[0] === "select-window")).toBe(true);
      expect(adapter.adminCalls.some((args) => args[0] === "rename-window")).toBe(true);
      expect(adapter.adminCalls.some((args) => args[0] === "select-pane")).toBe(true);
    }).pipe(Effect.provide(layer));
  });

  it.effect("requires process and neovim launch permissions for pane creation", () => {
    const { adapter, layer } = makeLayer();

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const snapshot = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-1"),
        cwd: "/tmp/project",
        initialGrants: [NO_PROCESS_SPAWN_GRANT],
      });
      const window = snapshot.windows[0]!;
      const splitCallsBefore = adapter.adminCalls.filter(
        (args) => args[0] === "split-window",
      ).length;

      const commandPane = yield* Effect.exit(
        service.createPane({
          actor: AUTH_ACTOR,
          workspaceId: snapshot.workspace.workspaceId,
          windowId: window.windowId,
          kind: "shell",
          split: "horizontal",
          command: "echo denied",
        }),
      );
      const neovimMissingProcess = yield* Effect.exit(
        service.createPane({
          actor: AUTH_ACTOR,
          workspaceId: snapshot.workspace.workspaceId,
          windowId: window.windowId,
          kind: "neovim",
          split: "vertical",
        }),
      );
      const neovimAllowedProcessSnapshot = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-2"),
        cwd: "/tmp/project-2",
        initialGrants: [NO_NEOVIM_LAUNCH_GRANT],
      });
      const neovimPane = yield* Effect.exit(
        service.createPane({
          actor: AUTH_ACTOR,
          workspaceId: neovimAllowedProcessSnapshot.workspace.workspaceId,
          windowId: neovimAllowedProcessSnapshot.windows[0]!.windowId,
          kind: "neovim",
          split: "vertical",
        }),
      );

      const splitCallsAfter = adapter.adminCalls.filter(
        (args) => args[0] === "split-window",
      ).length;
      expect(commandPane._tag).toBe("Failure");
      expect(neovimMissingProcess._tag).toBe("Failure");
      expect(neovimPane._tag).toBe("Failure");
      expect(splitCallsAfter).toBe(splitCallsBefore);
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "creates Neovim panes with bootstrap command, context metadata, and registry labels",
    () => {
      const { adapter, layer } = makeLayer();

      return Effect.gen(function* () {
        const service = yield* TmuxWorkspaceService;
        const initial = yield* service.ensureWorkspace({
          actor: AUTH_ACTOR,
          projectId: ProjectId.make("project-1"),
          cwd: "/tmp/project",
          initialGrants: [AUTH_GRANT],
        });
        const window = initial.windows[0]!;

        const afterCreate = yield* service.createNeovimPane({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
          windowId: window.windowId,
          cwd: "/tmp/project",
          files: ["/tmp/project/README.md"],
          line: 12,
          column: 4,
          profileId: "fenrir-dark",
          themeId: "fenrir-dark-high-contrast",
          keybindingProfileId: "vim-tmux-navigator",
          split: "vertical",
          launchSource: "user",
        });
        const pane = afterCreate.panes.find((candidate) => candidate.metadata.kind === "neovim")!;
        if (pane.metadata.kind !== "neovim") {
          throw new Error("expected Neovim pane metadata");
        }
        const splitCommand = adapter.adminCalls.findLast((args) => args[0] === "split-window")!;
        const command = splitCommand.at(-1) ?? "";

        expect(splitCommand).toContain("-v");
        expect(command).toContain("env");
        expect(command).toContain(`FENRIR_WORKSPACE_ID='${initial.workspace.workspaceId}'`);
        expect(command).toContain(`FENRIR_WINDOW_ID='${window.windowId}'`);
        expect(command).toContain("FENRIR_NEOVIM_PROFILE_ID='fenrir-dark'");
        expect(command).toContain("FENRIR_NEOVIM_THEME_ID='fenrir-dark-high-contrast'");
        expect(command).toContain("FENRIR_NEOVIM_KEYBINDING_PROFILE_ID='vim-tmux-navigator'");
        expect(command).toContain("NVIM_LISTEN_ADDRESS='/tmp/fenrir-nvim-");
        expect(command).toContain("nvim");
        expect(command).toContain("'+call cursor(12,4)'");
        expect(command).toContain("'/tmp/project/README.md'");
        expect(pane.metadata).toMatchObject({
          kind: "neovim",
          process: {
            command,
            argv: ["nvim", "/tmp/project/README.md"],
            envKeys: [
              "FENRIR_WORKSPACE_ID",
              "FENRIR_WINDOW_ID",
              "FENRIR_NEOVIM_BOOTSTRAP_ID",
              "FENRIR_NEOVIM_PROFILE_ID",
              "FENRIR_NEOVIM_THEME_ID",
              "FENRIR_NEOVIM_KEYBINDING_PROFILE_ID",
              "NVIM_LISTEN_ADDRESS",
            ],
          },
          labels: {
            "fenrir.process.kind": "neovim",
            "fenrir.neovim.profileId": "fenrir-dark",
            "fenrir.neovim.themeId": "fenrir-dark-high-contrast",
            "fenrir.neovim.keybindingProfileId": "vim-tmux-navigator",
            "fenrir.neovim.bridge": "nvim-listen-address",
            "fenrir.neovim.launchSource": "user",
          },
          neovim: {
            workspaceId: initial.workspace.workspaceId,
            windowId: window.windowId,
            cwd: "/tmp/project",
            profileId: "fenrir-dark",
            themeId: "fenrir-dark-high-contrast",
            keybindingProfileId: "vim-tmux-navigator",
            files: ["/tmp/project/README.md"],
            line: 12,
            column: 4,
            launchSource: "user",
          },
        });
        expect(pane.metadata.neovim.bootstrapId).toMatch(/^nvim-[a-f0-9]{40}$/);
        expect(pane.metadata.neovim.bridgeSocketPath).toBe(
          `/tmp/fenrir-${pane.metadata.neovim.bootstrapId}.sock`,
        );
        expect(pane.metadata.neovim.bootstrapId.length).toBeLessThanOrEqual(128);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("routes generic Neovim pane creation through the bootstrap bridge", () => {
    const { adapter, layer } = makeLayer();

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const initial = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-1"),
        cwd: "/tmp/project",
        initialGrants: [AUTH_GRANT],
      });
      const window = initial.windows[0]!;

      const afterCreate = yield* service.createPane({
        actor: AUTH_ACTOR,
        workspaceId: initial.workspace.workspaceId,
        windowId: window.windowId,
        kind: "neovim",
        split: "horizontal",
      });
      const pane = afterCreate.panes.find((candidate) => candidate.metadata.kind === "neovim")!;
      if (pane.metadata.kind !== "neovim") {
        throw new Error("expected Neovim pane metadata");
      }
      const command =
        adapter.adminCalls.findLast((args) => args[0] === "split-window")?.at(-1) ?? "";

      expect(command).toContain("FENRIR_WORKSPACE_ID=");
      expect(command).toContain("FENRIR_WINDOW_ID=");
      expect(command).toContain("FENRIR_NEOVIM_BOOTSTRAP_ID=");
      expect(command).toContain("FENRIR_NEOVIM_PROFILE_ID=");
      expect(pane.metadata.process.command).toBe(command);
      expect(pane.metadata.neovim.bootstrapId).toMatch(/^nvim-[a-f0-9]{40}$/);
      expect(pane.metadata.neovim.bootstrapId.length).toBeLessThanOrEqual(128);
    }).pipe(Effect.provide(layer));
  });

  it.effect("rejects custom generic Neovim pane creation without bridge bootstrap metadata", () => {
    const { adapter, layer } = makeLayer();

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const initial = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-1"),
        cwd: "/tmp/project",
        initialGrants: [AUTH_GRANT],
      });
      const window = initial.windows[0]!;
      const splitCallsBefore = adapter.adminCalls.filter(
        (args) => args[0] === "split-window",
      ).length;

      const denied = yield* Effect.exit(
        service.createPane({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
          windowId: window.windowId,
          kind: "neovim",
          split: "horizontal",
          command: "nvim",
        }),
      );
      const splitCallsAfter = adapter.adminCalls.filter(
        (args) => args[0] === "split-window",
      ).length;

      expect(denied._tag).toBe("Failure");
      expect(splitCallsAfter).toBe(splitCallsBefore);
    }).pipe(Effect.provide(layer));
  });

  it.effect("reports missing nvim without registering a fake Neovim pane", () => {
    const { adapter, layer } = makeLayer();

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const initial = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-1"),
        cwd: "/tmp/project",
        initialGrants: [AUTH_GRANT],
      });
      adapter.nvimAvailable = false;

      const error = yield* Effect.flip(
        service.createNeovimPane({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
          windowId: initial.windows[0]!.windowId,
          files: ["/tmp/project/README.md"],
        }),
      );
      const snapshot = yield* service.getSnapshot({
        actor: AUTH_ACTOR,
        workspaceId: initial.workspace.workspaceId,
      });

      expect(error.code).toBe("nvim-unavailable");
      expect(snapshot.panes.filter((pane) => pane.metadata.kind === "neovim")).toHaveLength(0);
      expect(adapter.adminCalls.some((args) => args[0] === "split-window")).toBe(false);
    }).pipe(Effect.provide(layer));
  });

  it.effect("reports missing tmux before workspace bootstrap creates runtime panes", () => {
    const adapter = new FakeControlModeAdapter();
    adapter.connectFailures.push(new Error("tmux: command not found"));
    const { layer } = makeLayer(adapter);

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const error = yield* Effect.flip(
        service.ensureWorkspace({
          actor: AUTH_ACTOR,
          projectId: ProjectId.make("project-1"),
          cwd: "/tmp/project",
          initialGrants: [AUTH_GRANT],
        }),
      );

      expect(error.code).toBe("control-mode-unavailable");
      expect(adapter.connections).toHaveLength(0);
    }).pipe(Effect.provide(layer));
  });

  it.effect("rejects forged Neovim bridge metadata before tmux side effects", () => {
    const { adapter, layer } = makeLayer();

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const initial = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-1"),
        cwd: "/tmp/project",
        initialGrants: [AUTH_GRANT],
      });
      const window = initial.windows[0]!;
      const forgedCommand = [
        "env",
        `FENRIR_WORKSPACE_ID='${initial.workspace.workspaceId}'`,
        `FENRIR_WINDOW_ID='${window.windowId}'`,
        "FENRIR_NEOVIM_BOOTSTRAP_ID='nvim-forged'",
        "FENRIR_NEOVIM_PROFILE_ID='default'",
        "FENRIR_NEOVIM_THEME_ID='fenrir-dark'",
        "FENRIR_NEOVIM_KEYBINDING_PROFILE_ID='native-compatible'",
        "NVIM_LISTEN_ADDRESS='/tmp/fenrir-nvim-forged.sock'",
        "sh",
        "-lc",
        "'echo not-nvim'",
      ].join(" ");
      const forgedMetadata: TmuxNeovimPaneMetadata = {
        kind: "neovim",
        title: "Neovim",
        process: {
          command: forgedCommand,
          argv: ["nvim"],
          envKeys: [
            "FENRIR_WORKSPACE_ID",
            "FENRIR_WINDOW_ID",
            "FENRIR_NEOVIM_BOOTSTRAP_ID",
            "FENRIR_NEOVIM_PROFILE_ID",
            "FENRIR_NEOVIM_THEME_ID",
            "FENRIR_NEOVIM_KEYBINDING_PROFILE_ID",
            "NVIM_LISTEN_ADDRESS",
          ],
          pid: null,
          startedAt: null,
          exitedAt: null,
          exitCode: null,
          exitSignal: null,
        },
        labels: {
          "fenrir.process.kind": "neovim",
          "fenrir.neovim.bootstrapId": "nvim-forged",
          "fenrir.neovim.profileId": "default",
          "fenrir.neovim.themeId": "fenrir-dark",
          "fenrir.neovim.keybindingProfileId": "native-compatible",
          "fenrir.neovim.bridge": "nvim-listen-address",
          "fenrir.neovim.bridgeSocketPath": "/tmp/fenrir-nvim-forged.sock",
          "fenrir.neovim.launchSource": "user",
        },
        neovim: {
          bootstrapId: "nvim-forged",
          workspaceId: initial.workspace.workspaceId,
          windowId: window.windowId,
          cwd: "/tmp/project",
          profileId: "default",
          themeId: "fenrir-dark",
          keybindingProfileId: "native-compatible",
          bridgeSocketPath: "/tmp/fenrir-nvim-forged.sock",
          files: [],
          launchSource: "user",
          bootstrapEnvKeys: [
            "FENRIR_WORKSPACE_ID",
            "FENRIR_WINDOW_ID",
            "FENRIR_NEOVIM_BOOTSTRAP_ID",
            "FENRIR_NEOVIM_PROFILE_ID",
            "FENRIR_NEOVIM_THEME_ID",
            "FENRIR_NEOVIM_KEYBINDING_PROFILE_ID",
            "NVIM_LISTEN_ADDRESS",
          ],
        },
        agent: null,
        workflow: null,
        managedProcess: null,
        remoteProcess: null,
        browserLab: null,
      };
      const splitCallsBefore = adapter.adminCalls.filter(
        (args) => args[0] === "split-window",
      ).length;

      const denied = yield* Effect.exit(
        service.createPane({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
          windowId: window.windowId,
          cwd: "/tmp/project",
          kind: "neovim",
          split: "horizontal",
          command: forgedCommand,
          metadata: forgedMetadata,
        }),
      );
      const splitCallsAfter = adapter.adminCalls.filter(
        (args) => args[0] === "split-window",
      ).length;

      expect(denied._tag).toBe("Failure");
      expect(splitCallsAfter).toBe(splitCallsBefore);
    }).pipe(Effect.provide(layer));
  });

  it.effect("generates contract-bounded Neovim bootstrap ids for long file paths", () => {
    const { layer } = makeLayer();

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const initial = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-1"),
        cwd: "/tmp/project",
        initialGrants: [AUTH_GRANT],
      });
      const window = initial.windows[0]!;
      const longFile = `/tmp/project/${"nested/".repeat(16)}README.md`;

      const afterCreate = yield* service.createNeovimPane({
        actor: AUTH_ACTOR,
        workspaceId: initial.workspace.workspaceId,
        windowId: window.windowId,
        files: [longFile],
        profileId: "fenrir-dark-with-long-profile-name",
      });
      const pane = afterCreate.panes.find((candidate) => candidate.metadata.kind === "neovim")!;
      if (pane.metadata.kind !== "neovim") {
        throw new Error("expected Neovim pane metadata");
      }

      expect(pane.metadata.neovim.bootstrapId).toMatch(/^nvim-[a-f0-9]{40}$/);
      expect(pane.metadata.neovim.bootstrapId.length).toBeLessThanOrEqual(128);
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "reconnects Neovim panes by focusing registered running panes or recreating missing ones",
    () => {
      const { adapter, layer } = makeLayer();

      return Effect.gen(function* () {
        const service = yield* TmuxWorkspaceService;
        const initial = yield* service.ensureWorkspace({
          actor: AUTH_ACTOR,
          projectId: ProjectId.make("project-1"),
          cwd: "/tmp/project",
          initialGrants: [AUTH_GRANT],
        });
        const window = initial.windows[0]!;
        const created = yield* service.createNeovimPane({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
          windowId: window.windowId,
          files: ["/tmp/project/README.md"],
          profileId: "fenrir-dark",
        });
        const firstPane = created.panes.find((pane) => pane.metadata.kind === "neovim")!;
        const splitCallsAfterCreate = adapter.adminCalls.filter(
          (args) => args[0] === "split-window",
        ).length;

        const focused = yield* service.reconnectNeovimPane({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
          windowId: window.windowId,
          files: ["/tmp/project/README.md"],
          profileId: "fenrir-dark",
        });
        const splitCallsAfterFocus = adapter.adminCalls.filter(
          (args) => args[0] === "split-window",
        ).length;

        yield* service.closePane({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
          paneId: firstPane.paneId,
          mode: "detach",
        });
        const recreated = yield* service.reconnectNeovimPane({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
          windowId: window.windowId,
          files: ["/tmp/project/README.md"],
          profileId: "fenrir-dark",
        });
        const runningNeovim = recreated.panes.filter(
          (pane) => pane.metadata.kind === "neovim" && pane.status === "running",
        );
        const recreatedPane = runningNeovim[0];
        if (!recreatedPane || recreatedPane.metadata.kind !== "neovim") {
          throw new Error("expected recreated Neovim pane metadata");
        }

        expect(
          focused.windows.find((candidate) => candidate.windowId === window.windowId)?.activePaneId,
        ).toBe(firstPane.paneId);
        expect(splitCallsAfterFocus).toBe(splitCallsAfterCreate);
        expect(runningNeovim).toHaveLength(1);
        expect(recreatedPane.paneId).not.toBe(firstPane.paneId);
        expect(recreatedPane.metadata.neovim.launchSource).toBe("restore");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("reattaches control mode before reconnecting a restored Neovim pane", () => {
    const baseDir = join(tmpdir(), `fenrir-tmux-workspace-${randomUUID()}`);
    const adapter = new FakeControlModeAdapter();
    const first = makeLayer(adapter, baseDir);
    const second = makeLayer(adapter, baseDir);

    return Effect.gen(function* () {
      const created = yield* Effect.gen(function* () {
        const service = yield* TmuxWorkspaceService;
        const initial = yield* service.ensureWorkspace({
          actor: AUTH_ACTOR,
          projectId: ProjectId.make("project-1"),
          cwd: "/tmp/project",
          initialGrants: [AUTH_GRANT],
        });
        const window = initial.windows[0]!;
        const afterCreate = yield* service.createNeovimPane({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
          windowId: window.windowId,
          cwd: "/tmp/project",
          files: ["/tmp/project/README.md"],
          profileId: "fenrir-dark",
        });
        const pane = afterCreate.panes.find((candidate) => candidate.metadata.kind === "neovim")!;
        return {
          workspaceId: initial.workspace.workspaceId,
          windowId: window.windowId,
          paneId: pane.paneId,
        };
      }).pipe(Effect.provide(first.layer));
      const connectionsAfterCreate = adapter.connections.length;
      const adminCallsAfterCreate = adapter.adminCalls.length;

      const reconnected = yield* Effect.gen(function* () {
        const service = yield* TmuxWorkspaceService;
        const restored = yield* service.getSnapshot({
          actor: AUTH_ACTOR,
          workspaceId: created.workspaceId,
        });
        expect(restored.workspace.status).toBe("detached");

        return yield* service.reconnectNeovimPane({
          actor: AUTH_ACTOR,
          workspaceId: created.workspaceId,
          windowId: created.windowId,
          files: ["/tmp/project/README.md"],
          profileId: "fenrir-dark",
        });
      }).pipe(Effect.provide(second.layer));
      const connectionsAfterReconnect = adapter.connections.length;
      const activeWindow = reconnected.windows.find(
        (window) => window.windowId === created.windowId,
      )!;

      expect(connectionsAfterReconnect).toBe(connectionsAfterCreate + 1);
      expect(reconnected.workspace.status).toBe("running");
      expect(activeWindow.activePaneId).toBe(created.paneId);
      expect(reconnected.panes.find((pane) => pane.paneId === created.paneId)?.metadata.kind).toBe(
        "neovim",
      );
      expect(adapter.connections.at(-1)?.listeners.size).toBe(1);
      expect(
        adapter.adminCalls.slice(adminCallsAfterCreate).some((args) => args[0] === "list-panes"),
      ).toBe(true);
    });
  });

  it.effect(
    "creates panes with metadata, resizes, writes, and preserves metadata after reconcile",
    () => {
      const { adapter, layer } = makeLayer();

      return Effect.gen(function* () {
        const service = yield* TmuxWorkspaceService;
        const initial = yield* service.ensureWorkspace({
          actor: AUTH_ACTOR,
          projectId: ProjectId.make("project-1"),
          cwd: "/tmp/project",
          initialGrants: [AUTH_GRANT],
        });
        const window = initial.windows[0]!;
        const afterCreate = yield* service.createPane({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
          windowId: window.windowId,
          kind: "custom",
          split: "horizontal",
          cwd: "/tmp/project",
          metadata: {
            kind: "custom",
            title: "Tool",
            process: null,
            labels: { surface: "ops" },
            neovim: null,
            agent: null,
            workflow: null,
            managedProcess: null,
            remoteProcess: null,
            browserLab: null,
          },
        });
        const created = afterCreate.panes.find((pane) => pane.metadata.kind === "custom")!;

        const resized = yield* service.resizePane({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
          paneId: created.paneId,
          cols: 140,
          rows: 44,
        });
        const write = yield* service.writePane({
          workspaceId: initial.workspace.workspaceId,
          paneId: created.paneId,
          actor: AUTH_ACTOR,
          requestId: "req-1",
          data: "echo hello\n",
        });
        const reconciled = yield* service.getSnapshot({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
        });

        expect(resized.cols).toBe(140);
        expect(resized.rows).toBe(44);
        expect(write).toMatchObject({ type: "accepted", inputSeq: 1 });
        expect(
          adapter.connections[0]?.commands.filter((command) => command.command === "send-keys"),
        ).toEqual([
          {
            command: "send-keys",
            args: ["-t", created.tmuxPaneId, "-l", "echo hello\n"],
          },
        ]);
        expect(
          reconciled.panes.find((pane) => pane.paneId === created.paneId)?.metadata,
        ).toMatchObject({
          kind: "custom",
          title: "Tool",
        });
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("resizes a sole pane by sizing its window to the client viewport", () => {
    const { adapter, layer } = makeLayer();

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const initial = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-1"),
        cwd: "/tmp/project",
        initialGrants: [AUTH_GRANT],
      });
      const pane = initial.panes[0]!;

      const resized = yield* service.resizePane({
        actor: AUTH_ACTOR,
        workspaceId: initial.workspace.workspaceId,
        paneId: pane.paneId,
        cols: 277,
        rows: 74,
      });

      expect(resized.cols).toBe(277);
      expect(resized.rows).toBe(74);
      const resizeCalls = adapter.adminCalls.filter(
        (args) => args[0] === "resize-window" || args[0] === "resize-pane",
      );
      expect(resizeCalls).toEqual([
        ["resize-window", "-t", expect.any(String), "-x", "277", "-y", "74"],
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "decides the resize strategy from the live tmux pane count when the cache is stale",
    () => {
      const { adapter, layer } = makeLayer();

      return Effect.gen(function* () {
        const service = yield* TmuxWorkspaceService;
        const initial = yield* service.ensureWorkspace({
          actor: AUTH_ACTOR,
          projectId: ProjectId.make("project-1"),
          cwd: "/tmp/project",
          initialGrants: [AUTH_GRANT],
        });
        const pane = initial.panes[0]!;
        const window = initial.windows[0]!;
        // Simulate a concurrent split that tmux already applied but the
        // service has not reconciled yet: the cached pane map still sees a
        // single running pane in the window.
        yield* adapter.adminCommand([
          "split-window",
          "-t",
          window.tmuxWindowId,
          "-c",
          "/tmp/project",
        ]);

        const resized = yield* service.resizePane({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
          paneId: pane.paneId,
          cols: 60,
          rows: 20,
        });

        expect(resized.cols).toBe(60);
        expect(resized.rows).toBe(20);
        expect(
          adapter.adminCalls.some(
            (args) => args[0] === "display-message" && args.at(-1) === "#{window_panes}",
          ),
        ).toBe(true);
        // The live count (2 panes) must win over the stale cached count (1):
        // a stale single-pane decision would emit `resize-window -x 60 -y 20`
        // and clobber the sibling pane. The multi-pane path never shrinks the
        // window, so only the pane resize is issued here.
        const resizeCalls = adapter.adminCalls.filter(
          (args) => args[0] === "resize-window" || args[0] === "resize-pane",
        );
        expect(resizeCalls).toEqual([
          ["resize-pane", "-t", pane.tmuxPaneId, "-x", "60", "-y", "20"],
        ]);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("falls back to the cached pane count when the live pane count query fails", () => {
    const { adapter, layer } = makeLayer();

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const initial = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-1"),
        cwd: "/tmp/project",
        initialGrants: [AUTH_GRANT],
      });
      const pane = initial.panes[0]!;
      // Fail the pane-count query: resizePane must fall back to the cached
      // count (one running pane) and still size the window.
      adapter.adminFailuresByCommand.set("display-message", new Error("tmux briefly unavailable"));

      const resized = yield* service.resizePane({
        actor: AUTH_ACTOR,
        workspaceId: initial.workspace.workspaceId,
        paneId: pane.paneId,
        cols: 200,
        rows: 50,
      });

      expect(resized.cols).toBe(200);
      expect(resized.rows).toBe(50);
      const resizeCalls = adapter.adminCalls.filter(
        (args) => args[0] === "resize-window" || args[0] === "resize-pane",
      );
      expect(resizeCalls).toEqual([
        ["resize-window", "-t", expect.any(String), "-x", "200", "-y", "50"],
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("attaches operational metadata and reports pane lifecycle status", () => {
    const { layer } = makeLayer();

    return Effect.gen(function* () {
      const eventsRef = yield* Ref.make<ReadonlyArray<TmuxKernelEvent>>([]);
      const service = yield* TmuxWorkspaceService;
      const initial = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-1"),
        cwd: "/tmp/project",
        initialGrants: [AUTH_GRANT],
      });
      const pane = initial.panes[0]!;
      yield* service.subscribe(
        { actor: AUTH_ACTOR, workspaceId: initial.workspace.workspaceId },
        (event) => Ref.update(eventsRef, (events) => [...events, event]),
      );
      yield* Ref.set(eventsRef, []);

      const attached = yield* service.attachPaneMetadata({
        actor: AUTH_ACTOR,
        workspaceId: initial.workspace.workspaceId,
        paneId: pane.paneId,
        metadata: {
          kind: "workflow",
          title: "Workflow run",
          process: null,
          labels: { "fenrir.surface": "workflow" },
          neovim: null,
          agent: null,
          workflow: {
            workflowId: "workflow-1",
            runId: "run-1",
            stepId: "step-1",
            threadId: ThreadId.make("thread-1"),
          },
          managedProcess: null,
          remoteProcess: null,
          browserLab: null,
        },
      });
      const running = yield* service.listOperationalPaneStatuses({
        actor: AUTH_ACTOR,
        workspaceId: initial.workspace.workspaceId,
      });
      yield* service.closePane({
        actor: AUTH_ACTOR,
        workspaceId: initial.workspace.workspaceId,
        paneId: pane.paneId,
        mode: "detach",
      });
      const closed = yield* service.listOperationalPaneStatuses({
        actor: AUTH_ACTOR,
        workspaceId: initial.workspace.workspaceId,
      });
      const events = yield* Ref.get(eventsRef);

      expect(attached.metadata).toMatchObject({
        kind: "workflow",
        workflow: {
          workflowId: "workflow-1",
          runId: "run-1",
          stepId: "step-1",
          threadId: "thread-1",
        },
      });
      expect(running.panes).toHaveLength(1);
      expect(running.panes[0]).toMatchObject({
        paneId: pane.paneId,
        kind: "workflow",
        status: "running",
      });
      expect(closed.panes[0]).toMatchObject({
        paneId: pane.paneId,
        kind: "workflow",
        status: "closed",
      });
      expect(events.some((event) => event.type === "pane.changed")).toBe(true);
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "tracks agent, managed-process, remote-process, and browser-lab panes as operational surfaces",
    () => {
      const { layer } = makeLayer();

      return Effect.gen(function* () {
        const service = yield* TmuxWorkspaceService;
        const initial = yield* service.ensureWorkspace({
          actor: AUTH_ACTOR,
          projectId: ProjectId.make("project-1"),
          cwd: "/tmp/project",
          initialGrants: [AUTH_GRANT],
        });
        const window = initial.windows[0]!;
        yield* service.createPane({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
          windowId: window.windowId,
          kind: "agent",
          split: "horizontal",
          metadata: {
            kind: "agent",
            title: "Codex agent",
            process: null,
            labels: { "fenrir.surface": "agent" },
            neovim: null,
            agent: {
              providerId: "codex",
              providerInstanceId: "codex",
              threadId: ThreadId.make("thread-agent"),
            },
            workflow: null,
            managedProcess: null,
            remoteProcess: null,
            browserLab: null,
          },
        });
        yield* service.createPane({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
          windowId: window.windowId,
          kind: "managed-process",
          split: "horizontal",
          metadata: {
            kind: "managed-process",
            title: "Dev server",
            process: null,
            labels: { "fenrir.surface": "managed-process" },
            neovim: null,
            agent: null,
            workflow: null,
            managedProcess: { instanceId: "instance-1", processDefId: "dev-server" },
            remoteProcess: null,
            browserLab: null,
          },
        });
        yield* service.createPane({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
          windowId: window.windowId,
          kind: "remote-process",
          split: "horizontal",
          metadata: {
            kind: "remote-process",
            title: "Remote host command",
            process: null,
            labels: { "fenrir.surface": "remote-process" },
            neovim: null,
            agent: null,
            workflow: null,
            managedProcess: null,
            remoteProcess: {
              hostId: "host-1",
              connectionId: "connection-1",
              commandRunId: "run-1",
            },
            browserLab: null,
          },
        });
        yield* service.createPane({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
          windowId: window.windowId,
          kind: "browser-lab",
          split: "horizontal",
          metadata: {
            kind: "browser-lab",
            title: "Browser Lab",
            process: null,
            labels: { "fenrir.surface": "browser-lab" },
            neovim: null,
            agent: null,
            workflow: null,
            managedProcess: null,
            remoteProcess: null,
            browserLab: {
              profileId: "profile-1",
              tabId: "tab-1",
              origin: "https://example.test",
            },
          },
        });

        const statuses = yield* service.listOperationalPaneStatuses({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
        });

        expect(statuses.panes.map((pane) => pane.kind).toSorted()).toEqual([
          "agent",
          "browser-lab",
          "managed-process",
          "remote-process",
        ]);
        expect(statuses.panes.every((pane) => pane.status === "running")).toBe(true);
        expect(JSON.stringify(statuses)).not.toContain("secret bytes");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "creates managed-process panes running a command and terminates them through pane close",
    () => {
      const { adapter, layer } = makeLayer();

      return Effect.gen(function* () {
        const service = yield* TmuxWorkspaceService;
        const initial = yield* service.ensureWorkspace({
          actor: AUTH_ACTOR,
          projectId: ProjectId.make("project-1"),
          cwd: "/tmp/project",
          initialGrants: [AUTH_GRANT],
        });
        const window = initial.windows[0]!;
        const existingPaneIds = new Set(initial.panes.map((pane) => pane.paneId));

        const afterCreate = yield* service.createPane({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
          windowId: window.windowId,
          kind: "managed-process",
          split: "horizontal",
          cwd: "/tmp/project/apps/web",
          command: "bun run dev",
          metadata: {
            kind: "managed-process",
            title: "bun run dev",
            process: {
              command: "bun run dev",
              argv: [],
              envKeys: [],
              pid: null,
              startedAt: null,
              exitedAt: null,
              exitCode: null,
              exitSignal: null,
            },
            labels: { "fenrir.script": "dev" },
            neovim: null,
            agent: null,
            workflow: null,
            managedProcess: { instanceId: "script-run-1", processDefId: "script:dev" },
            remoteProcess: null,
            browserLab: null,
          },
        });

        const created = afterCreate.panes.find((pane) => !existingPaneIds.has(pane.paneId));
        expect(created).toBeDefined();
        expect(created!.status).toBe("running");
        expect(created!.metadata).toMatchObject({
          kind: "managed-process",
          title: "bun run dev",
          process: { command: "bun run dev" },
          managedProcess: { instanceId: "script-run-1", processDefId: "script:dev" },
        });

        const splitCall = adapter.adminCalls.findLast((args) => args[0] === "split-window");
        expect(splitCall).toBeDefined();
        expect(splitCall).toContain("-h");
        expect(splitCall![splitCall!.indexOf("-c") + 1]).toBe("/tmp/project/apps/web");
        expect(splitCall!.at(-1)).toBe("bun run dev");

        const statuses = yield* service.listOperationalPaneStatuses({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
        });
        expect(
          statuses.panes.some(
            (pane) => pane.paneId === created!.paneId && pane.kind === "managed-process",
          ),
        ).toBe(true);

        const afterClose = yield* service.closePane({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
          paneId: created!.paneId,
          mode: "terminate",
        });
        expect(
          adapter.adminCalls.some(
            (args) => args[0] === "kill-pane" && args.includes(created!.tmuxPaneId),
          ),
        ).toBe(true);
        const closedPane = afterClose.panes.find((pane) => pane.paneId === created!.paneId);
        expect(closedPane?.status).toBe("closed");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "requires pane control to attach metadata while allowing workspace readers to list statuses",
    () => {
      const { layer } = makeLayer();
      const readOnlyOtherGrant = {
        ...READ_ONLY_GRANT,
        actor: OTHER_ACTOR,
      };

      return Effect.gen(function* () {
        const service = yield* TmuxWorkspaceService;
        const initial = yield* service.ensureWorkspace({
          actor: AUTH_ACTOR,
          projectId: ProjectId.make("project-1"),
          cwd: "/tmp/project",
          initialGrants: [AUTH_GRANT, readOnlyOtherGrant],
        });
        const pane = initial.panes[0]!;

        const attach = yield* Effect.exit(
          service.attachPaneMetadata({
            actor: OTHER_ACTOR,
            workspaceId: initial.workspace.workspaceId,
            paneId: pane.paneId,
            metadata: {
              kind: "custom",
              title: "Denied",
              process: null,
              labels: {},
              neovim: null,
              agent: null,
              workflow: null,
              managedProcess: null,
              remoteProcess: null,
              browserLab: null,
            },
          }),
        );
        const statuses = yield* service.listOperationalPaneStatuses({
          actor: OTHER_ACTOR,
          workspaceId: initial.workspace.workspaceId,
        });

        expect(attach._tag).toBe("Failure");
        expect(statuses.panes).toEqual([]);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "rejects pane writes atomically when tmux rejects the single control-mode command",
    () => {
      const { adapter, layer } = makeLayer();

      return Effect.gen(function* () {
        const service = yield* TmuxWorkspaceService;
        const initial = yield* service.ensureWorkspace({
          actor: AUTH_ACTOR,
          projectId: ProjectId.make("project-1"),
          cwd: "/tmp/project",
          initialGrants: [AUTH_GRANT],
        });
        const pane = initial.panes[0]!;
        adapter.connections[0]!.commandFailures.push(new Error("no such pane"));

        const rejected = yield* service.writePane({
          workspaceId: initial.workspace.workspaceId,
          paneId: pane.paneId,
          actor: AUTH_ACTOR,
          requestId: "req-rejected-by-tmux",
          data: "echo rejected\n",
        });
        const accepted = yield* service.writePane({
          workspaceId: initial.workspace.workspaceId,
          paneId: pane.paneId,
          actor: AUTH_ACTOR,
          requestId: "req-after-reject",
          data: "echo accepted\n",
        });

        expect(rejected).toMatchObject({ type: "rejected", code: "invalid-state" });
        expect(accepted).toMatchObject({ type: "accepted", inputSeq: 1 });
        const writes = adapter.connections[0]?.commands.filter(
          (command) => command.command === "send-keys",
        );
        expect(writes?.[0]).toMatchObject({
          command: "send-keys",
          args: ["-t", pane.tmuxPaneId, "-l", "echo rejected\n"],
        });
        expect(writes?.[1]).toMatchObject({
          command: "send-keys",
          args: ["-t", pane.tmuxPaneId, "-l", "echo accepted\n"],
        });
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("rejects pane writes when the actor lacks pane:write", () => {
    const { adapter, layer } = makeLayer();

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const snapshot = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-1"),
        cwd: "/tmp/project",
        initialGrants: [NO_PANE_WRITE_GRANT],
      });
      const pane = snapshot.panes[0]!;

      const write = yield* service.writePane({
        workspaceId: snapshot.workspace.workspaceId,
        paneId: pane.paneId,
        actor: AUTH_ACTOR,
        requestId: "req-denied",
        data: "echo denied\n",
      });

      expect(write).toMatchObject({ type: "rejected", code: "permission-denied" });
      expect(
        adapter.connections[0]?.commands.some((command) => command.command === "send-keys"),
      ).toBe(false);
    }).pipe(Effect.provide(layer));
  });

  it.effect("rejects pane stream reads when the actor lacks pane:read", () => {
    const { layer } = makeLayer();

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const snapshot = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-1"),
        cwd: "/tmp/project",
        initialGrants: [NO_PANE_READ_GRANT],
      });
      const pane = snapshot.panes[0]!;

      const result = yield* Effect.exit(
        service.subscribePaneStream({
          workspaceId: snapshot.workspace.workspaceId,
          paneId: pane.paneId,
          actor: AUTH_ACTOR,
          backfill: "latest",
          slowClientPolicy: "fast-forward",
          maxBufferedChunks: 10,
        }),
      );

      expect(result._tag).toBe("Failure");
    }).pipe(Effect.provide(layer));
  });

  it.effect("keeps detached windows and panes closed across reconcile", () => {
    const { layer } = makeLayer();

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const initial = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-1"),
        cwd: "/tmp/project",
        initialGrants: [AUTH_GRANT],
      });
      const afterCreateWindow = yield* service.createWindow({
        actor: AUTH_ACTOR,
        workspaceId: initial.workspace.workspaceId,
        name: "ops",
      });
      const detachedWindow = afterCreateWindow.windows.find((window) => window.name === "ops")!;

      const afterWindowDetach = yield* service.closeWindow({
        actor: AUTH_ACTOR,
        workspaceId: initial.workspace.workspaceId,
        windowId: detachedWindow.windowId,
        mode: "detach",
      });
      const afterWindowReconcile = yield* service.reconnectWorkspace({
        actor: AUTH_ACTOR,
        workspaceId: initial.workspace.workspaceId,
      });

      const shellWindow = afterWindowReconcile.windows.find((window) => window.name === "shell")!;
      const afterCreatePane = yield* service.createPane({
        actor: AUTH_ACTOR,
        workspaceId: initial.workspace.workspaceId,
        windowId: shellWindow.windowId,
        kind: "shell",
        split: "horizontal",
      });
      const detachedPane = afterCreatePane.panes.find(
        (pane) =>
          pane.windowId === shellWindow.windowId && pane.paneId !== shellWindow.activePaneId,
      )!;

      const afterPaneDetach = yield* service.closePane({
        actor: AUTH_ACTOR,
        workspaceId: initial.workspace.workspaceId,
        paneId: detachedPane.paneId,
        mode: "detach",
      });
      const afterPaneReconcile = yield* service.reconnectWorkspace({
        actor: AUTH_ACTOR,
        workspaceId: initial.workspace.workspaceId,
      });

      expect(
        afterWindowReconcile.windows.find((window) => window.windowId === detachedWindow.windowId)
          ?.status,
      ).toBe("closed");
      expect(
        afterWindowDetach.panes.filter(
          (pane) => pane.windowId === detachedWindow.windowId && pane.status === "running",
        ),
      ).toHaveLength(0);
      expect(
        afterWindowReconcile.panes.filter(
          (pane) => pane.windowId === detachedWindow.windowId && pane.status === "running",
        ),
      ).toHaveLength(0);
      expect(
        afterWindowDetach.windows.find(
          (window) => window.windowId === afterWindowDetach.workspace.activeWindowId,
        )?.status,
      ).not.toBe("closed");
      expect(
        afterWindowReconcile.windows.find(
          (window) => window.windowId === afterWindowReconcile.workspace.activeWindowId,
        )?.status,
      ).not.toBe("closed");
      expect(
        afterPaneReconcile.panes.find((pane) => pane.paneId === detachedPane.paneId)?.status,
      ).toBe("closed");
      const windowAfterPaneDetach = afterPaneDetach.windows.find(
        (window) => window.windowId === shellWindow.windowId,
      )!;
      const windowAfterPaneReconcile = afterPaneReconcile.windows.find(
        (window) => window.windowId === shellWindow.windowId,
      )!;
      expect(
        afterPaneDetach.panes.find((pane) => pane.paneId === windowAfterPaneDetach.activePaneId)
          ?.status,
      ).toBe("running");
      expect(
        afterPaneReconcile.panes.find(
          (pane) => pane.paneId === windowAfterPaneReconcile.activePaneId,
        )?.status,
      ).toBe("running");
    }).pipe(Effect.provide(layer));
  });

  it.effect("does not attach restored metadata to a recreated tmux session", () => {
    const baseDir = join(tmpdir(), `fenrir-tmux-workspace-${randomUUID()}`);
    const adapter = new FakeControlModeAdapter();
    const first = makeLayer(adapter, baseDir);
    const second = makeLayer(adapter, baseDir);

    return Effect.gen(function* () {
      const created = yield* Effect.gen(function* () {
        const service = yield* TmuxWorkspaceService;
        const initial = yield* service.ensureWorkspace({
          actor: AUTH_ACTOR,
          projectId: ProjectId.make("project-1"),
          cwd: "/tmp/project",
          initialGrants: [AUTH_GRANT],
        });
        const afterCreate = yield* service.createPane({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
          windowId: initial.windows[0]!.windowId,
          kind: "custom",
          split: "horizontal",
          metadata: {
            kind: "custom",
            title: "Stale Tool",
            process: null,
            labels: { restored: "false" },
            neovim: null,
            agent: null,
            workflow: null,
            managedProcess: null,
            remoteProcess: null,
            browserLab: null,
          },
        });
        return {
          workspaceId: initial.workspace.workspaceId,
          sessionName: initial.workspace.tmuxSessionName,
          stalePaneId: afterCreate.panes.find((pane) => pane.metadata.kind === "custom")!.paneId,
        };
      }).pipe(Effect.provide(first.layer));

      adapter.recreateSession(created.sessionName, "/tmp/project");

      const reconciled = yield* Effect.gen(function* () {
        const service = yield* TmuxWorkspaceService;
        return yield* service.ensureWorkspace({
          actor: AUTH_ACTOR,
          projectId: ProjectId.make("project-1"),
          cwd: "/tmp/project",
          initialGrants: [AUTH_GRANT],
        });
      }).pipe(Effect.provide(second.layer));

      expect(reconciled.panes.find((pane) => pane.paneId === created.stalePaneId)?.status).toBe(
        "closed",
      );
      expect(
        reconciled.panes.some(
          (pane) => pane.status === "running" && pane.metadata.title === "Stale Tool",
        ),
      ).toBe(false);
      expect(reconciled.panes.filter((pane) => pane.status === "running")).toHaveLength(1);
    });
  });

  it.effect("backs pane output with a data-plane replay buffer", () => {
    const { adapter, layer } = makeLayer();

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const snapshot = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-1"),
        cwd: "/tmp/project",
        initialGrants: [AUTH_GRANT],
      });
      const pane = snapshot.panes[0]!;

      yield* adapter.connections[0]!.emit({
        type: "pane-output",
        paneId: pane.tmuxPaneId,
        data: "secret bytes",
      });

      const updated = yield* service.getSnapshot({
        actor: AUTH_ACTOR,
        workspaceId: snapshot.workspace.workspaceId,
      });
      const stream = yield* service.subscribePaneStream({
        workspaceId: snapshot.workspace.workspaceId,
        paneId: pane.paneId,
        actor: AUTH_ACTOR,
        afterSeq: 0,
        backfill: "from-seq",
        slowClientPolicy: "fast-forward",
        maxBufferedChunks: 10,
      });
      const events = Array.from(yield* stream.pipe(Stream.take(2), Stream.runCollect));

      expect(updated.panes[0]?.stream).toMatchObject({
        lowSeq: 1,
        highSeq: 1,
        backfillAvailable: true,
        droppedCount: 0,
      });
      expect(events.map((event) => event.type)).toEqual(["backfill-started", "chunk"]);
      expect(events[1]).toMatchObject({ type: "chunk", seq: 1, data: "secret bytes" });
    }).pipe(Effect.provide(layer));
  });

  it.effect("enables control-mode pane output so pane writes reach stream subscribers", () => {
    const { adapter, layer } = makeLayer();

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const snapshot = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-1"),
        cwd: "/tmp/project",
        initialGrants: [AUTH_GRANT],
      });
      const pane = snapshot.panes[0]!;

      expect(adapter.connections[0]?.commands).toContainEqual({
        command: "refresh-client",
        args: ["-A", `${pane.tmuxPaneId}:on`],
      });

      const write = yield* service.writePane({
        workspaceId: snapshot.workspace.workspaceId,
        paneId: pane.paneId,
        actor: AUTH_ACTOR,
        requestId: "req-stream-write",
        data: "echo streamed\n",
      });
      const stream = yield* service.subscribePaneStream({
        workspaceId: snapshot.workspace.workspaceId,
        paneId: pane.paneId,
        actor: AUTH_ACTOR,
        afterSeq: 0,
        backfill: "from-seq",
        slowClientPolicy: "fast-forward",
        maxBufferedChunks: 10,
      });
      const events = Array.from(yield* stream.pipe(Stream.take(2), Stream.runCollect));

      expect(write).toMatchObject({ type: "accepted", inputSeq: 1 });
      expect(events.map((event) => event.type)).toEqual(["backfill-started", "chunk"]);
      expect(events[1]).toMatchObject({ type: "chunk", seq: 1, data: "echo streamed\n" });
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "integrates kernel metadata, Neovim bootstrap, operational panes, and pane data-plane replay",
    () => {
      const { adapter, layer } = makeLayer();

      return Effect.gen(function* () {
        const eventsRef = yield* Ref.make<ReadonlyArray<TmuxKernelEvent>>([]);
        const service = yield* TmuxWorkspaceService;
        const initial = yield* service.ensureWorkspace({
          actor: AUTH_ACTOR,
          projectId: ProjectId.make("project-integrated"),
          cwd: "/tmp/project-integrated",
          initialGrants: [AUTH_GRANT],
        });
        const window = initial.windows[0]!;
        yield* service.subscribe(
          { actor: AUTH_ACTOR, workspaceId: initial.workspace.workspaceId },
          (event) => Ref.update(eventsRef, (events) => [...events, event]),
        );
        yield* Ref.set(eventsRef, []);

        const afterWorkflowPane = yield* service.createPane({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
          windowId: window.windowId,
          kind: "workflow",
          split: "horizontal",
          metadata: {
            kind: "workflow",
            title: "Workflow operational pane",
            process: null,
            labels: { "fenrir.surface": "workflow" },
            neovim: null,
            agent: null,
            workflow: {
              workflowId: "workflow-integrated",
              runId: "run-integrated",
              stepId: "step-integrated",
              threadId: ThreadId.make("thread-integrated"),
            },
            managedProcess: null,
            remoteProcess: null,
            browserLab: null,
          },
        });
        const workflowPane = afterWorkflowPane.panes.find(
          (pane) => pane.metadata.kind === "workflow",
        )!;
        const afterNeovim = yield* service.createNeovimPane({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
          windowId: window.windowId,
          files: ["/tmp/project-integrated/README.md"],
          profileId: "integrated",
        });
        const neovimPane = afterNeovim.panes.find((pane) => pane.metadata.kind === "neovim")!;
        if (neovimPane.metadata.kind !== "neovim") {
          throw new Error("expected Neovim pane metadata");
        }

        yield* adapter.connections[0]!.emit({
          type: "pane-output",
          paneId: workflowPane.tmuxPaneId,
          data: "workflow secret bytes",
        });
        const write = yield* service.writePane({
          workspaceId: initial.workspace.workspaceId,
          paneId: workflowPane.paneId,
          actor: AUTH_ACTOR,
          requestId: "req-integrated",
          data: "continue\n",
        });
        const statuses = yield* service.listOperationalPaneStatuses({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
        });
        const stream = yield* service.subscribePaneStream({
          workspaceId: initial.workspace.workspaceId,
          paneId: workflowPane.paneId,
          actor: AUTH_ACTOR,
          afterSeq: 0,
          backfill: "from-seq",
          slowClientPolicy: "fast-forward",
          maxBufferedChunks: 10,
        });
        const streamEvents = Array.from(yield* stream.pipe(Stream.take(2), Stream.runCollect));
        yield* service.closePane({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
          paneId: workflowPane.paneId,
          mode: "detach",
        });
        const kernelEvents = yield* Ref.get(eventsRef);

        expect(neovimPane.metadata.neovim).toMatchObject({
          workspaceId: initial.workspace.workspaceId,
          windowId: window.windowId,
          profileId: "integrated",
          files: ["/tmp/project-integrated/README.md"],
        });
        expect(statuses.panes).toEqual([
          expect.objectContaining({
            paneId: workflowPane.paneId,
            kind: "workflow",
            status: "running",
            metadata: expect.objectContaining({
              workflow: expect.objectContaining({
                workflowId: "workflow-integrated",
                runId: "run-integrated",
              }),
            }),
          }),
        ]);
        expect(write).toMatchObject({
          type: "accepted",
          workspaceId: initial.workspace.workspaceId,
          paneId: workflowPane.paneId,
          requestId: "req-integrated",
        });
        expect(streamEvents.map((event) => event.type)).toEqual(["backfill-started", "chunk"]);
        expect(streamEvents[1]).toMatchObject({
          type: "chunk",
          seq: 1,
          data: "workflow secret bytes",
        });
        expect(JSON.stringify(kernelEvents)).not.toContain("workflow secret bytes");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("restores persisted workspace metadata on a new service layer", () => {
    const baseDir = join(tmpdir(), `fenrir-tmux-workspace-${randomUUID()}`);
    const first = makeLayer(new FakeControlModeAdapter(), baseDir);
    const second = makeLayer(new FakeControlModeAdapter(), baseDir);

    return Effect.gen(function* () {
      const created = yield* Effect.gen(function* () {
        const service = yield* TmuxWorkspaceService;
        const initial = yield* service.ensureWorkspace({
          actor: AUTH_ACTOR,
          projectId: ProjectId.make("project-1"),
          cwd: "/tmp/project",
          initialGrants: [AUTH_GRANT],
        });
        const afterCreate = yield* service.createPane({
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
          windowId: initial.windows[0]!.windowId,
          kind: "custom",
          split: "horizontal",
          metadata: {
            kind: "custom",
            title: "Persisted Tool",
            process: null,
            labels: { restored: "true" },
            neovim: null,
            agent: null,
            workflow: null,
            managedProcess: null,
            remoteProcess: null,
            browserLab: null,
          },
        });
        return {
          workspaceId: initial.workspace.workspaceId,
          paneId: afterCreate.panes.find((pane) => pane.metadata.kind === "custom")!.paneId,
        };
      }).pipe(Effect.provide(first.layer));

      const restored = yield* Effect.gen(function* () {
        const service = yield* TmuxWorkspaceService;
        return yield* service.getSnapshot({ actor: AUTH_ACTOR, workspaceId: created.workspaceId });
      }).pipe(Effect.provide(second.layer));

      expect(restored.workspace.status).toBe("detached");
      expect(restored.panes.find((pane) => pane.paneId === created.paneId)?.metadata).toMatchObject(
        {
          kind: "custom",
          title: "Persisted Tool",
        },
      );
    });
  });

  it.effect("re-grants a restored workspace to the same subject on a new auth session", () => {
    const baseDir = join(tmpdir(), `fenrir-tmux-workspace-${randomUUID()}`);
    const adapter = new FakeControlModeAdapter();
    const first = makeLayer(adapter, baseDir);
    const second = makeLayer(adapter, baseDir);

    return Effect.gen(function* () {
      const created = yield* Effect.gen(function* () {
        const service = yield* TmuxWorkspaceService;
        return yield* service.ensureWorkspace({
          actor: AUTH_ACTOR,
          projectId: ProjectId.make("project-1"),
          cwd: "/tmp/project",
          initialGrants: [AUTH_GRANT],
        });
      }).pipe(Effect.provide(first.layer));

      // App relaunch: same subject, freshly minted auth session id. The
      // persisted grants reference the dead session, so without grant
      // adoption every subsequent ensure would fail permission-denied.
      const relaunched = yield* Effect.gen(function* () {
        const service = yield* TmuxWorkspaceService;
        const ensured = yield* service.ensureWorkspace({
          actor: OTHER_ACTOR,
          workspaceId: created.workspace.workspaceId,
          projectId: ProjectId.make("project-1"),
          cwd: "/tmp/project",
          initialGrants: [OTHER_GRANT],
        });
        // The adopted grant covers follow-up calls from the new session.
        const snapshot = yield* service.getSnapshot({
          actor: OTHER_ACTOR,
          workspaceId: ensured.workspace.workspaceId,
        });
        // An actor whose subject never held a grant remains denied even when
        // it offers its own initial grants.
        const foreignSubject = yield* Effect.exit(
          service.ensureWorkspace({
            actor: FOREIGN_SUBJECT_ACTOR,
            projectId: ProjectId.make("project-1"),
            cwd: "/tmp/project",
            initialGrants: [{ ...AUTH_GRANT, actor: FOREIGN_SUBJECT_ACTOR }],
          }),
        );
        return { ensured, snapshot, foreignSubject };
      }).pipe(Effect.provide(second.layer));

      expect(relaunched.ensured.workspace.workspaceId).toBe(created.workspace.workspaceId);
      expect(relaunched.ensured.workspace.status).toBe("running");
      const grantSessions = relaunched.snapshot.workspace.grants.map(
        (grant) => grant.actor.sessionId,
      );
      expect(grantSessions).toContain(OTHER_ACTOR.sessionId);
      expect(grantSessions).not.toContain(AUTH_ACTOR.sessionId);
      expect(relaunched.foreignSubject._tag).toBe("Failure");
    });
  });

  it.effect(
    "seeds a restored pane's first stream subscription with the visible tmux screen",
    () => {
      const baseDir = join(tmpdir(), `fenrir-tmux-workspace-${randomUUID()}`);
      const adapter = new FakeControlModeAdapter();
      const first = makeLayer(adapter, baseDir);
      const second = makeLayer(adapter, baseDir);

      return Effect.gen(function* () {
        const created = yield* Effect.gen(function* () {
          const service = yield* TmuxWorkspaceService;
          return yield* service.ensureWorkspace({
            actor: AUTH_ACTOR,
            projectId: ProjectId.make("project-1"),
            cwd: "/tmp/project",
            initialGrants: [AUTH_GRANT],
          });
        }).pipe(Effect.provide(first.layer));
        const pane = created.panes[0]!;
        // The tmux session survived the "restart"; its pane still shows the
        // pre-restart screen (including trailing blank rows tmux pads with).
        adapter.capturedScreens.set(
          pane.tmuxPaneId,
          "$ echo STABLE_MARKER\nSTABLE_MARKER\n$\n\n\n",
        );

        const observed = yield* Effect.gen(function* () {
          const service = yield* TmuxWorkspaceService;
          yield* service.ensureWorkspace({
            actor: AUTH_ACTOR,
            projectId: ProjectId.make("project-1"),
            cwd: "/tmp/project",
            initialGrants: [AUTH_GRANT],
          });
          // "latest" ignores buffered history, so the seed must arrive as a
          // live chunk appended after the subscription registers.
          const stream = yield* service.subscribePaneStream({
            workspaceId: created.workspace.workspaceId,
            paneId: pane.paneId,
            actor: AUTH_ACTOR,
            backfill: "latest",
            slowClientPolicy: "fast-forward",
            maxBufferedChunks: 10,
          });
          const events = Array.from(yield* stream.pipe(Stream.take(1), Stream.runCollect));
          const resubscribed = yield* service.subscribePaneStream({
            workspaceId: created.workspace.workspaceId,
            paneId: pane.paneId,
            actor: AUTH_ACTOR,
            afterSeq: 0,
            backfill: "from-seq",
            slowClientPolicy: "fast-forward",
            maxBufferedChunks: 10,
          });
          const replayEvents = Array.from(
            yield* resubscribed.pipe(Stream.take(2), Stream.runCollect),
          );
          return { events, replayEvents };
        }).pipe(Effect.provide(second.layer));

        expect(observed.events).toHaveLength(1);
        expect(observed.events[0]).toMatchObject({
          type: "chunk",
          data: "$ echo STABLE_MARKER\r\nSTABLE_MARKER\r\n$",
        });
        // Later subscriptions replay the seeded chunk from the buffer without
        // re-capturing (exactly one capture-pane for the whole relaunch).
        expect(observed.replayEvents.map((event) => event.type)).toEqual([
          "backfill-started",
          "chunk",
        ]);
        expect(adapter.adminCalls.filter((args) => args[0] === "capture-pane")).toHaveLength(1);
      });
    },
  );

  it.effect(
    "updates stream descriptors from control-mode pane output without lifecycle hot-path events",
    () => {
      const { adapter, layer } = makeLayer();

      return Effect.gen(function* () {
        const eventsRef = yield* Ref.make<ReadonlyArray<TmuxKernelEvent>>([]);
        const service = yield* TmuxWorkspaceService;
        const snapshot = yield* service.ensureWorkspace({
          actor: AUTH_ACTOR,
          projectId: ProjectId.make("project-1"),
          cwd: "/tmp/project",
          initialGrants: [AUTH_GRANT],
        });
        const pane = snapshot.panes[0]!;
        yield* service.subscribe(
          { actor: AUTH_ACTOR, workspaceId: snapshot.workspace.workspaceId },
          (event) => Ref.update(eventsRef, (events) => [...events, event]),
        );
        yield* Ref.set(eventsRef, []);

        yield* adapter.connections[0]!.emit({
          type: "pane-output",
          paneId: pane.tmuxPaneId,
          data: "secret bytes",
        });

        const updated = yield* service.getSnapshot({
          actor: AUTH_ACTOR,
          workspaceId: snapshot.workspace.workspaceId,
        });
        const events = yield* Ref.get(eventsRef);
        expect(updated.panes[0]?.stream.highSeq).toBe(1);
        expect(updated.revision).toBe(snapshot.revision);
        expect(events).toEqual([]);
        expect(JSON.stringify(events)).not.toContain("secret bytes");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("emits a baseline snapshot for stale workspace subscriptions", () => {
    const { layer } = makeLayer();

    return Effect.gen(function* () {
      const eventsRef = yield* Ref.make<ReadonlyArray<TmuxKernelEvent>>([]);
      const service = yield* TmuxWorkspaceService;
      const initial = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-1"),
        cwd: "/tmp/project",
        initialGrants: [AUTH_GRANT],
      });
      const afterMutation = yield* service.createPane({
        actor: AUTH_ACTOR,
        workspaceId: initial.workspace.workspaceId,
        windowId: initial.windows[0]!.windowId,
        kind: "shell",
        split: "horizontal",
      });

      const unsubscribe = yield* service.subscribe(
        {
          actor: AUTH_ACTOR,
          workspaceId: initial.workspace.workspaceId,
          afterRevision: initial.revision,
        },
        (event) => Ref.update(eventsRef, (events) => [...events, event]),
      );
      unsubscribe();

      const events = yield* Ref.get(eventsRef);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "workspace.snapshot",
        workspaceId: initial.workspace.workspaceId,
        revision: afterMutation.revision,
      });
      expect(events[0]).toMatchObject({
        snapshot: {
          panes: expect.arrayContaining([
            expect.objectContaining({ paneId: afterMutation.panes.at(-1)!.paneId }),
          ]),
        },
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("reconnects by restarting the control-mode connection and reconciling state", () => {
    const { adapter, layer } = makeLayer();

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const snapshot = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-1"),
        cwd: "/tmp/project",
        initialGrants: [AUTH_GRANT],
      });

      const reconnected = yield* service.reconnectWorkspace({
        actor: AUTH_ACTOR,
        workspaceId: snapshot.workspace.workspaceId,
      });

      expect(adapter.connections[0]?.restartCount).toBe(1);
      expect(reconnected.workspace.status).toBe("running");
      expect(reconnected.panes).toHaveLength(1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("rejects operational pane creation without required metadata", () => {
    const { layer } = makeLayer();

    return Effect.gen(function* () {
      const service = yield* TmuxWorkspaceService;
      const snapshot = yield* service.ensureWorkspace({
        actor: AUTH_ACTOR,
        projectId: ProjectId.make("project-1"),
        cwd: "/tmp/project",
        initialGrants: [AUTH_GRANT],
      });
      const result = yield* Effect.exit(
        service.createPane({
          actor: AUTH_ACTOR,
          workspaceId: snapshot.workspace.workspaceId,
          windowId: snapshot.windows[0]!.windowId,
          kind: "agent",
          split: "vertical",
        }),
      );

      expect(result._tag).toBe("Failure");
    }).pipe(Effect.provide(layer));
  });
});
