import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import { makeClaudeSkillAdapter } from "./ClaudeSkillAdapter.ts";
import { parseSkillFile, validateSkillFile } from "./skillFileFormat.ts";
import { importProviderSkills, needsInitialImport } from "./skillImport.ts";

// ─── Fixtures ──────────────────────────────────────────────────

const GRILL_ME_CONTENT = `---\nname: grill-me\ndescription: Interview relentlessly\n---\n\nInterview me relentlessly.\n`;
const CODE_REVIEW_CONTENT = `---\nname: code-review\ndescription: Review code for quality\n---\n\nReview the code carefully.\n`;
const BROKEN_CONTENT = `---\nname: [broken\n---\nbody`;

// ─── Test helpers ──────────────────────────────────────────────

/**
 * Write a Claude-format SKILL.md into {tempDir}/.claude/skills/{name}/SKILL.md.
 */
const writeClaudeSkill = (tempDir: string, name: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const skillDir = path.join(tempDir, ".claude", "skills", name);
    yield* fs.makeDirectory(skillDir, { recursive: true });
    yield* fs.writeFileString(path.join(skillDir, "SKILL.md"), content);
  });

/**
 * Write a Fenrir-format skill.md into {tempDir}/.fenrir/skills/{name}/skill.md.
 */
const writeFenrirSkill = (tempDir: string, name: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const skillDir = path.join(tempDir, ".fenrir", "skills", name);
    yield* fs.makeDirectory(skillDir, { recursive: true });
    yield* fs.writeFileString(path.join(skillDir, "skill.md"), content);
  });

// ─── Tests ─────────────────────────────────────────────────────

