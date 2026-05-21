import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, FileSystem, Path, Stream } from "effect";

import type { CreateSkillInput } from "@fenrir/contracts";

import { ServerConfig } from "../config.ts";
import { getProjectSkillStatePaths } from "./projectSkillStatePaths.ts";
import { makeSkillService } from "./SkillService.ts";
import { writeProviderOverlayFileToStorage } from "./skillStorage.ts";

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

const getFenrirSkillPaths = (cwd: string, baseDir: string, path: Path.Path) =>
  getProjectSkillStatePaths({
    stateDir: path.join(baseDir, "userdata"),
    workspaceRoot: cwd,
    path,
  });

const writeProviderSkill = (input: {
  readonly cwd: string;
  readonly providerDir: ".agents/skills" | ".claude/skills";
  readonly name: string;
  readonly entryContent: string;
  readonly files?: Record<string, string>;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const skillDir = path.join(input.cwd, input.providerDir, input.name);
    yield* fs.makeDirectory(skillDir, { recursive: true });
    yield* fs.writeFileString(path.join(skillDir, "SKILL.md"), input.entryContent);
    for (const [relativePath, content] of Object.entries(input.files ?? {})) {
      const targetPath = path.join(skillDir, relativePath);
      yield* fs.makeDirectory(path.dirname(targetPath), { recursive: true });
      yield* fs.writeFileString(targetPath, content);
    }
  });

const scanSkillNames = (skillsDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const entries = yield* fs.readDirectory(skillsDir);
    return entries.toSorted();
  });

// ─── Tests ─────────────────────────────────────────────────────

