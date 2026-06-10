import { Effect, Stream } from "effect";

import { WS_METHODS } from "@fenrir/contracts";

import { SourceControlStackService } from "../../sourceControl/stack/Services/SourceControlStackService";
import type { SourceControlStackServiceShape } from "../../sourceControl/stack/Services/SourceControlStackService";
import { makeRpcDomainWithErrors } from "../handlers";
import { toSourceControlStackRpcError } from "../rpcErrors";

const withStackService = <A, E, R>(
  f: (stackService: SourceControlStackServiceShape) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const stackService = yield* SourceControlStackService;
    return yield* f(stackService);
  });

const stack = makeRpcDomainWithErrors("source-control-stack", toSourceControlStackRpcError);

// The stack service is resolved lazily inside each handler (via
// `withStackService`), so this route slice is a plain record rather than an
// Effect resolving services up-front.
export const sourceControlStackRoutes = {
  [WS_METHODS.sourceControlStackGetSnapshot]: stack.effect(
    WS_METHODS.sourceControlStackGetSnapshot,
    (input) => withStackService((stackService) => stackService.getSnapshot(input)),
  ),
  [WS_METHODS.sourceControlStackCreateEntry]: stack.effect(
    WS_METHODS.sourceControlStackCreateEntry,
    (input) => withStackService((stackService) => stackService.createEntry(input)),
  ),
  [WS_METHODS.sourceControlStackSwitchEntry]: stack.effect(
    WS_METHODS.sourceControlStackSwitchEntry,
    (input) => withStackService((stackService) => stackService.switchEntry(input)),
  ),
  [WS_METHODS.sourceControlStackRenameEntry]: stack.effect(
    WS_METHODS.sourceControlStackRenameEntry,
    (input) => withStackService((stackService) => stackService.renameEntry(input)),
  ),
  [WS_METHODS.sourceControlStackDropEntry]: stack.effect(
    WS_METHODS.sourceControlStackDropEntry,
    (input) => withStackService((stackService) => stackService.dropEntry(input)),
  ),
  [WS_METHODS.sourceControlStackReorderEntries]: stack.effect(
    WS_METHODS.sourceControlStackReorderEntries,
    (input) => withStackService((stackService) => stackService.reorderEntries(input)),
  ),
  [WS_METHODS.sourceControlStackRestack]: stack.effect(
    WS_METHODS.sourceControlStackRestack,
    (input) => withStackService((stackService) => stackService.restack(input)),
  ),
  [WS_METHODS.sourceControlStackSync]: stack.effect(WS_METHODS.sourceControlStackSync, (input) =>
    withStackService((stackService) => stackService.sync(input)),
  ),
  [WS_METHODS.sourceControlStackSquashEntry]: stack.effect(
    WS_METHODS.sourceControlStackSquashEntry,
    (input) => withStackService((stackService) => stackService.squashEntry(input)),
  ),
  [WS_METHODS.sourceControlStackSplitEntry]: stack.effect(
    WS_METHODS.sourceControlStackSplitEntry,
    (input) => withStackService((stackService) => stackService.splitEntry(input)),
  ),
  [WS_METHODS.sourceControlStackPublish]: stack.effect(
    WS_METHODS.sourceControlStackPublish,
    (input) => withStackService((stackService) => stackService.publish(input)),
  ),
  [WS_METHODS.sourceControlStackContinueOperation]: stack.effect(
    WS_METHODS.sourceControlStackContinueOperation,
    (input) => withStackService((stackService) => stackService.continueOperation(input)),
  ),
  [WS_METHODS.sourceControlStackAbortOperation]: stack.effect(
    WS_METHODS.sourceControlStackAbortOperation,
    (input) => withStackService((stackService) => stackService.abortOperation(input)),
  ),
  [WS_METHODS.subscribeSourceControlStackEvents]: stack.stream(
    WS_METHODS.subscribeSourceControlStackEvents,
    (input) =>
      withStackService((stackService) =>
        Effect.succeed(
          stackService.streamEvents(input).pipe(Stream.mapError(toSourceControlStackRpcError)),
        ),
      ).pipe(Stream.unwrap),
  ),
};
