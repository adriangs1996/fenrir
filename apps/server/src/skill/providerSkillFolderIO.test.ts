import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import { readSkillFolderFiles, writeSkillFolderProjection } from "./providerSkillFolderIO.ts";

it.layer(NodeServices.layer)("providerSkillFolderIO", (it) => {
  describe("readSkillFolderFiles", () => {
    it.effect(
      "reads recursive files, excludes hidden paths and symlinks, and preserves executables",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const skillDir = yield* fs.makeTempDirectoryScoped({ prefix: "skill-folder-io-" });

          yield* fs.makeDirectory(path.join(skillDir, "scripts"), { recursive: true });
          yield* fs.makeDirectory(path.join(skillDir, ".hidden-dir"), { recursive: true });
          yield* fs.writeFileString(
            path.join(skillDir, "scripts", "run.sh"),
            "#!/bin/sh\necho ok\n",
          );
          yield* fs.writeFileString(path.join(skillDir, ".hidden"), "ignore");
          yield* fs.writeFileString(path.join(skillDir, ".hidden-dir", "secret.txt"), "ignore");
          yield* fs.chmod(path.join(skillDir, "scripts", "run.sh"), 0o755);
          yield* fs.symlink(
            path.join(skillDir, "scripts", "run.sh"),
            path.join(skillDir, "linked.sh"),
          );

          const files = yield* readSkillFolderFiles(skillDir, () => ({ kind: "general" }));

          expect(files).toHaveLength(1);
          expect(files[0]).toMatchObject({
            relativePath: "scripts/run.sh",
            executable: true,
            scope: { kind: "general" },
          });
        }),
    );
  });

  describe("writeSkillFolderProjection", () => {
    it.effect("writes recursive folders and preserves executable bits", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const skillDir = yield* fs.makeTempDirectoryScoped({ prefix: "skill-folder-io-" });

        yield* writeSkillFolderProjection({
          skillDir,
          files: [
            {
              relativePath: "scripts/run.sh",
              bytes: new TextEncoder().encode("#!/bin/sh\necho ok\n"),
              executable: true,
              scope: { kind: "general" },
            },
            {
              relativePath: "references/guide.md",
              bytes: "guide\n",
              executable: false,
              scope: { kind: "general" },
            },
          ],
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
        );

        expect(yield* fs.readFileString(path.join(skillDir, "references", "guide.md"))).toBe(
          "guide\n",
        );
        expect((yield* fs.stat(path.join(skillDir, "scripts", "run.sh"))).mode & 0o111).not.toBe(0);
      }),
    );

    it.effect("rejects unsafe relative paths", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const skillDir = yield* fs.makeTempDirectoryScoped({ prefix: "skill-folder-io-" });

        const exit = yield* writeSkillFolderProjection({
          skillDir,
          files: [
            {
              relativePath: "../escape.sh",
              bytes: "nope\n",
              executable: false,
              scope: { kind: "general" },
            },
          ],
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.exit,
        );

        expect(exit._tag).toBe("Failure");
        expect(yield* fs.exists(path.join(path.dirname(skillDir), "escape.sh"))).toBe(false);
      }),
    );
  });
});
