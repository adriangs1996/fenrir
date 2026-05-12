import { createHash } from "node:crypto";

import type { ProviderSkillFile, ProviderSkillProjectionFile } from "./ProviderSkillAdapter.ts";

type HashableSkillFile = Pick<ProviderSkillFile, "relativePath" | "bytes" | "executable"> &
  Partial<Pick<ProviderSkillProjectionFile, "relativePath" | "bytes" | "executable">>;

export const hashSkillFiles = (files: readonly HashableSkillFile[]): string => {
  const hash = createHash("sha256");

  for (const file of files.toSorted((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  )) {
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(file.executable ? "1" : "0");
    hash.update("\0");
    hash.update(file.bytes);
    hash.update("\0");
  }

  return hash.digest("hex");
};
