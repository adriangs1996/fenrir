import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { runProcess } from "../processRunner.ts";
import { VcsDriverRegistry, VcsDriverRegistryLive } from "./VcsDriverRegistry.ts";

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

describe("VcsDriverRegistryLive", () => {
  it("detects git repositories", async () => {
    const cwd = makeTempDir();
    await initRepo(cwd);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* VcsDriverRegistry;
        return yield* registry.detect({ cwd });
      }).pipe(Effect.provide(VcsDriverRegistryLive)),
    );

    expect(result?.kind).toBe("git");
    expect(result?.repository.rootPath).toBe(cwd);
  });

  it("returns null for non-repositories", async () => {
    const cwd = makeTempDir();

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* VcsDriverRegistry;
        return yield* registry.detect({ cwd });
      }).pipe(Effect.provide(VcsDriverRegistryLive)),
    );

    expect(result).toBeNull();
  });
});
