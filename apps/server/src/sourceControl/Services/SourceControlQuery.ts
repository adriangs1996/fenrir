import { Context } from "effect";

import type { GitCoreShape } from "../../git/Services/GitCore.ts";

export interface SourceControlQueryShape {
  readonly listBranches: GitCoreShape["listBranches"];
  readonly listLocalBranchNames: GitCoreShape["listLocalBranchNames"];
}

export class SourceControlQuery extends Context.Service<
  SourceControlQuery,
  SourceControlQueryShape
>()("fenrir/sourceControl/Services/SourceControlQuery") {}
