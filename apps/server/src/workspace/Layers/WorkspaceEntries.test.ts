import fsPromises from "node:fs/promises";
import { homedir } from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, afterEach, describe, expect, vi } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, PlatformError } from "effect";

import { ServerConfig } from "../../config.ts";
import { GitCoreLive } from "../../git/Layers/GitCore.ts";
import { GitCore } from "../../git/Services/GitCore.ts";
import { WorkspaceEntries } from "../Services/WorkspaceEntries.ts";
import { WorkspaceEntriesLive } from "./WorkspaceEntries.ts";
import { WorkspacePathsLive } from "./WorkspacePaths.ts";

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive))),
  Layer.provideMerge(WorkspacePathsLive),
  Layer.provideMerge(GitCoreLive),
  Layer.provide(
    ServerConfig.layerTest(process.cwd(), {
      prefix: "fenrir-workspace-entries-test-",
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDir = Effect.fn(function* (opts?: { prefix?: string; git?: boolean }) {
  const fileSystem = yield* FileSystem.FileSystem;
  const gitCore = yield* GitCore;
  const dir = yield* fileSystem.makeTempDirectoryScoped({
    prefix: opts?.prefix ?? "fenrir-workspace-entries-",
  });
  if (opts?.git) {
    yield* gitCore.initRepo({ cwd: dir });
  }
  return dir;
});

function writeTextFile(
  cwd: string,
  relativePath: string,
  contents = "",
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const absolutePath = path.join(cwd, relativePath);
    yield* fileSystem.makeDirectory(path.dirname(absolutePath), { recursive: true });
    yield* fileSystem.writeFileString(absolutePath, contents);
  });
}

const git = (cwd: string, args: ReadonlyArray<string>, env?: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const gitCore = yield* GitCore;
    const result = yield* gitCore.execute({
      operation: "WorkspaceEntries.test.git",
      cwd,
      args,
      ...(env ? { env } : {}),
      timeoutMs: 10_000,
    });
    return result.stdout.trim();
  });

const searchWorkspaceEntries = (input: { cwd: string; query: string; limit: number }) =>
  Effect.gen(function* () {
    const workspaceEntries = yield* WorkspaceEntries;
    return yield* workspaceEntries.search(input);
  });

const listWorkspaceEntries = (input: {
  cwd: string;
  includeIgnored?: boolean;
  relativePath?: string;
  limit: number;
}) =>
  Effect.gen(function* () {
    const workspaceEntries = yield* WorkspaceEntries;
    return yield* workspaceEntries.listEntries(input);
  });

const browseWorkspaceEntries = (input: { partialPath: string; cwd?: string }) =>
  Effect.gen(function* () {
    const workspaceEntries = yield* WorkspaceEntries;
    return yield* workspaceEntries.browse(input);
  });

function appendSeparator(value: string): string {
  return /[\\/]$/.test(value) ? value : `${value}/`;
}

