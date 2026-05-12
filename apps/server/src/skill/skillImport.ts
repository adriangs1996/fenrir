import { Effect, FileSystem, Option, Path } from "effect";

import type { CreateSkillInput, ProviderKind, ServerProviderSkill } from "@fenrir/contracts";

import type { ProviderSkillAdapter, ProviderSkillFolder } from "./ProviderSkillAdapter.ts";
import type { ProjectSkillStatePaths } from "./projectSkillStatePaths.ts";
import { validateSkillFile } from "./skillFileFormat.ts";
import {
  hasInternalProjectSkillState,
  rebuildSkillIndexFromStorage,
  writeGeneralSkillToStorage,
} from "./skillStorage.ts";

export class SkillImportError {
  readonly _tag = "SkillImportError";
  constructor(
    readonly message: string,
    readonly cause?: unknown,
  ) {}
}

export interface ImportedFile {
  readonly relativePath: string;
  readonly bytes: Uint8Array;
  readonly executable: boolean;
}

export interface ImportedSkillState {
  readonly skillName: string;
  readonly generalFiles: readonly ImportedFile[];
  readonly providerFiles: Record<ProviderKind, readonly ImportedFile[]>;
  readonly entry: {
    readonly name: string;
    readonly description: string;
    readonly body: string;
  };
}

interface ProviderSkillContribution {
  readonly adapter: ProviderSkillAdapter;
  readonly folder: ProviderSkillFolder;
}

const PROVIDER_ORDER: readonly ProviderKind[] = ["codex", "claudeAgent"];

const sortAdapters = (adapters: readonly ProviderSkillAdapter[]): readonly ProviderSkillAdapter[] =>
  adapters.toSorted((left, right) => right.priority - left.priority);

const sortImportedFiles = (files: readonly ImportedFile[]): readonly ImportedFile[] =>
  files.toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));

const getGeneralSkillDir = (
  paths: ProjectSkillStatePaths,
  skillName: string,
  path: Path.Path,
): string => path.join(paths.generalSkillsDir, skillName);

const getProviderSkillDir = (
  paths: ProjectSkillStatePaths,
  provider: ProviderKind,
  skillName: string,
  path: Path.Path,
): string => path.join(paths.providerSkillsDir, provider, skillName);

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
};

const writeImportedFile = (input: {
  readonly absolutePath: string;
  readonly file: ImportedFile;
}): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    yield* fs.makeDirectory(path.dirname(input.absolutePath), { recursive: true }).pipe(
      Effect.tapError((cause) =>
        Effect.logWarning(
          `Initial import: failed to create parent directory ${input.absolutePath}: ${String(cause)}`,
        ),
      ),
      Effect.catch(() => Effect.void),
    );
    yield* fs.writeFile(input.absolutePath, input.file.bytes).pipe(
      Effect.tapError((cause) =>
        Effect.logWarning(
          `Initial import: failed to write support file ${input.absolutePath}: ${String(cause)}`,
        ),
      ),
      Effect.catch(() => Effect.void),
    );
    if (input.file.executable) {
      yield* fs.chmod(input.absolutePath, 0o755).pipe(Effect.catch(() => Effect.void));
    }
  });

const readProviderSkillContributions = (
  adapters: readonly ProviderSkillAdapter[],
): Effect.Effect<
  ReadonlyMap<string, readonly ProviderSkillContribution[]>,
  never,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const contributions = new Map<string, ProviderSkillContribution[]>();

    for (const adapter of sortAdapters(adapters)) {
      const providerSkills = yield* adapter.readProviderSkillFolders().pipe(
        Effect.tapError((e) =>
          Effect.logWarning(
            `Initial import: failed to read skills from ${adapter.provider}: ${e.message}`,
          ),
        ),
        Effect.catch(() => Effect.succeed([])),
      );

      for (const folder of providerSkills) {
        const skillName = String(folder.entry.frontmatter.name ?? folder.skillName).trim();
        if (!skillName) {
          continue;
        }

        const existing = contributions.get(skillName) ?? [];
        existing.push({ adapter, folder });
        contributions.set(skillName, existing);
      }
    }

    return contributions;
  });

