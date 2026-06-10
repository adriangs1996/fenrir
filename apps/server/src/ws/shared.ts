import { Effect } from "effect";

import { CommandId } from "@fenrir/contracts";

import { VcsStatusBroadcaster } from "../vcs/VcsStatusBroadcaster";

export const serverCommandId = (tag: string): CommandId =>
  CommandId.make(`server:${tag}:${crypto.randomUUID()}`);

/** Fire-and-forget VCS status refresh shared by the vcs/git-diff/orchestration routes. */
export type RefreshGitStatus = (cwd: string) => Effect.Effect<void>;

export const makeRefreshGitStatus: Effect.Effect<RefreshGitStatus, never, VcsStatusBroadcaster> =
  Effect.gen(function* () {
    const vcsStatusBroadcaster = yield* VcsStatusBroadcaster;
    return (cwd: string) =>
      vcsStatusBroadcaster
        .refreshStatus(cwd)
        .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid);
  });
