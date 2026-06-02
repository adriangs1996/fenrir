import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe, expect } from "vitest";

import { RemoteControllerService } from "../Services/RemoteControllerService";
import { RemoteConnectionManagerLive } from "./RemoteConnectionManager";
import { RemoteController } from "./RemoteController";

const liveLayer = RemoteController.pipe(Layer.provide(RemoteConnectionManagerLive));

const localShellTransport = {
  type: "command-template",
  command: "sh",
  args: ["-lc", "{command}"],
} as const;

describe("RemoteController", () => {
  it.effect(
    "creates a host, starts a connection, and executes a command through the template",
    () =>
      Effect.gen(function* () {
        if (process.platform === "win32") return;

        const controller = yield* RemoteControllerService;
        const host = yield* controller.createHost({
          label: "Local shell",
          transport: localShellTransport,
        });
        const connection = yield* controller.startConnection({ hostId: host.hostId });
        const run = yield* controller.sendCommand({
          connectionId: connection.connectionId,
          command: "printf 'remote-controller-output'",
        });

        expect(connection).toMatchObject({
          hostId: host.hostId,
          label: "Local shell",
          status: "connected",
          transportType: "command-template",
        });
        expect(run).toMatchObject({
          connectionId: connection.connectionId,
          command: "printf 'remote-controller-output'",
          status: "succeeded",
          output: "remote-controller-output",
          exitCode: 0,
          signal: null,
        });
      }).pipe(Effect.provide(liveLayer)),
  );

  it.effect("records non-zero command exits as failed command runs without failing transport", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return;

      const controller = yield* RemoteControllerService;
      const connection = yield* controller.startConnection({
        label: "Ad hoc shell",
        transport: localShellTransport,
      });
      const run = yield* controller.sendCommand({
        connectionId: connection.connectionId,
        command: "printf 'denied' >&2; exit 7",
      });

      expect(run.status).toBe("failed");
      expect(run.output).toBe("denied");
      expect(run.exitCode).toBe(7);
      expect(yield* controller.listCommandRuns({ connectionId: connection.connectionId })).toEqual([
        run,
      ]);
    }).pipe(Effect.provide(liveLayer)),
  );

  it.effect("lists remote directory entries through the command template", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return;

      const tempDir = mkdtempSync(join(tmpdir(), "fenrir-remote-tree-"));
      try {
        writeFileSync(join(tempDir, "alpha.txt"), "alpha\n");
        yield* Effect.promise(() => mkdir(join(tempDir, "src")));
        symlinkSync(join(tempDir, "alpha.txt"), join(tempDir, "alpha-link"));

        const controller = yield* RemoteControllerService;
        const host = yield* controller.createHost({
          label: "Tree shell",
          transport: { ...localShellTransport, cwd: tempDir },
        });
        const connection = yield* controller.startConnection({ hostId: host.hostId });
        const result = yield* controller.listDirectory({
          connectionId: connection.connectionId,
          path: ".",
          limit: 20,
        });

        expect(result.path).toBe(".");
        expect(result.truncated).toBe(false);
        expect(result.entries).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "alpha.txt", kind: "file" }),
            expect.objectContaining({ name: "src", kind: "directory" }),
            expect.objectContaining({ name: "alpha-link", kind: "symlink" }),
          ]),
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }).pipe(Effect.provide(liveLayer)),
  );

  it.effect("updates connection path state with cd and executes later commands there", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return;

      const tempDir = mkdtempSync(join(tmpdir(), "fenrir-remote-path-"));
      try {
        yield* Effect.promise(() => mkdir(join(tempDir, "src")));
        writeFileSync(join(tempDir, "src", "marker.txt"), "marker\n");

        const controller = yield* RemoteControllerService;
        const host = yield* controller.createHost({
          label: "Path shell",
          transport: { ...localShellTransport, cwd: tempDir },
        });
        const connection = yield* controller.startConnection({ hostId: host.hostId });
        const cdRun = yield* controller.sendCommand({
          connectionId: connection.connectionId,
          command: "cd src",
        });
        const [updatedConnection] = yield* controller.listConnections();
        const pwdRun = yield* controller.sendCommand({
          connectionId: connection.connectionId,
          command: "pwd; ls",
        });

        expect(cdRun.status).toBe("succeeded");
        const expectedPath = realpathSync(join(tempDir, "src"));
        expect(updatedConnection?.state.path).toBe(expectedPath);
        expect(pwdRun.output).toContain(expectedPath);
        expect(pwdRun.output).toContain("marker.txt");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }).pipe(Effect.provide(liveLayer)),
  );

  it.effect("publishes host, connection, and command run events", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return;

      const controller = yield* RemoteControllerService;
      const events: string[] = [];
      const unsubscribe = yield* controller.subscribe((event) => {
        events.push(event.type);
      });

      const host = yield* controller.createHost({
        label: "Event shell",
        transport: localShellTransport,
      });
      const connection = yield* controller.startConnection({ hostId: host.hostId });
      yield* controller.sendCommand({
        connectionId: connection.connectionId,
        command: "printf ok",
      });
      unsubscribe();

      expect(events).toEqual([
        "host.upserted",
        "connection.updated",
        "commandRun.updated",
        "commandRun.updated",
      ]);
    }).pipe(Effect.provide(liveLayer)),
  );
});
