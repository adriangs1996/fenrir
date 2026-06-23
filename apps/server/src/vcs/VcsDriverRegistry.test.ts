import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Cause, DateTime, Effect, Layer, Option } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { VcsUnsupportedOperationError } from "@fenrir/contracts";
import { runProcess } from "../processRunner.ts";
import { GitVcsDriver } from "./GitVcsDriver.ts";
import { VcsProjectConfig } from "./VcsProjectConfig.ts";
import type { VcsDriverShape } from "./VcsDriver.ts";
import {
  makeVcsDriverRegistry,
  VcsDriverRegistry,
  VcsDriverRegistryLive,
} from "./VcsDriverRegistry.ts";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fenrir-vcs-driver-test-"));
  tempDirectories.push(directory);
  return directory;
}

async function initRepo(cwd: string): Promise<void> {
  await runProcess("git", ["init"], { cwd });
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  await runProcess("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Fenrir",
      GIT_AUTHOR_EMAIL: "fenrir@test.com",
      GIT_COMMITTER_NAME: "Fenrir",
      GIT_COMMITTER_EMAIL: "fenrir@test.com",
    },
  });
}

function writeFile(cwd: string, relativePath: string, content: string): void {
  const filePath = path.join(cwd, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

async function makeCommittedRepo(files: Record<string, string>): Promise<string> {
  const cwd = makeTempDir();
  await git(cwd, "init", "-b", "main");
  for (const [relativePath, content] of Object.entries(files)) {
    writeFile(cwd, relativePath, content);
  }
  await git(cwd, "add", ".");
  await git(cwd, "commit", "-m", "initial");
  return cwd;
}

describe("VcsDriverRegistryLive", () => {
  it("detects git repositories", async () => {
    const cwd = makeTempDir();
    await initRepo(cwd);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* VcsDriverRegistry;
        return yield* registry.detect({ cwd });
      }).pipe(Effect.provide(VcsDriverRegistryLive.pipe(Layer.provide(NodeServices.layer)))),
    );

    expect(result?.kind).toBe("git");
    expect(result?.repository.rootPath).toBe(fs.realpathSync(cwd));
  });

  it("returns null for non-repositories", async () => {
    const cwd = makeTempDir();

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* VcsDriverRegistry;
        return yield* registry.detect({ cwd });
      }).pipe(Effect.provide(VcsDriverRegistryLive.pipe(Layer.provide(NodeServices.layer)))),
    );

    expect(result).toBeNull();
  });

  it("resolves review diff support for git repositories", async () => {
    const cwd = await makeCommittedRepo({ "src/file.txt": "one\n" });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* VcsDriverRegistry;
        return yield* registry.resolveReviewDiff({ cwd });
      }).pipe(Effect.provide(VcsDriverRegistryLive.pipe(Layer.provide(NodeServices.layer)))),
    );

    expect(result.kind).toBe("git");
    expect(result.reviewDiff).toBeDefined();
  });

  it("fails when the resolved driver does not support review diff operations", async () => {
    const cwd = makeTempDir();
    const driverWithoutReviewDiff: VcsDriverShape = {
      capabilities: {
        kind: "git",
        supportsWorktrees: true,
        supportsBookmarks: false,
        supportsAtomicSnapshot: false,
        supportsPushDefaultRemote: true,
        ignoreClassifier: "native",
      },
      execute: () => Effect.die("execute should not be called"),
      detectRepository: (repositoryCwd) =>
        Effect.gen(function* () {
          return {
            kind: "git" as const,
            rootPath: repositoryCwd,
            metadataPath: null,
            freshness: {
              source: "live-local" as const,
              observedAt: yield* DateTime.now,
              expiresAt: Option.none(),
            },
          };
        }),
      isInsideWorkTree: () => Effect.succeed(true),
      listWorkspaceFiles: () => Effect.die("listWorkspaceFiles should not be called"),
      listRemotes: () => Effect.die("listRemotes should not be called"),
      filterIgnoredPaths: (_repositoryCwd, relativePaths) => Effect.succeed(relativePaths),
      initRepository: () => Effect.void,
    };

    const registryLayer = Layer.effect(VcsDriverRegistry, makeVcsDriverRegistry).pipe(
      Layer.provide(Layer.succeed(GitVcsDriver, GitVcsDriver.of(driverWithoutReviewDiff))),
      Layer.provide(
        Layer.succeed(
          VcsProjectConfig,
          VcsProjectConfig.of({
            resolveKind: () => Effect.succeed("auto"),
          }),
        ),
      ),
    );

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const registry = yield* VcsDriverRegistry;
        return yield* registry.resolveReviewDiff({ cwd });
      }).pipe(Effect.provide(registryLayer)),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = Cause.squash(exit.cause);
      expect(failure).toBeInstanceOf(VcsUnsupportedOperationError);
      expect(String(failure)).toContain("does not support review diff operations");
    }
  });
});
