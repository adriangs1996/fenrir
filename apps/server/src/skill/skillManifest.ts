import { createHash } from "node:crypto";

import { Effect, FileSystem, Path } from "effect";

import { readSkillFolderFiles } from "./providerSkillFolderIO.ts";

export interface SkillManifestEntry {
  readonly relativePath: string;
  readonly kind: "file";
  readonly executable: boolean;
  readonly contentHash: string;
}

export interface SkillManifest {
  readonly entries: readonly SkillManifestEntry[];
}

type ManifestSourceFile = {
  readonly relativePath: string;
  readonly executable: boolean;
  readonly bytes: Uint8Array | string;
};

const hashBytes = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

export const buildSkillManifest = (
  files: readonly ManifestSourceFile[],
  mapRelativePath: (relativePath: string) => string = (relativePath) => relativePath,
): SkillManifest => ({
  entries: files
    .map((file) => ({
      relativePath: mapRelativePath(file.relativePath).replaceAll("\\", "/"),
      kind: "file" as const,
      executable: file.executable,
      contentHash: hashBytes(file.bytes),
    }))
    .toSorted((left, right) => left.relativePath.localeCompare(right.relativePath)),
});

export const scanSkillManifest = (
  skillDir: string,
  mapRelativePath: (relativePath: string) => string = (relativePath) => relativePath,
): Effect.Effect<SkillManifest, never, FileSystem.FileSystem | Path.Path> =>
  readSkillFolderFiles(skillDir, () => ({ kind: "general" as const })).pipe(
    Effect.map((files) => buildSkillManifest(files, mapRelativePath)),
  );
