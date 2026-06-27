import type { EnvironmentId, EnvironmentApi } from "@fenrir/contracts";

import type { WsRpcClient } from "./rpc/wsRpcClient";
import { readEnvironmentConnection } from "./environments/runtime";

export function createEnvironmentApi(rpcClient: WsRpcClient): EnvironmentApi {
  return {
    server: {
      listProviderSkills: rpcClient.server.listProviderSkills,
    },
    terminal: {
      open: (input) => rpcClient.terminal.open(input as never),
      write: (input) => rpcClient.terminal.write(input as never),
      resize: (input) => rpcClient.terminal.resize(input as never),
      clear: (input) => rpcClient.terminal.clear(input as never),
      restart: (input) => rpcClient.terminal.restart(input as never),
      close: (input) => rpcClient.terminal.close(input as never),
      onEvent: (callback) => rpcClient.terminal.onEvent(callback),
      attachTmux: (input) => rpcClient.terminal.attachTmux(input),
      detachTmux: (input) => rpcClient.terminal.detachTmux(input),
      writeTmux: (input) => rpcClient.terminal.writeTmux(input),
      resizeTmux: (input) => rpcClient.terminal.resizeTmux(input),
    },
    rawTcp: {
      createListener: (input) => rpcClient.rawTcp.createListener(input),
      stopListener: (input) => rpcClient.rawTcp.stopListener(input),
      listListeners: () => rpcClient.rawTcp.listListeners().then((list) => [...list]),
      listSessions: () => rpcClient.rawTcp.listSessions().then((list) => [...list]),
      sessionWrite: (input) => rpcClient.rawTcp.sessionWrite(input),
      sessionUpgradePty: (input) => rpcClient.rawTcp.sessionUpgradePty(input),
      sessionClose: (input) => rpcClient.rawTcp.sessionClose(input),
      onEvent: (callback) => rpcClient.rawTcp.onEvent(callback),
    },
    remoteController: {
      listHosts: () => rpcClient.remoteController.listHosts().then((list) => [...list]),
      createHost: (input) => rpcClient.remoteController.createHost(input),
      updateHost: (input) => rpcClient.remoteController.updateHost(input),
      deleteHost: (input) => rpcClient.remoteController.deleteHost(input),
      startConnection: (input) => rpcClient.remoteController.startConnection(input),
      stopConnection: (input) => rpcClient.remoteController.stopConnection(input),
      setConnectionPath: (input) => rpcClient.remoteController.setConnectionPath(input),
      listConnections: () => rpcClient.remoteController.listConnections().then((list) => [...list]),
      sendCommand: (input) => rpcClient.remoteController.sendCommand(input),
      listCommandRuns: (input) =>
        rpcClient.remoteController.listCommandRuns(input).then((list) => [...list]),
      listDirectory: (input) => rpcClient.remoteController.listDirectory(input),
      onEvent: (callback) => rpcClient.remoteController.onEvent(callback),
    },
    projects: {
      listEntries: rpcClient.projects.listEntries,
      searchEntries: rpcClient.projects.searchEntries,
      readFile: rpcClient.projects.readFile,
      writeFile: rpcClient.projects.writeFile,
      createFile: rpcClient.projects.createFile,
      createDirectory: rpcClient.projects.createDirectory,
      removeEntry: rpcClient.projects.removeEntry,
      moveEntry: rpcClient.projects.moveEntry,
      copyEntry: rpcClient.projects.copyEntry,
    },
    filesystem: {
      browse: rpcClient.filesystem.browse,
    },
    sourceControl: {
      lookupRepository: rpcClient.sourceControl.lookupRepository,
      cloneRepository: rpcClient.sourceControl.cloneRepository,
      publishRepository: rpcClient.sourceControl.publishRepository,
      stack: rpcClient.sourceControl.stack as EnvironmentApi["sourceControl"]["stack"],
    },
    vcs: {
      pull: rpcClient.vcs.pull,
      refreshStatus: rpcClient.vcs.refreshStatus,
      onStatus: (input, callback, options) => rpcClient.vcs.onStatus(input, callback, options),
      listRefs: rpcClient.vcs.listRefs,
      createWorktree: rpcClient.vcs.createWorktree,
      removeWorktree: rpcClient.vcs.removeWorktree,
      createRef: rpcClient.vcs.createRef,
      switchRef: rpcClient.vcs.switchRef,
      init: rpcClient.vcs.init,
    },
    git: {
      runStackedAction: rpcClient.git.runStackedAction,
      resolvePullRequest: rpcClient.git.resolvePullRequest,
      preparePullRequestThread: rpcClient.git.preparePullRequestThread,
    },
    gitDiff: {
      listRepositories: rpcClient.gitDiff.listRepositories,
      loadChangeSignature: rpcClient.gitDiff.loadChangeSignature,
      loadFile: rpcClient.gitDiff.loadFile,
      loadFileIndex: rpcClient.gitDiff.loadFileIndex,
      loadActiveChangeRequestStackedFileIndex:
        rpcClient.gitDiff.loadActiveChangeRequestStackedFileIndex,
      loadStackedFileIndex: rpcClient.gitDiff.loadStackedFileIndex,
      loadHistory: rpcClient.gitDiff.loadHistory,
      loadIgnoreLists: rpcClient.gitDiff.loadIgnoreLists,
      createIgnoreList: rpcClient.gitDiff.createIgnoreList,
      updateIgnoreList: rpcClient.gitDiff.updateIgnoreList,
      deleteIgnoreList: rpcClient.gitDiff.deleteIgnoreList,
      loadReviewNotes: rpcClient.gitDiff.loadReviewNotes,
      createReviewNote: rpcClient.gitDiff.createReviewNote,
      deleteReviewNote: rpcClient.gitDiff.deleteReviewNote,
      updateReviewSession: rpcClient.gitDiff.updateReviewSession,
      loadReviewSession: rpcClient.gitDiff.loadReviewSession,
      requestReviewNavigation: rpcClient.gitDiff.requestReviewNavigation,
      stageWorktreeChanges: rpcClient.gitDiff.stageWorktreeChanges,
      unstageStagedChanges: rpcClient.gitDiff.unstageStagedChanges,
      discardWorktreeChanges: rpcClient.gitDiff.discardWorktreeChanges,
      discardWorktreeHunk: rpcClient.gitDiff.discardWorktreeHunk,
      amendStagedChanges: rpcClient.gitDiff.amendStagedChanges,
      revertCommit: rpcClient.gitDiff.revertCommit,
      cherryPickCommit: rpcClient.gitDiff.cherryPickCommit,
      loadOperation: rpcClient.gitDiff.loadOperation,
      continueOperation: rpcClient.gitDiff.continueOperation,
      abortOperation: rpcClient.gitDiff.abortOperation,
      loadStashes: rpcClient.gitDiff.loadStashes,
      createStash: rpcClient.gitDiff.createStash,
      applyStash: rpcClient.gitDiff.applyStash,
      popStash: rpcClient.gitDiff.popStash,
      dropStash: rpcClient.gitDiff.dropStash,
      closeChangeRequest: rpcClient.gitDiff.closeChangeRequest,
      mergeChangeRequest: rpcClient.gitDiff.mergeChangeRequest,
      loadChangeRequestChecks: rpcClient.gitDiff.loadChangeRequestChecks,
      loadChangeRequestReviewThreads: rpcClient.gitDiff.loadChangeRequestReviewThreads,
      commentChangeRequestLines: rpcClient.gitDiff.commentChangeRequestLines,
      revertChangeRequestLines: rpcClient.gitDiff.revertChangeRequestLines,
    },
    workflows: {
      createDraft: rpcClient.workflows.createDraft,
      listThread: rpcClient.workflows.listThread,
      listProjectWorkflows: rpcClient.workflows.listProjectWorkflows,
      listThreadLinks: rpcClient.workflows.listThreadLinks,
      linkThread: rpcClient.workflows.linkThread,
      unlinkThread: rpcClient.workflows.unlinkThread,
      openSource: rpcClient.workflows.openSource,
      syncSource: rpcClient.workflows.syncSource,
      validate: rpcClient.workflows.validate,
      archive: rpcClient.workflows.archive,
      run: rpcClient.workflows.run,
      scheduleRun: rpcClient.workflows.scheduleRun,
      cancelScheduledRun: rpcClient.workflows.cancelScheduledRun,
      stop: rpcClient.workflows.stop,
      respondToInput: rpcClient.workflows.respondToInput,
      getRun: rpcClient.workflows.getRun,
      getTimeline: rpcClient.workflows.getTimeline,
      listMemory: rpcClient.workflows.listMemory,
      suppressMemoryItem: rpcClient.workflows.suppressMemoryItem,
      onEvent: (callback) => rpcClient.workflows.onEvent(callback),
    },
    orchestration: {
      getArchivedShellSnapshot: rpcClient.orchestration.getArchivedShellSnapshot,
      subscribeShell: (callback, options) =>
        rpcClient.orchestration.subscribeShell(callback, options),
      subscribeManagedProcesses: (callback, options) =>
        rpcClient.orchestration.subscribeManagedProcesses(callback, options),
      getThreadSnapshot: ({ threadId }) => rpcClient.orchestration.getThreadSnapshot({ threadId }),
      getSnapshot: rpcClient.orchestration.getSnapshot,
      dispatchCommand: rpcClient.orchestration.dispatchCommand,
      getTurnDiff: rpcClient.orchestration.getTurnDiff,
      getFullThreadDiff: rpcClient.orchestration.getFullThreadDiff,
      replayEvents: (fromSequenceExclusive) =>
        rpcClient.orchestration
          .replayEvents({ fromSequenceExclusive })
          .then((events) => [...events]),
      onDomainEvent: (callback, options) =>
        rpcClient.orchestration.onDomainEvent(callback, options),
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
  return connection ? createEnvironmentApi(connection.client) : undefined;
}

export function ensureEnvironmentApi(environmentId: EnvironmentId): EnvironmentApi {
  const api = readEnvironmentApi(environmentId);
  if (!api) {
    throw new Error(`Environment API not found for environment ${environmentId}`);
  }
  return api;
}
