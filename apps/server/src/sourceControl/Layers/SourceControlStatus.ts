import { Effect, Layer } from "effect";

import { GitStatusBroadcasterLive } from "../../git/Layers/GitStatusBroadcaster.ts";
import { GitStatusBroadcaster } from "../../git/Services/GitStatusBroadcaster.ts";
import {
  SourceControlStatus,
  type SourceControlStatusShape,
} from "../Services/SourceControlStatus.ts";

const makeSourceControlStatus = Effect.gen(function* () {
  const gitStatusBroadcaster = yield* GitStatusBroadcaster;

  const getStatus: SourceControlStatusShape["getStatus"] = (input) =>
    gitStatusBroadcaster.getStatus(input);
  const refreshLocalStatus: SourceControlStatusShape["refreshLocalStatus"] = (cwd) =>
    gitStatusBroadcaster.refreshLocalStatus(cwd);
  const refreshStatus: SourceControlStatusShape["refreshStatus"] = (cwd) =>
    gitStatusBroadcaster.refreshStatus(cwd);
  const streamStatus: SourceControlStatusShape["streamStatus"] = (input) =>
    gitStatusBroadcaster.streamStatus(input);

  return SourceControlStatus.of({
    getStatus,
    refreshLocalStatus,
    refreshStatus,
    streamStatus,
  });
});

export const SourceControlStatusLive = Layer.effect(
  SourceControlStatus,
  makeSourceControlStatus,
).pipe(Layer.provide(GitStatusBroadcasterLive));
