import type {
  GitDiffFileSummary,
  LoadDiffFileIndexInput,
} from "@fenrir/contracts";
import { Effect, Layer } from "effect";

import { GitCore } from "../Services/GitCore.ts";
import { GitDiffCore } from "../Services/GitDiffCore.ts";

function buildDiffArgs(input: LoadDiffFileIndexInput): ReadonlyArray<string> {
  const args = ["diff", "--numstat", "-z", "--raw"];
  if (input.detectRenames) {
    args.push("--find-renames");
  }
  if (input.detectCopies) {
    args.push("--find-copies");
  }
  if (input.target.kind === "staged") {
    args.push("--cached");
  }
  return args;
}

function parseNumstat(stdout: string): ReadonlyArray<GitDiffFileSummary> {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [insertionsText = "0", deletionsText = "0", path = ""] =
        line.split("\t");
      const binary = insertionsText === "-" || deletionsText === "-";
      return {
        path,
        previousPath: null,
        insertions: binary ? 0 : Number(insertionsText),
        deletions: binary ? 0 : Number(deletionsText),
        binary,
      };
    });
}

export const GitDiffCoreLive = Layer.effect(
  GitDiffCore,
  Effect.gen(function* () {
    const gitCore = yield* GitCore;

    return GitDiffCore.of({
      loadDiffFileIndex: (input) =>
        gitCore
          .execute({
            operation: "GitDiffCore.loadDiffFileIndex",
            cwd: input.cwd,
            args: buildDiffArgs(input),
          })
          .pipe(Effect.map((result) => parseNumstat(result.stdout))),
    });
  }),
);
