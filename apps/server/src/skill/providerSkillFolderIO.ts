import { dirname } from "node:path";

import { Effect, FileSystem, Option, Path } from "effect";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import type { ProviderSkillFile, ProviderSkillProjectionFile } from "./ProviderSkillAdapter.ts";
import {
  isHiddenName,
  isSafeSkillRelativePath,
  normalizeRelativePath,
} from "./providerSkillPathClassifier.ts";

const isExecutable = (mode: number): boolean => (mode & 0o111) !== 0;

const withSymlinkWarning = (path: string) =>
  Effect.logWarning(`Ignoring symlink in skill folder sync: ${path}`);

export const readSkillFolderFiles = (
  skillDir: string,
  classifyRelativePath: (relativePath: string) => ProviderSkillFile["scope"],
): Effect.Effect<readonly ProviderSkillFile[], never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;

    const exists = yield* fs.exists(skillDir).pipe(Effect.catch(() => Effect.succeed(false)));
    if (!exists) {
      return [] as const;
    }

    const results: ProviderSkillFile[] = [];

    const walk = (
      currentDir: string,
    ): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
      Effect.gen(function* () {
        const entries = yield* fs
          .readDirectory(currentDir)
          .pipe(Effect.catch(() => Effect.succeed([] as string[])));

        for (const entry of entries.toSorted()) {
          if (isHiddenName(entry)) continue;

          const absolutePath = pathService.join(currentDir, entry);
          const symlinkOption = yield* fs.readLink(absolutePath).pipe(Effect.option);
          if (Option.isSome(symlinkOption)) {
            yield* withSymlinkWarning(absolutePath);
            continue;
          }

          const statOption = yield* fs.stat(absolutePath).pipe(Effect.option);
          if (Option.isNone(statOption)) continue;

          const stat = statOption.value;

          if (stat.type === "Directory") {
            yield* walk(absolutePath);
            continue;
          }

          if (stat.type !== "File") continue;

          const relativePath = normalizeRelativePath(pathService.relative(skillDir, absolutePath));
          if (!isSafeSkillRelativePath(relativePath)) {
            yield* Effect.logWarning(
              `Ignoring unsafe relative path in skill folder sync: ${absolutePath} -> ${relativePath}`,
            );
            continue;
          }
          const bytes = yield* fs
            .readFile(absolutePath)
            .pipe(Effect.catch(() => Effect.succeed(null)));
          if (bytes === null) continue;

          results.push({
            relativePath,
            absolutePath,
            bytes,
            executable: isExecutable(stat.mode),
            scope: classifyRelativePath(relativePath),
          });
        }
      });

    yield* walk(skillDir);

    return results.toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
  });

const applyExecutableBit = (
  targetPath: string,
  executable: boolean,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const statOption = yield* fs.stat(targetPath).pipe(Effect.option);
    if (Option.isNone(statOption)) return;

    const currentMode = statOption.value.mode;
    const nextMode = executable ? currentMode | 0o111 : currentMode & ~0o111;
    yield* fs.chmod(targetPath, nextMode).pipe(Effect.catch(() => Effect.void));
  });

export const writeSkillFolderProjection = (input: {
  readonly skillDir: string;
  readonly files: readonly ProviderSkillProjectionFile[];
}): Effect.Effect<void, string, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;

    yield* fs
      .remove(input.skillDir, { recursive: true, force: true })
      .pipe(Effect.mapError((cause) => cause.message));
    yield* fs
      .makeDirectory(input.skillDir, { recursive: true })
      .pipe(Effect.mapError((cause) => cause.message));

    for (const file of input.files.toSorted((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    )) {
      if (!isSafeSkillRelativePath(file.relativePath)) {
        return yield* Effect.fail(`unsafe skill relative path: ${file.relativePath}`);
      }

      const targetPath = pathService.join(input.skillDir, file.relativePath);
      yield* fs
        .makeDirectory(dirname(targetPath), { recursive: true })
        .pipe(Effect.mapError((cause) => cause.message));
      yield* typeof file.bytes === "string"
        ? writeFileStringAtomically({
            filePath: targetPath,
            contents: file.bytes,
          }).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, pathService),
            Effect.mapError((cause) => String(cause)),
          )
        : fs.writeFile(targetPath, file.bytes).pipe(Effect.mapError((cause) => cause.message));
      yield* applyExecutableBit(targetPath, file.executable);
    }
  });

export const deleteSkillFolder = (
  skillDir: string,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs
      .remove(skillDir, { recursive: true, force: true })
      .pipe(Effect.catch(() => Effect.void));
  });
