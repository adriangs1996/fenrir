import { Effect, FileSystem, Option, Path, Schema } from "effect";

import type { SkillFileScope } from "@fenrir/contracts";

import { writeFileStringAtomically } from "../atomicWrite.ts";

export const StoredSkillIndexFile = Schema.Struct({
  version: Schema.Literal(1),
  skillName: Schema.String,
  files: Schema.Array(
    Schema.Struct({
      relativePath: Schema.String,
      scope: Schema.Union([
        Schema.Struct({ kind: Schema.Literal("general") }),
        Schema.Struct({
          kind: Schema.Literal("providerSpecific"),
          provider: Schema.Literals(["codex", "claudeAgent"]),
        }),
      ]),
    }),
  ),
});
export type StoredSkillIndexFile = typeof StoredSkillIndexFile.Type;

export class SkillIndexError extends Schema.TaggedErrorClass<SkillIndexError>()("SkillIndexError", {
  path: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `Skill index error at ${this.path}: ${this.reason}`;
  }
}

const compareEntries = (
  left: { readonly relativePath: string; readonly scope: SkillFileScope },
  right: { readonly relativePath: string; readonly scope: SkillFileScope },
): number => {
  const leftScope = left.scope.kind === "general" ? "general" : `provider:${left.scope.provider}`;
  const rightScope =
    right.scope.kind === "general" ? "general" : `provider:${right.scope.provider}`;
  return leftScope.localeCompare(rightScope) || left.relativePath.localeCompare(right.relativePath);
};

const getSkillIndexPath = (skillIndexDir: string, skillName: string, path: Path.Path): string =>
  path.join(skillIndexDir, `${skillName}.json`);

export const readSkillIndex = (
  skillIndexDir: string,
  skillName: string,
): Effect.Effect<
  Option.Option<StoredSkillIndexFile>,
  SkillIndexError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const indexPath = getSkillIndexPath(skillIndexDir, skillName, path);
    const exists = yield* fs
      .exists(indexPath)
      .pipe(
        Effect.mapError((cause) => new SkillIndexError({ path: indexPath, reason: cause.message })),
      );
    if (!exists) {
      return Option.none();
    }

    const raw = yield* fs
      .readFileString(indexPath)
      .pipe(
        Effect.mapError((cause) => new SkillIndexError({ path: indexPath, reason: cause.message })),
      );
    const decoded = yield* Schema.decodeUnknownEffect(StoredSkillIndexFile)(JSON.parse(raw)).pipe(
      Effect.mapError((cause) => new SkillIndexError({ path: indexPath, reason: cause.message })),
    );
    return Option.some(decoded);
  });

export const writeSkillIndex = (
  skillIndexDir: string,
  skillName: string,
  files: readonly {
    readonly relativePath: string;
    readonly scope: SkillFileScope;
  }[],
): Effect.Effect<void, SkillIndexError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    const indexPath = getSkillIndexPath(skillIndexDir, skillName, path);
    const contents = `${JSON.stringify(
      {
        version: 1,
        skillName,
        files: [...files].toSorted(compareEntries),
      } satisfies StoredSkillIndexFile,
      null,
      2,
    )}\n`;

    yield* writeFileStringAtomically({ filePath: indexPath, contents }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError((cause) => new SkillIndexError({ path: indexPath, reason: String(cause) })),
    );
  });

export const deleteSkillIndex = (
  skillIndexDir: string,
  skillName: string,
): Effect.Effect<void, SkillIndexError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const indexPath = getSkillIndexPath(skillIndexDir, skillName, path);
    yield* fs.remove(indexPath).pipe(
      Effect.catch(() => Effect.void),
      Effect.mapError((cause) => new SkillIndexError({ path: indexPath, reason: String(cause) })),
    );
  });

export const listIndexedSkillNames = (
  skillIndexDir: string,
): Effect.Effect<readonly string[], SkillIndexError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const entries = yield* fs.readDirectory(skillIndexDir).pipe(
      Effect.catch(() => Effect.succeed([] as string[])),
      Effect.mapError(
        (cause) => new SkillIndexError({ path: skillIndexDir, reason: String(cause) }),
      ),
    );

    return entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => entry.slice(0, -".json".length))
      .toSorted();
  });
