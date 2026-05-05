import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, FileSystem, Path, Stream } from "effect";

import type { CreateSkillInput } from "@fenrir/contracts";

import { ServerConfig } from "../config.ts";
import { makeSkillService } from "./SkillService.ts";

// ─── Fixtures ──────────────────────────────────────────────────

const GRILL_ME: CreateSkillInput = {
  name: "grill-me",
  displayName: "Grill Me",
  description: "Interview the user relentlessly about a plan or design",
  body: "Interview me relentlessly about every aspect of this plan until you are satisfied.",
  icon: "flame",
  tags: ["planning", "design"],
  enabled: true,
};

const CODE_REVIEW: CreateSkillInput = {
  name: "code-review",
  displayName: "Code Review",
  description: "Review the provided code for quality and correctness",
  body: "Review the code carefully and point out any issues.",
  tags: ["quality"],
  enabled: true,
};

// ─── Test helpers ──────────────────────────────────────────────

/**
 * Build a SkillService instance backed by a fresh temp directory.
 * The temp dir acts as both cwd (project root) and state base dir.
 */
const makeTestService = (cwd: string) =>
  makeSkillService.pipe(Effect.provide(ServerConfig.layerTest(cwd, cwd)));

// ─── Tests ─────────────────────────────────────────────────────

