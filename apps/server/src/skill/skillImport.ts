/**
 * skillImport - Initial import of existing provider skills.
 *
 * On first run (when .fenrir/skills/ doesn't exist or is empty),
 * detects existing skills in provider directories and imports them
 * into Fenrir's canonical format.
 *
 * Import runs once: it only triggers when .fenrir/skills/ is absent
 * or contains no skill.md files AND at least one provider adapter
 * has skills available.
 *
 * @module skillImport
 */
import { Effect, FileSystem, Option, Path } from "effect";

import type { ProviderSkillAdapter } from "./ProviderSkillAdapter.ts";
import { validateSkillFile, writeSkillFile } from "./skillFileFormat.ts";

// ─── Error ─────────────────────────────────────────────────────

export class SkillImportError {
  readonly _tag = "SkillImportError";
  constructor(
    readonly message: string,
    readonly cause?: unknown,
  ) {}
}

// ─── needsInitialImport ─────────────────────────────────────────

/**
 * Check whether an initial import should run.
 *
 * Returns true when ALL of the following hold:
 *   1. .fenrir/skills/ does not exist, OR it exists but contains no
 *      subdirectory with a skill.md file.
 *   2. At least one provider adapter exposes one or more skills.
 *
 * All I/O errors are swallowed; the function always succeeds.
 */
export const needsInitialImport = (
  fenrirSkillsPath: string,
  adapters: readonly ProviderSkillAdapter[],
): Effect.Effect<boolean, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;

    // ── 1. Check Fenrir skills directory ──────────────────────────

    const dirExists = yield* fs
      .exists(fenrirSkillsPath)
      .pipe(Effect.catch(() => Effect.succeed(false)));

    if (dirExists) {
      const entries = yield* fs
        .readDirectory(fenrirSkillsPath)
        .pipe(Effect.catch(() => Effect.succeed([] as string[])));

      for (const entry of entries) {
        const entryPath = pathService.join(fenrirSkillsPath, entry);
        const statOption = yield* fs.stat(entryPath).pipe(Effect.option);
        if (!Option.isSome(statOption) || statOption.value.type !== "Directory") continue;

        const skillFilePath = pathService.join(entryPath, "skill.md");
        const skillExists = yield* fs
          .exists(skillFilePath)
          .pipe(Effect.catch(() => Effect.succeed(false)));

        if (skillExists) {
          // Fenrir directory already has at least one skill — skip import.
          return false;
        }
      }
    }

    // ── 2. Check if any provider has skills ───────────────────────

    for (const adapter of adapters) {
      const providerSkills = yield* adapter
        .readProviderSkills()
        .pipe(Effect.catch(() => Effect.succeed([])));
      if (providerSkills.length > 0) return true;
    }

    return false;
  });

// ─── importProviderSkills ───────────────────────────────────────

/**
 * Import all provider skills into .fenrir/skills/.
 *
 * For each adapter in order:
 *   1. Read skills from the provider directory.
 *   2. Validate the enriched RawSkillFile (adapter is responsible for
 *      injecting Fenrir defaults such as displayName, tags, enabled).
 *   3. Write to .fenrir/skills/{name}/skill.md.
 *   4. Skip skills whose name was already imported from a prior adapter
 *      (first adapter wins; collision is logged as a warning).
 *
 * Individual failures (parse errors, write errors, adapter read errors)
 * are logged as warnings and skipped — import always continues for
 * remaining skills and never fails.
 *
 * Returns the list of successfully imported skill names.
 */
export const importProviderSkills = (
  fenrirSkillsPath: string,
  adapters: readonly ProviderSkillAdapter[],
): Effect.Effect<string[], never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const imported: string[] = [];
    const seen = new Set<string>();

    for (const adapter of adapters) {
      const providerSkills = yield* adapter.readProviderSkills().pipe(
        Effect.tapError((e) =>
          Effect.logWarning(
            `Initial import: failed to read skills from ${adapter.provider}: ${e.message}`,
          ),
        ),
        Effect.catch(() => Effect.succeed([])),
      );

      for (const raw of providerSkills) {
        const name = String(raw.frontmatter.name ?? "");
        if (!name) continue;

        // Name collision: first adapter wins.
        if (seen.has(name)) {
          yield* Effect.logWarning(
            `Initial import: skill "${name}" from ${adapter.provider} skipped — already imported from a prior adapter`,
          );
          continue;
        }
        seen.add(name);

        // Validate enriched raw (adapter injects displayName, tags, enabled, etc.)
        const validated = yield* validateSkillFile(raw).pipe(
          Effect.tapError((e) =>
            Effect.logWarning(
              `Initial import: skipping invalid skill "${name}" from ${adapter.provider}: ${e.message}`,
            ),
          ),
          Effect.option,
        );
        if (Option.isNone(validated)) continue;

        const skill = validated.value;

        // Write to Fenrir canonical directory; track success.
        const writeOk = yield* writeSkillFile(fenrirSkillsPath, {
          name: skill.name,
          displayName: skill.displayName,
          description: skill.description,
          body: skill.body,
          ...(skill.icon !== undefined ? { icon: skill.icon } : {}),
          tags: Array.from(skill.tags),
          enabled: skill.enabled,
        }).pipe(
          Effect.tapError((e) =>
            Effect.logWarning(
              `Initial import: failed to write skill "${name}" to Fenrir directory: ${e.message}`,
            ),
          ),
          Effect.match({
            onSuccess: () => true,
            onFailure: () => false,
          }),
        );

        if (writeOk) {
          imported.push(name);
        }
      }
    }

    yield* Effect.logInfo(
      `Initial import: imported ${imported.length} skill${imported.length !== 1 ? "s" : ""} from provider directories` +
        (imported.length > 0 ? `: ${imported.join(", ")}` : ""),
    );

    return imported;
  });
