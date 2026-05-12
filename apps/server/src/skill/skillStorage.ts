import { Effect, FileSystem, Option, Path, Schema } from "effect";

import type { CreateSkillInput, ServerSkillFileEntry, SkillFileScope } from "@fenrir/contracts";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import type { ProjectSkillStatePaths } from "./projectSkillStatePaths.ts";
import { isSafeSkillRelativePath } from "./providerSkillPathClassifier.ts";
import { parseSkillFile, writeSkillFile } from "./skillFileFormat.ts";
import {
  deleteSkillIndex,
  listIndexedSkillNames,
  readSkillIndex,
  writeSkillIndex,
} from "./skillIndex.ts";

export class SkillStorageError extends Schema.TaggedErrorClass<SkillStorageError>()(
  "SkillStorageError",
  {
    path: Schema.String,
    reason: Schema.String,
  },
) {
  override get message(): string {
    return `Skill storage error at ${this.path}: ${this.reason}`;
  }
}

const isExecutable = (mode: number): boolean => (mode & 0o111) !== 0;

export const getGeneralSkillDir = (paths: ProjectSkillStatePaths, skillName: string): string =>
  `${paths.generalSkillsDir}/${skillName}`;

export const getProviderSkillDir = (
  paths: ProjectSkillStatePaths,
  provider: "codex" | "claudeAgent",
  skillName: string,
): string => `${paths.providerSkillsDir}/${provider}/${skillName}`;

const getAbsolutePathForIndexedFile = (
  paths: ProjectSkillStatePaths,
  skillName: string,
  file: { readonly relativePath: string; readonly scope: SkillFileScope },
  path: Path.Path,
): string =>
  file.scope.kind === "general"
    ? path.join(paths.generalSkillsDir, skillName, file.relativePath)
    : path.join(paths.providerSkillsDir, file.scope.provider, skillName, file.relativePath);

const scanScopeTree = (
  rootPath: string,
  scope: SkillFileScope,
): Effect.Effect<
  readonly { readonly relativePath: string; readonly scope: SkillFileScope }[],
  SkillStorageError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const exists = yield* fs.exists(rootPath).pipe(Effect.catch(() => Effect.succeed(false)));
    if (!exists) {
      return [] as const;
    }

    const entries: Array<{ readonly relativePath: string; readonly scope: SkillFileScope }> = [];

    const walk = (currentPath: string): Effect.Effect<void, SkillStorageError> =>
      Effect.gen(function* () {
        const names = yield* fs
          .readDirectory(currentPath)
          .pipe(
            Effect.mapError(
              (cause) => new SkillStorageError({ path: currentPath, reason: cause.message }),
            ),
          );
        for (const name of names) {
          if (name.startsWith(".")) {
            continue;
          }
          const absolutePath = path.join(currentPath, name);
          const symlinkOption = yield* fs.readLink(absolutePath).pipe(Effect.option);
          if (Option.isSome(symlinkOption)) {
            yield* Effect.logWarning(`Ignoring symlink in skill storage scan: ${absolutePath}`);
            continue;
          }
          const stat = yield* fs
            .stat(absolutePath)
            .pipe(
              Effect.mapError(
                (cause) => new SkillStorageError({ path: absolutePath, reason: cause.message }),
              ),
            );
          if (stat.type === "Directory") {
            yield* walk(absolutePath);
            continue;
          }
          if (stat.type !== "File") {
            continue;
          }
          entries.push({ relativePath: path.relative(rootPath, absolutePath), scope });
        }
      });

    yield* walk(rootPath);
    return entries.toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
  });

export const listStoredSkillNames = (
  paths: ProjectSkillStatePaths,
): Effect.Effect<readonly string[], SkillStorageError, FileSystem.FileSystem | Path.Path> =>
  listIndexedSkillNames(paths.skillIndexDir).pipe(
    Effect.mapError((cause) => new SkillStorageError({ path: cause.path, reason: cause.reason })),
  );

