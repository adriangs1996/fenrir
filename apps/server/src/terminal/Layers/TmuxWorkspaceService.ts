import {
  TmuxKernelError,
  TmuxPaneId,
  TmuxPaneStreamId,
  TmuxWindowId,
  TmuxWorkspaceId,
  type TmuxKernelEvent,
  type TmuxActor,
  type TmuxOperationalPaneMetadata,
  type TmuxOperationalPaneStatus,
  type TmuxOperationalPaneStatusResult,
  type TmuxPane,
  type TmuxPaneCreateInput,
  type TmuxPaneMetadata,
  type TmuxPanePermission,
  type TmuxPaneStreamDescriptor,
  type TmuxPaneWriteResult,
  type TmuxPath,
  type TmuxPermissionGrant,
  type TmuxNeovimPaneInput,
  type TmuxNeovimPaneMetadata,
  type TmuxWindow,
  type TmuxWorkspace,
  type TmuxWorkspaceSnapshot,
} from "@fenrir/contracts";
import { Effect, FileSystem, Layer, Option, Path, Ref } from "effect";
import { createHash } from "node:crypto";

import { AgentFeedHookCredential } from "../../agentFeed/Services/AgentFeedService";
import { ServerConfig } from "../../config";
import { isCommandAvailable as isSystemCommandAvailable } from "../../open";
import { writeFileStringAtomically } from "../../atomicWrite";
import { makeTmuxSessionName, sanitizeTmuxName } from "../tmuxRuntime";
import {
  TmuxControlModeAdapter,
  type TmuxControlModeCommandInput,
  type TmuxControlModeConnection,
  type TmuxControlModeEvent,
} from "../Services/TmuxControlMode";
import { TmuxPaneStreamService } from "../Services/TmuxPaneStreamService";
import {
  TmuxWorkspaceService,
  type TmuxWorkspaceServiceShape,
} from "../Services/TmuxWorkspaceService";

const TMUX_WORKSPACE_SESSION_PREFIX = "fenrir-ws-";
const TMUX_WORKSPACE_COMMAND_TIMEOUT_MS = 5_000;
const TMUX_CONTROL_RECONCILE_DEBOUNCE_MS = 100;
const TMUX_WORKSPACE_MARKER_OPTION = "@fenrir_workspace_id";
const FIELD_SEPARATOR = "\u001f";
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 40;
const NEOVIM_BOOTSTRAP_ENV_KEYS = [
  "FENRIR_WORKSPACE_ID",
  "FENRIR_WINDOW_ID",
  "FENRIR_NEOVIM_BOOTSTRAP_ID",
  "FENRIR_NEOVIM_PROFILE_ID",
  "FENRIR_NEOVIM_THEME_ID",
  "FENRIR_NEOVIM_KEYBINDING_PROFILE_ID",
  "NVIM_LISTEN_ADDRESS",
] as const;

interface WorkspaceRuntime {
  workspace: TmuxWorkspace;
  windows: Map<TmuxWindowId, TmuxWindow>;
  panes: Map<TmuxPaneId, TmuxPane>;
  tmuxWindowToWindowId: Map<string, TmuxWindowId>;
  tmuxPaneToPaneId: Map<string, TmuxPaneId>;
  revision: number;
  connection: TmuxControlModeConnection | null;
  unsubscribeControl: (() => void) | null;
  paneInputSeq: Map<TmuxPaneId, number>;
  /**
   * Panes restored from persisted metadata whose in-memory stream ring buffer
   * is empty (a server restart discards it). The first stream subscription
   * for such a pane seeds the buffer with the pane's visible tmux screen so
   * reattaching clients render the pre-restart content instead of a blank
   * viewport (D-046 stable-workspace reattach).
   */
  screenSeedPaneIds: Set<TmuxPaneId>;
}

interface ReconciledPaneRow {
  tmuxWindowId: string;
  tmuxWindowIndex: number;
  windowName: string;
  windowActive: boolean;
  tmuxPaneId: string;
  cwd: string;
  x: number;
  y: number;
  cols: number;
  rows: number;
  paneActive: boolean;
}

interface PersistedWorkspaceRuntime {
  workspace: TmuxWorkspace;
  windows: TmuxWindow[];
  panes: TmuxPane[];
  revision: number;
}

interface PersistedTmuxWorkspaceState {
  workspaces: PersistedWorkspaceRuntime[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function workspaceId(): TmuxWorkspaceId {
  return TmuxWorkspaceId.make(`tmux-workspace-${crypto.randomUUID()}`);
}

function windowId(): TmuxWindowId {
  return TmuxWindowId.make(`tmux-window-${crypto.randomUUID()}`);
}

function paneId(): TmuxPaneId {
  return TmuxPaneId.make(`tmux-pane-${crypto.randomUUID()}`);
}

function streamId(id: TmuxPaneId): TmuxPaneStreamId {
  return TmuxPaneStreamId.make(`tmux-pane-stream-${id}`);
}

function kernelError(input: {
  code: TmuxKernelError["code"];
  message: string;
  workspaceId?: TmuxWorkspaceId;
  windowId?: TmuxWindowId;
  paneId?: TmuxPaneId;
  cause?: unknown;
}): TmuxKernelError {
  return new TmuxKernelError(input);
}

function errorMessage(cause: { readonly message?: string }, fallback: string): string {
  const message = cause.message?.trim();
  return message && message.length > 0 ? message : fallback;
}

function emptyStreamDescriptor(id: TmuxPaneId): TmuxPaneStreamDescriptor {
  return {
    streamId: streamId(id),
    paneId: id,
    encoding: "utf8",
    lowSeq: 0,
    highSeq: 0,
    droppedCount: 0,
    backfillAvailable: false,
    maxChunkBytes: 256 * 1024,
  };
}

function defaultShellMetadata(kind: "shell" | "custom", title: string | null): TmuxPaneMetadata {
  return {
    kind,
    title,
    process: null,
    labels: {},
    neovim: null,
    agent: null,
    workflow: null,
    managedProcess: null,
    remoteProcess: null,
    browserLab: null,
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function neovimBootstrapId(input: TmuxNeovimPaneInput): string {
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        workspaceId: input.workspaceId,
        windowId: input.windowId,
        profileId: input.profileId ?? "default",
        themeId: input.themeId ?? "fenrir-dark",
        keybindingProfileId: input.keybindingProfileId ?? "native-compatible",
        files: [...(input.files ?? [])],
      }),
    )
    .digest("hex")
    .slice(0, 40);
  return `nvim-${hash}`;
}

function neovimBridgeSocketPath(bootstrapId: string): TmuxPath {
  return `/tmp/fenrir-${bootstrapId}.sock` as TmuxPath;
}

function neovimCommand(input: {
  readonly bootstrapId: string;
  readonly workspaceId: string;
  readonly windowId: string;
  readonly profileId: string;
  readonly themeId: string;
  readonly keybindingProfileId: string;
  readonly bridgeSocketPath: string;
  readonly files: readonly string[];
  readonly line?: number;
  readonly column?: number;
}): string {
  const env: ReadonlyArray<readonly [string, string]> = [
    ["FENRIR_WORKSPACE_ID", input.workspaceId],
    ["FENRIR_WINDOW_ID", input.windowId],
    ["FENRIR_NEOVIM_BOOTSTRAP_ID", input.bootstrapId],
    ["FENRIR_NEOVIM_PROFILE_ID", input.profileId],
    ["FENRIR_NEOVIM_THEME_ID", input.themeId],
    ["FENRIR_NEOVIM_KEYBINDING_PROFILE_ID", input.keybindingProfileId],
    ["NVIM_LISTEN_ADDRESS", input.bridgeSocketPath],
  ];
  const cursor =
    input.line === undefined
      ? []
      : ["+call cursor(" + String(input.line) + "," + String(input.column ?? 1) + ")"];
  return [
    "env",
    ...env.flatMap(([key, value]) => [key + "=" + shellQuote(value)]),
    "nvim",
    ...cursor.map(shellQuote),
    "--",
    ...input.files.map(shellQuote),
  ].join(" ");
}

function neovimMetadata(input: {
  readonly bootstrapId: string;
  readonly workspaceId: TmuxWorkspaceId;
  readonly windowId: TmuxWindowId;
  readonly cwd: TmuxPath;
  readonly profileId: string;
  readonly themeId: string;
  readonly keybindingProfileId: string;
  readonly bridgeSocketPath: TmuxPath;
  readonly files: readonly TmuxPath[];
  readonly line?: number;
  readonly column?: number;
  readonly launchSource: "user" | "agent" | "workflow" | "restore";
  readonly command: string;
}): TmuxNeovimPaneMetadata {
  return {
    kind: "neovim",
    title: "Neovim",
    process: {
      command: input.command,
      argv: ["nvim", ...input.files],
      envKeys: [...NEOVIM_BOOTSTRAP_ENV_KEYS],
      pid: null,
      startedAt: nowIso(),
      exitedAt: null,
      exitCode: null,
      exitSignal: null,
    },
    labels: {
      "fenrir.process.kind": "neovim",
      "fenrir.neovim.bootstrapId": input.bootstrapId,
      "fenrir.neovim.profileId": input.profileId,
      "fenrir.neovim.themeId": input.themeId,
      "fenrir.neovim.keybindingProfileId": input.keybindingProfileId,
      "fenrir.neovim.bridge": "nvim-listen-address",
      "fenrir.neovim.bridgeSocketPath": input.bridgeSocketPath,
      "fenrir.neovim.launchSource": input.launchSource,
    },
    neovim: {
      bootstrapId: input.bootstrapId,
      workspaceId: input.workspaceId,
      windowId: input.windowId,
      cwd: input.cwd,
      profileId: input.profileId,
      themeId: input.themeId,
      keybindingProfileId: input.keybindingProfileId,
      bridgeSocketPath: input.bridgeSocketPath,
      files: [...input.files],
      ...(input.line === undefined ? {} : { line: input.line }),
      ...(input.column === undefined ? {} : { column: input.column }),
      launchSource: input.launchSource,
      bootstrapEnvKeys: [...NEOVIM_BOOTSTRAP_ENV_KEYS],
    },
    agent: null,
    workflow: null,
    managedProcess: null,
    remoteProcess: null,
    browserLab: null,
  };
}

function sameStrings(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );
}

