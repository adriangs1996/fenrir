import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import { makeClaudeSkillAdapter } from "./ClaudeSkillAdapter.ts";
import { makeCodexSkillAdapter } from "./CodexSkillAdapter.ts";
import { getProjectSkillStatePaths } from "./projectSkillStatePaths.ts";
import { importProviderSkills, needsInitialImport } from "./skillImport.ts";

const GRILL_ME_CONTENT = `---\nname: grill-me\ndescription: Interview relentlessly\n---\n\nInterview me relentlessly.\n`;
const CODE_REVIEW_CONTENT = `---\nname: code-review\ndescription: Review code for quality\n---\n\nReview the code carefully.\n`;
const BROKEN_CONTENT = `---\nname: [broken\n---\nbody`;

const getStatePaths = (workspaceRoot: string, path: Path.Path) =>
  getProjectSkillStatePaths({
    stateDir: path.join(workspaceRoot, "userdata"),
    workspaceRoot,
    path,
  });

const readIndex = (indexPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return JSON.parse(yield* fs.readFileString(indexPath)) as {
      readonly files: ReadonlyArray<{
        readonly relativePath: string;
        readonly scope: { readonly kind: string; readonly provider?: string };
      }>;
    };
  });

const writeClaudeSkill = (workspaceRoot: string, name: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const skillDir = path.join(workspaceRoot, ".claude", "skills", name);
    yield* fs.makeDirectory(skillDir, { recursive: true });
    yield* fs.writeFileString(path.join(skillDir, "SKILL.md"), content);
  });

const writeCodexSkill = (input: {
  readonly workspaceRoot: string;
  readonly name: string;
  readonly entryContent: string;
  readonly overlayFiles?: Record<string, string>;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const skillDir = path.join(input.workspaceRoot, ".agents", "skills", input.name);
    yield* fs.makeDirectory(skillDir, { recursive: true });
    yield* fs.writeFileString(path.join(skillDir, "SKILL.md"), input.entryContent);
    for (const [relativePath, content] of Object.entries(input.overlayFiles ?? {})) {
      const targetPath = path.join(skillDir, relativePath);
      yield* fs.makeDirectory(path.dirname(targetPath), { recursive: true });
      yield* fs.writeFileString(targetPath, content);
    }
  });

