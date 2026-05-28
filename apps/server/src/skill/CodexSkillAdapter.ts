import { Effect, FileSystem, Layer, Path, Context } from "effect";
import { stringify as yamlStringify } from "yaml";

import type { ServerProviderSkill } from "@fenrir/contracts";

import type { ProviderSkillFolder } from "./ProviderSkillAdapter.ts";
import {
  SkillAdapterError,
  type ProviderSkillAdapter,
  type ProviderSkillProjection,
} from "./ProviderSkillAdapter.ts";
import { readSkillFolderFiles, writeSkillFolderProjection } from "./providerSkillFolderIO.ts";
import { makeProviderPathClassifier } from "./providerSkillPathClassifier.ts";
import { parseSkillFile, type RawSkillFile } from "./skillFileFormat.ts";

function serializeProviderEntry(skill: ServerProviderSkill): string {
  const frontmatterYaml = yamlStringify(
    { name: skill.name, description: skill.description },
    { lineWidth: 0 },
  ).trimEnd();
  return `---\n${frontmatterYaml}\n---\n\n${skill.body}\n`;
}

function toTitleCase(name: string): string {
  return name
    .split("-")
    .map((word) => (word.length > 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}

const enrichRawSkillFile = (entry: RawSkillFile, fallbackName: string): RawSkillFile => {
  const name = String(entry.frontmatter.name ?? fallbackName);

  return {
    ...entry,
    frontmatter: {
      name,
      description: entry.frontmatter.description ?? "",
      displayName: toTitleCase(name),
      tags: [],
      enabled: true,
    },
  };
};

const readProviderSkillFolders = (
  skillsDir: string,
): Effect.Effect<
  readonly ProviderSkillFolder[],
  SkillAdapterError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const classifyRelativePath = makeProviderPathClassifier("codex", ["agents"]);

    const entries = yield* fs
      .readDirectory(skillsDir)
      .pipe(Effect.catch(() => Effect.succeed([] as string[])));

    const folders: ProviderSkillFolder[] = [];

    for (const entry of entries.toSorted()) {
      if (entry.startsWith(".")) continue;

      const absolutePath = pathService.join(skillsDir, entry);
      const stat = yield* fs.stat(absolutePath).pipe(Effect.option);
      if (stat._tag !== "Some") continue;
      if (stat.value.type === "SymbolicLink") {
        yield* Effect.logWarning(`Ignoring symlink in Codex skill sync: ${absolutePath}`);
        continue;
      }
      if (stat.value.type !== "Directory") continue;

      const files = yield* readSkillFolderFiles(absolutePath, classifyRelativePath);
      const entryFile = files.find((file) => file.relativePath === "SKILL.md");
      if (!entryFile) continue;

      const parsed = yield* parseSkillFile(entryFile.absolutePath).pipe(
        Effect.mapError(
          (error) =>
            new SkillAdapterError({
              provider: "codex",
              reason: error.reason,
              filePath: error.filePath,
            }),
        ),
        Effect.option,
      );
      if (parsed._tag !== "Some") {
        yield* Effect.logWarning(
          `Skipping unparseable Codex skill file: ${entryFile.absolutePath}`,
        );
        continue;
      }

      folders.push({
        skillName: String(parsed.value.frontmatter.name ?? entry),
        absolutePath,
        entry: enrichRawSkillFile(parsed.value, entry),
        entryFile,
        files: files.filter((file) => file.relativePath !== "SKILL.md"),
      });
    }

    return folders;
  });

export class CodexSkillAdapter extends Context.Service<CodexSkillAdapter, ProviderSkillAdapter>()(
  "t3/skill/CodexSkillAdapter",
) {}

export const makeCodexSkillAdapter = Effect.fn("makeCodexSkillAdapter")(function* (
  projectRoot: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const skillsDir = pathService.join(projectRoot, ".agents", "skills");
  const classifyRelativePath = makeProviderPathClassifier("codex", ["agents"]);

  const mapError = (reason: string, filePath?: string) =>
    new SkillAdapterError({ provider: "codex", reason, ...(filePath ? { filePath } : {}) });

  const writeSkillProjection = (
    projection: ProviderSkillProjection,
  ): Effect.Effect<void, SkillAdapterError> =>
    Effect.gen(function* () {
      const files = projection.files.some((file) => file.relativePath === "SKILL.md")
        ? projection.files
        : [
            {
              relativePath: "SKILL.md",
              bytes: serializeProviderEntry(projection.skill),
              executable: false,
              scope: { kind: "general" as const },
            },
            ...projection.files,
          ];

      yield* writeSkillFolderProjection({
        skillDir: pathService.join(skillsDir, projection.skill.name),
        files,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, pathService),
        Effect.mapError((cause) => mapError(String(cause))),
      );
    });

  const deleteSkillFromProvider = (skillName: string): Effect.Effect<void, SkillAdapterError> =>
    fs
      .remove(pathService.join(skillsDir, skillName), { recursive: true, force: true })
      .pipe(Effect.mapError((cause) => mapError(String(cause))));

  return {
    provider: "codex" as const,
    priority: 200,
    entryFileName: "SKILL.md",
    serializeEntry: serializeProviderEntry,
    watchPath: () => ".agents/skills",
    classifyRelativePath,
    readProviderSkillFolders: () =>
      readProviderSkillFolders(skillsDir).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, pathService),
      ),
    writeSkillProjection,
    deleteSkillFromProvider,
  } satisfies ProviderSkillAdapter;
});

export const CodexSkillAdapterLive = (
  projectRoot: string,
): Layer.Layer<CodexSkillAdapter, never, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(CodexSkillAdapter, makeCodexSkillAdapter(projectRoot));
