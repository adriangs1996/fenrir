import {
  type CreateRemoteHostInput,
  type DeleteRemoteHostInput,
  type ListRemoteDirectoryResult,
  type RemoteCommandRunId,
  type RemoteCommandRunSnapshot,
  type RemoteConnectionId,
  type RemoteConnectionSnapshot,
  type RemoteConnectionState,
  type RemoteControllerEvent,
  type RemoteHostId,
  type RemoteHostSnapshot,
  type StartRemoteConnectionInput,
  type UpdateRemoteHostInput,
} from "@fenrir/contracts";
import { Effect, Layer } from "effect";

import {
  RemoteControllerError,
  RemoteControllerService,
} from "../Services/RemoteControllerService";
import { parsePosixFindDirectoryListing } from "./OutputParser";
import { executeRemoteCommand, RemoteConnectionManager } from "./RemoteConnectionManager";

const mapControllerError = (cause: { readonly message: string }) =>
  new RemoteControllerError({
    message: cause.message,
    cause,
  });

const nowIso = () => new Date().toISOString();

const makeHostId = (): RemoteHostId => `host-${crypto.randomUUID()}` as RemoteHostId;
const makeRunId = (): RemoteCommandRunId => `run-${crypto.randomUUID()}` as RemoteCommandRunId;
const DEFAULT_DIRECTORY_ENTRY_LIMIT = 200;
const DEFAULT_CONNECTION_STATE: RemoteConnectionState = { path: "." };

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

const withRemotePath = (path: string, command: string): string =>
  `cd ${shellQuote(path)} && ${command}`;

const buildListDirectoryCommand = (directoryPath: string, limit: number): string => {
  const quotedPath = shellQuote(directoryPath);
  return [
    `dir=${quotedPath}`,
    `max=${Math.max(1, Math.floor(limit))}`,
    "count=0",
    'for p in "$dir"/* "$dir"/.[!.]* "$dir"/..?*; do',
    '  [ -e "$p" ] || [ -L "$p" ] || continue',
    '  if [ -d "$p" ] && [ ! -L "$p" ]; then kind=d; elif [ -L "$p" ]; then kind=l; elif [ -f "$p" ]; then kind=f; else kind=o; fi',
    '  size=$(stat -f "%z" "$p" 2>/dev/null || stat -c "%s" "$p" 2>/dev/null || printf "")',
    '  mtime=$(stat -f "%m" "$p" 2>/dev/null || stat -c "%Y" "$p" 2>/dev/null || printf "")',
    '  printf "%s\\t%s\\t%s\\t%s\\0" "$kind" "$size" "$mtime" "$p"',
    "  count=$((count + 1))",
    '  [ "$count" -ge "$max" ] && break',
    "done",
  ].join("\n");
};

const buildResolvePathCommand = (currentPath: string, nextPath: string): string =>
  withRemotePath(currentPath, `cd ${shellQuote(nextPath)} && pwd`);

const parseCdCommand = (command: string): string | null => {
  const trimmed = command.trim();
  if (trimmed === "cd") return "";
  if (!trimmed.startsWith("cd ")) return null;
  return trimmed.slice(3).trim() || "~";
};

const buildCdCommand = (currentPath: string, target: string): string =>
  target === ""
    ? withRemotePath(currentPath, "cd && pwd")
    : withRemotePath(currentPath, `cd ${target} && pwd`);

const resolveHostPatch = (
  previous: RemoteHostSnapshot,
  input: UpdateRemoteHostInput,
): RemoteHostSnapshot => ({
  ...previous,
  ...(input.label === undefined ? {} : { label: input.label }),
  ...(input.description === undefined ? {} : { description: input.description }),
  ...(input.transport === undefined ? {} : { transport: input.transport }),
  updatedAt: nowIso(),
});

const resolveStartInput = (
  hosts: ReadonlyMap<string, RemoteHostSnapshot>,
  input: StartRemoteConnectionInput,
) =>
  Effect.gen(function* () {
    const host = input.hostId === undefined ? undefined : hosts.get(input.hostId);
    if (input.hostId !== undefined && !host) {
      return yield* new RemoteControllerError({
        message: `Remote host ${input.hostId} not found.`,
      });
    }

    const transport = input.transport ?? host?.transport;
    if (!transport) {
      return yield* new RemoteControllerError({
        message: "A remote connection needs either a hostId or an explicit transport.",
      });
    }

    return {
      ...(input.connectionId === undefined ? {} : { connectionId: input.connectionId }),
      ...(input.hostId === undefined ? {} : { hostId: input.hostId }),
      label: input.label ?? host?.label ?? "Remote host",
      transport,
    };
  });

