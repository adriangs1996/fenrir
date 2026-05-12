import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Path } from "effect";

import {
  decodeSkillProjectKey,
  encodeSkillProjectKey,
  getProjectSkillStatePaths,
  normalizeWorkspaceRoot,
} from "./projectSkillStatePaths.ts";

it.layer(NodeServices.layer)("projectSkillStatePaths", (it) => {
  describe("encodeSkillProjectKey", () => {
    it.effect("round-trips a normalized workspace root exactly", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const workspaceRoot = "/tmp/fenrir/project-a";
        const normalized = normalizeWorkspaceRoot(workspaceRoot, path);

        const projectKey = encodeSkillProjectKey(workspaceRoot, path);
        const decoded = decodeSkillProjectKey(projectKey);

        expect(decoded.workspaceRoot).toBe(normalized);
      }),
    );

    it.effect("produces different keys for distinct worktrees with the same repo name", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const repoA = "/tmp/worktrees/repo";
        const repoB = "/var/tmp/other/repo";

        const keyA = encodeSkillProjectKey(repoA, path);
        const keyB = encodeSkillProjectKey(repoB, path);

        expect(keyA).not.toBe(keyB);
        expect(decodeSkillProjectKey(keyA).workspaceRoot).toBe(normalizeWorkspaceRoot(repoA, path));
        expect(decodeSkillProjectKey(keyB).workspaceRoot).toBe(normalizeWorkspaceRoot(repoB, path));
      }),
    );

    it.effect("keeps project keys path-safe", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const projectKey = encodeSkillProjectKey("/tmp/path with spaces/repo", path);

        expect(projectKey).toMatch(/^[A-Za-z0-9_-]+$/);
      }),
    );
  });

  describe("getProjectSkillStatePaths", () => {
    it.effect("derives per-project skill-state paths under server state", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const stateDir = "/tmp/fenrir-home/userdata";
        const workspaceRoot = "/tmp/dev/repo";

        const paths = getProjectSkillStatePaths({ stateDir, workspaceRoot, path });

        expect(paths.projectRootStateDir).toBe(path.join(stateDir, "projects", paths.projectKey));
        expect(paths.skillsRootDir).toBe(path.join(paths.projectRootStateDir, "skills"));
        expect(paths.generalSkillsDir).toBe(path.join(paths.skillsRootDir, "general"));
        expect(paths.providerSkillsDir).toBe(path.join(paths.skillsRootDir, "providers"));
        expect(paths.skillIndexDir).toBe(path.join(paths.skillsRootDir, "index"));
        expect(paths.projectMetadataPath).toBe(path.join(paths.skillsRootDir, "project.json"));
      }),
    );
  });
});