it.layer(NodeServices.layer)("SkillService", (it) => {
  // ── getAll ──────────────────────────────────────────────────────

  describe("getAll", () => {
    it.effect("returns empty array when .fenrir/skills/ does not exist", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        const skills = yield* svc.getAll;

        expect(skills).toEqual([]);
      }),
    );

    it.effect("returns cached value — no re-scan on repeated calls", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        const first = yield* svc.getAll;
        const second = yield* svc.getAll;

        // Same array reference — served from cache
        expect(first).toBe(second);
      }),
    );
  });

  // ── create ─────────────────────────────────────────────────────

  describe("create", () => {
    it.effect("writes skill.md to .fenrir/skills/", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        const skillPath = path.join(cwd, ".fenrir", "skills", "grill-me", "skill.md");
        const exists = yield* fs.exists(skillPath);
        expect(exists).toBe(true);

        const content = yield* fs.readFileString(skillPath);
        expect(content).toContain("name: grill-me");
        expect(content).toContain("Interview me relentlessly");
      }),
    );

    it.effect("syncs to .claude/skills/ after create", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        const claudePath = path.join(cwd, ".claude", "skills", "grill-me", "SKILL.md");
        const exists = yield* fs.exists(claudePath);
        expect(exists).toBe(true);

        const content = yield* fs.readFileString(claudePath);
        expect(content).toContain("name: grill-me");
        expect(content).toContain("Interview me relentlessly");
      }),
    );

    it.effect("returns the created skill with correct fields", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        const skill = yield* svc.create(GRILL_ME);

        expect(skill.name).toBe("grill-me");
        expect(skill.displayName).toBe("Grill Me");
        expect(skill.description).toBe(GRILL_ME.description);
        expect(skill.body).toBe(GRILL_ME.body);
        expect(skill.enabled).toBe(true);
        expect(skill.tags).toEqual(["planning", "design"]);
        expect(skill.icon).toBe("flame");
        expect(skill.createdAt).toBeTruthy();
        expect(skill.updatedAt).toBeTruthy();
      }),
    );

    it.effect("create marks claude sync as synced", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        const skills = yield* svc.getAll;
        const skill = skills.find((s) => s.name === "grill-me")!;
        const claudeSync = skill.syncStatus.find((s) => s.provider === "claudeAgent");

        expect(claudeSync).toBeDefined();
        expect(claudeSync?.state).toBe("synced");
      }),
    );

    it.effect("fails if skill with same name already exists", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        const result = yield* svc.create(GRILL_ME).pipe(Effect.exit);
        expect(result._tag).toBe("Failure");
      }),
    );

    it.effect("cache is invalidated after create", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        const before = yield* svc.getAll;
        expect(before).toHaveLength(0);

        yield* svc.create(GRILL_ME);
        const after = yield* svc.getAll;
        expect(after).toHaveLength(1);
      }),
    );

    it.effect("streamChanges emits after create", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);

        const fiber = yield* Stream.take(svc.streamChanges, 1).pipe(
          Stream.runCollect,
          Effect.forkScoped,
        );
        yield* svc.create(GRILL_ME);
        const emitted = yield* Fiber.join(fiber);

        expect(emitted.length).toBe(1);
        const skills = emitted[0]!;
        expect(skills).toHaveLength(1);
        expect(skills[0]?.name).toBe("grill-me");
      }),
    );
  });

  // ── getByName ───────────────────────────────────────────────────

  describe("getByName", () => {
    it.effect("returns the skill when it exists", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        const skill = yield* svc.getByName("grill-me");
        expect(skill.name).toBe("grill-me");
      }),
    );

    it.effect("fails with SkillServiceError when skill does not exist", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        const result = yield* svc.getByName("nonexistent").pipe(Effect.exit);
        expect(result._tag).toBe("Failure");
      }),
    );
  });

  // ── update ─────────────────────────────────────────────────────

  describe("update", () => {
    it.effect("updates skill.md in .fenrir/skills/", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);
        yield* svc.update({ name: "grill-me", body: "Updated body content." });

        const skillPath = path.join(cwd, ".fenrir", "skills", "grill-me", "skill.md");
        const content = yield* fs.readFileString(skillPath);
        expect(content).toContain("Updated body content.");
      }),
    );

    it.effect("updates SKILL.md in .claude/skills/ after update", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);
        yield* svc.update({ name: "grill-me", body: "Updated body content." });

        const claudePath = path.join(cwd, ".claude", "skills", "grill-me", "SKILL.md");
        const content = yield* fs.readFileString(claudePath);
        expect(content).toContain("Updated body content.");
      }),
    );

    it.effect("returns the updated skill", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);
        const updated = yield* svc.update({ name: "grill-me", description: "New description." });

        expect(updated.description).toBe("New description.");
        expect(updated.name).toBe("grill-me");
      }),
    );

    it.effect("merges partial update — unspecified fields unchanged", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);
        const updated = yield* svc.update({ name: "grill-me", enabled: false });

        expect(updated.enabled).toBe(false);
        expect(updated.body).toBe(GRILL_ME.body); // unchanged
        expect(updated.tags).toEqual(GRILL_ME.tags); // unchanged
      }),
    );

    it.effect("fails with SkillServiceError when skill does not exist", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        const result = yield* svc.update({ name: "nonexistent", body: "x" }).pipe(Effect.exit);
        expect(result._tag).toBe("Failure");
      }),
    );

    it.effect("streamChanges emits after update", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        const fiber = yield* Stream.take(svc.streamChanges, 1).pipe(
          Stream.runCollect,
          Effect.forkScoped,
        );
        yield* svc.update({ name: "grill-me", body: "New body." });
        const emitted = yield* Fiber.join(fiber);

        expect(emitted.length).toBe(1);
        const skill = emitted[0]!.find((s) => s.name === "grill-me");
        expect(skill?.body).toBe("New body.");
      }),
    );
  });

  // ── delete ─────────────────────────────────────────────────────

  describe("delete", () => {
    it.effect("removes skill from .fenrir/skills/", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        const skillDir = path.join(cwd, ".fenrir", "skills", "grill-me");
        expect(yield* fs.exists(skillDir)).toBe(true);

        yield* svc.delete("grill-me");
        expect(yield* fs.exists(skillDir)).toBe(false);
      }),
    );

    it.effect("removes skill from .claude/skills/ after delete", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        const claudeDir = path.join(cwd, ".claude", "skills", "grill-me");
        expect(yield* fs.exists(claudeDir)).toBe(true);

        yield* svc.delete("grill-me");
        expect(yield* fs.exists(claudeDir)).toBe(false);
      }),
    );

    it.effect("returns void and skill is gone from getAll", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);
        yield* svc.create(CODE_REVIEW);

        yield* svc.delete("grill-me");

        const skills = yield* svc.getAll;
        expect(skills).toHaveLength(1);
        expect(skills[0]?.name).toBe("code-review");
      }),
    );

    it.effect("fails with SkillServiceError when skill does not exist", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        const result = yield* svc.delete("nonexistent").pipe(Effect.exit);
        expect(result._tag).toBe("Failure");
      }),
    );

    it.effect("streamChanges emits after delete", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        const fiber = yield* Stream.take(svc.streamChanges, 1).pipe(
          Stream.runCollect,
          Effect.forkScoped,
        );
        yield* svc.delete("grill-me");
        const emitted = yield* Fiber.join(fiber);

        expect(emitted.length).toBe(1);
        expect(Array.from(emitted[0]!)).toHaveLength(0);
      }),
    );
  });

  // ── toggleEnabled ──────────────────────────────────────────────

  describe("toggleEnabled", () => {
    it.effect("flips enabled from true to false", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME); // enabled: true

        const toggled = yield* svc.toggleEnabled("grill-me");
        expect(toggled.enabled).toBe(false);
      }),
    );

    it.effect("flips enabled from false to true", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create({ ...GRILL_ME, enabled: false });

        const toggled = yield* svc.toggleEnabled("grill-me");
        expect(toggled.enabled).toBe(true);
      }),
    );

    it.effect("fails with SkillServiceError when skill does not exist", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        const result = yield* svc.toggleEnabled("nonexistent").pipe(Effect.exit);
        expect(result._tag).toBe("Failure");
      }),
    );
  });

  // ── resolveConflict ─────────────────────────────────────────────

  describe("resolveConflict", () => {
    it.effect("keep-fenrir: overwrites provider with Fenrir version", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        // Externally edit the Claude SKILL.md to simulate a conflict
        const claudePath = path.join(cwd, ".claude", "skills", "grill-me", "SKILL.md");
        yield* fs.writeFileString(
          claudePath,
          `---\nname: grill-me\ndescription: ${GRILL_ME.description}\n---\n\nExternally edited body.\n`,
        );

        // Resolve by keeping Fenrir
        yield* svc.resolveConflict({
          name: "grill-me",
          provider: "claudeAgent",
          resolution: "keep-fenrir",
        });

        // Claude file should now contain the Fenrir body
        const claudeContent = yield* fs.readFileString(claudePath);
        expect(claudeContent).toContain(GRILL_ME.body);
        expect(claudeContent).not.toContain("Externally edited body.");
      }),
    );

    it.effect("accept-external: overwrites Fenrir with provider version", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        // Externally edit the Claude SKILL.md
        const claudePath = path.join(cwd, ".claude", "skills", "grill-me", "SKILL.md");
        yield* fs.writeFileString(
          claudePath,
          `---\nname: grill-me\ndescription: ${GRILL_ME.description}\n---\n\nExternally edited body.\n`,
        );

        // Resolve by accepting external
        const resolved = yield* svc.resolveConflict({
          name: "grill-me",
          provider: "claudeAgent",
          resolution: "accept-external",
        });

        expect(resolved.body).toBe("Externally edited body.");

        // Fenrir file should also contain the external body
        const fenrirPath = path.join(cwd, ".fenrir", "skills", "grill-me", "skill.md");
        const fenrirContent = yield* fs.readFileString(fenrirPath);
        expect(fenrirContent).toContain("Externally edited body.");
      }),
    );

    it.effect("keep-fenrir: sync status becomes synced after resolve", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        // Create a conflict
        const claudePath = path.join(cwd, ".claude", "skills", "grill-me", "SKILL.md");
        yield* fs.writeFileString(
          claudePath,
          `---\nname: grill-me\ndescription: ${GRILL_ME.description}\n---\n\nConflicting body.\n`,
        );

        const resolved = yield* svc.resolveConflict({
          name: "grill-me",
          provider: "claudeAgent",
          resolution: "keep-fenrir",
        });

        const claudeSync = resolved.syncStatus.find((s) => s.provider === "claudeAgent");
        expect(claudeSync?.state).toBe("synced");
      }),
    );

    it.effect("fails with SkillServiceError when skill does not exist", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        const result = yield* svc
          .resolveConflict({
            name: "nonexistent",
            provider: "claudeAgent",
            resolution: "keep-fenrir",
          })
          .pipe(Effect.exit);

        expect(result._tag).toBe("Failure");
      }),
    );
  });

  // ── Sync status ────────────────────────────────────────────────

  describe("sync status", () => {
    it.effect("codex sync status is unsupported (stub adapter has null watchPath)", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        const skills = yield* svc.getAll;
        const skill = skills[0]!;
        const codexSync = skill.syncStatus.find((s) => s.provider === "codex");

        expect(codexSync?.state).toBe("unsupported");
      }),
    );

    it.effect("claude sync is pending when .claude/skills/ does not have the skill", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        // Manually remove the claude copy to simulate pending state
        const claudeDir = path.join(cwd, ".claude", "skills", "grill-me");
        yield* fs.remove(claudeDir, { recursive: true });

        // Fresh service to bypass cache
        const svc2 = yield* makeTestService(cwd);
        const skills = yield* svc2.getAll;
        const skill = skills[0]!;
        const claudeSync = skill.syncStatus.find((s) => s.provider === "claudeAgent");

        expect(claudeSync?.state).toBe("pending");
      }),
    );

    it.effect("claude sync is synced when bodies match", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        const skills = yield* svc.getAll;
        const skill = skills[0]!;
        const claudeSync = skill.syncStatus.find((s) => s.provider === "claudeAgent");

        expect(claudeSync?.state).toBe("synced");
      }),
    );

    it.effect("claude sync is conflict when provider body differs", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        // Overwrite Claude SKILL.md with different body
        const claudePath = path.join(cwd, ".claude", "skills", "grill-me", "SKILL.md");
        yield* fs.writeFileString(
          claudePath,
          `---\nname: grill-me\ndescription: ${GRILL_ME.description}\n---\n\nDifferent body.\n`,
        );

        // Fresh service reads both dirs
        const svc2 = yield* makeTestService(cwd);
        const skills = yield* svc2.getAll;
        const skill = skills[0]!;
        const claudeSync = skill.syncStatus.find((s) => s.provider === "claudeAgent");

        expect(claudeSync?.state).toBe("conflict");
      }),
    );
  });

  // ── Multiple skills ─────────────────────────────────────────────

  describe("multiple skills", () => {
    it.effect("create multiple skills — all returned by getAll", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);
        yield* svc.create(CODE_REVIEW);

        const skills = yield* svc.getAll;
        expect(skills).toHaveLength(2);
        const names = skills.map((s) => s.name).toSorted();
        expect(names).toEqual(["code-review", "grill-me"]);
      }),
    );

    it.effect("delete one skill leaves the other intact", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);
        yield* svc.create(CODE_REVIEW);
        yield* svc.delete("grill-me");

        const skills = yield* svc.getAll;
        expect(skills).toHaveLength(1);
        expect(skills[0]?.name).toBe("code-review");
      }),
    );
  });
});