const buildImportedSkillState = (input: {
  readonly skillName: string;
  readonly contributions: readonly ProviderSkillContribution[];
}): Effect.Effect<
  {
    readonly canonicalSkill: CreateSkillInput;
    readonly importedState: ImportedSkillState;
  } | null,
  never
> =>
  Effect.gen(function* () {
    const validatedContributions: Array<{
      readonly adapter: ProviderSkillAdapter;
      readonly folder: ProviderSkillFolder;
      readonly skill: ServerProviderSkill;
    }> = [];

    for (const contribution of input.contributions) {
      const validated = yield* validateSkillFile(contribution.folder.entry).pipe(
        Effect.tapError((e) =>
          Effect.logWarning(
            `Initial import: skipping invalid skill "${input.skillName}" from ${contribution.adapter.provider}: ${e.message}`,
          ),
        ),
        Effect.option,
      );
      if (Option.isNone(validated)) {
        continue;
      }

      validatedContributions.push({
        adapter: contribution.adapter,
        folder: contribution.folder,
        skill: validated.value,
      });
    }

    if (validatedContributions.length === 0) {
      return null;
    }

    const canonical = validatedContributions[0]!;
    const generalFilesByPath = new Map<string, ImportedFile>();
    const providerFiles = {
      codex: [] as ImportedFile[],
      claudeAgent: [] as ImportedFile[],
    } satisfies Record<ProviderKind, ImportedFile[]>;
    const filesByRelativePath = new Map<
      string,
      Array<{
        readonly provider: ProviderKind;
        readonly file: ImportedFile;
        readonly classifiedAsProviderSpecific: boolean;
      }>
    >();

    for (const contribution of validatedContributions) {
      for (const file of contribution.folder.files) {
        const classification = contribution.adapter.classifyRelativePath(file.relativePath);
        const filesAtPath = filesByRelativePath.get(file.relativePath) ?? [];
        filesAtPath.push({
          provider: contribution.adapter.provider,
          file: {
            relativePath: file.relativePath,
            bytes: file.bytes,
            executable: file.executable,
          },
          classifiedAsProviderSpecific: classification.kind === "providerSpecific",
        });
        filesByRelativePath.set(file.relativePath, filesAtPath);
      }
    }

    for (const relativePath of [...filesByRelativePath.keys()].toSorted()) {
      const candidates = filesByRelativePath.get(relativePath) ?? [];
      if (candidates.length === 0) {
        continue;
      }

      if (candidates.length === 1) {
        const candidate = candidates[0]!;
        if (candidate.classifiedAsProviderSpecific) {
          providerFiles[candidate.provider].push(candidate.file);
          yield* Effect.logInfo(
            `Initial import: "${input.skillName}" kept provider overlay ${relativePath} for ${candidate.provider}`,
          );
        } else {
          generalFilesByPath.set(relativePath, candidate.file);
          yield* Effect.logInfo(
            `Initial import: "${input.skillName}" imported shared file ${relativePath} from ${candidate.provider}`,
          );
        }
        continue;
      }

      const firstCandidate = candidates[0]!;
      const identical = candidates.every(
        (candidate) =>
          bytesEqual(candidate.file.bytes, firstCandidate.file.bytes) &&
          candidate.file.executable === firstCandidate.file.executable,
      );

      if (identical) {
        generalFilesByPath.set(relativePath, firstCandidate.file);
        yield* Effect.logInfo(
          `Initial import: "${input.skillName}" deduplicated ${relativePath} to general storage across ${candidates
            .map((candidate) => candidate.provider)
            .join(", ")}`,
        );
        continue;
      }

      for (const candidate of candidates) {
        providerFiles[candidate.provider].push(candidate.file);
      }

      yield* Effect.logInfo(
        `Initial import: "${input.skillName}" preserved divergent overlays for ${relativePath} across ${candidates
          .map((candidate) => candidate.provider)
          .join(", ")}`,
      );
    }

    yield* Effect.logInfo(
      `Initial import: "${input.skillName}" chose ${canonical.adapter.provider} as canonical entry source`,
    );

    return {
      canonicalSkill: {
        name: canonical.skill.name,
        displayName: canonical.skill.displayName,
        description: canonical.skill.description,
        body: canonical.skill.body,
        ...(canonical.skill.icon !== undefined ? { icon: canonical.skill.icon } : {}),
        tags: Array.from(canonical.skill.tags),
        enabled: canonical.skill.enabled,
      },
      importedState: {
        skillName: canonical.skill.name,
        generalFiles: sortImportedFiles([...generalFilesByPath.values()]),
        providerFiles: {
          codex: sortImportedFiles(providerFiles.codex),
          claudeAgent: sortImportedFiles(providerFiles.claudeAgent),
        },
        entry: {
          name: canonical.skill.name,
          description: canonical.skill.description,
          body: canonical.skill.body,
        },
      },
    };
  });

