import type { EnvironmentId, EnvironmentApi } from "@fenrir/contracts";

import type { WsRpcClient } from "./rpc/wsRpcClient";
import { readEnvironmentConnection, requireEnvironmentConnection } from "./environments/runtime";

type EnvironmentClientResolver = WsRpcClient | (() => WsRpcClient);
type SourceControlStackApi = EnvironmentApi["sourceControl"]["stack"];

function createEnvironmentClientResolver(
  rpcClientOrResolver: EnvironmentClientResolver,
): () => WsRpcClient {
  if (typeof rpcClientOrResolver === "function") {
    return rpcClientOrResolver;
  }
  return () => rpcClientOrResolver;
}

export function createEnvironmentApi(
  rpcClientOrResolver: EnvironmentClientResolver,
): EnvironmentApi {
  const resolveClient = createEnvironmentClientResolver(rpcClientOrResolver);

  return {
    server: {
      listProviderSkills: (input) => resolveClient().server.listProviderSkills(input),
    },
    terminal: {
      open: (input) => resolveClient().terminal.open(input as never),
      write: (input) => resolveClient().terminal.write(input as never),
      resize: (input) => resolveClient().terminal.resize(input as never),
      clear: (input) => resolveClient().terminal.clear(input as never),
      restart: (input) => resolveClient().terminal.restart(input as never),
      close: (input) => resolveClient().terminal.close(input as never),
      onEvent: (callback) => resolveClient().terminal.onEvent(callback),
      attachTmux: (input) => resolveClient().terminal.attachTmux(input),
      detachTmux: (input) => resolveClient().terminal.detachTmux(input),
      writeTmux: (input) => resolveClient().terminal.writeTmux(input),
      resizeTmux: (input) => resolveClient().terminal.resizeTmux(input),
    },
    rawTcp: {
      createListener: (input) => resolveClient().rawTcp.createListener(input),
      stopListener: (input) => resolveClient().rawTcp.stopListener(input),
      listListeners: () =>
        resolveClient()
          .rawTcp.listListeners()
          .then((list) => [...list]),
      listSessions: () =>
        resolveClient()
          .rawTcp.listSessions()
          .then((list) => [...list]),
      sessionWrite: (input) => resolveClient().rawTcp.sessionWrite(input),
      sessionUpgradePty: (input) => resolveClient().rawTcp.sessionUpgradePty(input),
      sessionClose: (input) => resolveClient().rawTcp.sessionClose(input),
      onEvent: (callback) => resolveClient().rawTcp.onEvent(callback),
    },
    remoteController: {
      listHosts: () =>
        resolveClient()
          .remoteController.listHosts()
          .then((list) => [...list]),
      createHost: (input) => resolveClient().remoteController.createHost(input),
      updateHost: (input) => resolveClient().remoteController.updateHost(input),
      deleteHost: (input) => resolveClient().remoteController.deleteHost(input),
      startConnection: (input) => resolveClient().remoteController.startConnection(input),
      stopConnection: (input) => resolveClient().remoteController.stopConnection(input),
      setConnectionPath: (input) => resolveClient().remoteController.setConnectionPath(input),
      listConnections: () =>
        resolveClient()
          .remoteController.listConnections()
          .then((list) => [...list]),
      sendCommand: (input) => resolveClient().remoteController.sendCommand(input),
      listCommandRuns: (input) =>
        resolveClient()
          .remoteController.listCommandRuns(input)
          .then((list) => [...list]),
      listDirectory: (input) => resolveClient().remoteController.listDirectory(input),
      onEvent: (callback) => resolveClient().remoteController.onEvent(callback),
    },
    projects: {
      listEntries: (input) => resolveClient().projects.listEntries(input),
      searchEntries: (input) => resolveClient().projects.searchEntries(input),
      readFile: (input) => resolveClient().projects.readFile(input),
      writeFile: (input) => resolveClient().projects.writeFile(input),
      createFile: (input) => resolveClient().projects.createFile(input),
      createDirectory: (input) => resolveClient().projects.createDirectory(input),
      removeEntry: (input) => resolveClient().projects.removeEntry(input),
      moveEntry: (input) => resolveClient().projects.moveEntry(input),
      copyEntry: (input) => resolveClient().projects.copyEntry(input),
    },
    filesystem: {
      browse: (input) => resolveClient().filesystem.browse(input),
    },
    sourceControl: {
      lookupRepository: (input) => resolveClient().sourceControl.lookupRepository(input),
      cloneRepository: (input) => resolveClient().sourceControl.cloneRepository(input),
      publishRepository: (input) => resolveClient().sourceControl.publishRepository(input),
      stack: {
        getSnapshot: (input) =>
          resolveClient().sourceControl.stack.getSnapshot(input) as ReturnType<
            SourceControlStackApi["getSnapshot"]
          >,
        createEntry: (input) =>
          resolveClient().sourceControl.stack.createEntry(input) as ReturnType<
            SourceControlStackApi["createEntry"]
          >,
        switchEntry: (input) =>
          resolveClient().sourceControl.stack.switchEntry(input) as ReturnType<
            SourceControlStackApi["switchEntry"]
          >,
        renameEntry: (input) =>
          resolveClient().sourceControl.stack.renameEntry(input) as ReturnType<
            SourceControlStackApi["renameEntry"]
          >,
        dropEntry: (input) =>
          resolveClient().sourceControl.stack.dropEntry(input) as ReturnType<
            SourceControlStackApi["dropEntry"]
          >,
        reorderEntries: (input) =>
          resolveClient().sourceControl.stack.reorderEntries(input) as ReturnType<
            SourceControlStackApi["reorderEntries"]
          >,
        restack: (input) =>
          resolveClient().sourceControl.stack.restack(input) as ReturnType<
            SourceControlStackApi["restack"]
          >,
        sync: (input) =>
          resolveClient().sourceControl.stack.sync(input) as ReturnType<
            SourceControlStackApi["sync"]
          >,
        squashEntry: (input) =>
          resolveClient().sourceControl.stack.squashEntry(input) as ReturnType<
            SourceControlStackApi["squashEntry"]
          >,
        splitEntry: (input) =>
          resolveClient().sourceControl.stack.splitEntry(input) as ReturnType<
            SourceControlStackApi["splitEntry"]
          >,
        publish: (input) =>
          resolveClient().sourceControl.stack.publish(input) as ReturnType<
            SourceControlStackApi["publish"]
          >,
        continueOperation: (input) =>
          resolveClient().sourceControl.stack.continueOperation(input) as ReturnType<
            SourceControlStackApi["continueOperation"]
          >,
        abortOperation: (input) =>
          resolveClient().sourceControl.stack.abortOperation(input) as ReturnType<
            SourceControlStackApi["abortOperation"]
          >,
        onEvent: (input, callback, options) =>
          resolveClient().sourceControl.stack.onEvent(input, callback as never, options),
      } satisfies SourceControlStackApi,
    },
    vcs: {
      pull: (input) => resolveClient().vcs.pull(input),
      refreshStatus: (input) => resolveClient().vcs.refreshStatus(input),
      onStatus: (input, callback, options) =>
        resolveClient().vcs.onStatus(input, callback, options),
      listRefs: (input) => resolveClient().vcs.listRefs(input),
      createWorktree: (input) => resolveClient().vcs.createWorktree(input),
      removeWorktree: (input) => resolveClient().vcs.removeWorktree(input),
      createRef: (input) => resolveClient().vcs.createRef(input),
      switchRef: (input) => resolveClient().vcs.switchRef(input),
      init: (input) => resolveClient().vcs.init(input),
    },
    git: {
      runStackedAction: (input, options) => resolveClient().git.runStackedAction(input, options),
      resolvePullRequest: (input) => resolveClient().git.resolvePullRequest(input),
      preparePullRequestThread: (input) => resolveClient().git.preparePullRequestThread(input),
    },
    gitDiff: {
      listRepositories: (input) => resolveClient().gitDiff.listRepositories(input),
      loadChangeSignature: (input) => resolveClient().gitDiff.loadChangeSignature(input),
      loadFile: (input) => resolveClient().gitDiff.loadFile(input),
      loadFileIndex: (input) => resolveClient().gitDiff.loadFileIndex(input),
      loadActiveChangeRequestStackedFileIndex: (input) =>
        resolveClient().gitDiff.loadActiveChangeRequestStackedFileIndex(input),
      loadStackedFileIndex: (input) => resolveClient().gitDiff.loadStackedFileIndex(input),
      loadHistory: (input) => resolveClient().gitDiff.loadHistory(input),
      loadIgnoreLists: (input) => resolveClient().gitDiff.loadIgnoreLists(input),
      createIgnoreList: (input) => resolveClient().gitDiff.createIgnoreList(input),
      updateIgnoreList: (input) => resolveClient().gitDiff.updateIgnoreList(input),
      deleteIgnoreList: (input) => resolveClient().gitDiff.deleteIgnoreList(input),
      loadReviewNotes: (input) => resolveClient().gitDiff.loadReviewNotes(input),
      createReviewNote: (input) => resolveClient().gitDiff.createReviewNote(input),
      deleteReviewNote: (input) => resolveClient().gitDiff.deleteReviewNote(input),
      updateReviewSession: (input) => resolveClient().gitDiff.updateReviewSession(input),
      loadReviewSession: (input) => resolveClient().gitDiff.loadReviewSession(input),
      requestReviewNavigation: (input) => resolveClient().gitDiff.requestReviewNavigation(input),
      stageWorktreeChanges: (input) => resolveClient().gitDiff.stageWorktreeChanges(input),
      unstageStagedChanges: (input) => resolveClient().gitDiff.unstageStagedChanges(input),
      discardWorktreeChanges: (input) => resolveClient().gitDiff.discardWorktreeChanges(input),
      discardWorktreeHunk: (input) => resolveClient().gitDiff.discardWorktreeHunk(input),
      amendStagedChanges: (input) => resolveClient().gitDiff.amendStagedChanges(input),
      revertCommit: (input) => resolveClient().gitDiff.revertCommit(input),
      cherryPickCommit: (input) => resolveClient().gitDiff.cherryPickCommit(input),
      loadOperation: (input) => resolveClient().gitDiff.loadOperation(input),
      continueOperation: (input) => resolveClient().gitDiff.continueOperation(input),
      abortOperation: (input) => resolveClient().gitDiff.abortOperation(input),
      loadStashes: (input) => resolveClient().gitDiff.loadStashes(input),
      createStash: (input) => resolveClient().gitDiff.createStash(input),
      applyStash: (input) => resolveClient().gitDiff.applyStash(input),
      popStash: (input) => resolveClient().gitDiff.popStash(input),
      dropStash: (input) => resolveClient().gitDiff.dropStash(input),
      closeChangeRequest: (input) => resolveClient().gitDiff.closeChangeRequest(input),
      mergeChangeRequest: (input) => resolveClient().gitDiff.mergeChangeRequest(input),
      loadChangeRequestChecks: (input) => resolveClient().gitDiff.loadChangeRequestChecks(input),
      loadChangeRequestReviewThreads: (input) =>
        resolveClient().gitDiff.loadChangeRequestReviewThreads(input),
      commentChangeRequestLines: (input) =>
        resolveClient().gitDiff.commentChangeRequestLines(input),
      revertChangeRequestLines: (input) => resolveClient().gitDiff.revertChangeRequestLines(input),
    },
    workflows: {
      createDraft: (input) => resolveClient().workflows.createDraft(input),
      listThread: (input) => resolveClient().workflows.listThread(input),
      listProjectWorkflows: (input) => resolveClient().workflows.listProjectWorkflows(input),
      listThreadLinks: (input) => resolveClient().workflows.listThreadLinks(input),
      linkThread: (input) => resolveClient().workflows.linkThread(input),
      unlinkThread: (input) => resolveClient().workflows.unlinkThread(input),
      openSource: (input) => resolveClient().workflows.openSource(input),
      syncSource: (input) => resolveClient().workflows.syncSource(input),
      validate: (input) => resolveClient().workflows.validate(input),
      archive: (input) => resolveClient().workflows.archive(input),
      run: (input) => resolveClient().workflows.run(input),
      scheduleRun: (input) => resolveClient().workflows.scheduleRun(input),
      cancelScheduledRun: (input) => resolveClient().workflows.cancelScheduledRun(input),
      stop: (input) => resolveClient().workflows.stop(input),
      respondToInput: (input) => resolveClient().workflows.respondToInput(input),
      getRun: (input) => resolveClient().workflows.getRun(input),
      getTimeline: (input) => resolveClient().workflows.getTimeline(input),
      listMemory: (input) => resolveClient().workflows.listMemory(input),
      suppressMemoryItem: (input) => resolveClient().workflows.suppressMemoryItem(input),
      onEvent: (callback) => resolveClient().workflows.onEvent(callback),
    },
    orchestration: {
      getArchivedShellSnapshot: () => resolveClient().orchestration.getArchivedShellSnapshot(),
      subscribeShell: (callback, options) =>
        resolveClient().orchestration.subscribeShell(callback, options),
      subscribeManagedProcesses: (callback, options) =>
        resolveClient().orchestration.subscribeManagedProcesses(callback, options),
      getThreadSnapshot: ({ threadId }) =>
        resolveClient().orchestration.getThreadSnapshot({ threadId }),
      getSnapshot: () => resolveClient().orchestration.getSnapshot(),
      dispatchCommand: (input) => resolveClient().orchestration.dispatchCommand(input),
      getTurnDiff: (input) => resolveClient().orchestration.getTurnDiff(input),
      getFullThreadDiff: (input) => resolveClient().orchestration.getFullThreadDiff(input),
      replayEvents: (fromSequenceExclusive) =>
        resolveClient()
          .orchestration.replayEvents({ fromSequenceExclusive })
          .then((events) => [...events]),
      onDomainEvent: (callback, options) =>
        resolveClient().orchestration.onDomainEvent(callback, options),
    },
  };
}

export function readEnvironmentApi(environmentId: EnvironmentId): EnvironmentApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  if (!environmentId) {
    return undefined;
  }

  const connection = readEnvironmentConnection(environmentId);
  return connection
    ? createEnvironmentApi(() => requireEnvironmentConnection(environmentId).client)
    : undefined;
}

export function ensureEnvironmentApi(environmentId: EnvironmentId): EnvironmentApi {
  const api = readEnvironmentApi(environmentId);
  if (!api) {
    throw new Error(`Environment API not found for environment ${environmentId}`);
  }
  return api;
}
