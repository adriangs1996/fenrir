import { Layer } from "effect";

import { SourceControlLive } from "./Layers/SourceControl.ts";
import { SourceControlQueryLive } from "./Layers/SourceControlQuery.ts";
import { SourceControlStatusLive } from "./Layers/SourceControlStatus.ts";
import { SourceControlWorkflowsLive } from "./Layers/SourceControlWorkflows.ts";
import * as AzureDevOpsCli from "./AzureDevOpsCli.ts";
import * as BitbucketApi from "./BitbucketApi.ts";
import * as GitHubCli from "./GitHubCli.ts";
import * as GitLabCli from "./GitLabCli.ts";
import * as SourceControlDiscovery from "./SourceControlDiscovery.ts";
import * as SourceControlProviderRegistry from "./SourceControlProviderRegistry.ts";
import * as SourceControlRepositoryService from "./SourceControlRepositoryService.ts";
import { GitVcsDriverLive } from "../vcs/GitVcsDriver.ts";
import { VcsDriverRegistryLive } from "../vcs/VcsDriverRegistry.ts";
import { VcsProcessLive } from "../vcs/VcsProcess.ts";

export const SourceControlWorkspaceLive = SourceControlLive;

const SourceControlProviderToolsLive = Layer.empty.pipe(
  Layer.provideMerge(GitHubCli.layer),
  Layer.provideMerge(GitLabCli.layer),
  Layer.provideMerge(AzureDevOpsCli.layer),
  Layer.provideMerge(BitbucketApi.layer),
  Layer.provideMerge(VcsProcessLive),
  Layer.provideMerge(VcsDriverRegistryLive),
);

const SourceControlProviderRegistryLive = SourceControlProviderRegistry.layer.pipe(
  Layer.provideMerge(SourceControlProviderToolsLive),
);

const SourceControlDiscoveryLive = SourceControlDiscovery.layer.pipe(
  Layer.provideMerge(SourceControlProviderRegistryLive),
  Layer.provideMerge(VcsProcessLive),
);

const SourceControlRepositoryServiceLive = SourceControlRepositoryService.layer.pipe(
  Layer.provideMerge(SourceControlProviderRegistryLive),
  Layer.provideMerge(GitVcsDriverLive),
);

export const SourceControlModuleLive = Layer.empty.pipe(
  Layer.provideMerge(SourceControlWorkspaceLive),
  Layer.provideMerge(SourceControlQueryLive),
  Layer.provideMerge(SourceControlStatusLive),
  Layer.provideMerge(SourceControlWorkflowsLive),
  Layer.provideMerge(SourceControlProviderRegistryLive),
  Layer.provideMerge(SourceControlDiscoveryLive),
  Layer.provideMerge(SourceControlRepositoryServiceLive),
);