it.layer(NodeServices.layer)("skillImport", (it) => {
  // ── needsInitialImport ─────────────────────────────────────────

  describe("needsInitialImport", () => {
    it.effect("returns true when fenrir dir is missing and provider has skills", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "skill-import-" });

        yield* writeClaudeSkill(tempDir, "grill-me", GRILL_ME_CONTENT);

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        const fenrirSkillsPath = path.join(tempDir, ".fenrir", "skills");

        const result = yield* needsInitialImport(fenrirSkillsPath, [adapter]);
        expect(result).toBe(true);
      }),
    );

    it.effect("returns true when fenrir dir is empty and provider has skills", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "skill-import-" });

        yield* writeClaudeSkill(tempDir, "grill-me", GRILL_ME_CONTENT);

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        const fenrirSkillsPath = path.join(tempDir, ".fenrir", "skills");

        // Create empty fenrir dir
        yield* fs.makeDirectory(fenrirSkillsPath, { recursive: true });

        const result = yield* needsInitialImport(fenrirSkillsPath, [adapter]);
        expect(result).toBe(true);
      }),
    );

    it.effect("returns false when fenrir dir already has a skill", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "skill-import-" });

        // Fenrir dir has a skill already
        yield* writeFenrirSkill(
          tempDir,
          "existing-skill",
          `---\nname: existing-skill\ndisplayName: Existing Skill\ndescription: Already here\nenabled: true\ntags: []\n---\n\nAlready imported.\n`,
        );

        // Claude also has skills — should not matter
        yield* writeClaudeSkill(tempDir, "grill-me", GRILL_ME_CONTENT);

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        const fenrirSkillsPath = path.join(tempDir, ".fenrir", "skills");

        const result = yield* needsInitialImport(fenrirSkillsPath, [adapter]);
        expect(result).toBe(false);
      }),
    );

    it.effect("returns false when both fenrir and provider dirs are empty", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "skill-import-" });

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        const fenrirSkillsPath = path.join(tempDir, ".fenrir", "skills");

        const result = yield* needsInitialImport(fenrirSkillsPath, [adapter]);
        expect(result).toBe(false);
      }),
    );

    it.effect("returns false when fenrir dir has non-skill files but no skill subdirs", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "skill-import-" });

        // Fenrir dir exists but only has a loose file, no skill subdirs
        const fenrirSkillsPath = path.join(tempDir, ".fenrir", "skills");
        yield* fs.makeDirectory(fenrirSkillsPath, { recursive: true });
        yield* fs.writeFileString(path.join(fenrirSkillsPath, "README.md"), "not a skill");

        yield* writeClaudeSkill(tempDir, "grill-me", GRILL_ME_CONTENT);

        const adapter = yield* makeClaudeSkillAdapter(tempDir);

        // Loose file is not a directory — should be treated as empty
        const result = yield* needsInitialImport(fenrirSkillsPath, [adapter]);
        expect(result).toBe(true);
      }),
    );
  });

  // ── importProviderSkills ───────────────────────────────────────

  describe("importProviderSkills", () => {
    it.effect("imports 2 Claude skills into .fenrir/skills/", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "skill-import-" });

        yield* writeClaudeSkill(tempDir, "grill-me", GRILL_ME_CONTENT);
        yield* writeClaudeSkill(tempDir, "code-review", CODE_REVIEW_CONTENT);

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        const fenrirSkillsPath = path.join(tempDir, ".fenrir", "skills");

        const imported = yield* importProviderSkills(fenrirSkillsPath, [adapter]);

        expect(imported.toSorted()).toEqual(["code-review", "grill-me"]);

        // Both skill.md files must exist in Fenrir dir
        const grillPath = path.join(fenrirSkillsPath, "grill-me", "skill.md");
        const reviewPath = path.join(fenrirSkillsPath, "code-review", "skill.md");
        expect(yield* fs.exists(grillPath)).toBe(true);
        expect(yield* fs.exists(reviewPath)).toBe(true);
      }),
    );

    it.effect("fills default values: displayName (title-case), tags, enabled", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "skill-import-" });

        yield* writeClaudeSkill(tempDir, "grill-me", GRILL_ME_CONTENT);

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        const fenrirSkillsPath = path.join(tempDir, ".fenrir", "skills");

        yield* importProviderSkills(fenrirSkillsPath, [adapter]);

        const skillPath = path.join(fenrirSkillsPath, "grill-me", "skill.md");
        const content = yield* fs.readFileString(skillPath);

        // displayName derived from name: "grill-me" → "Grill Me"
        expect(content).toContain("displayName: Grill Me");
        // enabled defaults to true
        expect(content).toContain("enabled: true");
        // tags defaults to []
        expect(content).toContain("tags: []");
        // body preserved
        expect(content).toContain("Interview me relentlessly.");
      }),
    );

    it.effect("malformed Claude skill is skipped; valid skills are imported", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "skill-import-" });

        yield* writeClaudeSkill(tempDir, "grill-me", GRILL_ME_CONTENT);
        // Broken YAML frontmatter
        yield* writeClaudeSkill(tempDir, "broken-skill", BROKEN_CONTENT);

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        const fenrirSkillsPath = path.join(tempDir, ".fenrir", "skills");

        const imported = yield* importProviderSkills(fenrirSkillsPath, [adapter]);

        // Only the valid skill is imported
        expect(imported).toEqual(["grill-me"]);

        const grillPath = path.join(fenrirSkillsPath, "grill-me", "skill.md");
        expect(yield* fs.exists(grillPath)).toBe(true);

        // Broken skill directory should not exist in Fenrir
        const brokenPath = path.join(fenrirSkillsPath, "broken-skill", "skill.md");
        expect(yield* fs.exists(brokenPath)).toBe(false);
      }),
    );

    it.effect("name collision: first adapter wins, second is logged and skipped", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir1 = yield* fs.makeTempDirectoryScoped({ prefix: "skill-import-a-" });
        const tempDir2 = yield* fs.makeTempDirectoryScoped({ prefix: "skill-import-b-" });
        const fenrirRoot = yield* fs.makeTempDirectoryScoped({ prefix: "skill-import-fenrir-" });

        // Both adapters expose a skill named "grill-me" with different bodies
        yield* writeClaudeSkill(tempDir1, "grill-me", GRILL_ME_CONTENT);
        yield* writeClaudeSkill(
          tempDir2,
          "grill-me",
          `---\nname: grill-me\ndescription: Different adapter\n---\n\nDifferent body from adapter 2.\n`,
        );

        const adapter1 = yield* makeClaudeSkillAdapter(tempDir1);
        const adapter2 = yield* makeClaudeSkillAdapter(tempDir2);
        const fenrirSkillsPath = path.join(fenrirRoot, ".fenrir", "skills");

        const imported = yield* importProviderSkills(fenrirSkillsPath, [adapter1, adapter2]);

        // Only one copy should be imported
        expect(imported).toEqual(["grill-me"]);

        // The first adapter's body should win
        const skillPath = path.join(fenrirSkillsPath, "grill-me", "skill.md");
        const content = yield* fs.readFileString(skillPath);
        expect(content).toContain("Interview me relentlessly.");
        expect(content).not.toContain("Different body from adapter 2.");
      }),
    );

    it.effect("returns empty array when no provider has skills", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "skill-import-" });

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        const fenrirSkillsPath = path.join(tempDir, ".fenrir", "skills");

        const imported = yield* importProviderSkills(fenrirSkillsPath, [adapter]);
        expect(imported).toEqual([]);
      }),
    );

    it.effect("preserves description and name from provider", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "skill-import-" });

        yield* writeClaudeSkill(tempDir, "code-review", CODE_REVIEW_CONTENT);

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        const fenrirSkillsPath = path.join(tempDir, ".fenrir", "skills");

        yield* importProviderSkills(fenrirSkillsPath, [adapter]);

        const skillPath = path.join(fenrirSkillsPath, "code-review", "skill.md");
        const content = yield* fs.readFileString(skillPath);

        expect(content).toContain("name: code-review");
        expect(content).toContain("displayName: Code Review");
        expect(content).toContain("description: Review code for quality");
        expect(content).toContain("Review the code carefully.");
      }),
    );
  });

  // ── Round-trip ─────────────────────────────────────────────────

  describe("round-trip", () => {
    it.effect("imported skill body is preserved; re-sync to provider dir is unchanged", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "skill-import-" });

        // Step 1: write a skill to the Claude provider dir
        const originalBody = "Interview me relentlessly about every detail.";
        yield* writeClaudeSkill(
          tempDir,
          "grill-me",
          `---\nname: grill-me\ndescription: Interview relentlessly\n---\n\n${originalBody}\n`,
        );

        // Step 2: import into Fenrir
        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        const fenrirSkillsPath = path.join(tempDir, ".fenrir", "skills");

        const imported = yield* importProviderSkills(fenrirSkillsPath, [adapter]);
        expect(imported).toEqual(["grill-me"]);

        // Step 3: verify Fenrir skill.md preserves the original body
        const fenrirSkillPath = path.join(fenrirSkillsPath, "grill-me", "skill.md");
        const fenrirContent = yield* fs.readFileString(fenrirSkillPath);
        expect(fenrirContent).toContain(originalBody);

        // Step 4: parse and validate the Fenrir skill
        const rawFenrir = yield* parseSkillFile(fenrirSkillPath);
        const validated = yield* validateSkillFile(rawFenrir);

        expect(validated.name).toBe("grill-me");
        expect(validated.body.trim()).toBe(originalBody);
        expect(validated.displayName).toBe("Grill Me");
        expect(validated.enabled).toBe(true);
        expect(Array.from(validated.tags)).toEqual([]);

        // Step 5: re-sync the imported skill back to the provider dir
        yield* adapter.writeSkillToProvider({ ...validated, syncStatus: [] });

        // Claude SKILL.md must still contain the original body (round-trip unchanged)
        const claudeSkillPath = path.join(tempDir, ".claude", "skills", "grill-me", "SKILL.md");
        const claudeContent = yield* fs.readFileString(claudeSkillPath);
        expect(claudeContent).toContain(originalBody);

        // Claude SKILL.md must NOT contain Fenrir-only fields
        expect(claudeContent).not.toContain("displayName:");
        expect(claudeContent).not.toContain("tags:");
        expect(claudeContent).not.toContain("enabled:");
      }),
    );
  });
});