export const readGeneralSkillFileFromStorage = (paths: ProjectSkillStatePaths, skillName: string) =>
  parseSkillFile(`${getGeneralSkillDir(paths, skillName)}/skill.md`).pipe(
    Effect.mapError(
      (cause) => new SkillStorageError({ path: cause.filePath, reason: cause.reason }),
    ),
  );

export const readSkillDetailsFromStorage = (
  paths: ProjectSkillStatePaths,
  skillName: string,
): Effect.Effect<
  readonly ServerSkillFileEntry[],
  SkillStorageError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const indexOption = yield* readSkillIndex(paths.skillIndexDir, skillName).pipe(
      Effect.mapError((cause) => new SkillStorageError({ path: cause.path, reason: cause.reason })),
    );
    if (Option.isNone(indexOption)) {
      return [] as const;
    }

    const files: ServerSkillFileEntry[] = [];
    for (const file of indexOption.value.files) {
      const absolutePath = getAbsolutePathForIndexedFile(paths, skillName, file, path);
      const exists = yield* fs.exists(absolutePath).pipe(Effect.catch(() => Effect.succeed(false)));
      if (!exists) {
        continue;
      }
      const stat = yield* fs
        .stat(absolutePath)
        .pipe(
          Effect.mapError(
            (cause) => new SkillStorageError({ path: absolutePath, reason: cause.message }),
          ),
        );
      if (stat.type !== "File") {
        continue;
      }
      files.push({
        relativePath: file.relativePath,
        absolutePath,
        executable: isExecutable(stat.mode),
        scope: file.scope,
      });
    }

    return files.toSorted(
      (left, right) =>
        left.relativePath.localeCompare(right.relativePath) ||
        left.absolutePath.localeCompare(right.absolutePath),
    );
  });

export const writeGeneralSkillToStorage = (
  paths: ProjectSkillStatePaths,
  skill: CreateSkillInput,
): Effect.Effect<void, SkillStorageError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    yield* writeSkillFile(paths.generalSkillsDir, skill).pipe(
      Effect.mapError(
        (cause) => new SkillStorageError({ path: cause.filePath, reason: cause.reason }),
      ),
    );
    const generalEntries = yield* scanScopeTree(getGeneralSkillDir(paths, skill.name), {
      kind: "general",
    });
    const existingIndex = yield* readSkillIndex(paths.skillIndexDir, skill.name).pipe(
      Effect.mapError((cause) => new SkillStorageError({ path: cause.path, reason: cause.reason })),
    );
    const providerEntries = Option.isSome(existingIndex)
      ? existingIndex.value.files.filter((file) => file.scope.kind === "providerSpecific")
      : [];
    yield* writeSkillIndex(paths.skillIndexDir, skill.name, [
      ...generalEntries,
      ...providerEntries,
    ]).pipe(
      Effect.mapError((cause) => new SkillStorageError({ path: cause.path, reason: cause.reason })),
    );
  });

export const rebuildSkillIndexFromStorage = (
  paths: ProjectSkillStatePaths,
  skillName: string,
): Effect.Effect<void, SkillStorageError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const generalEntries = yield* scanScopeTree(getGeneralSkillDir(paths, skillName), {
      kind: "general",
    });
    const providerEntries = yield* Effect.all(
      [
        scanScopeTree(getProviderSkillDir(paths, "codex", skillName), {
          kind: "providerSpecific",
          provider: "codex",
        }),
        scanScopeTree(getProviderSkillDir(paths, "claudeAgent", skillName), {
          kind: "providerSpecific",
          provider: "claudeAgent",
        }),
      ],
      { concurrency: "unbounded" },
    );
    yield* writeSkillIndex(paths.skillIndexDir, skillName, [
      ...generalEntries,
      ...providerEntries.flat(),
    ]).pipe(
      Effect.mapError((cause) => new SkillStorageError({ path: cause.path, reason: cause.reason })),
    );
  });