it.layer(NodeServices.layer)("SkillService", (it) => {
  // ── getAll ──────────────────────────────────────────────────────

  describe("getAll", () => {
    it.effect("returns empty array and initializes per-project state outside the workspace", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        const skills = yield* svc.getAll;
        const paths = getFenrirSkillPaths(cwd, cwd, path);

        expect(skills).toEqual([]);
        expect(yield* fs.exists(paths.generalSkillsDir)).toBe(true);
        expect(yield* scanSkillNames(paths.generalSkillsDir)).toEqual([]);
        expect(yield* fs.exists(path.join(cwd, ".fenrir", "skills"))).toBe(false);
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

    it.effect(
      "bootstraps from provider mirrors and immediately converges the lower-precedence mirror",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

            yield* writeProviderSkill({
              cwd,
              providerDir: ".agents/skills",
              name: "grill-me",
              entryContent:
                "---\nname: grill-me\ndescription: Codex canonical\n---\n\nCodex body wins.\n",
              files: {
                "agents/openai.yaml": "model: gpt-5\n",
              },
            });
            yield* writeProviderSkill({
              cwd,
              providerDir: ".claude/skills",
              name: "grill-me",
              entryContent:
                "---\nname: grill-me\ndescription: Claude lower priority\n---\n\nClaude body loses.\n",
            });

            const svc = yield* makeTestService(cwd);
            yield* svc.start;
            const skills = yield* svc.getAll;
            const statePaths = getFenrirSkillPaths(cwd, cwd, path);

            expect(skills).toHaveLength(1);
            expect(skills[0]?.body).toBe("Codex body wins.");
            expect(
              yield* fs.readFileString(
                path.join(statePaths.generalSkillsDir, "grill-me", "skill.md"),
              ),
            ).toContain("Codex body wins.");
            expect(
              yield* fs.readFileString(path.join(cwd, ".claude", "skills", "grill-me", "SKILL.md")),
            ).toContain("Codex body wins.");
            expect(
              yield* fs.readFileString(path.join(cwd, ".agents", "skills", "grill-me", "SKILL.md")),
            ).toContain("Codex body wins.");
            expect(
              yield* fs.exists(
                path.join(cwd, ".agents", "skills", "grill-me", "agents", "openai.yaml"),
              ),
            ).toBe(true);
            expect(
              yield* fs.exists(
                path.join(cwd, ".claude", "skills", "grill-me", "agents", "openai.yaml"),
              ),
            ).toBe(false);
          }),
        ),
    );
  });

  // ── create ─────────────────────────────────────────────────────

  describe("create", () => {
    it.effect("writes skill.md to Fenrir project state under FENRIR_HOME", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        const statePaths = getFenrirSkillPaths(cwd, cwd, path);
        const skillPath = path.join(statePaths.generalSkillsDir, "grill-me", "skill.md");
        const exists = yield* fs.exists(skillPath);
        expect(exists).toBe(true);
        expect(yield* fs.exists(path.join(cwd, ".fenrir", "skills", "grill-me", "skill.md"))).toBe(
          false,
        );

        const content = yield* fs.readFileString(skillPath);
        expect(content).toContain("name: grill-me");
        expect(content).toContain("Interview me relentlessly");
      }),
    );

    it.effect("persists project metadata next to the per-project skill state", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        const statePaths = getFenrirSkillPaths(cwd, cwd, path);
        const rawMetadata = yield* fs.readFileString(statePaths.projectMetadataPath);
        const metadata = JSON.parse(rawMetadata) as {
          readonly version: number;
          readonly projectKey: string;
          readonly workspaceRoot: string;
          readonly repositoryIdentity: null;
        };

        expect(metadata).toEqual({
          version: 1,
          projectKey: statePaths.projectKey,
          workspaceRoot: statePaths.workspaceRoot,
          repositoryIdentity: null,
        });
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
    it.effect("updates skill.md in Fenrir project state", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);
        yield* svc.update({ name: "grill-me", body: "Updated body content." });

        const statePaths = getFenrirSkillPaths(cwd, cwd, path);
        const skillPath = path.join(statePaths.generalSkillsDir, "grill-me", "skill.md");
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
    it.effect("removes skill from Fenrir project state", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        const statePaths = getFenrirSkillPaths(cwd, cwd, path);
        const skillDir = path.join(statePaths.generalSkillsDir, "grill-me");
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
        const statePaths = getFenrirSkillPaths(cwd, cwd, path);
        const fenrirPath = path.join(statePaths.generalSkillsDir, "grill-me", "skill.md");
        const fenrirContent = yield* fs.readFileString(fenrirPath);
        expect(fenrirContent).toContain("Externally edited body.");
      }),
    );

    it.effect("accept-external: does not mutate codex-only overlay files", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        const statePaths = getFenrirSkillPaths(cwd, cwd, path);
        yield* writeProviderOverlayFileToStorage({
          paths: statePaths,
          skillName: "grill-me",
          provider: "codex",
          relativePath: "agents/openai.yaml",
          contents: "model: gpt-5\n",
        });
        yield* svc.update({ name: "grill-me", body: GRILL_ME.body });

        const codexOverlayPath = path.join(
          cwd,
          ".agents",
          "skills",
          "grill-me",
          "agents",
          "openai.yaml",
        );
        expect(yield* fs.readFileString(codexOverlayPath)).toBe("model: gpt-5\n");

        const claudePath = path.join(cwd, ".claude", "skills", "grill-me", "SKILL.md");
        yield* fs.writeFileString(
          claudePath,
          `---\nname: grill-me\ndescription: External description\n---\n\nExternally edited body.\n`,
        );

        const resolved = yield* svc.resolveConflict({
          name: "grill-me",
          provider: "claudeAgent",
          resolution: "accept-external",
        });

        expect(resolved.description).toBe("External description");
        expect(resolved.body).toBe("Externally edited body.");
        expect(yield* fs.readFileString(codexOverlayPath)).toBe("model: gpt-5\n");
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

    it.effect("accept-external only resolves the selected skill on the selected provider", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);
        yield* svc.create(CODE_REVIEW);

        const grillMeClaudePath = path.join(cwd, ".claude", "skills", "grill-me", "SKILL.md");
        const codeReviewClaudePath = path.join(cwd, ".claude", "skills", "code-review", "SKILL.md");

        yield* fs.writeFileString(
          grillMeClaudePath,
          `---\nname: grill-me\ndescription: External grill-me description\n---\n\nExternally edited grill-me body.\n`,
        );
        yield* fs.writeFileString(
          codeReviewClaudePath,
          `---\nname: code-review\ndescription: External code-review description\n---\n\nExternally edited code-review body.\n`,
        );

        yield* svc.resolveConflict({
          name: "grill-me",
          provider: "claudeAgent",
          resolution: "accept-external",
        });

        const skills = yield* svc.getAll;
        const grillMe = skills.find((skill) => skill.name === "grill-me");
        const codeReview = skills.find((skill) => skill.name === "code-review");
        const grillMeClaudeSync = grillMe?.syncStatus.find((s) => s.provider === "claudeAgent");
        const codeReviewClaudeSync = codeReview?.syncStatus.find(
          (s) => s.provider === "claudeAgent",
        );

        expect(grillMe?.body).toBe("Externally edited grill-me body.");
        expect(grillMeClaudeSync?.state).toBe("synced");
        expect(codeReview?.body).toBe(CODE_REVIEW.body);
        expect(codeReviewClaudeSync?.state).toBe("conflict");
        expect(yield* fs.readFileString(codeReviewClaudePath)).toContain(
          "Externally edited code-review body.",
        );
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
    it.effect("codex sync status is synced when the projected folder matches", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        const skills = yield* svc.getAll;
        const skill = skills[0]!;
        const codexSync = skill.syncStatus.find((s) => s.provider === "codex");

        expect(codexSync?.state).toBe("synced");
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
        const codexSync = skill.syncStatus.find((s) => s.provider === "codex");

        expect(claudeSync?.state).toBe("conflict");
        expect(codexSync?.state).toBe("synced");
      }),
    );

    it.effect("provider-specific external drift only flips the affected provider badge", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        const statePaths = getFenrirSkillPaths(cwd, cwd, path);
        yield* writeProviderOverlayFileToStorage({
          paths: statePaths,
          skillName: "grill-me",
          provider: "codex",
          relativePath: "agents/openai.yaml",
          contents: "model: gpt-5\n",
        });
        yield* svc.update({ name: "grill-me", body: GRILL_ME.body });

        const codexPath = path.join(cwd, ".agents", "skills", "grill-me", "agents", "openai.yaml");
        yield* fs.writeFileString(codexPath, "model: gpt-6\n");

        const svc2 = yield* makeTestService(cwd);
        const skill = (yield* svc2.getAll)[0]!;
        const codexSync = skill.syncStatus.find((s) => s.provider === "codex");
        const claudeSync = skill.syncStatus.find((s) => s.provider === "claudeAgent");

        expect(codexSync?.state).toBe("conflict");
        expect(claudeSync?.state).toBe("synced");
      }),
    );
  });

  describe("internal sync", () => {
    it.effect("general-file edits in internal state resync both providers", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        const statePaths = getFenrirSkillPaths(cwd, cwd, path);
        const generalFile = path.join(
          statePaths.generalSkillsDir,
          "grill-me",
          "references",
          "guide.md",
        );
        yield* fs.makeDirectory(path.dirname(generalFile), { recursive: true });
        yield* fs.writeFileString(generalFile, "shared reference\n");
        yield* svc.update({ name: "grill-me", body: GRILL_ME.body });

        const claudeFile = path.join(
          cwd,
          ".claude",
          "skills",
          "grill-me",
          "references",
          "guide.md",
        );
        const codexFile = path.join(cwd, ".agents", "skills", "grill-me", "references", "guide.md");

        expect(yield* fs.readFileString(claudeFile)).toBe("shared reference\n");
        expect(yield* fs.readFileString(codexFile)).toBe("shared reference\n");
      }),
    );

    it.effect("provider overlay edits only resync the relevant provider", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        const statePaths = getFenrirSkillPaths(cwd, cwd, path);
        const overlayFile = path.join(
          statePaths.providerSkillsDir,
          "codex",
          "grill-me",
          "agents",
          "openai.yaml",
        );
        yield* fs.makeDirectory(path.dirname(overlayFile), { recursive: true });
        yield* fs.writeFileString(overlayFile, "model: gpt-5\n");
        yield* svc.update({ name: "grill-me", body: GRILL_ME.body });

        const codexFile = path.join(cwd, ".agents", "skills", "grill-me", "agents", "openai.yaml");
        const claudeFile = path.join(cwd, ".claude", "skills", "grill-me", "agents", "openai.yaml");

        expect(yield* fs.readFileString(codexFile)).toBe("model: gpt-5\n");
        expect(yield* fs.exists(claudeFile)).toBe(false);
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

  describe("getDetails", () => {
    it.effect("reads file inventory from internal storage indexes and preserves mixed scopes", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });

        const svc = yield* makeTestService(cwd);
        yield* svc.create(GRILL_ME);

        const statePaths = getFenrirSkillPaths(cwd, cwd, path);
        yield* writeProviderOverlayFileToStorage({
          paths: statePaths,
          skillName: "grill-me",
          provider: "codex",
          relativePath: "agents/openai.yaml",
          contents: "model: gpt-5\n",
        });

        const details = yield* svc.getDetails("grill-me");
        expect(details.files).toContainEqual({
          relativePath: "skill.md",
          absolutePath: path.join(statePaths.generalSkillsDir, "grill-me", "skill.md"),
          executable: false,
          scope: { kind: "general" },
        });
        expect(details.files).toContainEqual({
          relativePath: "agents/openai.yaml",
          absolutePath: path.join(
            statePaths.providerSkillsDir,
            "codex",
            "grill-me",
            "agents",
            "openai.yaml",
          ),
          executable: false,
          scope: { kind: "providerSpecific", provider: "codex" },
        });
      }),
    );
  });

  describe("legacy migration", () => {
    it.effect("prefers legacy workspace skills over codex and claude bootstrap copies", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });
        const legacySkillDir = path.join(cwd, ".fenrir", "skills", "grill-me");

        yield* fs.makeDirectory(legacySkillDir, { recursive: true });
        yield* fs.writeFileString(
          path.join(legacySkillDir, "skill.md"),
          `---
name: grill-me
displayName: Grill Me
description: Legacy copy
enabled: true
tags: []
---

Legacy body.
`,
        );
        yield* writeProviderSkill({
          cwd,
          providerDir: ".agents/skills",
          name: "grill-me",
          entryContent: "---\nname: grill-me\ndescription: Codex copy\n---\n\nCodex body.\n",
        });
        yield* writeProviderSkill({
          cwd,
          providerDir: ".claude/skills",
          name: "grill-me",
          entryContent: "---\nname: grill-me\ndescription: Claude copy\n---\n\nClaude body.\n",
        });

        const svc = yield* makeTestService(cwd);
        const skill = yield* svc.getByName("grill-me");

        expect(skill.description).toBe("Legacy copy");
        expect(skill.body).toBe("Legacy body.");
      }),
    );

    it.effect(
      "imports workspace-local .fenrir/skills exactly once and then reads only internal state",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-" });
          const legacySkillDir = path.join(cwd, ".fenrir", "skills", "grill-me");
          yield* fs.makeDirectory(path.join(legacySkillDir, "references"), { recursive: true });
          yield* fs.writeFileString(
            path.join(legacySkillDir, "skill.md"),
            `---
name: grill-me
displayName: Grill Me
description: Legacy copy
enabled: true
tags: []
---

Legacy body.
`,
          );
          yield* fs.writeFileString(
            path.join(legacySkillDir, "references", "notes.md"),
            "legacy reference\n",
          );

          const svc = yield* makeTestService(cwd);
          const skills = yield* svc.getAll;
          const statePaths = getFenrirSkillPaths(cwd, cwd, path);

          expect(skills.map((skill) => skill.name)).toEqual(["grill-me"]);
          expect(
            yield* fs.exists(path.join(statePaths.generalSkillsDir, "grill-me", "skill.md")),
          ).toBe(true);
          expect(
            yield* fs.exists(
              path.join(statePaths.generalSkillsDir, "grill-me", "references", "notes.md"),
            ),
          ).toBe(true);

          yield* fs.writeFileString(
            path.join(cwd, ".fenrir", "skills", "grill-me", "skill.md"),
            `---
name: grill-me
displayName: Grill Me
description: Mutated legacy copy
enabled: true
tags: []
---

Mutated legacy body.
`,
          );

          const svc2 = yield* makeTestService(cwd);
          const migrated = yield* svc2.getByName("grill-me");
          expect(migrated.body).toBe("Legacy body.");
        }),
    );
  });

  describe("setActiveProjectRoot", () => {
    it.effect("switches projects without touching workspace .fenrir/skills", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const projectA = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-project-a-" });
        const projectB = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-project-b-" });

        const svc = yield* makeTestService(projectA);
        yield* svc.create(GRILL_ME);

        const projectAPaths = getFenrirSkillPaths(projectA, projectA, path);
        expect(
          yield* fs.exists(path.join(projectAPaths.generalSkillsDir, "grill-me", "skill.md")),
        ).toBe(true);
        expect(
          yield* fs.exists(path.join(projectA, ".fenrir", "skills", "grill-me", "skill.md")),
        ).toBe(false);

        yield* svc.setActiveProjectRoot(projectB);
        yield* svc.create(CODE_REVIEW);

        const projectBPaths = getFenrirSkillPaths(projectB, projectA, path);
        expect(
          yield* fs.exists(path.join(projectBPaths.generalSkillsDir, "code-review", "skill.md")),
        ).toBe(true);
        expect(
          yield* fs.exists(path.join(projectB, ".fenrir", "skills", "code-review", "skill.md")),
        ).toBe(false);

        const activeSkills = yield* svc.getAll;
        expect(activeSkills.map((skill) => skill.name)).toEqual(["code-review"]);

        const storedProjectASkills = yield* scanSkillNames(projectAPaths.generalSkillsDir);
        const storedProjectBSkills = yield* scanSkillNames(projectBPaths.generalSkillsDir);
        expect(storedProjectASkills).toEqual(["grill-me"]);
        expect(storedProjectBSkills).toEqual(["code-review"]);
      }),
    );

    it.effect("switches a started service to the new project state before subsequent writes", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const projectA = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-project-a-" });
          const projectB = yield* fs.makeTempDirectoryScoped({ prefix: "skill-svc-project-b-" });

          const svc = yield* makeTestService(projectA);
          yield* svc.start;
          yield* svc.create(GRILL_ME);
          yield* svc.setActiveProjectRoot(projectB);
          yield* svc.create(CODE_REVIEW);

          const projectAPaths = getFenrirSkillPaths(projectA, projectA, path);
          const projectBPaths = getFenrirSkillPaths(projectB, projectA, path);

          expect(
            yield* fs.exists(path.join(projectAPaths.generalSkillsDir, "grill-me", "skill.md")),
          ).toBe(true);
          expect(
            yield* fs.exists(path.join(projectAPaths.generalSkillsDir, "code-review", "skill.md")),
          ).toBe(false);
          expect(
            yield* fs.exists(path.join(projectBPaths.generalSkillsDir, "code-review", "skill.md")),
          ).toBe(true);

          const activeSkills = yield* svc.getAll;
          expect(activeSkills.map((skill) => skill.name)).toEqual(["code-review"]);
        }),
      ),
    );
  });
});