export const RemoteController = Layer.effect(
  RemoteControllerService,
  Effect.gen(function* () {
    const connectionManager = yield* RemoteConnectionManager;
    const hosts = new Map<string, RemoteHostSnapshot>();
    const commandRuns = new Map<string, RemoteCommandRunSnapshot>();
    const connectionStates = new Map<string, RemoteConnectionState>();
    const subscribers = new Set<(event: RemoteControllerEvent) => void>();

    const emit = (event: RemoteControllerEvent) => {
      for (const subscriber of subscribers) {
        try {
          subscriber(event);
        } catch (error) {
          console.warn("[remote-controller] subscriber threw:", error);
        }
      }
    };

    const upsertRun = (snapshot: RemoteCommandRunSnapshot) => {
      commandRuns.set(snapshot.runId, snapshot);
      emit({ type: "commandRun.updated", snapshot });
    };

    const stateForConnection = (connectionId: string): RemoteConnectionState =>
      connectionStates.get(connectionId) ?? DEFAULT_CONNECTION_STATE;

    const snapshotWithState = (snapshot: RemoteConnectionSnapshot): RemoteConnectionSnapshot => ({
      ...snapshot,
      state: stateForConnection(snapshot.connectionId),
    });

    const resolveRemotePath = (connectionId: string, nextPath: string) =>
      Effect.gen(function* () {
        const connection = yield* connectionManager
          .getConnection(connectionId)
          .pipe(Effect.mapError(mapControllerError));
        const state = stateForConnection(connectionId);
        const result = yield* executeRemoteCommand(connection, {
          command: buildResolvePathCommand(state.path, nextPath),
          timeoutMs: 10_000,
          outputBytesLimit: 64 * 1024,
        }).pipe(Effect.mapError(mapControllerError));

        if (result.exitCode !== 0 || result.signal !== null) {
          return yield* new RemoteControllerError({
            message: result.combinedOutput.trim() || `Failed to change remote path to ${nextPath}.`,
          });
        }

        const resolvedPath = result.stdout.trim().split(/\r?\n/).at(-1)?.trim();
        if (!resolvedPath) {
          return yield* new RemoteControllerError({
            message: `Failed to resolve remote path ${nextPath}.`,
          });
        }

        return resolvedPath;
      });

    return {
      listHosts: () => Effect.sync(() => Array.from(hosts.values())),

      createHost: (input: CreateRemoteHostInput) =>
        Effect.sync(() => {
          const timestamp = nowIso();
          const hostId = input.hostId ?? makeHostId();
          const snapshot: RemoteHostSnapshot = {
            hostId,
            label: input.label,
            ...(input.description === undefined ? {} : { description: input.description }),
            transport: input.transport,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          hosts.set(hostId, snapshot);
          emit({ type: "host.upserted", snapshot });
          return snapshot;
        }),

      updateHost: (input: UpdateRemoteHostInput) =>
        Effect.gen(function* () {
          const previous = hosts.get(input.hostId);
          if (!previous) {
            return yield* new RemoteControllerError({
              message: `Remote host ${input.hostId} not found.`,
            });
          }
          const snapshot = resolveHostPatch(previous, input);
          hosts.set(input.hostId, snapshot);
          emit({ type: "host.upserted", snapshot });
          return snapshot;
        }),

      deleteHost: (input: DeleteRemoteHostInput) =>
        Effect.gen(function* () {
          const previous = hosts.get(input.hostId);
          if (!previous) {
            return yield* new RemoteControllerError({
              message: `Remote host ${input.hostId} not found.`,
            });
          }
          hosts.delete(input.hostId);
          const connections = yield* connectionManager.listConnections();
          for (const connection of connections) {
            if (connection.hostId === input.hostId && connection.status === "connected") {
              const stopped = yield* connectionManager
                .stopConnection(connection.connectionId)
                .pipe(Effect.mapError(mapControllerError));
              emit({ type: "connection.updated", snapshot: stopped });
            }
          }
          emit({ type: "host.deleted", hostId: input.hostId });
        }),

      startConnection: (input: StartRemoteConnectionInput) =>
        Effect.gen(function* () {
          const resolved = yield* resolveStartInput(hosts, input);
          const snapshot = yield* connectionManager
            .startConnection(resolved)
            .pipe(Effect.mapError(mapControllerError));
          connectionStates.set(snapshot.connectionId, { path: input.path ?? "." });
          const statefulSnapshot = snapshotWithState(snapshot);
          emit({ type: "connection.updated", snapshot: statefulSnapshot });
          return statefulSnapshot;
        }),

      stopConnection: (input) =>
        connectionManager.stopConnection(input.connectionId).pipe(
          Effect.mapError(mapControllerError),
          Effect.map(snapshotWithState),
          Effect.tap((snapshot) =>
            Effect.sync(() => emit({ type: "connection.updated", snapshot })),
          ),
        ),

      setConnectionPath: (input) =>
        Effect.gen(function* () {
          const resolvedPath = yield* resolveRemotePath(input.connectionId, input.path);
          connectionStates.set(input.connectionId, { path: resolvedPath });
          const snapshot = yield* connectionManager.listConnections().pipe(
            Effect.map((connections) =>
              connections.find((connection) => connection.connectionId === input.connectionId),
            ),
            Effect.mapError(mapControllerError),
          );
          if (!snapshot) {
            return yield* new RemoteControllerError({
              message: `Remote connection ${input.connectionId} not found.`,
            });
          }
          const statefulSnapshot = snapshotWithState(snapshot);
          emit({ type: "connection.updated", snapshot: statefulSnapshot });
          return statefulSnapshot;
        }),

      listConnections: () =>
        connectionManager
          .listConnections()
          .pipe(Effect.map((snapshots) => snapshots.map(snapshotWithState))),

      sendCommand: (input) =>
        Effect.gen(function* () {
          const connection = yield* connectionManager
            .getConnection(input.connectionId)
            .pipe(Effect.mapError(mapControllerError));
          const state = stateForConnection(input.connectionId);
          const startedAt = nowIso();
          const running: RemoteCommandRunSnapshot = {
            runId: makeRunId(),
            connectionId: input.connectionId as RemoteConnectionId,
            command: input.command,
            status: "running",
            output: "",
            exitCode: null,
            signal: null,
            startedAt,
          };
          upsertRun(running);

          const cdTarget = parseCdCommand(input.command);
          const result = yield* executeRemoteCommand(connection, {
            command:
              cdTarget === null
                ? withRemotePath(state.path, input.command)
                : buildCdCommand(state.path, cdTarget),
          }).pipe(Effect.mapError(mapControllerError));
          if (cdTarget !== null && result.exitCode === 0 && result.signal === null) {
            const resolvedPath = result.stdout.trim().split(/\r?\n/).at(-1)?.trim();
            if (resolvedPath) {
              connectionStates.set(input.connectionId, { path: resolvedPath });
              const snapshots = yield* connectionManager
                .listConnections()
                .pipe(Effect.mapError(mapControllerError));
              const snapshot = snapshots.find(
                (connectionSnapshot) => connectionSnapshot.connectionId === input.connectionId,
              );
              if (snapshot) {
                emit({ type: "connection.updated", snapshot: snapshotWithState(snapshot) });
              }
            }
          }
          const finished: RemoteCommandRunSnapshot = {
            ...running,
            status: result.exitCode === 0 && result.signal === null ? "succeeded" : "failed",
            output: result.combinedOutput,
            exitCode: result.exitCode,
            signal: result.signal,
            finishedAt: nowIso(),
          };
          upsertRun(finished);
          return finished;
        }),

      listCommandRuns: (input) =>
        Effect.sync(() => {
          const runs = Array.from(commandRuns.values());
          return input.connectionId === undefined
            ? runs
            : runs.filter((run) => run.connectionId === input.connectionId);
        }),

      listDirectory: (input) =>
        Effect.gen(function* () {
          const connection = yield* connectionManager
            .getConnection(input.connectionId)
            .pipe(Effect.mapError(mapControllerError));
          const state = stateForConnection(input.connectionId);
          const limit = input.limit ?? DEFAULT_DIRECTORY_ENTRY_LIMIT;
          const result = yield* executeRemoteCommand(connection, {
            command: withRemotePath(state.path, buildListDirectoryCommand(input.path, limit)),
            timeoutMs: 10_000,
            outputBytesLimit: 1024 * 1024,
          }).pipe(Effect.mapError(mapControllerError));

          if (result.exitCode !== 0 || result.signal !== null) {
            return yield* new RemoteControllerError({
              message:
                result.combinedOutput.trim() || `Failed to list remote directory ${input.path}.`,
            });
          }

          const parsed = parsePosixFindDirectoryListing({
            directoryPath: input.path,
            stdout: result.stdout,
          });
          const entries = parsed.entries.slice(0, limit);
          const response: ListRemoteDirectoryResult = {
            path: input.path,
            entries,
            truncated: parsed.entries.length > entries.length || result.outputTruncated,
            ...(!parsed.ok ? { parseError: parsed.message } : {}),
          };
          return response;
        }),

      subscribe: (callback) =>
        Effect.sync(() => {
          subscribers.add(callback);
          return () => {
            subscribers.delete(callback);
          };
        }),
    };
  }),
);
