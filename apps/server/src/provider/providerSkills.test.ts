import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { ServerSettingsService } from "../serverSettings.ts";
import { listProviderSkills } from "./providerSkills.ts";

const makeTempDir = Effect.acquireRelease(
  Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "fenrir-provider-skills-"))),
  (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })),
);

it.layer(Layer.mergeAll(NodeServices.layer, ServerSettingsService.layerTest()))(
  "providerSkills",
  (it) => {
    it.effect("lists Claude project skills for the requested cwd", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir;
        const skillDir = path.join(cwd, ".claude", "skills", "repo-review");
        const skillPath = path.join(skillDir, "SKILL.md");
        yield* Effect.promise(() => fs.mkdir(skillDir, { recursive: true }));
        yield* Effect.promise(() =>
          fs.writeFile(
            skillPath,
            `---
name: repo-review
displayName: Repo Review
description: Review this repository.
shortDescription: Review repo changes.
---

Use repository-specific review guidance.
`,
            "utf8",
          ),
        );

        const result = yield* listProviderSkills({
          provider: "claudeAgent",
          cwd,
        });
        const projectSkill = result.skills.find(
          (skill) => skill.name === "repo-review" && skill.scope === "project",
        );

        assert.ok(projectSkill);
        assert.strictEqual(projectSkill.path, skillPath);
        assert.strictEqual(projectSkill.displayName, "Repo Review");
        assert.strictEqual(projectSkill.shortDescription, "Review repo changes.");
      }).pipe(Effect.scoped),
    );
  },
);
