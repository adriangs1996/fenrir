import { Effect, Layer } from "effect";

import { GitCore } from "../../git/Services/GitCore.ts";
import {
  SourceControlQuery,
  type SourceControlQueryShape,
} from "../Services/SourceControlQuery.ts";

const makeSourceControlQuery = Effect.gen(function* () {
  const git = yield* GitCore;

  const listBranches: SourceControlQueryShape["listBranches"] = (input) => git.listBranches(input);
  const listLocalBranchNames: SourceControlQueryShape["listLocalBranchNames"] = (cwd) =>
    git.listLocalBranchNames(cwd);

  return SourceControlQuery.of({
    listBranches,
    listLocalBranchNames,
  });
});

export const SourceControlQueryLive = Layer.effect(SourceControlQuery, makeSourceControlQuery);
