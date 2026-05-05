import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, FileSystem, Path } from "effect";

import type { CreateSkillInput } from "@fenrir/contracts";

import {
  SkillParseError,
  SkillValidationError,
  parseSkillFile,
  scanSkillDirectory,
  serializeSkillFile,
  validateSkillFile,
  writeSkillFile,
} from "./skillFileFormat.ts";

// ─── Fixtures ──────────────────────────────────────────────────

const FULL_SKILL_CONTENT = `---
name: grill-me
displayName: Grill Me
description: Interview the user relentlessly about a plan or design
icon: flame
enabled: true
tags:
  - planning
  - design
---

Interview me relentlessly about every aspect of this plan...
`;

const MINIMAL_SKILL_CONTENT = `---
name: minimal-skill
displayName: Minimal Skill
description: A bare-bones skill
enabled: false
tags: []
---

Do something minimal.
`;

const FULL_SKILL_INPUT: CreateSkillInput = {
  name: "grill-me",
  displayName: "Grill Me",
  description: "Interview the user relentlessly about a plan or design",
  icon: "flame",
  enabled: true,
  tags: ["planning", "design"],
  body: "Interview me relentlessly about every aspect of this plan...",
};

const MINIMAL_SKILL_INPUT: CreateSkillInput = {
  name: "minimal-skill",
  displayName: "Minimal Skill",
  description: "A bare-bones skill",
  enabled: false,
  tags: [],
  body: "Do something minimal.",
};

// ─── Helper: extract first typed error from a failed Exit ───────

function firstFailure<E>(exit: Exit.Exit<unknown, E>): E | undefined {
  if (!Exit.isFailure(exit)) return undefined;
  return exit.cause.reasons.find(Cause.isFailReason)?.error;
}

// ─── serializeSkillFile (pure, no Effect) ──────────────────────

describe("serializeSkillFile", () => {
  it("produces YAML frontmatter fences", () => {
    const out = serializeSkillFile(FULL_SKILL_INPUT);
    expect(out.startsWith("---\n")).toBe(true);
    expect(out).toContain("\n---\n");
  });

  it("puts body in the markdown section, not in frontmatter", () => {
    const out = serializeSkillFile(FULL_SKILL_INPUT);
    expect(out).toContain(FULL_SKILL_INPUT.body);
    expect(out).not.toMatch(/^body:/m);
  });

  it("serializes all frontmatter fields", () => {
    const out = serializeSkillFile(FULL_SKILL_INPUT);
    expect(out).toContain("name: grill-me");
    expect(out).toContain("displayName: Grill Me");
    expect(out).toContain("description:");
    expect(out).toContain("icon: flame");
    expect(out).toContain("enabled: true");
    expect(out).toContain("planning");
    expect(out).toContain("design");
  });

  it("omits icon when undefined", () => {
    const skill = { ...MINIMAL_SKILL_INPUT };
    const out = serializeSkillFile(skill);
    expect(out).not.toContain("icon:");
  });

  it("round-trips: serialize then parse gives back original frontmatter and body", () => {
    const serialized = serializeSkillFile(FULL_SKILL_INPUT);
    expect(serialized).toContain("name: grill-me");
    expect(serialized).toContain(FULL_SKILL_INPUT.body);
    // Body must appear after the closing ---
    const closingFenceIndex = serialized.indexOf("\n---\n");
    const bodyIndex = serialized.indexOf(FULL_SKILL_INPUT.body);
    expect(bodyIndex).toBeGreaterThan(closingFenceIndex);
  });
});

// ─── Effect-based file I/O tests ───────────────────────────────