const writeImportedSkillState = (input: {
  readonly paths: ProjectSkillStatePaths;
  readonly canonicalSkill: CreateSkillInput;
  readonly importedState: ImportedSkillState;
}): Effect.Effect<boolean, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const generalSkillDir = getGeneralSkillDir(input.paths, input.importedState.skillName, path);

    yield* fs
      .remove(generalSkillDir, { recursive: true, force: true })
      .pipe(Effect.catch(() => Effect.void));
    for (const provider of PROVIDER_ORDER) {
      yield* fs
        .remove(getProviderSkillDir(input.paths, provider, input.importedState.skillName, path), {
          recursive: true,
          force: true,
        })
        .pipe(Effect.catch(() => Effect.void));
    }

    const writeOk = yield* writeGeneralSkillToStorage(input.paths, input.canonicalSkill).pipe(
      Effect.tapError((e) =>
        Effect.logWarning(
          `Initial import: failed to write skill "${input.importedState.skillName}" to Fenrir storage: ${e.message}`,
        ),
      ),
      Effect.match({
        onSuccess: () => true,
        onFailure: () => false,
      }),
    );
    if (!writeOk) {
      return false;
    }

    for (const file of input.importedState.generalFiles) {
      yield* writeImportedFile({
        absolutePath: path.join(generalSkillDir, file.relativePath),
        file,
      });
    }

    for (const provider of PROVIDER_ORDER) {
      const providerDir = getProviderSkillDir(
        input.paths,
        provider,
        input.importedState.skillName,
        path,
      );
      for (const file of input.importedState.providerFiles[provider]) {
        yield* writeImportedFile({
          absolutePath: path.join(providerDir, file.relativePath),
          file,
        });
      }
    }

    yield* rebuildSkillIndexFromStorage(input.paths, input.importedState.skillName).pipe(
      Effect.tapError((cause) =>
        Effect.logWarning(
          `Initial import: failed to rebuild skill index for "${input.importedState.skillName}": ${cause.message}`,
        ),
      ),
      Effect.catch(() => Effect.void),
    );

    return true;
  });

export const needsInitialImport = (
  statePaths: ProjectSkillStatePaths,
  adapters: readonly ProviderSkillAdapter[],
): Effect.Effect<boolean, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const hasInternalState = yield* hasInternalProjectSkillState(statePaths).pipe(
      Effect.catch(() => Effect.succeed(false)),
    );
    if (hasInternalState) {
      return false;
    }

    const contributions = yield* readProviderSkillContributions(adapters);
    return contributions.size > 0;
  });

export const importProviderSkills = (
  statePaths: ProjectSkillStatePaths,
  adapters: readonly ProviderSkillAdapter[],
): Effect.Effect<string[], never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const imported: string[] = [];
    const contributionsBySkill = yield* readProviderSkillContributions(adapters);

    for (const skillName of [...contributionsBySkill.keys()].toSorted()) {
      const contributions = contributionsBySkill.get(skillName) ?? [];
      const importedState = yield* buildImportedSkillState({
        skillName,
        contributions,
      });
      if (importedState === null) {
        continue;
      }

      const written = yield* writeImportedSkillState({
        paths: statePaths,
        canonicalSkill: importedState.canonicalSkill,
        importedState: importedState.importedState,
      });
      if (written) {
        imported.push(skillName);
      }
    }

    yield* Effect.logInfo(
      `Initial import: imported ${imported.length} skill${imported.length !== 1 ? "s" : ""} from provider directories` +
        (imported.length > 0 ? `: ${imported.join(", ")}` : ""),
    );

    return imported;
  });
