import { Effect, Queue, Stream } from "effect";

import { type RemoteControllerEvent, WS_METHODS } from "@fenrir/contracts";

import { RemoteControllerService } from "../../puppeteer/Services/RemoteControllerService";
import { makeControlPlaneDomain } from "../controlPlane";

export const makeRemoteControllerRoutes = Effect.gen(function* () {
  const remoteControllerService = yield* RemoteControllerService;

  const remoteController = makeControlPlaneDomain("remoteController");

  return {
    [WS_METHODS.remoteControllerListHosts]: remoteController.effect(
      WS_METHODS.remoteControllerListHosts,
      (_input) => remoteControllerService.listHosts(),
    ),
    [WS_METHODS.remoteControllerCreateHost]: remoteController.effect(
      WS_METHODS.remoteControllerCreateHost,
      (input) => remoteControllerService.createHost(input),
    ),
    [WS_METHODS.remoteControllerUpdateHost]: remoteController.effect(
      WS_METHODS.remoteControllerUpdateHost,
      (input) => remoteControllerService.updateHost(input),
    ),
    [WS_METHODS.remoteControllerDeleteHost]: remoteController.effect(
      WS_METHODS.remoteControllerDeleteHost,
      (input) => remoteControllerService.deleteHost(input),
    ),
    [WS_METHODS.remoteControllerStartConnection]: remoteController.effect(
      WS_METHODS.remoteControllerStartConnection,
      (input) => remoteControllerService.startConnection(input),
    ),
    [WS_METHODS.remoteControllerStopConnection]: remoteController.effect(
      WS_METHODS.remoteControllerStopConnection,
      (input) => remoteControllerService.stopConnection(input),
    ),
    [WS_METHODS.remoteControllerSetConnectionPath]: remoteController.effect(
      WS_METHODS.remoteControllerSetConnectionPath,
      (input) => remoteControllerService.setConnectionPath(input),
    ),
    [WS_METHODS.remoteControllerListConnections]: remoteController.effect(
      WS_METHODS.remoteControllerListConnections,
      (_input) => remoteControllerService.listConnections(),
    ),
    [WS_METHODS.remoteControllerSendCommand]: remoteController.effect(
      WS_METHODS.remoteControllerSendCommand,
      (input) => remoteControllerService.sendCommand(input),
    ),
    [WS_METHODS.remoteControllerListCommandRuns]: remoteController.effect(
      WS_METHODS.remoteControllerListCommandRuns,
      (input) => remoteControllerService.listCommandRuns(input),
    ),
    [WS_METHODS.remoteControllerListDirectory]: remoteController.effect(
      WS_METHODS.remoteControllerListDirectory,
      (input) => remoteControllerService.listDirectory(input),
    ),
    [WS_METHODS.subscribeRemoteControllerEvents]: remoteController.stream(
      WS_METHODS.subscribeRemoteControllerEvents,
      (_input) =>
        Stream.callback<RemoteControllerEvent>((queue) =>
          Effect.acquireRelease(
            remoteControllerService.subscribe((event) => {
              Queue.offerUnsafe(queue, event);
            }),
            (unsubscribe) => Effect.sync(unsubscribe),
          ),
        ),
    ),
  };
});
