import type { GitDiffFileSummary, LoadDiffFileIndexInput } from "@fenrir/contracts";
import { Effect, Layer } from "effect";

import { GitCore } from "../Services/GitCore.ts";
import { GitDiffCore } from "../Services/GitDiffCore.ts";

function buildDiffArgs(input: LoadDiffFileIndexInput): ReadonlyArray<string> {
  const args = ["diff", "--numstat", "-z"];
  if (input.detectRenames) {
    args.push("--find-renames");
  }
  if (input.detectCopies) {
    args.push("--find-copies");
  }
  if (input.target.kind === "staged") {
    args.push("--cached");
  }
  if (input.target.kind === "range") {
    args.push(`${input.target.baseRef}...${input.target.headRef}`);
  }
  return args;
}

function parseNumstat(stdout: string): ReadonlyArray<GitDiffFileSummary> {
  const tokens = stdout.split("\0");
  const summaries: GitDiffFileSummary[] = [];

  for (let index = 0; index < tokens.length; ) {
    const header = tokens[index++];
    if (!header) {
      continue;
    }

    const firstTab = header.indexOf("\t");
    const secondTab = firstTab === -1 ? -1 : header.indexOf("\t", firstTab + 1);
    if (firstTab === -1 || secondTab === -1) {
      continue;
    }

    const insertionsText = header.slice(0, firstTab);
    const deletionsText = header.slice(firstTab + 1, secondTab);
    const inlinePath = header.slice(secondTab + 1);
    const previousPath = inlinePath.length === 0 ? (tokens[index++] ?? "") : null;
    const path = inlinePath.length === 0 ? (tokens[index++] ?? "") : inlinePath;
    if (path.length === 0) {
      continue;
    }

    const binary = insertionsText === "-" || deletionsText === "-";
    summaries.push({
      path,
      previousPath: previousPath && previousPath.length > 0 ? previousPath : null,
      insertions: binary ? 0 : Number(insertionsText),
      deletions: binary ? 0 : Number(deletionsText),
      binary,
    });
  }

  return summaries;
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
