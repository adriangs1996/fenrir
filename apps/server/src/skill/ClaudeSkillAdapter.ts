/**
 * ClaudeSkillAdapter - Claude implementation of the ProviderSkillAdapter interface.
 *
 * Syncs skills to/from .claude/skills/{name}/SKILL.md in the project root.
 * Claude's native format only stores name + description in YAML frontmatter;
 * Fenrir-only fields (displayName, icon, tags, enabled) are filled in as
 * defaults on read and stripped on write.
 *
 * Conversion rules (Claude → Fenrir):
 *   name        → name
 *   description → description
 *   name (dashes → title case) → displayName  (e.g. "grill-me" → "Grill Me")
 *   (absent)    → tags: []
 *   (absent)    → icon: omitted (optional field)
 *   (absent)    → enabled: true
 *
 * Conversion rules (Fenrir → Claude):
 *   name        → name
 *   description → description
 *   body        → markdown body (unchanged)
 *   all other fields → dropped
 *
 * @module ClaudeSkillAdapter
 */
import { Effect, FileSystem, Layer, Option, Path, ServiceMap } from "effect";
import { stringify as yamlStringify } from "yaml";

import type { ServerProviderSkill } from "@fenrir/contracts";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import { parseSkillFile, type RawSkillFile } from "./skillFileFormat.ts";
import { SkillAdapterError, type ProviderSkillAdapter } from "./ProviderSkillAdapter.ts";

// ─── Internal helpers ──────────────────────────────────────────

/**
 * Convert a dash-separated name to title case.
 * "grill-me" → "Grill Me"
 * "code-review" → "Code Review"
 * "simpleskill" → "Simpleskill"
 */
function toTitleCase(name: string): string {
  return name
    .split("-")
    .map((word) => (word.length > 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/**
 * Serialize a skill to Claude's native SKILL.md format.
 * Only name + description go in frontmatter; body is the markdown section.
 */
function serializeClaudeSkillFile(skill: ServerProviderSkill): string {
  const frontmatterYaml = yamlStringify(
    { name: skill.name, description: skill.description },
    { lineWidth: 0 },
  ).trimEnd();
  return `---\n${frontmatterYaml}\n---\n\n${skill.body}\n`;
}

// ─── Service Tag ───────────────────────────────────────────────

/**
 * ClaudeSkillAdapter - Service tag for the Claude skill adapter.
 */
export class ClaudeSkillAdapter extends ServiceMap.Service<
  ClaudeSkillAdapter,
  ProviderSkillAdapter
>()("t3/skill/ClaudeSkillAdapter") {}

// ─── Implementation ────────────────────────────────────────────

/**
 * Build a Claude skill adapter for the given project root.
 * Skills are stored at {projectRoot}/.claude/skills/{name}/SKILL.md.
 *
 * Exported for direct use in tests — use ClaudeSkillAdapterLive in production.
 */
export const makeClaudeSkillAdapter = Effect.fn("makeClaudeSkillAdapter")(function* (
  projectRoot: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const skillsDir = pathService.join(projectRoot, ".claude", "skills");

  // ── readProviderSkills ────────────────────────────────────────

  const readProviderSkills = (): Effect.Effect<RawSkillFile[], SkillAdapterError> =>
    Effect.gen(function* () {
      const entries = yield* fs
        .readDirectory(skillsDir)
        .pipe(Effect.catch(() => Effect.succeed([] as string[])));

      if (entries.length === 0) return [];

      const results: RawSkillFile[] = [];

      for (const entry of entries) {
        const entryPath = pathService.join(skillsDir, entry);

        // Skip non-directories
        const statOption = yield* fs.stat(entryPath).pipe(Effect.option);
        if (!Option.isSome(statOption) || statOption.value.type !== "Directory") continue;

        // Claude uses uppercase SKILL.md
        const skillFilePath = pathService.join(entryPath, "SKILL.md");
        const exists = yield* fs
          .exists(skillFilePath)
          .pipe(Effect.catch(() => Effect.succeed(false)));
        if (!exists) continue;

        // Parse the SKILL.md file; inject captured fs into the Effect's R channel
        const parsed = yield* parseSkillFile(skillFilePath).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.catch((error) =>
            Effect.andThen(
              Effect.logWarning(`Skipping unparseable Claude skill file: ${error.message}`),
              Effect.succeed(null as RawSkillFile | null),
            ),
          ),
        );

        if (parsed === null) continue;

        // Enrich frontmatter with Fenrir defaults so validateSkillFile can decode it
        const name = String(parsed.frontmatter.name ?? entry);
        const enrichedRaw: RawSkillFile = {
          ...parsed,
          frontmatter: {
            name,
            description: parsed.frontmatter.description ?? "",
            displayName: toTitleCase(name),
            tags: [],
            enabled: true,
          },
        };

        results.push(enrichedRaw);
      }

      return results;
    });

  // ── writeSkillToProvider ──────────────────────────────────────

  const writeSkillToProvider = (
    skill: ServerProviderSkill,
  ): Effect.Effect<void, SkillAdapterError> =>
    Effect.gen(function* () {
      const filePath = pathService.join(skillsDir, skill.name, "SKILL.md");
      const contents = serializeClaudeSkillFile(skill);

      yield* writeFileStringAtomically({ filePath, contents }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, pathService),
        Effect.mapError(
          (cause) =>
            new SkillAdapterError({
              provider: "claudeAgent",
              reason: String(cause),
              filePath,
            }),
        ),
      );
    });

  // ── deleteSkillFromProvider ───────────────────────────────────

  const deleteSkillFromProvider = (skillName: string): Effect.Effect<void, SkillAdapterError> =>
    Effect.gen(function* () {
      const skillDir = pathService.join(skillsDir, skillName);
      yield* fs.remove(skillDir, { recursive: true }).pipe(Effect.catch(() => Effect.void));
    });

  // ── watchPath ─────────────────────────────────────────────────

  const watchPath = (): string | null => ".claude/skills";

  return {
    provider: "claudeAgent" as const,
    readProviderSkills,
    writeSkillToProvider,
    deleteSkillFromProvider,
    watchPath,
  } satisfies ProviderSkillAdapter;
});

// ─── Live Layer ────────────────────────────────────────────────

/**
 * ClaudeSkillAdapterLive - Layer that provides ClaudeSkillAdapter for the given project root.
 *
 * @param projectRoot - Absolute path to the project root directory.
 *   Skills are stored at {projectRoot}/.claude/skills/{name}/SKILL.md.
 */
export const ClaudeSkillAdapterLive = (
  projectRoot: string,
): Layer.Layer<ClaudeSkillAdapter, never, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(ClaudeSkillAdapter, makeClaudeSkillAdapter(projectRoot));