it.layer(NodeServices.layer)("skillFileFormat (Effect)", (it) => {
  // ─── parseSkillFile ─────────────────────────────────────────

  it.effect("parseSkillFile: parses valid skill.md with all fields", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "fenrir-skill-test-" });
      const filePath = path.join(tempDir, "skill.md");

      yield* fs.writeFileString(filePath, FULL_SKILL_CONTENT);

      const raw = yield* parseSkillFile(filePath);

      expect(raw.filePath).toBe(filePath);
      expect(raw.frontmatter.name).toBe("grill-me");
      expect(raw.frontmatter.displayName).toBe("Grill Me");
      expect(raw.frontmatter.description).toBe(
        "Interview the user relentlessly about a plan or design",
      );
      expect(raw.frontmatter.icon).toBe("flame");
      expect(raw.frontmatter.enabled).toBe(true);
      expect(raw.frontmatter.tags).toEqual(["planning", "design"]);
      expect(raw.body.trim()).toBe("Interview me relentlessly about every aspect of this plan...");
    }),
  );

  it.effect("parseSkillFile: parses minimal skill.md (name + description + body only)", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "fenrir-skill-test-" });
      const filePath = path.join(tempDir, "skill.md");

      yield* fs.writeFileString(filePath, MINIMAL_SKILL_CONTENT);

      const raw = yield* parseSkillFile(filePath);

      expect(raw.frontmatter.name).toBe("minimal-skill");
      expect(raw.frontmatter.icon).toBeUndefined();
      expect(raw.body.trim()).toBe("Do something minimal.");
    }),
  );

  it.effect("parseSkillFile: fails with SkillParseError for missing closing fence", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "fenrir-skill-test-" });
      const filePath = path.join(tempDir, "skill.md");

      yield* fs.writeFileString(filePath, "---\nname: broken\n# no closing fence");

      const exit = yield* parseSkillFile(filePath).pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      const error = firstFailure(exit);
      expect(error).toBeInstanceOf(SkillParseError);
      expect((error as SkillParseError).reason).toMatch(/fence|malformed/i);
    }),
  );

  it.effect("parseSkillFile: fails for malformed YAML", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "fenrir-skill-test-" });
      const filePath = path.join(tempDir, "skill.md");

      yield* fs.writeFileString(filePath, "---\nname: [broken\n---\nbody");

      const exit = yield* parseSkillFile(filePath).pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      const error = firstFailure(exit);
      expect(error).toBeInstanceOf(SkillParseError);
      expect((error as SkillParseError).reason).toMatch(/YAML/i);
    }),
  );

  it.effect("parseSkillFile: treats file without frontmatter as body-only", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "fenrir-skill-test-" });
      const filePath = path.join(tempDir, "skill.md");

      yield* fs.writeFileString(filePath, "Just a plain body with no frontmatter.");

      const raw = yield* parseSkillFile(filePath);

      expect(raw.frontmatter).toEqual({});
      expect(raw.body).toBe("Just a plain body with no frontmatter.");
    }),
  );

  // ─── validateSkillFile ──────────────────────────────────────

  it.effect("validateSkillFile: decodes a fully valid raw skill file", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "fenrir-skill-test-" });
      const filePath = path.join(tempDir, "skill.md");

      yield* fs.writeFileString(filePath, FULL_SKILL_CONTENT);
      const raw = yield* parseSkillFile(filePath);
      const skill = yield* validateSkillFile(raw);

      expect(skill.name).toBe("grill-me");
      expect(skill.displayName).toBe("Grill Me");
      expect(skill.icon).toBe("flame");
      expect(skill.tags).toEqual(["planning", "design"]);
      expect(skill.syncStatus).toEqual([]);
      expect(typeof skill.createdAt).toBe("string");
      expect(typeof skill.updatedAt).toBe("string");
    }),
  );

  it.effect("validateSkillFile: fails with SkillValidationError for missing required fields", () =>
    Effect.gen(function* () {
      const raw = {
        frontmatter: { name: "oops" /* missing displayName, description, enabled, tags */ },
        body: "body text",
        filePath: "/fake/path/skill.md",
      };

      const exit = yield* validateSkillFile(raw).pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      const error = firstFailure(exit);
      expect(error).toBeInstanceOf(SkillValidationError);
    }),
  );

  it.effect("validateSkillFile: fails for invalid icon value", () =>
    Effect.gen(function* () {
      const raw = {
        frontmatter: {
          name: "my-skill",
          displayName: "My Skill",
          description: "A skill",
          enabled: true,
          tags: [],
          icon: "notanicon",
        },
        body: "body text",
        filePath: "/fake/path/skill.md",
      };

      const exit = yield* validateSkillFile(raw).pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      const error = firstFailure(exit);
      expect(error).toBeInstanceOf(SkillValidationError);
    }),
  );

  // ─── Round-trip ─────────────────────────────────────────────

  it.effect("serialize → parseSkillFile → validateSkillFile round-trip preserves all data", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "fenrir-skill-test-" });
      const filePath = path.join(tempDir, "skill.md");

      const serialized = serializeSkillFile(FULL_SKILL_INPUT);
      yield* fs.writeFileString(filePath, serialized);

      const raw = yield* parseSkillFile(filePath);
      const skill = yield* validateSkillFile(raw);

      expect(skill.name).toBe(FULL_SKILL_INPUT.name);
      expect(skill.displayName).toBe(FULL_SKILL_INPUT.displayName);
      expect(skill.description).toBe(FULL_SKILL_INPUT.description);
      expect(skill.icon).toBe(FULL_SKILL_INPUT.icon);
      expect(skill.enabled).toBe(FULL_SKILL_INPUT.enabled);
      expect(skill.tags).toEqual(FULL_SKILL_INPUT.tags);
      expect(skill.body.trim()).toBe(FULL_SKILL_INPUT.body.trim());
      expect(skill.syncStatus).toEqual([]);
    }),
  );

  // ─── writeSkillFile ─────────────────────────────────────────

  it.effect("writeSkillFile: creates directory and writes skill.md", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "fenrir-skill-test-" });
      const basePath = path.join(tempDir, "skills");

      yield* writeSkillFile(basePath, FULL_SKILL_INPUT);

      const expectedPath = path.join(basePath, "grill-me", "skill.md");
      const exists = yield* fs.exists(expectedPath);
      expect(exists).toBe(true);

      const contents = yield* fs.readFileString(expectedPath);
      expect(contents).toContain("name: grill-me");
      expect(contents).toContain(FULL_SKILL_INPUT.body);
    }),
  );

  it.effect("writeSkillFile: round-trip — written file can be parsed back", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "fenrir-skill-test-" });
      const basePath = path.join(tempDir, "skills");

      yield* writeSkillFile(basePath, MINIMAL_SKILL_INPUT);

      const filePath = path.join(basePath, "minimal-skill", "skill.md");
      const raw = yield* parseSkillFile(filePath);
      const skill = yield* validateSkillFile(raw);

      expect(skill.name).toBe(MINIMAL_SKILL_INPUT.name);
      expect(skill.enabled).toBe(MINIMAL_SKILL_INPUT.enabled);
      expect(skill.tags).toEqual([]);
    }),
  );

  // ─── scanSkillDirectory ─────────────────────────────────────

  it.effect("scanSkillDirectory: returns empty array for missing directory", () =>
    Effect.gen(function* () {
      const results = yield* scanSkillDirectory("/tmp/fenrir-nonexistent-skills-dir-xyz");
      expect(results).toEqual([]);
    }),
  );

  it.effect("scanSkillDirectory: returns empty array for empty directory", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "fenrir-skill-test-" });

      const results = yield* scanSkillDirectory(tempDir);
      expect(results).toEqual([]);
    }),
  );

  it.effect("scanSkillDirectory: finds all valid skill.md files", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "fenrir-skill-test-" });

      yield* writeSkillFile(tempDir, FULL_SKILL_INPUT);
      yield* writeSkillFile(tempDir, MINIMAL_SKILL_INPUT);

      const results = yield* scanSkillDirectory(tempDir);

      expect(results).toHaveLength(2);
      const names = results.map((r) => r.frontmatter.name as string).toSorted();
      expect(names).toEqual(["grill-me", "minimal-skill"]);
    }),
  );

  it.effect("scanSkillDirectory: skips directories without skill.md", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "fenrir-skill-test-" });

      yield* writeSkillFile(tempDir, FULL_SKILL_INPUT);

      // Directory without skill.md
      yield* fs.makeDirectory(path.join(tempDir, "no-skill-here"), { recursive: true });
      yield* fs.writeFileString(path.join(tempDir, "no-skill-here", "readme.md"), "not a skill");

      // Stray file at root level (not a directory)
      yield* fs.writeFileString(path.join(tempDir, "stray.md"), "stray");

      const results = yield* scanSkillDirectory(tempDir);

      expect(results).toHaveLength(1);
      expect(results[0]?.frontmatter.name).toBe("grill-me");
    }),
  );

  it.effect("scanSkillDirectory: tolerates unparseable skill.md files, returns good ones", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "fenrir-skill-test-" });

      // One valid skill
      yield* writeSkillFile(tempDir, FULL_SKILL_INPUT);

      // One broken skill (malformed YAML frontmatter)
      const brokenDir = path.join(tempDir, "broken-skill");
      yield* fs.makeDirectory(brokenDir, { recursive: true });
      yield* fs.writeFileString(path.join(brokenDir, "skill.md"), "---\nname: [broken\n---\nbody");

      const results = yield* scanSkillDirectory(tempDir);

      // Only the valid skill is returned; broken one is silently skipped
      expect(results).toHaveLength(1);
      expect(results[0]?.frontmatter.name).toBe("grill-me");
    }),
  );
});
