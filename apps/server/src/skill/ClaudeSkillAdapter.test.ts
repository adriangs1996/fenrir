import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import type { ServerProviderSkill } from "@fenrir/contracts";

import { makeClaudeSkillAdapter } from "./ClaudeSkillAdapter.ts";

const SKILL: ServerProviderSkill = {
  name: "grill-me",
  displayName: "Grill Me",
  description: "Interview the user relentlessly about a plan or design",
  body: "Interview me relentlessly about every aspect of this plan.",
  tags: ["planning"],
  enabled: true,
  syncStatus: [],
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

it.layer(NodeServices.layer)("ClaudeSkillAdapter", (it) => {
  describe("writeSkillProjection", () => {
    it.effect("writes SKILL.md plus recursive support files", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "fenrir-claude-adapter-" });

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        yield* adapter.writeSkillProjection({
          skill: SKILL,
          files: [
            {
              relativePath: "scripts/check.sh",
              bytes: new TextEncoder().encode("#!/bin/sh\necho ok\n"),
              executable: true,
              scope: { kind: "general" },
            },
            {
              relativePath: "references/guide.md",
              bytes: new TextEncoder().encode("Reference\n"),
              executable: false,
              scope: { kind: "general" },
            },
          ],
        });

        const skillDir = path.join(tempDir, ".claude", "skills", "grill-me");
        expect(yield* fs.exists(path.join(skillDir, "SKILL.md"))).toBe(true);
        expect(yield* fs.exists(path.join(skillDir, "scripts", "check.sh"))).toBe(true);
        expect(yield* fs.exists(path.join(skillDir, "references", "guide.md"))).toBe(true);

        const contents = yield* fs.readFileString(path.join(skillDir, "SKILL.md"));
        expect(contents).toContain("name: grill-me");
        expect(contents).toContain(SKILL.body);

        const mode = (yield* fs.stat(path.join(skillDir, "scripts", "check.sh"))).mode & 0o111;
        expect(mode).not.toBe(0);
      }),
    );
  });

  describe("readProviderSkillFolders", () => {
    it.effect("reads recursive folders, enriches frontmatter, and ignores hidden files", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "fenrir-claude-adapter-" });
        const skillDir = path.join(tempDir, ".claude", "skills", "grill-me");

        yield* fs.makeDirectory(path.join(skillDir, "scripts"), { recursive: true });
        yield* fs.writeFileString(
          path.join(skillDir, "SKILL.md"),
          `---\nname: grill-me\ndescription: Interview relentlessly\n---\n\nInterview me.\n`,
        );
        yield* fs.writeFileString(path.join(skillDir, "scripts", "check.sh"), "#!/bin/sh\n");
        yield* fs.writeFileString(path.join(skillDir, ".hidden"), "ignore");

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        const folders = yield* adapter.readProviderSkillFolders();

        expect(folders).toHaveLength(1);
        expect(folders[0]?.entry.frontmatter.displayName).toBe("Grill Me");
        expect(folders[0]?.files.map((file) => file.relativePath)).toEqual(["scripts/check.sh"]);
        expect(folders[0]?.files[0]?.scope).toEqual({ kind: "general" });
      }),
    );

    it.effect("ignores symlinks safely", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "fenrir-claude-adapter-" });
        const skillDir = path.join(tempDir, ".claude", "skills", "grill-me");

        yield* fs.makeDirectory(skillDir, { recursive: true });
        yield* fs.writeFileString(
          path.join(skillDir, "SKILL.md"),
          `---\nname: grill-me\ndescription: Interview relentlessly\n---\n\nInterview me.\n`,
        );
        yield* fs.symlink(path.join(tempDir, "outside"), path.join(skillDir, "linked"));

        const adapter = yield* makeClaudeSkillAdapter(tempDir);
        const folders = yield* adapter.readProviderSkillFolders();

        expect(folders).toHaveLength(1);
        expect(folders[0]?.files).toEqual([]);
      }),
    );
  });
});
