import * as NodeServices from "@effect/platform-node/NodeServices";
import { ServerConfig } from "../../config";
import { GitCoreLive } from "./GitCore";
import { GitDiffCoreLive } from "./GitDiffCore";
import { GitDiffCore } from "../Services/GitDiffCore";
import { execFileSync } from "child_process";
import { Effect, Layer } from "effect";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { describe, it } from "@effect/vitest";
import { tmpdir } from "os";
import path from "path";
import { expect } from "vitest";

const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "fenrir-git-diff-core-test",
});

const TestLayer = GitDiffCoreLive.pipe(
  Layer.provide(GitCoreLive),
  Layer.provide(ServerConfigLayer),
  Layer.provide(NodeServices.layer),
);

const git = (cwd: string, ...args: string[]) => {
  execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Fenrir",
      GIT_AUTHOR_EMAIL: "fenrir@test.com",
      GIT_COMMITTER_NAME: "Fenrir",
      GIT_COMMITTER_EMAIL: "fenrir@test.com",
    },
  });
};

function writeFile(cwd: string, relativePath: string, content: string) {
  const filePath = path.join(cwd, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function makeRepo() {
  const cwd = mkdtempSync(path.join(tmpdir(), "fenrir-git-diff-core-"));

  git(cwd, "init", "-b", "main");
  writeFile(cwd, "src/file.txt", "one\ntwo\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "initial");

  git(cwd, "checkout", "-b", "feature/test");
  writeFile(cwd, "src/file.txt", "one\ntwo\nthree\n");
  writeFile(cwd, "src/staged.txt", "staged\n");
  git(cwd, "add", "src/staged.txt");

  return cwd;
}

function makeCommittedRepo(files: Record<string, string>) {
  const cwd = mkdtempSync(path.join(tmpdir(), "fenrir-git-diff-core-"));

  git(cwd, "init", "-b", "main");
  for (const [relativePath, content] of Object.entries(files)) {
    writeFile(cwd, relativePath, content);
  }
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "initial");

  return cwd;
}

function makeStackedRepo() {
  const cwd = makeCommittedRepo({
    "src/base.txt": "base\n",
  });

  git(cwd, "checkout", "-b", "feature/parent");
  writeFile(cwd, "src/parent-only.txt", "parent\n");
  writeFile(cwd, "src/shared.txt", "shared from parent\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "parent stack item");

  git(cwd, "checkout", "-b", "feature/child");
  writeFile(cwd, "src/child-only.txt", "child\n");
  writeFile(cwd, "src/shared.txt", "shared from child\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "child stack item");

  git(cwd, "checkout", "feature/parent");
  writeFile(cwd, "src/parent-followup.txt", "parent followup\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "parent followup");

  git(cwd, "checkout", "feature/child");

  return cwd;
}

function byPath<T extends { readonly path: string }>(files: ReadonlyArray<T>) {
  return files.toSorted((left, right) => left.path.localeCompare(right.path));
}

describe("GitDiffCoreLive", () => {
  it.layer(TestLayer)("loads unstaged file summaries from a real git repo", (it) => {
    it.effect("returns changed files without patch text", () =>
      Effect.gen(function* () {
        const cwd = makeRepo();

        try {
          const gitDiff = yield* GitDiffCore;
          const files = yield* gitDiff.loadDiffFileIndex({
            cwd,
            target: { kind: "worktree" },
            detectRenames: true,
            detectCopies: true,
          });

          expect(files).toEqual([
            expect.objectContaining({
              path: "src/file.txt",
              previousPath: null,
              insertions: 1,
              deletions: 0,
              binary: false,
            }),
          ]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("counts multiline replacements as insertions and deletions", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({
          "src/file.txt": "one\ntwo\nthree\nfour\n",
        });

        try {
          writeFile(cwd, "src/file.txt", "one\nTWO\nTHREE\nfour\n");

          const gitDiff = yield* GitDiffCore;
          const files = yield* gitDiff.loadDiffFileIndex({
            cwd,
            target: { kind: "worktree" },
            detectRenames: true,
            detectCopies: true,
          });

          expect(files).toEqual([
            expect.objectContaining({
              path: "src/file.txt",
              previousPath: null,
              insertions: 2,
              deletions: 2,
              binary: false,
            }),
          ]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("counts line removals as deletions only", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({
          "src/file.txt": "one\ntwo\nthree\n",
        });

        try {
          writeFile(cwd, "src/file.txt", "one\nthree\n");

          const gitDiff = yield* GitDiffCore;
          const files = yield* gitDiff.loadDiffFileIndex({
            cwd,
            target: { kind: "worktree" },
            detectRenames: true,
            detectCopies: true,
          });

          expect(files).toEqual([
            expect.objectContaining({
              path: "src/file.txt",
              previousPath: null,
              insertions: 0,
              deletions: 1,
              binary: false,
            }),
          ]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("returns summaries for multiple changed files", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({
          "src/alpha.txt": "alpha\n",
          "src/beta.txt": "one\ntwo\n",
        });

        try {
          writeFile(cwd, "src/alpha.txt", "alpha\nnext\n");
          writeFile(cwd, "src/beta.txt", "one\n");

          const gitDiff = yield* GitDiffCore;
          const files = yield* gitDiff.loadDiffFileIndex({
            cwd,
            target: { kind: "worktree" },
            detectRenames: true,
            detectCopies: true,
          });

          expect(byPath(files)).toEqual([
            expect.objectContaining({
              path: "src/alpha.txt",
              insertions: 1,
              deletions: 0,
              binary: false,
            }),
            expect.objectContaining({
              path: "src/beta.txt",
              insertions: 0,
              deletions: 1,
              binary: false,
            }),
          ]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("reports a staged rename with previousPath", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({
          "src/old-name.txt": "one\ntwo\n",
        });

        try {
          git(cwd, "mv", "src/old-name.txt", "src/new-name.txt");

          const gitDiff = yield* GitDiffCore;
          const files = yield* gitDiff.loadDiffFileIndex({
            cwd,
            target: { kind: "staged" },
            detectRenames: true,
            detectCopies: true,
          });

          expect(files).toEqual([
            expect.objectContaining({
              path: "src/new-name.txt",
              previousPath: "src/old-name.txt",
              insertions: 0,
              deletions: 0,
              binary: false,
            }),
          ]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("reports a staged rename with content changes", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({
          "src/old-name.txt": "one\ntwo\n",
        });

        try {
          git(cwd, "mv", "src/old-name.txt", "src/new-name.txt");
          writeFile(cwd, "src/new-name.txt", "one\ntwo\nthree\n");
          git(cwd, "add", "src/new-name.txt");

          const gitDiff = yield* GitDiffCore;
          const files = yield* gitDiff.loadDiffFileIndex({
            cwd,
            target: { kind: "staged" },
            detectRenames: true,
            detectCopies: true,
          });

          expect(files).toEqual([
            expect.objectContaining({
              path: "src/new-name.txt",
              previousPath: "src/old-name.txt",
              insertions: 1,
              deletions: 0,
              binary: false,
            }),
          ]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("reports multiple renames alongside ordinary changed files", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({
          "src/alpha-old.txt": "alpha\n",
          "src/beta-old.txt": "beta\n",
          "src/changed.txt": "one\ntwo\n",
        });

        try {
          git(cwd, "mv", "src/alpha-old.txt", "src/alpha-new.txt");
          git(cwd, "mv", "src/beta-old.txt", "src/beta-new.txt");
          writeFile(cwd, "src/changed.txt", "one\ntwo\nthree\n");
          git(cwd, "add", "src/changed.txt");

          const gitDiff = yield* GitDiffCore;
          const files = yield* gitDiff.loadDiffFileIndex({
            cwd,
            target: { kind: "staged" },
            detectRenames: true,
            detectCopies: true,
          });

          expect(byPath(files)).toEqual([
            expect.objectContaining({
              path: "src/alpha-new.txt",
              previousPath: "src/alpha-old.txt",
              insertions: 0,
              deletions: 0,
              binary: false,
            }),
            expect.objectContaining({
              path: "src/beta-new.txt",
              previousPath: "src/beta-old.txt",
              insertions: 0,
              deletions: 0,
              binary: false,
            }),
            expect.objectContaining({
              path: "src/changed.txt",
              previousPath: null,
              insertions: 1,
              deletions: 0,
              binary: false,
            }),
          ]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("loads a stacked branch file index against its parent branch", () =>
      Effect.gen(function* () {
        const cwd = makeStackedRepo();

        try {
          const gitDiff = yield* GitDiffCore;
          const files = yield* gitDiff.loadDiffFileIndex({
            cwd,
            target: {
              kind: "range",
              baseRef: "feature/parent",
              headRef: "feature/child",
            },
            detectRenames: true,
            detectCopies: true,
          });

          expect(byPath(files)).toEqual([
            expect.objectContaining({
              path: "src/child-only.txt",
              previousPath: null,
              insertions: 1,
              deletions: 0,
              binary: false,
            }),
            expect.objectContaining({
              path: "src/shared.txt",
              previousPath: null,
              insertions: 1,
              deletions: 1,
              binary: false,
            }),
          ]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );
  });
});
