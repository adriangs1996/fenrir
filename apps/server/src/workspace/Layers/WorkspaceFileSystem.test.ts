import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, describe, expect } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";

import { ServerConfig } from "../../config.ts";
import { GitCoreLive } from "../../git/Layers/GitCore.ts";
import { WorkspaceEntries } from "../Services/WorkspaceEntries.ts";
import { WorkspaceFileSystem, WorkspaceFileSystemError } from "../Services/WorkspaceFileSystem.ts";
import { WorkspaceEntriesLive } from "./WorkspaceEntries.ts";
import { WorkspaceFileSystemLive } from "./WorkspaceFileSystem.ts";
import { WorkspacePathsLive } from "./WorkspacePaths.ts";

const ProjectLayer = WorkspaceFileSystemLive.pipe(
  Layer.provide(WorkspacePathsLive),
  Layer.provide(WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive))),
);

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(ProjectLayer),
  Layer.provideMerge(WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive))),
  Layer.provideMerge(WorkspacePathsLive),
  Layer.provideMerge(GitCoreLive),
  Layer.provide(
    ServerConfig.layerTest(process.cwd(), {
      prefix: "fenrir-workspace-files-test-",
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({
    prefix: "fenrir-workspace-files-",
  });
});

const writeTextFile = Effect.fn("writeTextFile")(function* (
  cwd: string,
  relativePath: string,
  contents = "",
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolutePath = path.join(cwd, relativePath);
  yield* fileSystem
    .makeDirectory(path.dirname(absolutePath), { recursive: true })
    .pipe(Effect.orDie);
  yield* fileSystem.writeFileString(absolutePath, contents).pipe(Effect.orDie);
});

function expectWorkspaceFileSystemError(error: unknown): asserts error is WorkspaceFileSystemError {
  expect(error).toBeInstanceOf(WorkspaceFileSystemError);
}

it.layer(TestLayer)("WorkspaceFileSystemLive", (it) => {
  describe("writeFile", () => {
    it.effect("writes files relative to the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const result = yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "plans/effect-rpc.md",
          contents: "# Plan\n",
        });
        const saved = yield* fileSystem
          .readFileString(path.join(cwd, "plans/effect-rpc.md"))
          .pipe(Effect.orDie);

        expect(result).toEqual({ relativePath: "plans/effect-rpc.md" });
        expect(saved).toBe("# Plan\n");
      }),
    );

    it.effect("invalidates workspace entry search cache after writes", () =>
      Effect.gen(function* () {
        const workspaceEntries = yield* WorkspaceEntries;
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/existing.ts", "export {};\n");

        const beforeWrite = yield* workspaceEntries.search({
          cwd,
          query: "rpc",
          limit: 10,
        });
        expect(beforeWrite).toEqual({
          entries: [],
          truncated: false,
        });

        yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "plans/effect-rpc.md",
          contents: "# Plan\n",
        });

        const afterWrite = yield* workspaceEntries.search({
          cwd,
          query: "rpc",
          limit: 10,
        });
        expect(afterWrite.entries).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: "plans/effect-rpc.md" })]),
        );
        expect(afterWrite.truncated).toBe(false);
      }),
    );

    it.effect("rejects writes outside the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const path = yield* Path.Path;
        const fileSystem = yield* FileSystem.FileSystem;

        const error = yield* workspaceFileSystem
          .writeFile({
            cwd,
            relativePath: "../escape.md",
            contents: "# nope\n",
          })
          .pipe(Effect.flip);

        expect(error.message).toContain(
          "Workspace file path must be relative to the project root: ../escape.md",
        );

        const escapedPath = path.resolve(cwd, "..", "escape.md");
        const escapedStat = yield* fileSystem
          .stat(escapedPath)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        expect(escapedStat).toBeNull();
      }),
    );
  });

  describe("createFile", () => {
    it.effect("creates files without overwriting existing files", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const result = yield* workspaceFileSystem.createFile({
          cwd,
          relativePath: "src/new-file.ts",
          contents: "export const value = 1;\n",
        });
        const saved = yield* fileSystem
          .readFileString(path.join(cwd, "src", "new-file.ts"))
          .pipe(Effect.orDie);

        expect(result).toEqual({ relativePath: "src/new-file.ts" });
        expect(saved).toBe("export const value = 1;\n");

        const error = yield* workspaceFileSystem
          .createFile({
            cwd,
            relativePath: "src/new-file.ts",
          })
          .pipe(Effect.flip);
        const afterFailedCreate = yield* fileSystem
          .readFileString(path.join(cwd, "src", "new-file.ts"))
          .pipe(Effect.orDie);

        expectWorkspaceFileSystemError(error);
        expect(error.detail.toLowerCase()).toContain("exist");
        expect(afterFailedCreate).toBe("export const value = 1;\n");
      }),
    );
  });

  describe("createDirectory", () => {
    it.effect("creates directories relative to the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const result = yield* workspaceFileSystem.createDirectory({
          cwd,
          relativePath: "src/components",
        });
        const stat = yield* fileSystem.stat(path.join(cwd, "src", "components")).pipe(Effect.orDie);

        expect(result).toEqual({ relativePath: "src/components" });
        expect(stat.type).toBe("Directory");
      }),
    );
  });

  describe("removeEntry", () => {
    it.effect("removes files and directories relative to the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* writeTextFile(cwd, "src/remove-me.ts", "export {};\n");
        yield* writeTextFile(cwd, "nested/remove-me/file.txt", "remove\n");

        const fileResult = yield* workspaceFileSystem.removeEntry({
          cwd,
          relativePath: "src/remove-me.ts",
        });
        const directoryResult = yield* workspaceFileSystem.removeEntry({
          cwd,
          relativePath: "nested/remove-me",
        });
        const removedFileExists = yield* fileSystem.exists(path.join(cwd, "src", "remove-me.ts"));
        const removedDirectoryExists = yield* fileSystem.exists(
          path.join(cwd, "nested", "remove-me"),
        );

        expect(fileResult).toEqual({ relativePath: "src/remove-me.ts" });
        expect(directoryResult).toEqual({ relativePath: "nested/remove-me" });
        expect(removedFileExists).toBe(false);
        expect(removedDirectoryExists).toBe(false);
      }),
    );
  });

  describe("moveEntry", () => {
    it.effect("moves files and directories without overwriting destinations", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* writeTextFile(cwd, "src/old-name.ts", "export const value = 1;\n");
        yield* writeTextFile(cwd, "docs/readme.md", "# Docs\n");

        const result = yield* workspaceFileSystem.moveEntry({
          cwd,
          sourceRelativePath: "src/old-name.ts",
          destinationRelativePath: "src/new-name.ts",
        });
        const movedContents = yield* fileSystem
          .readFileString(path.join(cwd, "src", "new-name.ts"))
          .pipe(Effect.orDie);
        const oldPathExists = yield* fileSystem.exists(path.join(cwd, "src", "old-name.ts"));

        const overwriteError = yield* workspaceFileSystem
          .moveEntry({
            cwd,
            sourceRelativePath: "src/new-name.ts",
            destinationRelativePath: "docs/readme.md",
          })
          .pipe(Effect.flip);

        expectWorkspaceFileSystemError(overwriteError);
        expect(result).toEqual({ relativePath: "src/new-name.ts" });
        expect(movedContents).toBe("export const value = 1;\n");
        expect(oldPathExists).toBe(false);
        expect(overwriteError.detail).toBe("Destination already exists.");
      }),
    );
  });

  describe("copyEntry", () => {
    it.effect("copies files and directories without overwriting destinations", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* writeTextFile(cwd, "src/source.ts", "export const value = 1;\n");
        yield* writeTextFile(cwd, "src/components/button.ts", "export {};\n");

        const fileResult = yield* workspaceFileSystem.copyEntry({
          cwd,
          sourceRelativePath: "src/source.ts",
          destinationRelativePath: "src/source-copy.ts",
        });
        const directoryResult = yield* workspaceFileSystem.copyEntry({
          cwd,
          sourceRelativePath: "src/components",
          destinationRelativePath: "copied-components",
        });
        const copiedFileContents = yield* fileSystem
          .readFileString(path.join(cwd, "src", "source-copy.ts"))
          .pipe(Effect.orDie);
        const copiedDirectoryFileContents = yield* fileSystem
          .readFileString(path.join(cwd, "copied-components", "button.ts"))
          .pipe(Effect.orDie);
        const sourceStillExists = yield* fileSystem.exists(path.join(cwd, "src", "source.ts"));

        const overwriteError = yield* workspaceFileSystem
          .copyEntry({
            cwd,
            sourceRelativePath: "src/source.ts",
            destinationRelativePath: "src/source-copy.ts",
          })
          .pipe(Effect.flip);

        expectWorkspaceFileSystemError(overwriteError);
        expect(fileResult).toEqual({ relativePath: "src/source-copy.ts" });
        expect(directoryResult).toEqual({ relativePath: "copied-components" });
        expect(copiedFileContents).toBe("export const value = 1;\n");
        expect(copiedDirectoryFileContents).toBe("export {};\n");
        expect(sourceStillExists).toBe(true);
        expect(overwriteError.detail).toBe("Destination already exists.");
      }),
    );
  });
});
