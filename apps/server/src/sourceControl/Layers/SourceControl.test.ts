import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";

import { runProcess } from "../../processRunner.ts";
import { SourceControl } from "../Services/SourceControl.ts";
import { SourceControlLive } from "./SourceControl.ts";

const git = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.promise(() => runProcess("git", ["-C", cwd, ...args], { cwd }));

it.layer(NodeServices.layer)("SourceControlLive", (it) => {
  describe("resolveWorkspace", () => {
    it.effect("detects a git repository and resolves repository identity", () =>
      Effect.gen(function* () {
        const cwd = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "fenrir-sc-")));

        yield* git(cwd, ["init"]);
        yield* git(cwd, ["remote", "add", "origin", "git@github.com:Fenrir/fenrir.git"]);

        const sourceControl = yield* SourceControl;
        const workspace = yield* sourceControl.resolveWorkspace(cwd);

        expect(workspace?.kind).toBe("git");
        expect(workspace?.rootPath).toBe(yield* Effect.promise(() => fs.realpath(cwd)));
        expect(workspace?.repositoryIdentity?.canonicalKey).toBe("github.com/fenrir/fenrir");
      }).pipe(Effect.provide(SourceControlLive)),
    );

    it.effect("returns null for non-repository directories", () =>
      Effect.gen(function* () {
        const cwd = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "fenrir-sc-")));

        const sourceControl = yield* SourceControl;
        const workspace = yield* sourceControl.resolveWorkspace(cwd);
        const isSupported = yield* sourceControl.isSupportedWorkspace(cwd);

        expect(workspace).toBeNull();
        expect(isSupported).toBe(false);
      }).pipe(Effect.provide(SourceControlLive)),
    );
  });
});