type BridgeNeovimCreateInput = TmuxPaneCreateInput & {
  readonly kind: "neovim";
  readonly command: string;
  readonly cwd: TmuxPath;
  readonly metadata: TmuxNeovimPaneMetadata;
};

function isBridgeNeovimCreateInput(input: TmuxPaneCreateInput): input is BridgeNeovimCreateInput {
  if (
    input.kind !== "neovim" ||
    input.metadata?.kind !== "neovim" ||
    !input.command ||
    !input.cwd
  ) {
    return false;
  }
  const metadata = input.metadata;
  const expectedBootstrapId = neovimBootstrapId({
    actor: input.actor,
    workspaceId: input.workspaceId,
    windowId: input.windowId,
    profileId: metadata.neovim.profileId,
    themeId: metadata.neovim.themeId,
    keybindingProfileId: metadata.neovim.keybindingProfileId,
    files: metadata.neovim.files,
  });
  const expectedCommand = neovimCommand({
    bootstrapId: expectedBootstrapId,
    workspaceId: input.workspaceId,
    windowId: input.windowId,
    profileId: metadata.neovim.profileId,
    themeId: metadata.neovim.themeId,
    keybindingProfileId: metadata.neovim.keybindingProfileId,
    bridgeSocketPath: metadata.neovim.bridgeSocketPath,
    files: metadata.neovim.files,
    ...(metadata.neovim.line === undefined ? {} : { line: metadata.neovim.line }),
    ...(metadata.neovim.column === undefined ? {} : { column: metadata.neovim.column }),
  });
  return (
    input.command === expectedCommand &&
    metadata.process.command === expectedCommand &&
    metadata.neovim.bootstrapId === expectedBootstrapId &&
    metadata.neovim.workspaceId === input.workspaceId &&
    metadata.neovim.windowId === input.windowId &&
    metadata.neovim.cwd === input.cwd &&
    sameStrings(metadata.process.argv, ["nvim", ...metadata.neovim.files]) &&
    sameStrings(metadata.process.envKeys, NEOVIM_BOOTSTRAP_ENV_KEYS) &&
    sameStrings(metadata.neovim.bootstrapEnvKeys, NEOVIM_BOOTSTRAP_ENV_KEYS)
  );
}

function metadataForCreate(
  input: TmuxPaneCreateInput,
): Effect.Effect<TmuxPaneMetadata, TmuxKernelError> {
  if (input.metadata && input.kind !== "neovim") {
    if (input.metadata.kind !== input.kind) {
      return Effect.fail(
        kernelError({
          code: "invalid-state",
          message: `Pane metadata kind ${input.metadata.kind} does not match requested pane kind ${input.kind}`,
          workspaceId: input.workspaceId,
          windowId: input.windowId,
        }),
      );
    }
    return Effect.succeed(input.metadata);
  }
  if (input.kind === "neovim" && input.metadata && isBridgeNeovimCreateInput(input)) {
    return Effect.succeed(
      neovimMetadata({
        bootstrapId: input.metadata.neovim.bootstrapId,
        workspaceId: input.workspaceId,
        windowId: input.windowId,
        cwd: input.cwd,
        profileId: input.metadata.neovim.profileId,
        themeId: input.metadata.neovim.themeId,
        keybindingProfileId: input.metadata.neovim.keybindingProfileId,
        bridgeSocketPath: input.metadata.neovim.bridgeSocketPath,
        files: input.metadata.neovim.files,
        ...(input.metadata.neovim.line === undefined ? {} : { line: input.metadata.neovim.line }),
        ...(input.metadata.neovim.column === undefined
          ? {}
          : { column: input.metadata.neovim.column }),
        launchSource: input.metadata.neovim.launchSource,
        command: input.command,
      }),
    );
  }
  if (input.kind === "shell" || input.kind === "custom") {
    return Effect.succeed(defaultShellMetadata(input.kind, null));
  }
  if (input.kind === "neovim") {
    return Effect.fail(
      kernelError({
        code: "invalid-state",
        message: "Neovim panes require canonical bridge metadata",
        workspaceId: input.workspaceId,
        windowId: input.windowId,
      }),
    );
  }
  return Effect.fail(
    kernelError({
      code: "invalid-state",
      message: `${input.kind} panes require explicit operational metadata`,
      workspaceId: input.workspaceId,
      windowId: input.windowId,
    }),
  );
}

function isOperationalMetadata(
  metadata: TmuxPaneMetadata,
): metadata is TmuxOperationalPaneMetadata {
  return (
    metadata.kind === "agent" ||
    metadata.kind === "workflow" ||
    metadata.kind === "managed-process" ||
    metadata.kind === "remote-process" ||
    metadata.kind === "browser-lab" ||
    metadata.kind === "custom"
  );
}

function operationalPaneStatus(pane: TmuxPane): TmuxOperationalPaneStatus | null {
  if (!isOperationalMetadata(pane.metadata)) return null;
  return {
    workspaceId: pane.workspaceId,
    windowId: pane.windowId,
    paneId: pane.paneId,
    kind: pane.metadata.kind,
    status: pane.status,
    metadata: pane.metadata,
    stream: pane.stream,
    updatedAt: pane.updatedAt,
  };
}

function paneCommand(input: TmuxPaneCreateInput): string | null {
  if (input.command) return input.command;
  if (input.kind === "neovim") return "nvim";
  return null;
}

function paneInputCommand(tmuxPaneId: string, data: string): TmuxControlModeCommandInput {
  return { command: "send-keys", args: ["-t", tmuxPaneId, "-l", data] };
}

function isNvimUnavailableMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("nvim") && /not found|no such file|command not found/.test(normalized);
}

function isNvimUnavailableError(error: TmuxKernelError): boolean {
  const causeMessage =
    error.cause instanceof Error ? error.cause.message : error.cause ? String(error.cause) : "";
  return isNvimUnavailableMessage(`${error.message} ${causeMessage}`);
}

export interface TmuxWorkspaceServiceLiveOptions {
  readonly isCommandAvailable?: (command: string) => boolean;
}

function snapshot(runtime: WorkspaceRuntime): TmuxWorkspaceSnapshot {
  return {
    workspace: runtime.workspace,
    windows: [...runtime.windows.values()],
    panes: [...runtime.panes.values()],
    revision: runtime.revision,
  };
}

function paneListFormat(): string {
  return [
    "#{window_id}",
    "#{window_index}",
    "#{window_name}",
    "#{window_active}",
    "#{pane_id}",
    "#{pane_current_path}",
    "#{pane_left}",
    "#{pane_top}",
    "#{pane_width}",
    "#{pane_height}",
    "#{pane_active}",
  ].join(FIELD_SEPARATOR);
}

