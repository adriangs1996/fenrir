import { Effect } from "effect";

import { WS_METHODS } from "@fenrir/contracts";

import { SourceControlDiscovery } from "../../sourceControl/SourceControlDiscovery";
import { SourceControlRepositoryService } from "../../sourceControl/SourceControlRepositoryService";
import { makeRpcDomain } from "../handlers";

export const makeSourceControlRoutes = Effect.gen(function* () {
  const sourceControlDiscovery = yield* SourceControlDiscovery;
  const sourceControlRepositoryService = yield* SourceControlRepositoryService;

  const sourceControl = makeRpcDomain("source-control");

  return {
    [WS_METHODS.serverDiscoverSourceControl]: sourceControl.effect(
      WS_METHODS.serverDiscoverSourceControl,
      (_input) => sourceControlDiscovery.discover,
    ),
    [WS_METHODS.sourceControlLookupRepository]: sourceControl.effect(
      WS_METHODS.sourceControlLookupRepository,
      (input) => sourceControlRepositoryService.lookupRepository(input),
    ),
    [WS_METHODS.sourceControlCloneRepository]: sourceControl.effect(
      WS_METHODS.sourceControlCloneRepository,
      (input) => sourceControlRepositoryService.cloneRepository(input),
    ),
    [WS_METHODS.sourceControlPublishRepository]: sourceControl.effect(
      WS_METHODS.sourceControlPublishRepository,
      (input) => sourceControlRepositoryService.publishRepository(input),
    ),
  };
});
