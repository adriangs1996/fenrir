import { Layer } from "effect";

import { SourceControlLive } from "./Layers/SourceControl.ts";
import { SourceControlQueryLive } from "./Layers/SourceControlQuery.ts";
import { SourceControlStatusLive } from "./Layers/SourceControlStatus.ts";
import { SourceControlWorkflowsLive } from "./Layers/SourceControlWorkflows.ts";

export const SourceControlWorkspaceLive = SourceControlLive;

export const SourceControlModuleLive = Layer.empty.pipe(
  Layer.provideMerge(SourceControlWorkspaceLive),
  Layer.provideMerge(SourceControlQueryLive),
  Layer.provideMerge(SourceControlStatusLive),
  Layer.provideMerge(SourceControlWorkflowsLive),
);