it.layer(TestLayer)("WorkspaceEntriesLive", (it) => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("search", () => {
    it.effect("returns files and directories relative to cwd", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir();
        yield* writeTextFile(cwd, "src/components/Composer.tsx");
        yield* writeTextFile(cwd, "src/index.ts");
        yield* writeTextFile(cwd, "README.md");
        yield* writeTextFile(cwd, ".git/HEAD");
        yield* writeTextFile(cwd, "node_modules/pkg/index.js");

        const result = yield* searchWorkspaceEntries({ cwd, query: "", limit: 100 });
        const paths = result.entries.map((entry) => entry.path);

        expect(paths).toContain("src");
        expect(paths).toContain("src/components");
        expect(paths).toContain("src/components/Composer.tsx");
        expect(paths).toContain("README.md");
        expect(paths.some((entryPath) => entryPath.startsWith(".git"))).toBe(false);
        expect(paths.some((entryPath) => entryPath.startsWith("node_modules"))).toBe(false);
        expect(result.truncated).toBe(false);
      }),
    );

    it.effect("filters and ranks entries by query", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({ prefix: "fenrir-workspace-query-" });
        yield* writeTextFile(cwd, "src/components/Composer.tsx");
        yield* writeTextFile(cwd, "src/components/composePrompt.ts");
        yield* writeTextFile(cwd, "docs/composition.md");

        const result = yield* searchWorkspaceEntries({ cwd, query: "compo", limit: 5 });

        expect(result.entries.length).toBeGreaterThan(0);
        expect(result.entries.some((entry) => entry.path === "src/components")).toBe(true);
        expect(result.entries.every((entry) => entry.path.toLowerCase().includes("compo"))).toBe(
          true,
        );
      }),
    );

    it.effect("supports fuzzy subsequence queries for composer path search", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({ prefix: "fenrir-workspace-fuzzy-query-" });
        yield* writeTextFile(cwd, "src/components/Composer.tsx");
        yield* writeTextFile(cwd, "src/components/composePrompt.ts");
        yield* writeTextFile(cwd, "docs/composition.md");

        const result = yield* searchWorkspaceEntries({ cwd, query: "cmp", limit: 10 });
        const paths = result.entries.map((entry) => entry.path);

        expect(result.entries.length).toBeGreaterThan(0);
        expect(paths).toContain("src/components");
        expect(paths).toContain("src/components/Composer.tsx");
      }),
    );

    it.effect("tracks truncation without sorting every fuzzy match", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({ prefix: "fenrir-workspace-fuzzy-limit-" });
        yield* writeTextFile(cwd, "src/components/Composer.tsx");
        yield* writeTextFile(cwd, "src/components/composePrompt.ts");
        yield* writeTextFile(cwd, "docs/composition.md");

        const result = yield* searchWorkspaceEntries({ cwd, query: "cmp", limit: 1 });

        expect(result.entries).toHaveLength(1);
        expect(result.truncated).toBe(true);
      }),
    );

    it.effect("excludes gitignored paths for git repositories", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({ prefix: "fenrir-workspace-gitignore-", git: true });
        yield* writeTextFile(cwd, ".gitignore", ".convex/\nconvex/\nignored.txt\n");
        yield* writeTextFile(cwd, "src/keep.ts", "export {};");
        yield* writeTextFile(cwd, "ignored.txt", "ignore me");
        yield* writeTextFile(cwd, ".convex/local-storage/data.json", "{}");
        yield* writeTextFile(cwd, "convex/UOoS-l/convex_local_storage/modules/data.json", "{}");

        const result = yield* searchWorkspaceEntries({ cwd, query: "", limit: 100 });
        const paths = result.entries.map((entry) => entry.path);

        expect(paths).toContain("src");
        expect(paths).toContain("src/keep.ts");
        expect(paths).not.toContain("ignored.txt");
        expect(paths.some((entryPath) => entryPath.startsWith(".convex/"))).toBe(false);
        expect(paths.some((entryPath) => entryPath.startsWith("convex/"))).toBe(false);
      }),
    );

    it.effect("excludes tracked paths that match ignore rules", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({
          prefix: "fenrir-workspace-tracked-gitignore-",
          git: true,
        });
        yield* writeTextFile(cwd, ".convex/local-storage/data.json", "{}");
        yield* writeTextFile(cwd, "src/keep.ts", "export {};");
        yield* git(cwd, ["add", ".convex/local-storage/data.json", "src/keep.ts"]);
        yield* writeTextFile(cwd, ".gitignore", ".convex/\n");

        const result = yield* searchWorkspaceEntries({ cwd, query: "", limit: 100 });
        const paths = result.entries.map((entry) => entry.path);

        expect(paths).toContain("src");
        expect(paths).toContain("src/keep.ts");
        expect(paths.some((entryPath) => entryPath.startsWith(".convex/"))).toBe(false);
      }),
    );

    it.effect("excludes .convex in non-git workspaces", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({ prefix: "fenrir-workspace-non-git-convex-" });
        yield* writeTextFile(cwd, ".convex/local-storage/data.json", "{}");
        yield* writeTextFile(cwd, "src/keep.ts", "export {};");

        const result = yield* searchWorkspaceEntries({ cwd, query: "", limit: 100 });
        const paths = result.entries.map((entry) => entry.path);

        expect(paths).toContain("src");
        expect(paths).toContain("src/keep.ts");
        expect(paths.some((entryPath) => entryPath.startsWith(".convex/"))).toBe(false);
      }),
    );

    it.effect("deduplicates concurrent index builds for the same cwd", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({ prefix: "fenrir-workspace-concurrent-build-" });
        yield* writeTextFile(cwd, "src/components/Composer.tsx");

        let rootReadCount = 0;
        const originalReaddir = fsPromises.readdir.bind(fsPromises);
        vi.spyOn(fsPromises, "readdir").mockImplementation((async (
          ...args: Parameters<typeof fsPromises.readdir>
        ) => {
          if (args[0] === cwd) {
            rootReadCount += 1;
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          return originalReaddir(...args);
        }) as typeof fsPromises.readdir);

        yield* Effect.all(
          [
            searchWorkspaceEntries({ cwd, query: "", limit: 100 }),
            searchWorkspaceEntries({ cwd, query: "comp", limit: 100 }),
            searchWorkspaceEntries({ cwd, query: "src", limit: 100 }),
          ],
          { concurrency: "unbounded" },
        );

        expect(rootReadCount).toBe(1);
      }),
    );

    it.effect("limits concurrent directory reads while walking the filesystem", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({ prefix: "fenrir-workspace-read-concurrency-" });
        yield* Effect.forEach(
          Array.from({ length: 80 }, (_, index) => index),
          (index) => writeTextFile(cwd, `group-${index}/entry-${index}.ts`, "export {};"),
          { discard: true },
        );

        let activeReads = 0;
        let peakReads = 0;
        const originalReaddir = fsPromises.readdir.bind(fsPromises);
        vi.spyOn(fsPromises, "readdir").mockImplementation((async (
          ...args: Parameters<typeof fsPromises.readdir>
        ) => {
          const target = args[0];
          if (typeof target === "string" && target.startsWith(cwd)) {
            activeReads += 1;
            peakReads = Math.max(peakReads, activeReads);
            await new Promise((resolve) => setTimeout(resolve, 4));
            try {
              return await originalReaddir(...args);
            } finally {
              activeReads -= 1;
            }
          }
          return originalReaddir(...args);
        }) as typeof fsPromises.readdir);

        yield* searchWorkspaceEntries({ cwd, query: "", limit: 200 });

        expect(peakReads).toBeLessThanOrEqual(32);
      }),
    );
  });

  describe("listEntries", () => {
    it.effect("lists direct children relative to cwd with directories first", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({ prefix: "fenrir-workspace-list-" });
        yield* writeTextFile(cwd, "src/index.ts", "export {};");
        yield* writeTextFile(cwd, "README.md", "# Readme\n");
        yield* writeTextFile(cwd, "node_modules/pkg/index.js", "");

        const result = yield* listWorkspaceEntries({ cwd, limit: 100 });

        expect(result).toEqual({
          entries: [
            { path: "src", kind: "directory" },
            { path: "README.md", kind: "file" },
          ],
          truncated: false,
        });
      }),
    );

    it.effect("lists nested directories and reports truncation", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({ prefix: "fenrir-workspace-list-nested-" });
        yield* writeTextFile(cwd, "src/a.ts", "export {};");
        yield* writeTextFile(cwd, "src/b.ts", "export {};");

        const result = yield* listWorkspaceEntries({ cwd, relativePath: "src", limit: 1 });

        expect(result).toEqual({
          entries: [{ path: "src/a.ts", kind: "file", parentPath: "src" }],
          truncated: true,
        });
      }),
    );

    it.effect("hides gitignored entries by default and includes them when requested", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({ prefix: "fenrir-workspace-list-ignored-", git: true });
        yield* writeTextFile(cwd, ".gitignore", "ignored.txt\nignored-dir/\nnode_modules/\n");
        yield* writeTextFile(cwd, "src/index.ts", "export {};");
        yield* writeTextFile(cwd, "ignored.txt", "");
        yield* writeTextFile(cwd, "ignored-dir/config.json", "{}");
        yield* writeTextFile(cwd, "node_modules/pkg/index.js", "");

        const hiddenResult = yield* listWorkspaceEntries({ cwd, limit: 100 });
        const visibleResult = yield* listWorkspaceEntries({
          cwd,
          includeIgnored: true,
          limit: 100,
        });

        expect(hiddenResult.entries).toEqual([
          { path: "src", kind: "directory" },
          { path: ".gitignore", kind: "file" },
        ]);
        expect(visibleResult.entries).toEqual([
          { path: "ignored-dir", kind: "directory" },
          { path: "node_modules", kind: "directory" },
          { path: "src", kind: "directory" },
          { path: ".gitignore", kind: "file" },
          { path: "ignored.txt", kind: "file" },
        ]);
      }),
    );

    it.effect("keeps git metadata hidden even when ignored entries are included", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({
          prefix: "fenrir-workspace-list-ignored-git-",
          git: true,
        });

        const result = yield* listWorkspaceEntries({
          cwd,
          includeIgnored: true,
          limit: 100,
        });

        expect(result.entries.some((entry) => entry.path === ".git")).toBe(false);
      }),
    );

    it.effect("rejects directory traversal outside the workspace root", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({ prefix: "fenrir-workspace-list-traversal-" });

        const error = yield* listWorkspaceEntries({
          cwd,
          relativePath: "../outside",
          limit: 100,
        }).pipe(Effect.flip);

        expect(error.detail).toBe("Workspace path must stay within the project root.");
      }),
    );
  });

  describe("browse", () => {
    it.effect("returns matching directories and excludes files", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir({ prefix: "fenrir-workspace-browse-prefix-" });
        yield* writeTextFile(cwd, "alphabet.txt", "ignore me");
        yield* writeTextFile(cwd, "alpha/index.ts", "export {};\n");
        yield* writeTextFile(cwd, "alpine/index.ts", "export {};\n");

        const result = yield* browseWorkspaceEntries({
          partialPath: path.join(cwd, "alp"),
        });

        expect(result).toEqual({
          parentPath: cwd,
          entries: [
            { name: "alpha", fullPath: path.join(cwd, "alpha") },
            { name: "alpine", fullPath: path.join(cwd, "alpine") },
          ],
        });
      }),
    );

    it.effect("includes hidden directories when the prefix matches", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir({ prefix: "fenrir-workspace-browse-hidden-" });
        yield* writeTextFile(cwd, ".config/settings.json", "{}");
        yield* writeTextFile(cwd, "config/settings.json", "{}");

        const directoryResult = yield* browseWorkspaceEntries({
          partialPath: appendSeparator(cwd),
        });
        const hiddenPrefixResult = yield* browseWorkspaceEntries({
          partialPath: `${appendSeparator(cwd)}.c`,
        });

        expect(directoryResult.entries.map((entry) => entry.name)).toEqual([".config", "config"]);
        expect(hiddenPrefixResult).toEqual({
          parentPath: cwd,
          entries: [{ name: ".config", fullPath: path.join(cwd, ".config") }],
        });
      }),
    );

    it.effect("resolves explicit relative paths against the current project", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir({ prefix: "fenrir-workspace-browse-relative-" });
        yield* writeTextFile(cwd, "packages/pkg.json", "{}");

        const result = yield* browseWorkspaceEntries({
          cwd,
          partialPath: "./pack",
        });

        expect(result).toEqual({
          parentPath: cwd,
          entries: [{ name: "packages", fullPath: path.join(cwd, "packages") }],
        });
      }),
    );

    it.effect("expands home-relative paths before listing directories", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;

        const result = yield* browseWorkspaceEntries({
          partialPath: "~/",
        });

        expect(result.parentPath).toBe(path.resolve(homedir()));
      }),
    );

    it.effect("rejects relative paths without a current project", () =>
      Effect.gen(function* () {
        const error = yield* browseWorkspaceEntries({
          partialPath: "./src",
        }).pipe(Effect.flip);

        expect(error.detail).toBe("Relative filesystem browse paths require a current project.");
      }),
    );
  });
});
