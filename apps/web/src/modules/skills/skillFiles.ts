import type { LocalApi, ServerSkillDetails, ServerSkillFileEntry } from "@fenrir/contracts";
import { openInPreferredEditor } from "~/editorPreferences";

export function findCanonicalSkillFile(
  files: readonly ServerSkillFileEntry[],
): ServerSkillFileEntry | null {
  return (
    files.find(
      (file) => file.scope.kind === "general" && file.relativePath.toLowerCase() === "skill.md",
    ) ?? null
  );
}

export async function openCanonicalSkillFileInEditor(
  api: LocalApi,
  details: ServerSkillDetails,
): Promise<string> {
  const canonicalFile = findCanonicalSkillFile(details.files);
  if (!canonicalFile) {
    throw new Error("Canonical skill.md was not found for this skill.");
  }

  await openInPreferredEditor(api, canonicalFile.absolutePath);
  return canonicalFile.absolutePath;
}