it.layer(NodeServices.layer)("skillImport", (it) => {
  describe("needsInitialImport", () => {
    it.effect("returns true when any provider exposes skills", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "skill-import-" });
        const statePaths = getStatePaths(workspaceRoot, yield* Path.Path);
        yield* writeClaudeSkill(workspaceRoot, "grill-me", GRILL_ME_CONTENT);

        const adapter = yield* makeClaudeSkillAdapter(workspaceRoot);
        expect(yield* needsInitialImport(statePaths, [adapter])).toBe(true);
      }),
    );

    it.effect("returns false when providers expose no skills", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "skill-import-" });
        const statePaths = getStatePaths(workspaceRoot, yield* Path.Path);

        const adapter = yield* makeClaudeSkillAdapter(workspaceRoot);
        expect(yield* needsInitialImport(statePaths, [adapter])).toBe(false);
      }),
    );

    it.effect("returns false when internal state already exists", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "skill-import-" });
        const statePaths = getStatePaths(workspaceRoot, path);

        yield* fs.makeDirectory(path.join(statePaths.generalSkillsDir, "grill-me"), {
          recursive: true,
        });
        yield* fs.writeFileString(
          path.join(statePaths.generalSkillsDir, "grill-me", "skill.md"),
          GRILL_ME_CONTENT,
        );

        const adapter = yield* makeClaudeSkillAdapter(workspaceRoot);
        expect(yield* needsInitialImport(statePaths, [adapter])).toBe(false);
      }),
    );
  });

  describe("importProviderSkills", () => {
    it.effect("imports provider entry files into internal general storage and writes indexes", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "skill-import-" });
        const statePaths = getStatePaths(workspaceRoot, path);

        yield* writeClaudeSkill(workspaceRoot, "grill-me", GRILL_ME_CONTENT);
        yield* writeClaudeSkill(workspaceRoot, "code-review", CODE_REVIEW_CONTENT);

        const adapter = yield* makeClaudeSkillAdapter(workspaceRoot);
        const imported = yield* importProviderSkills(statePaths, [adapter]);

        expect(imported.toSorted()).toEqual(["code-review", "grill-me"]);
        expect(
          yield* fs.exists(path.join(statePaths.generalSkillsDir, "grill-me", "skill.md")),
        ).toBe(true);
        expect(yield* fs.exists(path.join(statePaths.skillIndexDir, "grill-me.json"))).toBe(true);
      }),
    );

    it.effect("fills Fenrir defaults when importing provider entry files", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "skill-import-" });
        const statePaths = getStatePaths(workspaceRoot, path);

        yield* writeClaudeSkill(workspaceRoot, "grill-me", GRILL_ME_CONTENT);

        const adapter = yield* makeClaudeSkillAdapter(workspaceRoot);
        yield* importProviderSkills(statePaths, [adapter]);

        const content = yield* fs.readFileString(
          path.join(statePaths.generalSkillsDir, "grill-me", "skill.md"),
        );
        expect(content).toContain("displayName: Grill Me");
        expect(content).toContain("enabled: true");
        expect(content).toContain("tags: []");
      }),
    );

    it.effect("skips malformed provider entries while importing valid skills", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "skill-import-" });
        const statePaths = getStatePaths(workspaceRoot, path);

        yield* writeClaudeSkill(workspaceRoot, "grill-me", GRILL_ME_CONTENT);
        yield* writeClaudeSkill(workspaceRoot, "broken-skill", BROKEN_CONTENT);

        const adapter = yield* makeClaudeSkillAdapter(workspaceRoot);
        const imported = yield* importProviderSkills(statePaths, [adapter]);

        expect(imported).toEqual(["grill-me"]);
        expect(
          yield* fs.exists(path.join(statePaths.generalSkillsDir, "broken-skill", "skill.md")),
        ).toBe(false);
      }),
    );

    it.effect("preserves provider-specific overlay files in internal provider storage", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "skill-import-" });
        const statePaths = getStatePaths(workspaceRoot, path);

        yield* writeCodexSkill({
          workspaceRoot,
          name: "grill-me",
          entryContent: GRILL_ME_CONTENT,
          overlayFiles: {
            "agents/openai.yaml": "model: gpt-5\n",
          },
        });

        const adapter = yield* makeCodexSkillAdapter(workspaceRoot);
        const imported = yield* importProviderSkills(statePaths, [adapter]);

        expect(imported).toEqual(["grill-me"]);
        expect(
          yield* fs.exists(
            path.join(statePaths.providerSkillsDir, "codex", "grill-me", "agents", "openai.yaml"),
          ),
        ).toBe(true);
        const index = yield* readIndex(path.join(statePaths.skillIndexDir, "grill-me.json"));
        expect(index.files).toContainEqual({
          relativePath: "agents/openai.yaml",
          scope: { kind: "providerSpecific", provider: "codex" },
        });
      }),
    );

    it.effect("uses adapter priority when the same skill exists in multiple providers", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "skill-import-" });
        const statePaths = getStatePaths(workspaceRoot, path);

        yield* writeClaudeSkill(
          workspaceRoot,
          "grill-me",
          `---\nname: grill-me\ndescription: Lower priority copy\n---\n\nReview the code carefully.\n`,
        );
        yield* writeCodexSkill({
          workspaceRoot,
          name: "grill-me",
          entryContent: GRILL_ME_CONTENT,
        });

        const claudeAdapter = yield* makeClaudeSkillAdapter(workspaceRoot);
        const codexAdapter = yield* makeCodexSkillAdapter(workspaceRoot);
        const imported = yield* importProviderSkills(statePaths, [claudeAdapter, codexAdapter]);

        expect(imported).toEqual(["grill-me"]);
        const content = yield* fs.readFileString(
          path.join(statePaths.generalSkillsDir, "grill-me", "skill.md"),
        );
        expect(content).toContain("Interview me relentlessly.");
        expect(content).not.toContain("Review the code carefully.");
      }),
    );

    it.effect("deduplicates identical files from multiple providers into general storage", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "skill-import-" });
        const statePaths = getStatePaths(workspaceRoot, path);

        yield* writeCodexSkill({
          workspaceRoot,
          name: "grill-me",
          entryContent: GRILL_ME_CONTENT,
          overlayFiles: {
            "agents/shared.md": "same bytes\n",
          },
        });
        yield* writeClaudeSkill(workspaceRoot, "grill-me", GRILL_ME_CONTENT);
        yield* fs.makeDirectory(
          path.join(workspaceRoot, ".claude", "skills", "grill-me", "agents"),
          { recursive: true },
        );
        yield* fs.writeFileString(
          path.join(workspaceRoot, ".claude", "skills", "grill-me", "agents", "shared.md"),
          "same bytes\n",
        );

        const codexAdapter = yield* makeCodexSkillAdapter(workspaceRoot);
        const claudeAdapter = yield* makeClaudeSkillAdapter(workspaceRoot);
        yield* importProviderSkills(statePaths, [claudeAdapter, codexAdapter]);

        expect(
          yield* fs.exists(
            path.join(statePaths.generalSkillsDir, "grill-me", "agents", "shared.md"),
          ),
        ).toBe(true);
        expect(
          yield* fs.exists(
            path.join(statePaths.providerSkillsDir, "codex", "grill-me", "agents", "shared.md"),
          ),
        ).toBe(false);
        expect(
          yield* fs.exists(
            path.join(
              statePaths.providerSkillsDir,
              "claudeAgent",
              "grill-me",
              "agents",
              "shared.md",
            ),
          ),
        ).toBe(false);

        const index = yield* readIndex(path.join(statePaths.skillIndexDir, "grill-me.json"));
        expect(index.files).toContainEqual({
          relativePath: "agents/shared.md",
          scope: { kind: "general" },
        });
      }),
    );

    it.effect("preserves divergent files from multiple providers as provider overlays", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "skill-import-" });
        const statePaths = getStatePaths(workspaceRoot, path);

        yield* writeCodexSkill({
          workspaceRoot,
          name: "grill-me",
          entryContent: GRILL_ME_CONTENT,
          overlayFiles: {
            "agents/shared.md": "codex bytes\n",
          },
        });
        yield* writeClaudeSkill(workspaceRoot, "grill-me", GRILL_ME_CONTENT);
        yield* fs.makeDirectory(
          path.join(workspaceRoot, ".claude", "skills", "grill-me", "agents"),
          { recursive: true },
        );
        yield* fs.writeFileString(
          path.join(workspaceRoot, ".claude", "skills", "grill-me", "agents", "shared.md"),
          "claude bytes\n",
        );

        const codexAdapter = yield* makeCodexSkillAdapter(workspaceRoot);
        const claudeAdapter = yield* makeClaudeSkillAdapter(workspaceRoot);
        yield* importProviderSkills(statePaths, [claudeAdapter, codexAdapter]);

        expect(
          yield* fs.exists(
            path.join(statePaths.generalSkillsDir, "grill-me", "agents", "shared.md"),
          ),
        ).toBe(false);
        expect(
          yield* fs.exists(
            path.join(statePaths.providerSkillsDir, "codex", "grill-me", "agents", "shared.md"),
          ),
        ).toBe(true);
        expect(
          yield* fs.exists(
            path.join(
              statePaths.providerSkillsDir,
              "claudeAgent",
              "grill-me",
              "agents",
              "shared.md",
            ),
          ),
        ).toBe(true);

        const index = yield* readIndex(path.join(statePaths.skillIndexDir, "grill-me.json"));
        expect(index.files).toContainEqual({
          relativePath: "agents/shared.md",
          scope: { kind: "providerSpecific", provider: "codex" },
        });
        expect(index.files).toContainEqual({
          relativePath: "agents/shared.md",
          scope: { kind: "providerSpecific", provider: "claudeAgent" },
        });
      }),
    );
  });
});
