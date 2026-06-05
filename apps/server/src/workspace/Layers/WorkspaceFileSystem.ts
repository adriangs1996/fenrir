import { Effect, FileSystem, Layer, Path } from "effect";

import {
  WorkspaceFileSystem,
  WorkspaceFileSystemError,
  type WorkspaceFileSystemShape,
} from "../Services/WorkspaceFileSystem.ts";
import { WorkspaceEntries } from "../Services/WorkspaceEntries.ts";
import { WorkspacePaths } from "../Services/WorkspacePaths.ts";

const RESERVED_WORKSPACE_MUTATION_DIRECTORIES = new Set([".git"]);

function isReservedWorkspaceMutationPath(relativePath: string): boolean {
  const firstSegment = relativePath.replaceAll("\\", "/").split("/")[0];
  if (!firstSegment) return false;
  return RESERVED_WORKSPACE_MUTATION_DIRECTORIES.has(firstSegment);
}

function isSameOrNestedRelativePath(sourceRelativePath: string, destinationRelativePath: string) {
  const sourcePath = sourceRelativePath.replaceAll("\\", "/").replace(/\/+$/g, "");
  const destinationPath = destinationRelativePath.replaceAll("\\", "/").replace(/\/+$/g, "");
  return destinationPath === sourcePath || destinationPath.startsWith(`${sourcePath}/`);
}

