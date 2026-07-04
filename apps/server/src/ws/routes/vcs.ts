import { Effect, Queue, Stream } from "effect";

import {
  DEFAULT_AUTOMATIC_GIT_FETCH_INTERVAL,
  type GitActionProgressEvent,
  type GitManagerServiceError,
  WS_METHODS,
} from "@fenrir/contracts";

import { GitWorkflowService } from "../../git/Services/GitWorkflowService";
import { WorkspaceGitProbe } from "../../git/Services/WorkspaceGitProbe";
import { ServerSettingsService } from "../../serverSettings";
import { VcsProvisioningService } from "../../vcs/VcsProvisioningService";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster";
import { makeRpcDomain } from "../handlers";
import type { RefreshGitStatus } from "../shared";

export const makeVcsRoutes = (deps: { readonly refreshGitStatus: RefreshGitStatus }) =>
  Effect.gen(function* () {
    const { refreshGitStatus } = deps;
    const gitWorkflow = yield* GitWorkflowService;
    const workspaceGitProbe = yield* WorkspaceGitProbe;
    const vcsProvisioning = yield* VcsProvisioningService;
    const vcsStatusBroadcaster = yield* VcsStatusBroadcaster;
    const serverSettings = yield* ServerSettingsService;

    const automaticGitFetchInterval = serverSettings.getSettings.pipe(
      Effect.map((settings) => settings.automaticGitFetchInterval),
      Effect.catch((cause) =>
        Effect.logWarning("Failed to read automatic Git fetch interval setting", {
          detail: cause instanceof Error ? cause.message : String(cause),
        }).pipe(Effect.as(DEFAULT_AUTOMATIC_GIT_FETCH_INTERVAL)),
      ),
    );

    const sourceControl = makeRpcDomain("source-control");
    const git = makeRpcDomain("git");

    return {
      [WS_METHODS.subscribeVcsStatus]: sourceControl.stream(
        WS_METHODS.subscribeVcsStatus,
        (input) =>
          vcsStatusBroadcaster.streamStatus(input, {
            automaticRemoteRefreshInterval: automaticGitFetchInterval,
          }),
      ),
      [WS_METHODS.vcsRefreshStatus]: sourceControl.effect(WS_METHODS.vcsRefreshStatus, (input) =>
        vcsStatusBroadcaster.refreshStatus(input.cwd),
      ),
      [WS_METHODS.vcsPull]: sourceControl.effect(WS_METHODS.vcsPull, (input) =>
        gitWorkflow
          .pullCurrentBranch(input.cwd)
          .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
      ),
      [WS_METHODS.vcsListRefs]: sourceControl.effect(WS_METHODS.vcsListRefs, (input) =>
        gitWorkflow.listRefs(input),
      ),
      [WS_METHODS.vcsCreateWorktree]: sourceControl.effect(WS_METHODS.vcsCreateWorktree, (input) =>
        gitWorkflow.createWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
      ),
      [WS_METHODS.vcsRemoveWorktree]: sourceControl.effect(WS_METHODS.vcsRemoveWorktree, (input) =>
        gitWorkflow.removeWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
      ),
      [WS_METHODS.vcsCreateRef]: sourceControl.effect(WS_METHODS.vcsCreateRef, (input) =>
        gitWorkflow.createRef(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
      ),
      [WS_METHODS.vcsSwitchRef]: sourceControl.effect(WS_METHODS.vcsSwitchRef, (input) =>
        gitWorkflow.switchRef(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
      ),
      [WS_METHODS.vcsInit]: sourceControl.effect(WS_METHODS.vcsInit, (input) =>
        vcsProvisioning.initRepository(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
      ),
      [WS_METHODS.gitRunStackedAction]: git.stream(WS_METHODS.gitRunStackedAction, (input) =>
        Stream.callback<GitActionProgressEvent, GitManagerServiceError>((queue) =>
          gitWorkflow
            .runStackedAction(input, {
              actionId: input.actionId,
              progressReporter: {
                publish: (event) => Queue.offer(queue, event).pipe(Effect.asVoid),
              },
            })
            .pipe(
              Effect.matchCauseEffect({
                onFailure: (cause) => Queue.failCause(queue, cause),
                onSuccess: () =>
                  refreshGitStatus(input.cwd).pipe(
                    Effect.andThen(Queue.end(queue).pipe(Effect.asVoid)),
                  ),
              }),
            ),
        ),
      ),
      [WS_METHODS.gitResolvePullRequest]: git.effect(WS_METHODS.gitResolvePullRequest, (input) =>
        gitWorkflow.resolvePullRequest(input),
      ),
      [WS_METHODS.gitPreparePullRequestThread]: git.effect(
        WS_METHODS.gitPreparePullRequestThread,
        (input) =>
          gitWorkflow
            .preparePullRequestThread(input)
            .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
      ),
      // D-045 sidebar row metadata: branch + PR number/state/checks. Served
      // from a short-TTL server-side cache; clients poll this instead of
      // shelling out to `git`/`gh` or scraping panes.
      [WS_METHODS.workspaceGitProbe]: git.effect(WS_METHODS.workspaceGitProbe, (input) =>
        workspaceGitProbe.probe(input),
      ),
    };
  });