function parseBool(value: string): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function parsePaneRows(output: string): ReconciledPaneRow[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const fields = line.split(FIELD_SEPARATOR);
      return {
        tmuxWindowId: fields[0] ?? "",
        tmuxWindowIndex: Number.parseInt(fields[1] ?? "0", 10) || 0,
        windowName: fields[2] || "shell",
        windowActive: parseBool(fields[3] ?? "0"),
        tmuxPaneId: fields[4] ?? "",
        cwd: fields[5] || "/tmp",
        x: Number.parseInt(fields[6] ?? "0", 10) || 0,
        y: Number.parseInt(fields[7] ?? "0", 10) || 0,
        cols: Number.parseInt(fields[8] ?? String(DEFAULT_COLS), 10) || DEFAULT_COLS,
        rows: Number.parseInt(fields[9] ?? String(DEFAULT_ROWS), 10) || DEFAULT_ROWS,
        paneActive: parseBool(fields[10] ?? "0"),
      };
    })
    .filter((row) => row.tmuxWindowId.length > 0 && row.tmuxPaneId.length > 0);
}

function closeLiveSurfaces(runtime: WorkspaceRuntime, now: string): void {
  for (const [id, window] of runtime.windows) {
    if (window.status !== "closed") {
      runtime.windows.set(id, { ...window, status: "closed", updatedAt: now });
    }
  }
  for (const [id, pane] of runtime.panes) {
    if (pane.status !== "closed") {
      runtime.panes.set(id, { ...pane, status: "closed", updatedAt: now });
    }
  }
}

function closeWindowPanes(runtime: WorkspaceRuntime, id: TmuxWindowId, now: string): void {
  for (const [paneId, pane] of runtime.panes) {
    if (pane.windowId === id && pane.status !== "closed") {
      runtime.panes.set(paneId, { ...pane, status: "closed", updatedAt: now });
    }
  }
}

function resetNativeBindings(runtime: WorkspaceRuntime): void {
  runtime.tmuxWindowToWindowId.clear();
  runtime.tmuxPaneToPaneId.clear();
  closeLiveSurfaces(runtime, nowIso());
}

function normalizeActiveReferences(runtime: WorkspaceRuntime, now: string): void {
  for (const [windowId, window] of runtime.windows) {
    if (window.status === "closed") continue;
    const activePane = window.activePaneId === null ? null : runtime.panes.get(window.activePaneId);
    if (
      activePane?.status === "running" &&
      activePane.windowId === windowId &&
      activePane.workspaceId === runtime.workspace.workspaceId
    ) {
      continue;
    }

    const fallbackPane =
      [...runtime.panes.values()].find(
        (pane) =>
          pane.workspaceId === runtime.workspace.workspaceId &&
          pane.windowId === windowId &&
          pane.status === "running",
      ) ?? null;
    runtime.windows.set(windowId, {
      ...window,
      activePaneId: fallbackPane?.paneId ?? null,
      updatedAt: now,
    });
  }

  const currentActiveWindow =
    runtime.workspace.activeWindowId === null
      ? null
      : runtime.windows.get(runtime.workspace.activeWindowId);
  if (currentActiveWindow?.status !== "closed" && currentActiveWindow !== undefined) {
    return;
  }

  const fallbackWindow =
    [...runtime.windows.values()].find(
      (window) =>
        window.workspaceId === runtime.workspace.workspaceId && window.status === "active",
    ) ??
    [...runtime.windows.values()].find(
      (window) =>
        window.workspaceId === runtime.workspace.workspaceId && window.status !== "closed",
    ) ??
    null;

  runtime.workspace = {
    ...runtime.workspace,
    activeWindowId: fallbackWindow?.windowId ?? null,
    updatedAt: now,
  };
}

function actorMatches(left: TmuxActor, right: TmuxActor): boolean {
  return left.sessionId === right.sessionId && left.subject === right.subject;
}

function hasPermission(
  runtime: WorkspaceRuntime,
  actor: TmuxActor,
  permission: TmuxPanePermission,
): boolean {
  const now = Date.now();
  return runtime.workspace.grants.some(
    (grant) =>
      actorMatches(grant.actor, actor) &&
      grant.permissions.includes(permission) &&
      (grant.expiresAt === null || Date.parse(grant.expiresAt) > now),
  );
}

function permissionDeniedError(input: {
  workspaceId: TmuxWorkspace["workspaceId"];
  paneId?: TmuxPane["paneId"];
  permission: TmuxPanePermission;
}): TmuxKernelError {
  return kernelError({
    code: "permission-denied",
    message: `${input.permission} is not granted for tmux workspace ${input.workspaceId}`,
    workspaceId: input.workspaceId,
    ...(input.paneId ? { paneId: input.paneId } : {}),
  });
}

function requirePermission(
  runtime: WorkspaceRuntime,
  actor: TmuxActor,
  permission: TmuxPanePermission,
  paneId?: TmuxPane["paneId"],
): Effect.Effect<void, TmuxKernelError> {
  if (hasPermission(runtime, actor, permission)) return Effect.void;
  return Effect.fail(
    permissionDeniedError({
      workspaceId: runtime.workspace.workspaceId,
      permission,
      ...(paneId ? { paneId } : {}),
    }),
  );
}

function requiredPaneCreatePermissions(input: TmuxPaneCreateInput): readonly TmuxPanePermission[] {
  const permissions: TmuxPanePermission[] = ["pane:control"];
  if (
    input.command ||
    input.kind === "neovim" ||
    input.kind === "agent" ||
    input.kind === "workflow" ||
    input.kind === "managed-process" ||
    input.kind === "remote-process" ||
    input.kind === "browser-lab"
  ) {
    permissions.push("process:spawn");
  }
  if (input.kind === "neovim") {
    permissions.push("neovim:launch");
  }
  return permissions;
}

function requirePermissions(
  runtime: WorkspaceRuntime,
  actor: TmuxActor,
  permissions: readonly TmuxPanePermission[],
  paneId?: TmuxPane["paneId"],
): Effect.Effect<void, TmuxKernelError> {
  return Effect.forEach(
    permissions,
    (permission) => requirePermission(runtime, actor, permission, paneId),
    { discard: true },
  );
}

const ENSURE_WORKSPACE_PERMISSIONS = ["workspace:read", "workspace:control"] as const;

/**
 * Auth session ids are minted per client boot, while tmux workspaces (and
 * their persisted grants) outlive them: a workspace restored after a server
 * restart — or still in memory across an app relaunch — carries grants keyed
 * to session ids that can never authenticate again, so its rightful owner
 * would be permanently locked out of `ensureWorkspace`.
 *
 * When the requesting actor lacks the ensure permissions but (a) the request
 * carries `initialGrants` for that exact actor (the transport layer already
 * verified those grants name the authenticated session) covering
 * workspace:read + workspace:control, and (b) the workspace holds a grant for
 * the SAME subject under a DIFFERENT session id, the stale same-subject
 * grants are replaced by the offered ones. Actors whose subject never held a
 * grant on the workspace remain denied exactly as before.
 */
function adoptGrantsForNewSession(
  runtime: WorkspaceRuntime,
  input: {
    readonly actor: TmuxActor;
    readonly initialGrants?: readonly TmuxPermissionGrant[] | undefined;
  },
): void {
  if (
    ENSURE_WORKSPACE_PERMISSIONS.every((permission) =>
      hasPermission(runtime, input.actor, permission),
    )
  ) {
    return;
  }
  const offeredGrants = (input.initialGrants ?? []).filter((grant) =>
    actorMatches(grant.actor, input.actor),
  );
  const offersEnsurePermissions = ENSURE_WORKSPACE_PERMISSIONS.every((permission) =>
    offeredGrants.some((grant) => grant.permissions.includes(permission)),
  );
  if (!offersEnsurePermissions) return;
  const hasStaleSameSubjectGrant = runtime.workspace.grants.some(
    (grant) =>
      grant.actor.subject === input.actor.subject &&
      grant.actor.sessionId !== input.actor.sessionId,
  );
  if (!hasStaleSameSubjectGrant) return;
  runtime.workspace = {
    ...runtime.workspace,
    grants: [
      ...runtime.workspace.grants.filter((grant) => grant.actor.subject !== input.actor.subject),
      ...offeredGrants,
    ],
    updatedAt: nowIso(),
  };
}

function permissionDeniedResult(input: {
  workspaceId: TmuxWorkspace["workspaceId"];
  paneId: TmuxPane["paneId"];
  requestId: string;
  permission: TmuxPanePermission;
}): TmuxPaneWriteResult {
  return {
    type: "rejected",
    workspaceId: input.workspaceId,
    paneId: input.paneId,
    requestId: input.requestId,
    code: "permission-denied",
    message: `${input.permission} is not granted for tmux pane ${input.paneId}`,
    rejectedAt: nowIso(),
  };
}