export const writeProviderOverlayFileToStorage = (input: {
  readonly paths: ProjectSkillStatePaths;
  readonly skillName: string;
  readonly provider: "codex" | "claudeAgent";
  readonly relativePath: string;
  readonly contents: string;
  readonly executable?: boolean;
}): Effect.Effect<void, SkillStorageError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const filePath = path.join(
      getProviderSkillDir(input.paths, input.provider, input.skillName),
      input.relativePath,
    );
    if (!isSafeSkillRelativePath(input.relativePath)) {
      return yield* new SkillStorageError({
        path: filePath,
        reason: `unsafe skill relative path: ${input.relativePath}`,
      });
    }
    yield* writeFileStringAtomically({ filePath, contents: input.contents }).pipe(
      Effect.mapError((cause) => new SkillStorageError({ path: filePath, reason: String(cause) })),
    );
    if (input.executable === true) {
      yield* fs
        .chmod(filePath, 0o755)
        .pipe(
          Effect.mapError(
            (cause) => new SkillStorageError({ path: filePath, reason: cause.message }),
          ),
        );
    }

    const existingIndex = yield* readSkillIndex(input.paths.skillIndexDir, input.skillName).pipe(
      Effect.mapError((cause) => new SkillStorageError({ path: cause.path, reason: cause.reason })),
    );
    const retainedEntries = Option.isSome(existingIndex)
      ? existingIndex.value.files.filter(
          (file) =>
            !(
              file.scope.kind === "providerSpecific" &&
              file.scope.provider === input.provider &&
              file.relativePath === input.relativePath
            ),
        )
      : [];
    yield* writeSkillIndex(input.paths.skillIndexDir, input.skillName, [
      ...retainedEntries,
      {
        relativePath: input.relativePath,
        scope: { kind: "providerSpecific", provider: input.provider },
      },
    ]).pipe(
      Effect.mapError((cause) => new SkillStorageError({ path: cause.path, reason: cause.reason })),
    );
  });

export const deleteSkillFromStorage = (
  paths: ProjectSkillStatePaths,
  skillName: string,
): Effect.Effect<void, SkillStorageError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs
      .remove(getGeneralSkillDir(paths, skillName), { recursive: true })
      .pipe(Effect.catch(() => Effect.void));
    yield* fs
      .remove(getProviderSkillDir(paths, "codex", skillName), { recursive: true })
      .pipe(Effect.catch(() => Effect.void));
    yield* fs
      .remove(getProviderSkillDir(paths, "claudeAgent", skillName), { recursive: true })
      .pipe(Effect.catch(() => Effect.void));
    yield* deleteSkillIndex(paths.skillIndexDir, skillName).pipe(
      Effect.mapError((cause) => new SkillStorageError({ path: cause.path, reason: cause.reason })),
    );
  });

const hasAnyFilesRecursively = (
  rootPath: string,
): Effect.Effect<boolean, SkillStorageError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const entries = yield* fs.readDirectory(rootPath).pipe(
      Effect.catch(() => Effect.succeed([] as string[])),
      Effect.mapError((cause) => new SkillStorageError({ path: rootPath, reason: String(cause) })),
    );

    for (const entry of entries) {
      const absolutePath = path.join(rootPath, entry);
      const statOption = yield* fs.stat(absolutePath).pipe(Effect.option);
      if (Option.isNone(statOption)) {
        continue;
      }
      if (statOption.value.type === "File") {
        return true;
      }
      if (statOption.value.type === "Directory" && (yield* hasAnyFilesRecursively(absolutePath))) {
        return true;
      }
    }

    return false;
  });

export const hasInternalProjectSkillState = (
  paths: ProjectSkillStatePaths,
): Effect.Effect<boolean, SkillStorageError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const metadataExists = yield* fs
      .exists(paths.projectMetadataPath)
      .pipe(Effect.catch(() => Effect.succeed(false)));
    if (metadataExists) {
      return true;
    }

    for (const rootPath of [paths.generalSkillsDir, paths.providerSkillsDir, paths.skillIndexDir]) {
      const exists = yield* fs.exists(rootPath).pipe(Effect.catch(() => Effect.succeed(false)));
      if (!exists) {
        continue;
      }
      if (yield* hasAnyFilesRecursively(rootPath)) {
        return true;
      }
    }

    return false;
  });

