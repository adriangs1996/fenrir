import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, FileSystem, Path } from "effect";

import type { ServerProviderSkill } from "@fenrir/contracts";

import { SkillAdapterError } from "./ProviderSkillAdapter.ts";
import { makeClaudeSkillAdapter } from "./ClaudeSkillAdapter.ts";

// ─── Fixtures ──────────────────────────────────────────────────

const FULL_SKILL: ServerProviderSkill = {
  name: "grill-me",
  displayName: "Grill Me",
  description: "Interview the user relentlessly about a plan or design",
  body: "Interview me relentlessly about every aspect of this plan...",
  icon: "flame",
  tags: ["planning", "design"],
  enabled: true,
  syncStatus: [],
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

const MINIMAL_SKILL: ServerProviderSkill = {
  name: "quick-fix",
  displayName: "Quick Fix",
  description: "Apply a quick targeted fix",
  body: "Fix the issue quickly and precisely.",
  tags: [],
  enabled: false,
  syncStatus: [],
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

// ─── Helper ────────────────────────────────────────────────────

function firstFailure<E>(exit: Exit.Exit<unknown, E>): E | undefined {
  if (!Exit.isFailure(exit)) return undefined;
  return exit.cause.reasons.find(Cause.isFailReason)?.error;
}

// ─── Tests ─────────────────────────────────────────────────────

it.layer(NodeServices.layer)("ClaudeSkillAdapter (Effect)", (it) => {
  // ── writeSkillToProvider ──────────────────────────────────────

  describe("writeSkillToProvider", () => {
    it.effect("writes SKILL.md with only name + description in frontmatter", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({
          prefix: "fenrir-claude-adapter-test-",
        });

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        yield* adapter.writeSkillToProvider(FULL_SKILL);

        const filePath = path.join(tempDir, ".claude", "skills", "grill-me", "SKILL.md");
        const exists = yield* fs.exists(filePath);
        expect(exists).toBe(true);

        const contents = yield* fs.readFileString(filePath);
        expect(contents).toContain("name: grill-me");
        expect(contents).toContain("description:");
        expect(contents).toContain("Interview the user relentlessly");
      }),
    );

    it.effect("strips Fenrir-only fields (displayName, icon, tags, enabled) on write", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({
          prefix: "fenrir-claude-adapter-test-",
        });

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        yield* adapter.writeSkillToProvider(FULL_SKILL);

        const filePath = path.join(tempDir, ".claude", "skills", "grill-me", "SKILL.md");
        const contents = yield* fs.readFileString(filePath);

        expect(contents).not.toContain("displayName:");
        expect(contents).not.toContain("icon:");
        expect(contents).not.toContain("tags:");
        expect(contents).not.toContain("enabled:");
        expect(contents).not.toContain("syncStatus:");
        expect(contents).not.toContain("createdAt:");
        expect(contents).not.toContain("updatedAt:");
      }),
    );

    it.effect("writes body in the markdown section after the closing fence", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({
          prefix: "fenrir-claude-adapter-test-",
        });

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        yield* adapter.writeSkillToProvider(FULL_SKILL);

        const filePath = path.join(tempDir, ".claude", "skills", "grill-me", "SKILL.md");
        const contents = yield* fs.readFileString(filePath);

        // Body must appear after the closing ---
        const closingFenceIdx = contents.indexOf("\n---\n");
        const bodyIdx = contents.indexOf(FULL_SKILL.body);
        expect(closingFenceIdx).toBeGreaterThan(-1);
        expect(bodyIdx).toBeGreaterThan(closingFenceIdx);
      }),
    );

    it.effect("creates SKILL.md (uppercase) — exact filename in directory listing", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({
          prefix: "fenrir-claude-adapter-test-",
        });

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        yield* adapter.writeSkillToProvider(MINIMAL_SKILL);

        const skillDir = path.join(tempDir, ".claude", "skills", "quick-fix");
        const entries = yield* fs.readDirectory(skillDir);

        // Directory entry must be the uppercase SKILL.md, not skill.md
        expect(entries).toContain("SKILL.md");
        expect(entries).not.toContain("skill.md");
      }),
    );

    it.effect("creates parent directories automatically", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({
          prefix: "fenrir-claude-adapter-test-",
        });

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        yield* adapter.writeSkillToProvider(FULL_SKILL);

        const skillDir = path.join(tempDir, ".claude", "skills", "grill-me");
        const statOpt = yield* fs.stat(skillDir).pipe(Effect.option);
        expect(statOpt._tag).toBe("Some");
      }),
    );
  });

  // ── readProviderSkills ────────────────────────────────────────

  describe("readProviderSkills", () => {
    it.effect("returns empty array when .claude/skills/ does not exist", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const tempDir = yield* fs.makeTempDirectoryScoped({
          prefix: "fenrir-claude-adapter-test-",
        });

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        const skills = yield* adapter.readProviderSkills();

        expect(skills).toEqual([]);
      }),
    );

    it.effect("reads a Claude SKILL.md and maps to RawSkillFile with enriched frontmatter", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({
          prefix: "fenrir-claude-adapter-test-",
        });

        // Write a minimal Claude-format SKILL.md (only name + description)
        const skillDir = path.join(tempDir, ".claude", "skills", "grill-me");
        yield* fs.makeDirectory(skillDir, { recursive: true });
        yield* fs.writeFileString(
          path.join(skillDir, "SKILL.md"),
          `---\nname: grill-me\ndescription: Interview relentlessly\n---\n\nInterview me.\n`,
        );

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        const skills = yield* adapter.readProviderSkills();

        expect(skills).toHaveLength(1);
        const raw = skills[0]!;
        expect(raw.frontmatter.name).toBe("grill-me");
        expect(raw.frontmatter.description).toBe("Interview relentlessly");
        expect(raw.body.trim()).toBe("Interview me.");
      }),
    );

    it.effect("fills in displayName as title-case of name", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({
          prefix: "fenrir-claude-adapter-test-",
        });

        const skillDir = path.join(tempDir, ".claude", "skills", "code-review-pro");
        yield* fs.makeDirectory(skillDir, { recursive: true });
        yield* fs.writeFileString(
          path.join(skillDir, "SKILL.md"),
          `---\nname: code-review-pro\ndescription: Reviews code\n---\n\nReview.\n`,
        );

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        const skills = yield* adapter.readProviderSkills();

        expect(skills[0]?.frontmatter.displayName).toBe("Code Review Pro");
      }),
    );

    it.effect("fills in default tags: [], enabled: true", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({
          prefix: "fenrir-claude-adapter-test-",
        });

        const skillDir = path.join(tempDir, ".claude", "skills", "grill-me");
        yield* fs.makeDirectory(skillDir, { recursive: true });
        yield* fs.writeFileString(
          path.join(skillDir, "SKILL.md"),
          `---\nname: grill-me\ndescription: Grill\n---\n\nGrill me.\n`,
        );

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        const skills = yield* adapter.readProviderSkills();

        expect(skills[0]?.frontmatter.tags).toEqual([]);
        expect(skills[0]?.frontmatter.enabled).toBe(true);
      }),
    );

    it.effect("skips directories without SKILL.md", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({
          prefix: "fenrir-claude-adapter-test-",
        });

        // One valid SKILL.md
        const skillDir = path.join(tempDir, ".claude", "skills", "grill-me");
        yield* fs.makeDirectory(skillDir, { recursive: true });
        yield* fs.writeFileString(
          path.join(skillDir, "SKILL.md"),
          `---\nname: grill-me\ndescription: Grill\n---\n\nGrill me.\n`,
        );

        // A directory without SKILL.md
        const emptyDir = path.join(tempDir, ".claude", "skills", "empty-skill");
        yield* fs.makeDirectory(emptyDir, { recursive: true });
        yield* fs.writeFileString(path.join(emptyDir, "readme.md"), "not a skill");

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        const skills = yield* adapter.readProviderSkills();

        expect(skills).toHaveLength(1);
        expect(skills[0]?.frontmatter.name).toBe("grill-me");
      }),
    );

    it.effect("tolerates malformed SKILL.md — skips bad files, returns good ones", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({
          prefix: "fenrir-claude-adapter-test-",
        });

        // Valid skill
        const goodDir = path.join(tempDir, ".claude", "skills", "grill-me");
        yield* fs.makeDirectory(goodDir, { recursive: true });
        yield* fs.writeFileString(
          path.join(goodDir, "SKILL.md"),
          `---\nname: grill-me\ndescription: Grill\n---\n\nGrill me.\n`,
        );

        // Malformed YAML frontmatter
        const badDir = path.join(tempDir, ".claude", "skills", "broken-skill");
        yield* fs.makeDirectory(badDir, { recursive: true });
        yield* fs.writeFileString(path.join(badDir, "SKILL.md"), `---\nname: [broken\n---\nbody`);

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        const skills = yield* adapter.readProviderSkills();

        expect(skills).toHaveLength(1);
        expect(skills[0]?.frontmatter.name).toBe("grill-me");
      }),
    );

    it.effect("reads multiple skills", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({
          prefix: "fenrir-claude-adapter-test-",
        });

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        yield* adapter.writeSkillToProvider(FULL_SKILL);
        yield* adapter.writeSkillToProvider(MINIMAL_SKILL);

        const skills = yield* adapter.readProviderSkills();
        expect(skills).toHaveLength(2);
        const names = skills.map((s) => s.frontmatter.name as string).toSorted();
        expect(names).toEqual(["grill-me", "quick-fix"]);
      }),
    );
  });

  // ── Round-trip ────────────────────────────────────────────────

  describe("round-trip", () => {
    it.effect("write then read preserves name, description, and body", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const tempDir = yield* fs.makeTempDirectoryScoped({
          prefix: "fenrir-claude-adapter-test-",
        });

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        yield* adapter.writeSkillToProvider(FULL_SKILL);

        const skills = yield* adapter.readProviderSkills();
        expect(skills).toHaveLength(1);

        const raw = skills[0]!;
        expect(raw.frontmatter.name).toBe(FULL_SKILL.name);
        expect(raw.frontmatter.description).toBe(FULL_SKILL.description);
        expect(raw.body.trim()).toBe(FULL_SKILL.body.trim());
      }),
    );

    it.effect("round-trip: Fenrir-only fields are NOT in SKILL.md but displayName is derived", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const tempDir = yield* fs.makeTempDirectoryScoped({
          prefix: "fenrir-claude-adapter-test-",
        });

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        yield* adapter.writeSkillToProvider(FULL_SKILL);

        const skills = yield* adapter.readProviderSkills();
        const raw = skills[0]!;

        // displayName is derived from name (not from original displayName)
        expect(raw.frontmatter.displayName).toBe("Grill Me");
        // Fenrir fields are filled with defaults
        expect(raw.frontmatter.tags).toEqual([]);
        expect(raw.frontmatter.enabled).toBe(true);
        // icon is not set (optional)
        expect(raw.frontmatter.icon).toBeUndefined();
      }),
    );

    it.effect("minimal skill round-trip preserves name, description, body", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const tempDir = yield* fs.makeTempDirectoryScoped({
          prefix: "fenrir-claude-adapter-test-",
        });

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        yield* adapter.writeSkillToProvider(MINIMAL_SKILL);

        const skills = yield* adapter.readProviderSkills();
        expect(skills).toHaveLength(1);

        const raw = skills[0]!;
        expect(raw.frontmatter.name).toBe("quick-fix");
        expect(raw.frontmatter.description).toBe("Apply a quick targeted fix");
        expect(raw.body.trim()).toBe("Fix the issue quickly and precisely.");
      }),
    );
  });

  // ── deleteSkillFromProvider ───────────────────────────────────

  describe("deleteSkillFromProvider", () => {
    it.effect("removes the skill directory", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({
          prefix: "fenrir-claude-adapter-test-",
        });

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        yield* adapter.writeSkillToProvider(FULL_SKILL);

        const skillDir = path.join(tempDir, ".claude", "skills", "grill-me");
        expect(yield* fs.exists(skillDir)).toBe(true);

        yield* adapter.deleteSkillFromProvider("grill-me");
        expect(yield* fs.exists(skillDir)).toBe(false);
      }),
    );

    it.effect("deleting non-existent skill does not throw", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const tempDir = yield* fs.makeTempDirectoryScoped({
          prefix: "fenrir-claude-adapter-test-",
        });

        const adapter = yield* makeClaudeSkillAdapter(tempDir);

        const exit = yield* adapter.deleteSkillFromProvider("nonexistent-skill").pipe(Effect.exit);
        expect(Exit.isSuccess(exit)).toBe(true);
      }),
    );

    it.effect("after delete, skill is no longer returned by readProviderSkills", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const tempDir = yield* fs.makeTempDirectoryScoped({
          prefix: "fenrir-claude-adapter-test-",
        });

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        yield* adapter.writeSkillToProvider(FULL_SKILL);
        yield* adapter.writeSkillToProvider(MINIMAL_SKILL);

        yield* adapter.deleteSkillFromProvider("grill-me");

        const skills = yield* adapter.readProviderSkills();
        expect(skills).toHaveLength(1);
        expect(skills[0]?.frontmatter.name).toBe("quick-fix");
      }),
    );
  });

  // ── watchPath ─────────────────────────────────────────────────

  describe("watchPath", () => {
    it.effect("returns .claude/skills", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const tempDir = yield* fs.makeTempDirectoryScoped({
          prefix: "fenrir-claude-adapter-test-",
        });

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        expect(adapter.watchPath()).toBe(".claude/skills");
      }),
    );
  });

  // ── SkillAdapterError ─────────────────────────────────────────

  describe("SkillAdapterError", () => {
    it.effect("is tagged as SkillAdapterError", () =>
      Effect.gen(function* () {
        const err = new SkillAdapterError({ provider: "claudeAgent", reason: "test error" });
        expect(err._tag).toBe("SkillAdapterError");
        expect(err.provider).toBe("claudeAgent");
        expect(err.reason).toBe("test error");
        expect(err.message).toContain("claudeAgent");
        expect(err.message).toContain("test error");
      }),
    );

    it.effect("includes filePath in message when provided", () =>
      Effect.gen(function* () {
        const err = new SkillAdapterError({
          provider: "claudeAgent",
          reason: "write failed",
          filePath: "/some/path/SKILL.md",
        });
        expect(err.message).toContain("/some/path/SKILL.md");
      }),
    );
  });
});
