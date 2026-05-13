import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import type { ServerProviderSkill } from "@fenrir/contracts";

import { makeCodexSkillAdapter } from "./CodexSkillAdapter.ts";

const SKILL: ServerProviderSkill = {
  name: "openai-docs",
  displayName: "OpenAI Docs",
  description: "Use official OpenAI documentation",
  body: "Read the official docs before answering.",
  tags: [],
  enabled: true,
  syncStatus: [],
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

it.layer(NodeServices.layer)("CodexSkillAdapter", (it) => {
  describe("classifyRelativePath", () => {
    it.effect("marks agents/** as codex-specific", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "fenrir-codex-adapter-" });
        const adapter = yield* makeCodexSkillAdapter(tempDir);

        expect(adapter.classifyRelativePath("agents/openai.yaml")).toEqual({
          kind: "providerSpecific",
          provider: "codex",
        });
        expect(adapter.classifyRelativePath("scripts/bootstrap.sh")).toEqual({ kind: "general" });
      }),
    );
  });

  describe("writeSkillProjection", () => {
    it.effect("writes SKILL.md and preserves Codex support folders", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "fenrir-codex-adapter-" });
        const adapter = yield* makeCodexSkillAdapter(tempDir);

        yield* adapter.writeSkillProjection({
          skill: SKILL,
          files: [
            {
              relativePath: "scripts/fetch.sh",
              bytes: new TextEncoder().encode("#!/bin/sh\necho fetch\n"),
              executable: true,
              scope: { kind: "general" },
            },
            {
              relativePath: "references/api.md",
              bytes: new TextEncoder().encode("API reference\n"),
              executable: false,
              scope: { kind: "general" },
            },
            {
              relativePath: "agents/openai.yaml",
              bytes: new TextEncoder().encode("interface:\n  display_name: OpenAI Docs\n"),
              executable: false,
              scope: { kind: "providerSpecific", provider: "codex" },
            },
          ],
        });

        const skillDir = path.join(tempDir, ".agents", "skills", "openai-docs");
        expect(yield* fs.exists(path.join(skillDir, "SKILL.md"))).toBe(true);
        expect(yield* fs.exists(path.join(skillDir, "scripts", "fetch.sh"))).toBe(true);
        expect(yield* fs.exists(path.join(skillDir, "references", "api.md"))).toBe(true);
        expect(yield* fs.exists(path.join(skillDir, "agents", "openai.yaml"))).toBe(true);
      }),
    );
  });

  describe("readProviderSkillFolders", () => {
    it.effect("reads recursive skill folders and classifies agents/** as provider-specific", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "fenrir-codex-adapter-" });
        const skillDir = path.join(tempDir, ".agents", "skills", "openai-docs");

        yield* fs.makeDirectory(path.join(skillDir, "agents"), { recursive: true });
        yield* fs.makeDirectory(path.join(skillDir, "scripts"), { recursive: true });
        yield* fs.writeFileString(
          path.join(skillDir, "SKILL.md"),
          `---\nname: openai-docs\ndescription: Use official docs\n---\n\nRead the docs.\n`,
        );
        yield* fs.writeFileString(path.join(skillDir, "agents", "openai.yaml"), "interface: {}\n");
        yield* fs.writeFileString(path.join(skillDir, "scripts", "fetch.sh"), "#!/bin/sh\n");
        yield* fs.writeFileString(path.join(skillDir, ".secret"), "ignore");

        const adapter = yield* makeCodexSkillAdapter(tempDir);
        const folders = yield* adapter.readProviderSkillFolders();

        expect(folders).toHaveLength(1);
        expect(folders[0]?.files.map((file) => [file.relativePath, file.scope])).toEqual([
          ["agents/openai.yaml", { kind: "providerSpecific", provider: "codex" }],
          ["scripts/fetch.sh", { kind: "general" }],
        ]);
      }),
    );
  });
});