const copyDirectoryContents = (
  sourceDir: string,
  targetDir: string,
): Effect.Effect<void, SkillStorageError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs
      .makeDirectory(targetDir, { recursive: true })
      .pipe(
        Effect.mapError(
          (cause) => new SkillStorageError({ path: targetDir, reason: cause.message }),
        ),
      );
    const names = yield* fs
      .readDirectory(sourceDir)
      .pipe(
        Effect.mapError(
          (cause) => new SkillStorageError({ path: sourceDir, reason: cause.message }),
        ),
      );

    for (const name of names) {
      const sourcePath = path.join(sourceDir, name);
      const targetPath = path.join(targetDir, name);
      const symlinkOption = yield* fs.readLink(sourcePath).pipe(Effect.option);
      if (Option.isSome(symlinkOption)) {
        yield* Effect.logWarning(`Ignoring symlink in legacy skill migration: ${sourcePath}`);
        continue;
      }
      const stat = yield* fs
        .stat(sourcePath)
        .pipe(
          Effect.mapError(
            (cause) => new SkillStorageError({ path: sourcePath, reason: cause.message }),
          ),
        );
      if (stat.type === "Directory") {
        yield* copyDirectoryContents(sourcePath, targetPath);
        continue;
      }
      if (stat.type !== "File") {
        continue;
      }
      const bytes = yield* fs
        .readFile(sourcePath)
        .pipe(
          Effect.mapError(
            (cause) => new SkillStorageError({ path: sourcePath, reason: cause.message }),
          ),
        );
      yield* fs
        .makeDirectory(path.dirname(targetPath), { recursive: true })
        .pipe(
          Effect.mapError(
            (cause) => new SkillStorageError({ path: targetPath, reason: cause.message }),
          ),
        );
      yield* fs
        .writeFile(targetPath, bytes)
        .pipe(
          Effect.mapError(
            (cause) => new SkillStorageError({ path: targetPath, reason: cause.message }),
          ),
        );
      if (isExecutable(stat.mode)) {
        yield* fs
          .chmod(targetPath, stat.mode)
          .pipe(
            Effect.mapError(
              (cause) => new SkillStorageError({ path: targetPath, reason: cause.message }),
            ),
          );
      }
    }
  });

export const importLegacyWorkspaceSkills = (
  paths: ProjectSkillStatePaths,
): Effect.Effect<readonly string[], SkillStorageError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const legacyRoot = path.join(paths.workspaceRoot, ".fenrir", "skills");
    const exists = yield* fs.exists(legacyRoot).pipe(Effect.catch(() => Effect.succeed(false)));
    if (!exists) {
      return [] as const;
    }

    const entries = yield* fs.readDirectory(legacyRoot).pipe(
      Effect.catch(() => Effect.succeed([] as string[])),
      Effect.mapError(
        (cause) => new SkillStorageError({ path: legacyRoot, reason: String(cause) }),
      ),
    );

    const imported: string[] = [];
    for (const entry of entries.toSorted()) {
      const sourceDir = path.join(legacyRoot, entry);
      const statOption = yield* fs.stat(sourceDir).pipe(Effect.option);
      if (Option.isNone(statOption) || statOption.value.type !== "Directory") {
        continue;
      }
      const skillFilePath = path.join(sourceDir, "skill.md");
      const hasSkillFile = yield* fs
        .exists(skillFilePath)
        .pipe(Effect.catch(() => Effect.succeed(false)));
      if (!hasSkillFile) {
        continue;
      }
      const targetDir = getGeneralSkillDir(paths, entry);
      yield* copyDirectoryContents(sourceDir, targetDir);
      const generalEntries = yield* scanScopeTree(targetDir, { kind: "general" });
      yield* writeSkillIndex(paths.skillIndexDir, entry, generalEntries).pipe(
        Effect.mapError(
          (cause) => new SkillStorageError({ path: cause.path, reason: cause.reason }),
        ),
      );
      imported.push(entry);
    }

    return imported;
  });
