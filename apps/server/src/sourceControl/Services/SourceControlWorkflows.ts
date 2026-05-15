import { ServiceMap } from "effect";

import type { GitCoreShape } from "../../git/Services/GitCore.ts";
import type { GitManagerShape } from "../../git/Services/GitManager.ts";

export interface SourceControlWorkflowsShape {
  readonly pullCurrentBranch: GitCoreShape["pullCurrentBranch"];
  readonly createWorktree: GitCoreShape["createWorktree"];
  readonly removeWorktree: GitCoreShape["removeWorktree"];
  readonly renameBranch: GitCoreShape["renameBranch"];
  readonly createBranch: GitCoreShape["createBranch"];
  readonly checkoutBranch: GitCoreShape["checkoutBranch"];
  readonly initRepo: GitCoreShape["initRepo"];
  readonly runStackedAction: GitManagerShape["runStackedAction"];
  readonly resolvePullRequest: GitManagerShape["resolvePullRequest"];
  readonly preparePullRequestThread: GitManagerShape["preparePullRequestThread"];
}

export class SourceControlWorkflows extends ServiceMap.Service<
  SourceControlWorkflows,
  SourceControlWorkflowsShape
>()("fenrir/sourceControl/Services/SourceControlWorkflows") {}
