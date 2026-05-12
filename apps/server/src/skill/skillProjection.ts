import type { ServerProviderSkill } from "@fenrir/contracts";

import type {
  ProviderSkillAdapter,
  ProviderSkillFile,
  ProviderSkillProjection,
} from "./ProviderSkillAdapter.ts";

const textEncoder = new TextEncoder();

export const buildProviderSkillProjection = (input: {
  readonly skill: ServerProviderSkill;
  readonly adapter: ProviderSkillAdapter;
  readonly generalFiles: readonly ProviderSkillFile[];
  readonly providerFiles: readonly ProviderSkillFile[];
}): ProviderSkillProjection => {
  const mergedFiles = new Map<string, ProviderSkillProjection["files"][number]>();

  mergedFiles.set(input.adapter.entryFileName, {
    relativePath: input.adapter.entryFileName,
    bytes: textEncoder.encode(input.adapter.serializeEntry(input.skill)),
    executable: false,
    scope: { kind: "general" },
  });

  for (const file of input.generalFiles) {
    if (file.relativePath === "skill.md" || file.relativePath === input.adapter.entryFileName) {
      continue;
    }
    mergedFiles.set(file.relativePath, {
      relativePath: file.relativePath,
      bytes: file.bytes,
      executable: file.executable,
      scope: { kind: "general" },
    });
  }

  for (const file of input.providerFiles) {
    if (file.relativePath === "skill.md" || file.relativePath === input.adapter.entryFileName) {
      continue;
    }
    mergedFiles.set(file.relativePath, {
      relativePath: file.relativePath,
      bytes: file.bytes,
      executable: file.executable,
      scope: input.adapter.classifyRelativePath(file.relativePath),
    });
  }

  return {
    skill: input.skill,
    files: [...mergedFiles.values()].toSorted((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    ),
  };
};