export function makeTmuxWorkspaceServiceLive(options: TmuxWorkspaceServiceLiveOptions = {}) {
  const isCommandAvailable =
    options.isCommandAvailable ?? ((command: string) => isSystemCommandAvailable(command));

  return Layer.effect(
    TmuxWorkspaceService,
    Effect.gen(function* () {
      const controlMode = yield* TmuxControlModeAdapter;
      const paneStreams = yield* TmuxPaneStreamService;
      const services = yield* Effect.context<never>();
      const runDetached = Effect.runForkWith(services);
      const serverConfig = yield* ServerConfig;
      // D-042: optional per-boot agent-feed hook credential. When present it
      // is exported into tmux session environments so provisioned feed hooks
      // can authenticate against the local approval-feed endpoint. Absent
      // (e.g. in tests without the agent-feed layer) no token is exported
      // and feed hooks simply fall back to the agent's own TUI.
      const agentFeedHookCredential = Option.getOrNull(
        yield* Effect.serviceOption(AgentFeedHookCredential),
      );
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const persistencePath = path.join(serverConfig.stateDir, "tmux-workspaces", "metadata.json");

      const loadPersistedState = Effect.gen(function* () {
        const exists = yield* fs.exists(persistencePath).pipe(Effect.orElseSucceed(() => false));
        if (!exists) return new Map<TmuxWorkspaceId, WorkspaceRuntime>();
        const raw = yield* fs.readFileString(persistencePath);
        const parsed = JSON.parse(raw) as PersistedTmuxWorkspaceState;
        const restored = new Map<TmuxWorkspaceId, WorkspaceRuntime>();
        for (const entry of parsed.workspaces ?? []) {
          const panes = new Map<TmuxPaneId, TmuxPane>();
          for (const pane of entry.panes) {
            const stream = yield* paneStreams.ensurePane(pane.stream);
            panes.set(pane.paneId, { ...pane, stream });
          }
          restored.set(entry.workspace.workspaceId, {
            workspace: { ...entry.workspace, status: "detached" },
            windows: new Map(entry.windows.map((window) => [window.windowId, window] as const)),
            panes,
            tmuxWindowToWindowId: new Map(
              entry.windows.map((window) => [window.tmuxWindowId, window.windowId] as const),
            ),
            tmuxPaneToPaneId: new Map(
              entry.panes.map((pane) => [pane.tmuxPaneId, pane.paneId] as const),
            ),
            revision: entry.revision,
            connection: null,
            unsubscribeControl: null,
            paneInputSeq: new Map(),
            screenSeedPaneIds: new Set(
              entry.panes.filter((pane) => pane.status !== "closed").map((pane) => pane.paneId),
            ),
          });
        }
        return restored;
      }).pipe(
        Effect.catchCause(() =>
          Effect.logWarning("TmuxWorkspaceService: failed to load persisted metadata", {
            path: persistencePath,
          }).pipe(Effect.as(new Map<TmuxWorkspaceId, WorkspaceRuntime>())),
        ),
      );

      const initialRuntimes = yield* loadPersistedState;
      const initialProjectToWorkspace = new Map<TmuxWorkspace["projectId"], TmuxWorkspaceId>(
        [...initialRuntimes.values()].map(
          (runtime) => [runtime.workspace.projectId, runtime.workspace.workspaceId] as const,
        ),
      );
      const runtimesRef = yield* Ref.make(initialRuntimes);
      const projectToWorkspaceRef = yield* Ref.make(initialProjectToWorkspace);
      const listeners = new Map<
        TmuxWorkspaceId,
        Set<(event: TmuxKernelEvent) => Effect.Effect<void>>
      >();
      const publish = (event: TmuxKernelEvent): Effect.Effect<void> =>
        Effect.forEach(
          [...(listeners.get(event.workspaceId) ?? [])],
          (listener) => listener(event).pipe(Effect.catchCause(() => Effect.void)),
          { discard: true },
        );

      const bump = (runtime: WorkspaceRuntime): number => {
        runtime.revision += 1;
        runtime.workspace = { ...runtime.workspace, updatedAt: nowIso() };
        return runtime.revision;
      };

      const persistRuntimes = (
        runtimes: Map<TmuxWorkspaceId, WorkspaceRuntime>,
      ): Effect.Effect<void, TmuxKernelError> => {
        const persisted: PersistedTmuxWorkspaceState = {
          workspaces: [...runtimes.values()].map((runtime) => ({
            workspace: runtime.workspace,
            windows: [...runtime.windows.values()],
            panes: [...runtime.panes.values()],
            revision: runtime.revision,
          })),
        };
        return writeFileStringAtomically({
          filePath: persistencePath,
          contents: `${JSON.stringify(persisted, null, 2)}\n`,
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.mapError((cause) =>
            kernelError({
              code: "io-error",
              message: "failed to persist tmux workspace metadata",
              cause,
            }),
          ),
        );
      };

      const persistState = Ref.get(runtimesRef).pipe(Effect.flatMap(persistRuntimes));

      const publishSnapshot = (runtime: WorkspaceRuntime): Effect.Effect<void> =>
        publish({
          type: "workspace.snapshot",
          workspaceId: runtime.workspace.workspaceId,
          revision: runtime.revision,
          occurredAt: nowIso(),
          snapshot: snapshot(runtime),
        });

      const getRuntime = (id: TmuxWorkspaceId): Effect.Effect<WorkspaceRuntime, TmuxKernelError> =>
        Ref.get(runtimesRef).pipe(
          Effect.flatMap((runtimes) => {
            const runtime = runtimes.get(id);
            if (!runtime) {
              return Effect.fail(
                kernelError({
                  code: "not-found",
                  message: `tmux workspace ${id} was not found`,
                  workspaceId: id,
                }),
              );
            }
            return Effect.succeed(runtime);
          }),
        );

      const runAdmin = (
        runtime: WorkspaceRuntime,
        args: readonly string[],
      ): Effect.Effect<string, TmuxKernelError> =>
        controlMode.adminCommand(args, { timeoutMs: TMUX_WORKSPACE_COMMAND_TIMEOUT_MS }).pipe(
          Effect.mapError((cause) =>
            kernelError({
              code: cause.message.toLowerCase().includes("tmux") ? "tmux-unavailable" : "io-error",
              message: errorMessage(cause, "tmux admin command failed"),
              workspaceId: runtime.workspace.workspaceId,
              cause,
            }),
          ),
        );

      const enablePaneOutput = (
        runtime: WorkspaceRuntime,
        tmuxPaneId: string,
      ): Effect.Effect<void, TmuxKernelError> =>
        Effect.gen(function* () {
          const connection = runtime.connection;
          if (!connection || (yield* connection.status) !== "running") {
            return yield* kernelError({
              code: "control-mode-unavailable",
              message: `tmux control-mode client is not running for ${runtime.workspace.tmuxSessionName}`,
              workspaceId: runtime.workspace.workspaceId,
            });
          }
          yield* connection
            .command({ command: "refresh-client", args: ["-A", `${tmuxPaneId}:on`] })
            .pipe(
              Effect.mapError((cause) =>
                kernelError({
                  code: "control-mode-unavailable",
                  message: errorMessage(cause, "tmux control-mode command failed"),
                  workspaceId: runtime.workspace.workspaceId,
                  cause,
                }),
              ),
            );
        });

      const emitChangedWorkspace = (runtime: WorkspaceRuntime): Effect.Effect<void> =>
        publish({
          type: "workspace.changed",
          workspaceId: runtime.workspace.workspaceId,
          revision: runtime.revision,
          occurredAt: nowIso(),
          workspace: runtime.workspace,
        });

      const ensureSessionMarker = (
        runtime: WorkspaceRuntime,
      ): Effect.Effect<void, TmuxKernelError> =>
        Effect.gen(function* () {
          const marker = (yield* runAdmin(runtime, [
            "display-message",
            "-p",
            "-t",
            runtime.workspace.tmuxSessionName,
            `#{${TMUX_WORKSPACE_MARKER_OPTION}}`,
          ])).trim();
          if (
            marker !== runtime.workspace.workspaceId &&
            (runtime.tmuxWindowToWindowId.size > 0 || runtime.tmuxPaneToPaneId.size > 0)
          ) {
            resetNativeBindings(runtime);
          }
          if (marker !== runtime.workspace.workspaceId) {
            yield* runAdmin(runtime, [
              "set-option",
              "-t",
              runtime.workspace.tmuxSessionName,
              TMUX_WORKSPACE_MARKER_OPTION,
              runtime.workspace.workspaceId,
            ]);
          }
        });

      const reconcile = (
        runtime: WorkspaceRuntime,
      ): Effect.Effect<TmuxWorkspaceSnapshot, TmuxKernelError> =>
        Effect.gen(function* () {
          yield* ensureSessionMarker(runtime);
          const output = yield* runAdmin(runtime, [
            "list-panes",
            "-t",
            runtime.workspace.tmuxSessionName,
            "-F",
            paneListFormat(),
          ]);
          const rows = parsePaneRows(output);
          const now = nowIso();
          const seenWindows = new Set<TmuxWindowId>();
          const seenPanes = new Set<TmuxPaneId>();
          let activeWindowId: TmuxWindowId | null = null;

          for (const row of rows) {
            let id = runtime.tmuxWindowToWindowId.get(row.tmuxWindowId);
            const mappedWindow = id ? runtime.windows.get(id) : undefined;
            if (id && mappedWindow?.status === "closed") {
              seenWindows.add(id);
              continue;
            }
            if (!id) {
              id = windowId();
              runtime.tmuxWindowToWindowId.set(row.tmuxWindowId, id);
            }
            seenWindows.add(id);
            if (row.windowActive) activeWindowId = id;
            const existingWindow = runtime.windows.get(id);
            runtime.windows.set(id, {
              windowId: id,
              workspaceId: runtime.workspace.workspaceId,
              tmuxWindowId: row.tmuxWindowId,
              tmuxWindowIndex: row.tmuxWindowIndex,
              name: row.windowName,
              cwd: row.cwd,
              status: row.windowActive ? "active" : "inactive",
              activePaneId: existingWindow?.activePaneId ?? null,
              createdAt: existingWindow?.createdAt ?? now,
              updatedAt: now,
            });

            let pane = runtime.tmuxPaneToPaneId.get(row.tmuxPaneId);
            const mappedPane = pane ? runtime.panes.get(pane) : undefined;
            if (pane && mappedPane?.status === "closed") {
              seenPanes.add(pane);
              continue;
            }
            if (!pane) {
              pane = paneId();
              runtime.tmuxPaneToPaneId.set(row.tmuxPaneId, pane);
            }
            seenPanes.add(pane);
            const existingPane = runtime.panes.get(pane);
            const stream = yield* paneStreams.ensurePane(
              existingPane?.stream ?? emptyStreamDescriptor(pane),
            );
            runtime.panes.set(pane, {
              paneId: pane,
              workspaceId: runtime.workspace.workspaceId,
              windowId: id,
              tmuxPaneId: row.tmuxPaneId,
              cwd: row.cwd,
              x: row.x,
              y: row.y,
              cols: row.cols,
              rows: row.rows,
              status: "running",
              metadata: existingPane?.metadata ?? defaultShellMetadata("shell", row.windowName),
              stream,
              createdAt: existingPane?.createdAt ?? now,
              updatedAt: now,
            });
            yield* enablePaneOutput(runtime, row.tmuxPaneId);
            if (row.paneActive) {
              const currentWindow = runtime.windows.get(id);
              if (currentWindow) runtime.windows.set(id, { ...currentWindow, activePaneId: pane });
            }
          }

          for (const [id, win] of runtime.windows) {
            if (!seenWindows.has(id) && win.status !== "closed") {
              runtime.windows.set(id, { ...win, status: "closed", updatedAt: now });
            }
          }
          for (const [id, pane] of runtime.panes) {
            if (!seenPanes.has(id) && pane.status !== "closed") {
              runtime.panes.set(id, { ...pane, status: "closed", updatedAt: now });
              yield* paneStreams.closePane(id, "pane-closed");
            }
          }

          runtime.workspace = {
            ...runtime.workspace,
            status: "running",
            activeWindowId,
            updatedAt: now,
          };
          normalizeActiveReferences(runtime, now);
          bump(runtime);
          yield* persistState;
          yield* publishSnapshot(runtime);
          return snapshot(runtime);
        });

      // tmux emits control events in bursts (window-add + layout-change +
      // session-changed for a single user action); each reconcile shells out to
      // tmux, so coalesce per workspace instead of reconciling per event.
      const pendingControlReconciles = new Map<TmuxWorkspaceId, { rerun: boolean }>();

      const scheduleControlReconcile = (runtime: WorkspaceRuntime): Effect.Effect<void> =>
        Effect.sync(() => {
          const id = runtime.workspace.workspaceId;
          const pending = pendingControlReconciles.get(id);
          if (pending) {
            pending.rerun = true;
            return;
          }
          const state = { rerun: false };
          pendingControlReconciles.set(id, state);
          const drain: Effect.Effect<void> = Effect.gen(function* () {
            yield* Effect.sleep(`${TMUX_CONTROL_RECONCILE_DEBOUNCE_MS} millis`);
            state.rerun = false;
            yield* Effect.exit(reconcile(runtime));
            if (state.rerun) {
              return yield* drain;
            }
            pendingControlReconciles.delete(id);
          });
          runDetached(drain);
        });

      /**
       * Appends pane bytes through the shared stream service and keeps the
       * cached pane stream descriptor in sync. Shared by live control-mode
       * output and by the restored-screen seeding path so both flow through
       * identical overflow accounting.
       */
      const appendPaneStreamData = (
        runtime: WorkspaceRuntime,
        id: TmuxPaneId,
        data: string,
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          const pane = runtime.panes.get(id);
          if (!pane) return;
          const appendResult = yield* paneStreams.append(id, data).pipe(Effect.exit);
          if (appendResult._tag === "Failure") return;
          const overflow = appendResult.value.overflow;
          const updatedPane = {
            ...pane,
            stream: appendResult.value.descriptor,
            updatedAt: nowIso(),
          };
          runtime.panes.set(id, updatedPane);
          if (overflow) {
            bump(runtime);
            yield* persistState.pipe(Effect.exit);
            yield* publish({
              type: "pane.stream-overflow",
              workspaceId: runtime.workspace.workspaceId,
              revision: runtime.revision,
              occurredAt: nowIso(),
              paneId: id,
              stream: updatedPane.stream,
              reason: overflow.reason,
            });
          }
        });

      const handleControlEvent = (
        runtime: WorkspaceRuntime,
        event: TmuxControlModeEvent,
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          if (event.type === "client-error" || event.type === "client-exited") {
            runtime.workspace = {
              ...runtime.workspace,
              status: event.type === "client-error" ? "error" : "exited",
              updatedAt: nowIso(),
            };
            bump(runtime);
            yield* persistState.pipe(Effect.exit);
            yield* emitChangedWorkspace(runtime);
            return;
          }
          if (event.type === "pane-output" || event.type === "pane-extended-output") {
            const id = runtime.tmuxPaneToPaneId.get(event.paneId);
            if (!id) return;
            yield* appendPaneStreamData(runtime, id, event.data);
            return;
          }
          if (
            event.type === "window-add" ||
            event.type === "window-close" ||
            event.type === "window-renamed" ||
            event.type === "layout-change" ||
            event.type === "pane-mode-changed" ||
            event.type === "session-changed"
          ) {
            yield* scheduleControlReconcile(runtime);
          }
        });

      /**
       * Workspace identity plus the D-042 agent-feed hook endpoint
       * coordinates. Exported twice on purpose: as `new-session -e` entries so
       * the session's INITIAL pane inherits them (see `connectRuntime`), and
       * via `set-environment` so panes of pre-existing sessions created after
       * connect pick them up too.
       */
      const sessionEnvironmentEntries = (
        runtime: WorkspaceRuntime,
      ): ReadonlyArray<readonly [string, string]> => [
        ["FENRIR_WORKSPACE_ID", runtime.workspace.workspaceId],
        ["FENRIR_SERVER_URL", `http://127.0.0.1:${serverConfig.port}`],
        ...(agentFeedHookCredential
          ? ([["FENRIR_HOOK_TOKEN", agentFeedHookCredential.token]] as const)
          : []),
      ];

      /**
       * Exports workspace identity plus the D-042 agent-feed hook endpoint
       * coordinates into the tmux session environment, so panes created
       * afterwards (and the agent hooks they spawn) can reach the local
       * approval-feed endpoint. Panes created before a server restart keep a
       * stale token; their hooks fail auth and reply neutrally, which is the
       * intended TUI fallback. Failures here never block connecting.
       */
      const ensureSessionEnvironment = (runtime: WorkspaceRuntime): Effect.Effect<void> =>
        Effect.gen(function* () {
          yield* Effect.forEach(
            sessionEnvironmentEntries(runtime),
            ([key, value]) =>
              runAdmin(runtime, [
                "set-environment",
                "-t",
                runtime.workspace.tmuxSessionName,
                key,
                value,
              ]),
            { discard: true },
          );
        }).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Failed to export tmux session environment", {
              workspaceId: runtime.workspace.workspaceId,
              cause,
            }),
          ),
          Effect.ignoreCause({ log: true }),
        );

      const connectRuntime = (
        runtime: WorkspaceRuntime,
      ): Effect.Effect<TmuxControlModeConnection, TmuxKernelError> =>
        Effect.gen(function* () {
          const current = runtime.connection;
          if (current && (yield* current.status) === "running") return current;
          if (runtime.unsubscribeControl) {
            runtime.unsubscribeControl();
            runtime.unsubscribeControl = null;
          }
          const connection = yield* controlMode
            .connect({
              sessionName: runtime.workspace.tmuxSessionName,
              cwd: runtime.workspace.cwd,
              createIfMissing: true,
              // Seeded at creation so the session's FIRST pane (whose shell
              // spawns before any `set-environment` can run) already carries
              // the D-042 hook coordinates.
              environment: sessionEnvironmentEntries(runtime),
            })
            .pipe(
              Effect.mapError((cause) =>
                kernelError({
                  code: "control-mode-unavailable",
                  message: errorMessage(cause, "tmux control-mode connection failed"),
                  workspaceId: runtime.workspace.workspaceId,
                  cause,
                }),
              ),
            );
          const unsubscribe = yield* connection.subscribe((event) =>
            handleControlEvent(runtime, event),
          );
          runtime.connection = connection;
          runtime.unsubscribeControl = unsubscribe;
          runtime.workspace = { ...runtime.workspace, status: "running", updatedAt: nowIso() };
          yield* ensureSessionEnvironment(runtime);
          return connection;
        });

      /**
       * Dumps the visible screen of a tmux pane (`capture-pane -p -e`) as a
       * CRLF-delimited byte stream suitable for replay into a fresh terminal
       * emulator. Trailing blank rows are dropped so the seeded cursor lands
       * just after the last populated row (approximating the live cursor).
       */
      const captureVisibleScreen = (
        runtime: WorkspaceRuntime,
        pane: TmuxPane,
      ): Effect.Effect<string, TmuxKernelError> =>
        runAdmin(runtime, ["capture-pane", "-p", "-e", "-t", pane.tmuxPaneId]).pipe(
          Effect.map((output) => {
            const rows = output.replace(/\n+$/u, "").split("\n");
            while (rows.length > 0 && (rows.at(-1) ?? "").trim().length === 0) {
              rows.pop();
            }
            return rows.join("\r\n");
          }),
        );

      const getWindow = (
        runtime: WorkspaceRuntime,
        id: TmuxWindowId,
      ): Effect.Effect<TmuxWindow, TmuxKernelError> => {
        const window = runtime.windows.get(id);
        if (!window || window.status === "closed") {
          return Effect.fail(
            kernelError({
              code: "not-found",
              message: `tmux window ${id} was not found`,
              workspaceId: runtime.workspace.workspaceId,
              windowId: id,
            }),
          );
        }
        return Effect.succeed(window);
      };

      const getPane = (
        runtime: WorkspaceRuntime,
        id: TmuxPaneId,
      ): Effect.Effect<TmuxPane, TmuxKernelError> => {
        const pane = runtime.panes.get(id);
        if (!pane || pane.status === "closed") {
          return Effect.fail(
            kernelError({
              code: "not-found",
              message: `tmux pane ${id} was not found`,
              workspaceId: runtime.workspace.workspaceId,
              paneId: id,
            }),
          );
        }
        return Effect.succeed(pane);
      };

      const service: TmuxWorkspaceServiceShape = {
        sessionNameForProject: (projectId) =>
          makeTmuxSessionName(TMUX_WORKSPACE_SESSION_PREFIX, sanitizeTmuxName(projectId)),

        listWorkspaces: (input) =>
          Ref.get(runtimesRef).pipe(
            Effect.map((runtimes) => {
              const visibleRuntimes = [...runtimes.values()].filter(
                (runtime) =>
                  (!input.projectId || runtime.workspace.projectId === input.projectId) &&
                  hasPermission(runtime, input.actor, "workspace:read"),
              );
              const workspaces = visibleRuntimes.map((runtime) => runtime.workspace);
              const revision = Math.max(0, ...visibleRuntimes.map((runtime) => runtime.revision));
              return { workspaces, revision };
            }),
          ),

        ensureWorkspace: (input) =>
          Effect.gen(function* () {
            const projectToWorkspace = yield* Ref.get(projectToWorkspaceRef);
            const runtimes = yield* Ref.get(runtimesRef);
            const existingId = projectToWorkspace.get(input.projectId);
            const existing = existingId ? runtimes.get(existingId) : undefined;
            if (existing) {
              adoptGrantsForNewSession(existing, input);
              yield* requirePermissions(existing, input.actor, ENSURE_WORKSPACE_PERMISSIONS);
              yield* connectRuntime(existing);
              return yield* reconcile(existing);
            }
            if (input.workspaceId) {
              const requestedRuntime = runtimes.get(input.workspaceId);
              if (requestedRuntime) {
                if (requestedRuntime.workspace.projectId !== input.projectId) {
                  return yield* kernelError({
                    code: "invalid-state",
                    message: "requested tmux workspace id is already assigned to another project",
                    workspaceId: input.workspaceId,
                  });
                }
                adoptGrantsForNewSession(requestedRuntime, input);
                yield* requirePermissions(
                  requestedRuntime,
                  input.actor,
                  ENSURE_WORKSPACE_PERMISSIONS,
                );
                projectToWorkspace.set(input.projectId, input.workspaceId);
                yield* Ref.set(projectToWorkspaceRef, projectToWorkspace);
                yield* connectRuntime(requestedRuntime);
                return yield* reconcile(requestedRuntime);
              }
            }
            if (
              !input.initialGrants?.some(
                (grant) =>
                  actorMatches(grant.actor, input.actor) &&
                  grant.permissions.includes("workspace:read") &&
                  grant.permissions.includes("workspace:control"),
              )
            ) {
              return yield* kernelError({
                code: "permission-denied",
                message:
                  "workspace:read and workspace:control must be granted explicitly when creating a tmux workspace",
              });
            }

            const now = nowIso();
            const id = input.workspaceId ?? workspaceId();
            const runtime: WorkspaceRuntime = {
              workspace: {
                workspaceId: id,
                projectId: input.projectId,
                tmuxSessionName: service.sessionNameForProject(input.projectId),
                cwd: input.cwd,
                status: "starting",
                activeWindowId: null,
                grants: input.initialGrants ?? [],
                createdAt: now,
                updatedAt: now,
              },
              windows: new Map(),
              panes: new Map(),
              tmuxWindowToWindowId: new Map(),
              tmuxPaneToPaneId: new Map(),
              revision: 0,
              connection: null,
              unsubscribeControl: null,
              paneInputSeq: new Map(),
              screenSeedPaneIds: new Set(),
            };
            runtimes.set(id, runtime);
            projectToWorkspace.set(input.projectId, id);
            yield* Ref.set(runtimesRef, runtimes);
            yield* Ref.set(projectToWorkspaceRef, projectToWorkspace);
            yield* connectRuntime(runtime);
            return yield* reconcile(runtime);
          }),

        reconnectWorkspace: (input) =>
          Effect.gen(function* () {
            const runtime = yield* getRuntime(input.workspaceId);
            yield* requirePermissions(runtime, input.actor, [
              "workspace:read",
              "workspace:control",
            ]);
            if (runtime.connection) {
              yield* Effect.exit(runtime.connection.restart);
            }
            yield* connectRuntime(runtime);
            return yield* reconcile(runtime);
          }),

        getSnapshot: (input) =>
          Effect.gen(function* () {
            const runtime = yield* getRuntime(input.workspaceId);
            yield* requirePermission(runtime, input.actor, "workspace:read");
            return snapshot(runtime);
          }),

        createWindow: (input) =>
          Effect.gen(function* () {
            const runtime = yield* getRuntime(input.workspaceId);
            yield* requirePermission(runtime, input.actor, "window:control");
            yield* connectRuntime(runtime);
            const args = [
              "new-window",
              "-P",
              "-F",
              paneListFormat(),
              "-t",
              runtime.workspace.tmuxSessionName,
            ];
            if (input.name) args.push("-n", input.name);
            if (input.cwd) args.push("-c", input.cwd);
            yield* runAdmin(runtime, args);
            return yield* reconcile(runtime);
          }),

        renameWindow: (input) =>
          Effect.gen(function* () {
            const runtime = yield* getRuntime(input.workspaceId);
            yield* requirePermission(runtime, input.actor, "window:control");
            const window = yield* getWindow(runtime, input.windowId);
            yield* runAdmin(runtime, ["rename-window", "-t", window.tmuxWindowId, input.name]);
            yield* reconcile(runtime);
            return (runtime.windows.get(input.windowId) ?? window) as TmuxWindow;
          }),

        focusWindow: (input) =>
          Effect.gen(function* () {
            const runtime = yield* getRuntime(input.workspaceId);
            yield* requirePermission(runtime, input.actor, "window:control");
            const window = yield* getWindow(runtime, input.windowId);
            yield* runAdmin(runtime, ["select-window", "-t", window.tmuxWindowId]);
            return yield* reconcile(runtime);
          }),

        closeWindow: (input) =>
          Effect.gen(function* () {
            const runtime = yield* getRuntime(input.workspaceId);
            yield* requirePermission(
              runtime,
              input.actor,
              input.mode === "destroy" ? "session:destroy" : "window:control",
            );
            const window = yield* getWindow(runtime, input.windowId);
            if (input.mode === "destroy") {
              yield* runAdmin(runtime, ["kill-window", "-t", window.tmuxWindowId]);
            } else {
              const now = nowIso();
              const panesToClose = [...runtime.panes.values()].filter(
                (pane) => pane.windowId === input.windowId && pane.status !== "closed",
              );
              runtime.windows.set(input.windowId, {
                ...window,
                status: "closed",
                updatedAt: now,
              });
              closeWindowPanes(runtime, input.windowId, now);
              yield* Effect.forEach(
                panesToClose,
                (pane) => paneStreams.closePane(pane.paneId, "pane-closed"),
                { discard: true },
              );
              normalizeActiveReferences(runtime, now);
              bump(runtime);
              yield* persistState;
              yield* publishSnapshot(runtime);
              return snapshot(runtime);
            }
            return yield* reconcile(runtime);
          }),

        createPane: (input) =>
          Effect.gen(function* () {
            if (input.kind === "neovim" && !isBridgeNeovimCreateInput(input)) {
              if (!input.command && !input.metadata) {
                return yield* service.createNeovimPane({
                  actor: input.actor,
                  workspaceId: input.workspaceId,
                  windowId: input.windowId,
                  ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
                  split: input.split,
                });
              }
              return yield* kernelError({
                code: "invalid-state",
                message:
                  "Neovim panes must be created through the tmux Neovim bridge with bootstrap command and metadata",
                workspaceId: input.workspaceId,
                windowId: input.windowId,
              });
            }
            const runtime = yield* getRuntime(input.workspaceId);
            yield* requirePermissions(runtime, input.actor, requiredPaneCreatePermissions(input));
            const window = yield* getWindow(runtime, input.windowId);
            const metadata = yield* metadataForCreate(input);
            const splitArgs =
              input.split === "horizontal" ? ["-h"] : input.split === "vertical" ? ["-v"] : [];
            const args = [
              "split-window",
              ...splitArgs,
              "-P",
              "-F",
              paneListFormat(),
              "-t",
              window.tmuxWindowId,
            ];
            if (input.cwd) args.push("-c", input.cwd);
            const command = paneCommand(input);
            if (command) args.push(command);
            const beforePanes = new Set(runtime.panes.keys());
            yield* runAdmin(runtime, args).pipe(
              Effect.mapError((error) =>
                input.kind === "neovim" && isNvimUnavailableError(error)
                  ? kernelError({
                      code: "nvim-unavailable",
                      message: error.message,
                      workspaceId: input.workspaceId,
                      windowId: input.windowId,
                      cause: error,
                    })
                  : error,
              ),
            );
            yield* reconcile(runtime);
            for (const [id, pane] of runtime.panes) {
              if (!beforePanes.has(id) && pane.status !== "closed") {
                runtime.panes.set(id, { ...pane, metadata, updatedAt: nowIso() });
              }
            }
            bump(runtime);
            yield* persistState;
            yield* publishSnapshot(runtime);
            return snapshot(runtime);
          }),

        attachPaneMetadata: (input) =>
          Effect.gen(function* () {
            const runtime = yield* getRuntime(input.workspaceId);
            yield* requirePermission(runtime, input.actor, "pane:control", input.paneId);
            const pane = yield* getPane(runtime, input.paneId);
            const updated = {
              ...pane,
              metadata: input.metadata,
              updatedAt: nowIso(),
            };
            runtime.panes.set(input.paneId, updated);
            bump(runtime);
            yield* persistState;
            yield* publish({
              type: "pane.changed",
              workspaceId: runtime.workspace.workspaceId,
              revision: runtime.revision,
              occurredAt: nowIso(),
              pane: updated,
            });
            return updated;
          }),

        listOperationalPaneStatuses: (input) =>
          Effect.gen(function* () {
            const runtime = yield* getRuntime(input.workspaceId);
            yield* requirePermission(runtime, input.actor, "workspace:read");
            const panes = [...runtime.panes.values()].flatMap((pane) => {
              const status = operationalPaneStatus(pane);
              return status ? [status] : [];
            });
            return {
              workspaceId: input.workspaceId,
              panes,
              revision: runtime.revision,
            } satisfies TmuxOperationalPaneStatusResult;
          }),

        createNeovimPane: (input) =>
          Effect.gen(function* () {
            const runtime = yield* getRuntime(input.workspaceId);
            yield* requirePermissions(runtime, input.actor, [
              "pane:control",
              "process:spawn",
              "neovim:launch",
            ]);
            if (!isCommandAvailable("nvim")) {
              return yield* kernelError({
                code: "nvim-unavailable",
                message: "nvim was not found on the server PATH",
                workspaceId: input.workspaceId,
                windowId: input.windowId,
              });
            }
            yield* connectRuntime(runtime);
            yield* reconcile(runtime);
            const window = yield* getWindow(runtime, input.windowId);
            const cwd = input.cwd ?? window.cwd;
            const files = [...(input.files ?? [])];
            const profileId = input.profileId ?? "default";
            const themeId = input.themeId ?? "fenrir-dark";
            const keybindingProfileId = input.keybindingProfileId ?? "native-compatible";
            const bootstrapId = neovimBootstrapId({
              ...input,
              files,
              profileId,
              themeId,
              keybindingProfileId,
            });
            const bridgeSocketPath = neovimBridgeSocketPath(bootstrapId);
            const command = neovimCommand({
              bootstrapId,
              workspaceId: input.workspaceId,
              windowId: input.windowId,
              profileId,
              themeId,
              keybindingProfileId,
              bridgeSocketPath,
              files,
              ...(input.line === undefined ? {} : { line: input.line }),
              ...(input.column === undefined ? {} : { column: input.column }),
            });
            return yield* service.createPane({
              actor: input.actor,
              workspaceId: input.workspaceId,
              windowId: input.windowId,
              cwd,
              command,
              kind: "neovim",
              split: input.split ?? "horizontal",
              metadata: neovimMetadata({
                bootstrapId,
                workspaceId: input.workspaceId,
                windowId: input.windowId,
                cwd,
                profileId,
                themeId,
                keybindingProfileId,
                bridgeSocketPath,
                files,
                ...(input.line === undefined ? {} : { line: input.line }),
                ...(input.column === undefined ? {} : { column: input.column }),
                launchSource: input.launchSource ?? "user",
                command,
              }),
            });
          }),

        reconnectNeovimPane: (input) =>
          Effect.gen(function* () {
            const runtime = yield* getRuntime(input.workspaceId);
            yield* requirePermissions(runtime, input.actor, [
              "pane:control",
              "process:spawn",
              "neovim:launch",
            ]);
            yield* connectRuntime(runtime);
            yield* reconcile(runtime);
            const window = yield* getWindow(runtime, input.windowId);
            const files = [...(input.files ?? [])];
            const bootstrapId = neovimBootstrapId({
              ...input,
              files,
              profileId: input.profileId ?? "default",
              themeId: input.themeId ?? "fenrir-dark",
              keybindingProfileId: input.keybindingProfileId ?? "native-compatible",
            });
            const existing = [...runtime.panes.values()].find(
              (pane) =>
                pane.windowId === window.windowId &&
                pane.status === "running" &&
                pane.metadata.kind === "neovim" &&
                pane.metadata.neovim.bootstrapId === bootstrapId,
            );
            if (existing) {
              return yield* service.focusPane({
                actor: input.actor,
                workspaceId: input.workspaceId,
                paneId: existing.paneId,
              });
            }
            return yield* service.createNeovimPane({
              ...input,
              files,
              launchSource: input.launchSource ?? "restore",
            });
          }),

        focusPane: (input) =>
          Effect.gen(function* () {
            const runtime = yield* getRuntime(input.workspaceId);
            yield* requirePermission(runtime, input.actor, "pane:control", input.paneId);
            const pane = yield* getPane(runtime, input.paneId);
            yield* runAdmin(runtime, ["select-pane", "-t", pane.tmuxPaneId]);
            return yield* reconcile(runtime);
          }),

        resizePane: (input) =>
          Effect.gen(function* () {
            const runtime = yield* getRuntime(input.workspaceId);
            yield* requirePermission(runtime, input.actor, "pane:control", input.paneId);
            const pane = yield* getPane(runtime, input.paneId);
            const window = yield* getWindow(runtime, pane.windowId);
            const cachedRunningSiblings = [...runtime.panes.values()].filter(
              (candidate) => candidate.windowId === pane.windowId && candidate.status === "running",
            ).length;
            // Decide window-resize vs pane-resize from the LIVE tmux pane
            // count: the cached runtime.panes map races concurrent pane
            // creation (a split already applied in tmux but not yet
            // reconciled), which would misclassify a multi-pane window as
            // single-pane and clobber sibling panes with a window resize.
            // The cached count remains the fallback when the query output is
            // unparsable. A tiny TOCTOU window still exists between this
            // query and the resize command below; that is acceptable because
            // the next resize self-corrects.
            const rawPaneCount = yield* runAdmin(runtime, [
              "display-message",
              "-p",
              "-t",
              window.tmuxWindowId,
              "#{window_panes}",
            ]).pipe(Effect.orElseSucceed(() => ""));
            const livePaneCount = Number.parseInt(rawPaneCount.trim(), 10);
            const paneCount =
              Number.isInteger(livePaneCount) && livePaneCount > 0
                ? livePaneCount
                : cachedRunningSiblings;
            // A pane can never outgrow its window, and server-owned windows
            // have no sized client, so tmux pins them to its 80x24 default:
            // `resize-pane` alone is a no-op there. Sizing the window is the
            // only way to honor the client viewport.
            if (paneCount <= 1) {
              yield* runAdmin(runtime, [
                "resize-window",
                "-t",
                window.tmuxWindowId,
                "-x",
                String(input.cols),
                "-y",
                String(input.rows),
              ]);
            } else {
              const rawWindowSize = yield* runAdmin(runtime, [
                "display-message",
                "-p",
                "-t",
                window.tmuxWindowId,
                "#{window_width} #{window_height}",
              ]);
              const [windowWidth = 0, windowHeight = 0] = rawWindowSize
                .trim()
                .split(/\s+/)
                .map((value) => Number.parseInt(value, 10) || 0);
              const targetWidth = Math.max(windowWidth, input.cols);
              const targetHeight = Math.max(windowHeight, input.rows);
              if (targetWidth !== windowWidth || targetHeight !== windowHeight) {
                yield* runAdmin(runtime, [
                  "resize-window",
                  "-t",
                  window.tmuxWindowId,
                  "-x",
                  String(targetWidth),
                  "-y",
                  String(targetHeight),
                ]);
              }
              yield* runAdmin(runtime, [
                "resize-pane",
                "-t",
                pane.tmuxPaneId,
                "-x",
                String(input.cols),
                "-y",
                String(input.rows),
              ]);
            }
            const updated = {
              ...pane,
              cols: input.cols,
              rows: input.rows,
              updatedAt: nowIso(),
            };
            runtime.panes.set(input.paneId, updated);
            bump(runtime);
            yield* persistState;
            yield* publish({
              type: "pane.changed",
              workspaceId: runtime.workspace.workspaceId,
              revision: runtime.revision,
              occurredAt: nowIso(),
              pane: updated,
            });
            return updated;
          }),

        closePane: (input) =>
          Effect.gen(function* () {
            const runtime = yield* getRuntime(input.workspaceId);
            yield* requirePermission(runtime, input.actor, "pane:control", input.paneId);
            const pane = yield* getPane(runtime, input.paneId);
            if (input.mode !== "detach") {
              yield* runAdmin(runtime, ["kill-pane", "-t", pane.tmuxPaneId]);
            }
            const now = nowIso();
            runtime.panes.set(input.paneId, { ...pane, status: "closed", updatedAt: now });
            yield* paneStreams.closePane(input.paneId, "pane-closed");
            normalizeActiveReferences(runtime, now);
            bump(runtime);
            yield* persistState;
            yield* publishSnapshot(runtime);
            if (input.mode === "detach") return snapshot(runtime);
            return yield* reconcile(runtime);
          }),

        writePane: (input) =>
          Effect.gen(function* () {
            const runtime = yield* getRuntime(input.workspaceId);
            if (!hasPermission(runtime, input.actor, "pane:write")) {
              return permissionDeniedResult({
                workspaceId: input.workspaceId,
                paneId: input.paneId,
                requestId: input.requestId,
                permission: "pane:write",
              });
            }
            const pane = yield* getPane(runtime, input.paneId);
            const connection = runtime.connection;
            if (
              !connection ||
              pane.status !== "running" ||
              (yield* connection.status) !== "running"
            ) {
              return {
                type: "rejected",
                workspaceId: input.workspaceId,
                paneId: input.paneId,
                requestId: input.requestId,
                code: "not-running",
                message: `tmux pane ${input.paneId} is not running`,
                rejectedAt: nowIso(),
              } satisfies TmuxPaneWriteResult;
            }
            const nextSeq = (runtime.paneInputSeq.get(input.paneId) ?? 0) + 1;
            const writeExit = yield* Effect.exit(
              connection.command(paneInputCommand(pane.tmuxPaneId, input.data)),
            );
            if (writeExit._tag === "Failure") {
              return {
                type: "rejected",
                workspaceId: input.workspaceId,
                paneId: input.paneId,
                requestId: input.requestId,
                code: "invalid-state",
                message: "tmux pane input was rejected",
                rejectedAt: nowIso(),
              } satisfies TmuxPaneWriteResult;
            }
            runtime.paneInputSeq.set(input.paneId, nextSeq);
            return {
              type: "accepted",
              workspaceId: input.workspaceId,
              paneId: input.paneId,
              requestId: input.requestId,
              inputSeq: nextSeq,
              acceptedAt: nowIso(),
            } satisfies TmuxPaneWriteResult;
          }),

        subscribePaneStream: (input) =>
          Effect.gen(function* () {
            const runtime = yield* getRuntime(input.workspaceId);
            if (!hasPermission(runtime, input.actor, "pane:read")) {
              return yield* kernelError({
                code: "permission-denied",
                message: `pane:read is not granted for tmux pane ${input.paneId}`,
                workspaceId: input.workspaceId,
                paneId: input.paneId,
              });
            }
            const pane = yield* getPane(runtime, input.paneId);
            // A restored pane's ring buffer is empty after a server restart,
            // so a reattaching client would render blank until new output
            // arrives. Seed the FIRST subscription with the pane's visible
            // tmux screen; the delete-before-capture keeps concurrent
            // subscribers from double-seeding, and capture failures (pane or
            // session already gone) degrade to the old blank-until-output
            // behavior instead of failing the subscription.
            const needsScreenSeed =
              runtime.screenSeedPaneIds.delete(input.paneId) && pane.status === "running";
            const screenSeed = needsScreenSeed
              ? yield* captureVisibleScreen(runtime, pane).pipe(Effect.orElseSucceed(() => ""))
              : "";
            const stream = yield* paneStreams.subscribe(input);
            if (screenSeed.length > 0) {
              // Appended AFTER the subscription registers so every backfill
              // mode — including "latest", which skips buffered history —
              // receives the restored screen as a live chunk.
              yield* appendPaneStreamData(runtime, input.paneId, screenSeed);
            }
            return stream;
          }),

        subscribe: (input, listener) =>
          getRuntime(input.workspaceId).pipe(
            Effect.tap((runtime) => requirePermission(runtime, input.actor, "workspace:read")),
            Effect.flatMap((runtime) =>
              Effect.sync(() => {
                const workspaceId = input.workspaceId;
                let workspaceListeners = listeners.get(workspaceId);
                if (!workspaceListeners) {
                  workspaceListeners = new Set();
                  listeners.set(workspaceId, workspaceListeners);
                }
                workspaceListeners.add(listener);
                return {
                  runtime,
                  unsubscribe: () => {
                    workspaceListeners.delete(listener);
                  },
                };
              }).pipe(
                Effect.tap(({ runtime }) =>
                  listener({
                    type: "workspace.snapshot",
                    workspaceId: runtime.workspace.workspaceId,
                    revision: runtime.revision,
                    occurredAt: nowIso(),
                    snapshot: snapshot(runtime),
                  }),
                ),
                Effect.map(({ unsubscribe }) => unsubscribe),
              ),
            ),
          ),
      };

      return service;
    }),
  );
}

export const TmuxWorkspaceServiceLive = makeTmuxWorkspaceServiceLive();