export const makeWorkspaceFileSystem = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths;
  const workspaceEntries = yield* WorkspaceEntries;

  const resolveMutationTarget = Effect.fn("WorkspaceFileSystem.resolveMutationTarget")(function* (
    input: { cwd: string; relativePath: string },
    operation: string,
  ) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });
    if (isReservedWorkspaceMutationPath(target.relativePath)) {
      return yield* new WorkspaceFileSystemError({
        cwd: input.cwd,
        relativePath: input.relativePath,
        operation,
        detail: "Reserved workspace metadata paths cannot be modified.",
      });
    }
    return target;
  });

  const makeParentDirectory = Effect.fn("WorkspaceFileSystem.makeParentDirectory")(
    function* (input: { cwd: string; relativePath: string; absolutePath: string }) {
      yield* fileSystem.makeDirectory(path.dirname(input.absolutePath), { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFileSystemError({
              cwd: input.cwd,
              relativePath: input.relativePath,
              operation: "workspaceFileSystem.makeDirectory",
              detail: cause.message,
              cause,
            }),
        ),
      );
    },
  );

  const failIfDestinationExists = Effect.fn("WorkspaceFileSystem.failIfDestinationExists")(
    function* (input: {
      cwd: string;
      relativePath: string;
      absolutePath: string;
      operation: string;
    }) {
      const exists = yield* fileSystem.exists(input.absolutePath).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFileSystemError({
              cwd: input.cwd,
              relativePath: input.relativePath,
              operation: input.operation,
              detail: cause.message,
              cause,
            }),
        ),
      );
      if (exists) {
        return yield* new WorkspaceFileSystemError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: input.operation,
          detail: "Destination already exists.",
        });
      }
    },
  );

  const writeFile: WorkspaceFileSystemShape["writeFile"] = Effect.fn(
    "WorkspaceFileSystem.writeFile",
  )(function* (input) {
    const target = yield* resolveMutationTarget(input, "workspaceFileSystem.writeFile");

    yield* makeParentDirectory({
      cwd: input.cwd,
      relativePath: input.relativePath,
      absolutePath: target.absolutePath,
    });

    yield* fileSystem.writeFileString(target.absolutePath, input.contents).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.writeFile",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* workspaceEntries.invalidate(input.cwd);
    return { relativePath: target.relativePath };
  });

  const createFile: WorkspaceFileSystemShape["createFile"] = Effect.fn(
    "WorkspaceFileSystem.createFile",
  )(function* (input) {
    const target = yield* resolveMutationTarget(input, "workspaceFileSystem.createFile");

    yield* makeParentDirectory({
      cwd: input.cwd,
      relativePath: input.relativePath,
      absolutePath: target.absolutePath,
    });

    yield* fileSystem
      .writeFileString(target.absolutePath, input.contents ?? "", { flag: "wx" })
      .pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFileSystemError({
              cwd: input.cwd,
              relativePath: input.relativePath,
              operation: "workspaceFileSystem.createFile",
              detail: cause.message,
              cause,
            }),
        ),
      );
    yield* workspaceEntries.invalidate(input.cwd);
    return { relativePath: target.relativePath };
  });

  const createDirectory: WorkspaceFileSystemShape["createDirectory"] = Effect.fn(
    "WorkspaceFileSystem.createDirectory",
  )(function* (input) {
    const target = yield* resolveMutationTarget(input, "workspaceFileSystem.createDirectory");

    yield* fileSystem.makeDirectory(target.absolutePath, { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.createDirectory",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* workspaceEntries.invalidate(input.cwd);
    return { relativePath: target.relativePath };
  });

  const removeEntry: WorkspaceFileSystemShape["removeEntry"] = Effect.fn(
    "WorkspaceFileSystem.removeEntry",
  )(function* (input) {
    const target = yield* resolveMutationTarget(input, "workspaceFileSystem.removeEntry");

    yield* fileSystem.remove(target.absolutePath, { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.removeEntry",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* workspaceEntries.invalidate(input.cwd);
    return { relativePath: target.relativePath };
  });

  const moveEntry: WorkspaceFileSystemShape["moveEntry"] = Effect.fn(
    "WorkspaceFileSystem.moveEntry",
  )(function* (input) {
    const source = yield* resolveMutationTarget(
      { cwd: input.cwd, relativePath: input.sourceRelativePath },
      "workspaceFileSystem.moveEntry",
    );
    const destination = yield* resolveMutationTarget(
      { cwd: input.cwd, relativePath: input.destinationRelativePath },
      "workspaceFileSystem.moveEntry",
    );
    if (isSameOrNestedRelativePath(source.relativePath, destination.relativePath)) {
      return yield* new WorkspaceFileSystemError({
        cwd: input.cwd,
        relativePath: input.destinationRelativePath,
        operation: "workspaceFileSystem.moveEntry",
        detail: "Destination must be outside the source entry.",
      });
    }

    yield* makeParentDirectory({
      cwd: input.cwd,
      relativePath: input.destinationRelativePath,
      absolutePath: destination.absolutePath,
    });
    yield* failIfDestinationExists({
      cwd: input.cwd,
      relativePath: input.destinationRelativePath,
      absolutePath: destination.absolutePath,
      operation: "workspaceFileSystem.moveEntry",
    });
    yield* fileSystem.rename(source.absolutePath, destination.absolutePath).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.sourceRelativePath,
            operation: "workspaceFileSystem.moveEntry",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* workspaceEntries.invalidate(input.cwd);
    return { relativePath: destination.relativePath };
  });

  const copyEntry: WorkspaceFileSystemShape["copyEntry"] = Effect.fn(
    "WorkspaceFileSystem.copyEntry",
  )(function* (input) {
    const source = yield* resolveMutationTarget(
      { cwd: input.cwd, relativePath: input.sourceRelativePath },
      "workspaceFileSystem.copyEntry",
    );
    const destination = yield* resolveMutationTarget(
      { cwd: input.cwd, relativePath: input.destinationRelativePath },
      "workspaceFileSystem.copyEntry",
    );
    if (isSameOrNestedRelativePath(source.relativePath, destination.relativePath)) {
      return yield* new WorkspaceFileSystemError({
        cwd: input.cwd,
        relativePath: input.destinationRelativePath,
        operation: "workspaceFileSystem.copyEntry",
        detail: "Destination must be outside the source entry.",
      });
    }

    yield* makeParentDirectory({
      cwd: input.cwd,
      relativePath: input.destinationRelativePath,
      absolutePath: destination.absolutePath,
    });
    yield* failIfDestinationExists({
      cwd: input.cwd,
      relativePath: input.destinationRelativePath,
      absolutePath: destination.absolutePath,
      operation: "workspaceFileSystem.copyEntry",
    });
    yield* fileSystem
      .copy(source.absolutePath, destination.absolutePath, { overwrite: false })
      .pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFileSystemError({
              cwd: input.cwd,
              relativePath: input.sourceRelativePath,
              operation: "workspaceFileSystem.copyEntry",
              detail: cause.message,
              cause,
            }),
        ),
      );
    yield* workspaceEntries.invalidate(input.cwd);
    return { relativePath: destination.relativePath };
  });

  return {
    writeFile,
    createFile,
    createDirectory,
    removeEntry,
    moveEntry,
    copyEntry,
  } satisfies WorkspaceFileSystemShape;
});

export const WorkspaceFileSystemLive = Layer.effect(WorkspaceFileSystem, makeWorkspaceFileSystem);
