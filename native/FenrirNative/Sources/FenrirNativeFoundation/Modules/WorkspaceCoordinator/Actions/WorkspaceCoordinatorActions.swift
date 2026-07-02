import Foundation
import FenrirNativeShared
import WorkspaceIndex
import ServerConnection
import NativeRuntime
import PaneGrid

public extension WorkspaceCoordinator {
    struct OpenWorkspace: FenrirAction {
        public typealias Failure = WorkspaceCoordinatorError

        let index: any WorkspaceIndexCoordinating
        let serverSelector: any WorkspaceServerSelecting
        let windows: any WorkspaceWindowCoordinating
        let runtime: any WorkspaceRuntimeCoordinating
        let clock: any WorkspaceCoordinatorClock
        let events: (any WorkspaceCoordinatorEventPublishing)?

        public init(
            index: any WorkspaceIndexCoordinating,
            serverSelector: any WorkspaceServerSelecting,
            windows: any WorkspaceWindowCoordinating,
            runtime: any WorkspaceRuntimeCoordinating,
            clock: any WorkspaceCoordinatorClock,
            events: (any WorkspaceCoordinatorEventPublishing)? = nil
        ) {
            self.index = index
            self.serverSelector = serverSelector
            self.windows = windows
            self.runtime = runtime
            self.clock = clock
            self.events = events
        }

        public func run(_ input: OpenWorkspaceInput) async -> Result<OpenWorkspaceResult, WorkspaceCoordinatorError> {
            do {
                let workspace = try await index.resolveWorkspace(requestID: input.requestID, identity: input.identity)
                let timestamp = clock.now()
                await WorkspaceCoordinator.publish(input.requestID, "WorkspaceResolved", timestamp, .workspaceResolved(workspace.workspaceID), events)

                if workspace.isOpenLocally {
                    let windowID = try await windows.focusWindow(workspace: workspace)
                    try await index.markRecent(requestID: input.requestID, workspaceID: workspace.workspaceID, targetIdentity: workspace.identity)
                    await WorkspaceCoordinator.publish(input.requestID, "WorkspaceFocused", timestamp, .workspaceFocused(workspace.workspaceID), events)
                    return .success(OpenWorkspaceResult(
                        requestID: input.requestID,
                        experience: WorkspaceExperience(workspace: workspace, serverSelection: input.serverSelection, windowID: windowID),
                        didCreateWindow: false,
                        didFocusExistingWindow: true,
                        timestamp: timestamp
                    ))
                }

                let server = try await serverSelector.selectServer(input.serverSelection, workspace: workspace)
                await WorkspaceCoordinator.publish(input.requestID, "ServerSelected", timestamp, .serverSelected(workspace.workspaceID), events)
                let runtimeState: NativeRuntime.WorkspaceRuntimeState
                do {
                    runtimeState = try await runtime.attachWorkspaceRuntime(requestID: input.requestID, workspaceID: workspace.workspaceID, server: server)
                } catch {
                    await WorkspaceCoordinator.publish(input.requestID, "WorkspacePartialAttachFailed", timestamp, .workspacePartialAttachFailed(workspace.workspaceID), events)
                    return .failure(.partialAttachFailed)
                }
                await WorkspaceCoordinator.publish(input.requestID, "WorkspaceRuntimeAttached", timestamp, .workspaceRuntimeAttached(workspace.workspaceID), events)
                let windowID = try await windows.openWindow(workspace: workspace)
                let attached = try await index.attachWorkspace(requestID: input.requestID, workspaceID: workspace.workspaceID, targetIdentity: workspace.identity, windowID: windowID)
                await WorkspaceCoordinator.publish(input.requestID, "WorkspaceWindowOpened", timestamp, .workspaceWindowOpened(workspace.workspaceID, windowID), events)
                await WorkspaceCoordinator.publish(input.requestID, "WorkspaceOpened", timestamp, .workspaceOpened(workspace.workspaceID), events)
                return .success(OpenWorkspaceResult(
                    requestID: input.requestID,
                    experience: WorkspaceExperience(workspace: attached, serverSelection: input.serverSelection, windowID: windowID, runtime: runtimeState),
                    didCreateWindow: true,
                    didFocusExistingWindow: false,
                    timestamp: timestamp
                ))
            } catch let error as WorkspaceCoordinatorError {
                return .failure(error)
            } catch {
                return .failure(.resolutionFailed)
            }
        }
    }

    struct SwitchWorkspace: FenrirAction {
        public typealias Failure = WorkspaceCoordinatorError

        let index: any WorkspaceIndexCoordinating
        let windows: any WorkspaceWindowCoordinating
        let clock: any WorkspaceCoordinatorClock
        let events: (any WorkspaceCoordinatorEventPublishing)?

        public init(index: any WorkspaceIndexCoordinating, windows: any WorkspaceWindowCoordinating, clock: any WorkspaceCoordinatorClock, events: (any WorkspaceCoordinatorEventPublishing)? = nil) {
            self.index = index
            self.windows = windows
            self.clock = clock
            self.events = events
        }

        public func run(_ input: SwitchWorkspaceInput) async -> Result<SwitchWorkspaceResult, WorkspaceCoordinatorError> {
            do {
                let workspace = try await index.resolveWorkspace(requestID: input.requestID, identity: input.identity)
                guard workspace.isOpenLocally else {
                    return .failure(.notOpen)
                }
                let windowID = try await windows.focusWindow(workspace: workspace)
                try await index.markRecent(requestID: input.requestID, workspaceID: workspace.workspaceID, targetIdentity: workspace.identity)
                let timestamp = clock.now()
                await WorkspaceCoordinator.publish(input.requestID, "WorkspaceSwitched", timestamp, .workspaceSwitched(workspace.workspaceID), events)
                return .success(SwitchWorkspaceResult(requestID: input.requestID, experience: WorkspaceExperience(workspace: workspace, serverSelection: .local, windowID: windowID), timestamp: timestamp))
            } catch let error as WorkspaceCoordinatorError {
                return .failure(error)
            } catch {
                return .failure(.notFound)
            }
        }
    }

    struct CloseWorkspaceExperience: FenrirAction {
        public typealias Failure = WorkspaceCoordinatorError

        let index: any WorkspaceIndexCoordinating
        let windows: any WorkspaceWindowCoordinating
        let runtime: any WorkspaceRuntimeCoordinating
        let clock: any WorkspaceCoordinatorClock
        let events: (any WorkspaceCoordinatorEventPublishing)?

        public init(index: any WorkspaceIndexCoordinating, windows: any WorkspaceWindowCoordinating, runtime: any WorkspaceRuntimeCoordinating, clock: any WorkspaceCoordinatorClock, events: (any WorkspaceCoordinatorEventPublishing)? = nil) {
            self.index = index
            self.windows = windows
            self.runtime = runtime
            self.clock = clock
            self.events = events
        }

        public func run(_ input: CloseWorkspaceExperienceInput) async -> Result<CloseWorkspaceExperienceResult, WorkspaceCoordinatorError> {
            do {
                let target = input.targetIdentity ?? WorkspaceIndex.WorkspaceIdentity(kind: .project, workspaceID: input.workspaceID)
                let workspace = try await index.resolveWorkspace(requestID: input.requestID, identity: target)
                try await windows.closeWindow(workspace: workspace)
                try await runtime.detachWorkspaceRuntime(requestID: input.requestID, workspaceID: workspace.workspaceID, targetIdentity: workspace.identity)
                _ = try await index.detachWorkspace(requestID: input.requestID, workspaceID: workspace.workspaceID, targetIdentity: workspace.identity)
                let timestamp = clock.now()
                await WorkspaceCoordinator.publish(input.requestID, "WorkspaceClosed", timestamp, .workspaceClosed(workspace.workspaceID), events)
                return .success(CloseWorkspaceExperienceResult(requestID: input.requestID, workspaceID: workspace.workspaceID, timestamp: timestamp))
            } catch {
                return .failure(.closeFailed)
            }
        }
    }

    struct ReconnectWorkspaceExperience: FenrirAction {
        public typealias Failure = WorkspaceCoordinatorError

        let index: any WorkspaceIndexCoordinating
        let serverSelector: any WorkspaceServerSelecting
        let runtime: any WorkspaceRuntimeCoordinating
        let layoutRestorer: any WorkspaceLayoutRestoring
        let viewportRestorer: any WorkspaceViewportRestoring
        let clock: any WorkspaceCoordinatorClock
        let events: (any WorkspaceCoordinatorEventPublishing)?

        public init(
            index: any WorkspaceIndexCoordinating,
            serverSelector: any WorkspaceServerSelecting,
            runtime: any WorkspaceRuntimeCoordinating,
            layoutRestorer: any WorkspaceLayoutRestoring,
            viewportRestorer: any WorkspaceViewportRestoring,
            clock: any WorkspaceCoordinatorClock,
            events: (any WorkspaceCoordinatorEventPublishing)? = nil
        ) {
            self.index = index
            self.serverSelector = serverSelector
            self.runtime = runtime
            self.layoutRestorer = layoutRestorer
            self.viewportRestorer = viewportRestorer
            self.clock = clock
            self.events = events
        }

        public func run(_ input: ReconnectWorkspaceExperienceInput) async -> Result<ReconnectWorkspaceExperienceResult, WorkspaceCoordinatorError> {
            do {
                let workspace = try await index.resolveWorkspace(requestID: input.requestID, identity: input.identity)
                let server = try await serverSelector.selectServer(input.serverSelection, workspace: workspace)
                let runtimeProjection = try await runtime.reconnectWorkspaceRuntime(requestID: input.requestID, workspaceID: workspace.workspaceID, server: server)
                let runtimeState = runtimeProjection.workspace
                guard let snapshot = WorkspaceCoordinator.layoutSnapshot(from: runtimeState, panes: runtimeProjection.panes, workspace: workspace) else {
                    return .failure(.restoreFailed)
                }
                let restore = try await WorkspaceCoordinator.restore(requestID: input.requestID, workspace: workspace, snapshot: snapshot, layoutRestorer: layoutRestorer, viewportRestorer: viewportRestorer)
                let timestamp = clock.now()
                await WorkspaceCoordinator.publish(input.requestID, "WorkspaceReconnected", timestamp, .workspaceReconnected(workspace.workspaceID), events)
                let experience = WorkspaceExperience(workspace: workspace, serverSelection: input.serverSelection, runtime: runtimeState, layout: restore.layout, restoredPanes: restore.restoredPanes)
                return .success(ReconnectWorkspaceExperienceResult(
                    requestID: input.requestID,
                    experience: experience,
                    timestamp: timestamp
                ))
            } catch let error as WorkspaceCoordinatorError {
                return .failure(error)
            } catch {
                return .failure(.reconnectFailed)
            }
        }
    }

    struct RestoreVisiblePanes: FenrirAction {
        public typealias Failure = WorkspaceCoordinatorError

        let layoutRestorer: any WorkspaceLayoutRestoring
        let viewportRestorer: any WorkspaceViewportRestoring
        let clock: any WorkspaceCoordinatorClock
        let events: (any WorkspaceCoordinatorEventPublishing)?

        public init(layoutRestorer: any WorkspaceLayoutRestoring, viewportRestorer: any WorkspaceViewportRestoring, clock: any WorkspaceCoordinatorClock, events: (any WorkspaceCoordinatorEventPublishing)? = nil) {
            self.layoutRestorer = layoutRestorer
            self.viewportRestorer = viewportRestorer
            self.clock = clock
            self.events = events
        }

        public func run(_ input: RestoreVisiblePanesInput) async -> Result<RestoreVisiblePanesResult, WorkspaceCoordinatorError> {
            do {
                let restore = try await WorkspaceCoordinator.restore(requestID: input.requestID, workspace: input.workspace, snapshot: input.layoutSnapshot, layoutRestorer: layoutRestorer, viewportRestorer: viewportRestorer)
                let timestamp = clock.now()
                await WorkspaceCoordinator.publish(input.requestID, "VisiblePanesRestored", timestamp, .visiblePanesRestored(input.workspace.workspaceID, restore.restoredPanes.count), events)
                return .success(RestoreVisiblePanesResult(requestID: input.requestID, layout: restore.layout, restoredPanes: restore.restoredPanes, timestamp: timestamp))
            } catch {
                return .failure(.restoreFailed)
            }
        }
    }
}

extension WorkspaceCoordinator {
    static func publish(_ requestID: RequestID, _ kind: String, _ timestamp: FenrirTimestamp, _ event: Event, _ events: (any WorkspaceCoordinatorEventPublishing)?) async {
        await events?.publish(EventEnvelope(eventID: requestID, eventKind: kind, timestamp: timestamp, event: event))
    }

    static func restore(
        requestID: RequestID,
        workspace: WorkspaceIndex.WorkspaceSummary,
        snapshot: PaneGrid.SessionSnapshot,
        layoutRestorer: any WorkspaceLayoutRestoring,
        viewportRestorer: any WorkspaceViewportRestoring
    ) async throws -> (layout: PaneGrid.State, restoredPanes: [VisiblePaneRestore]) {
        let layout = try await layoutRestorer.restorePaneGrid(requestID: requestID, snapshot: snapshot)
        var restored: [VisiblePaneRestore] = []
        for paneID in layout.windows.flatMap(\.panes).map(\.paneID) {
            restored.append(try await viewportRestorer.restoreViewport(requestID: requestID, workspaceID: workspace.workspaceID, paneID: paneID))
        }
        return (layout, restored)
    }

    static func layoutSnapshot(from runtime: NativeRuntime.WorkspaceRuntimeState, panes runtimePanes: [NativeRuntime.PaneRuntimeState], workspace: WorkspaceIndex.WorkspaceSummary) -> PaneGrid.SessionSnapshot? {
        var paneStates: [PaneID: NativeRuntime.PaneRuntimeState] = [:]
        for pane in runtimePanes {
            guard paneStates[pane.paneID] == nil else {
                return nil
            }
            paneStates[pane.paneID] = pane
        }
        guard let activeWindowID = runtime.activeWindowID ?? runtime.windows.first?.windowID,
              let tmuxSessionID = runtime.tmuxSessionID,
              !runtime.windows.isEmpty
        else {
            return nil
        }
        let windows = runtime.windows.compactMap { window -> PaneGrid.WindowSnapshot? in
            let panes = window.paneIDs.enumerated().compactMap { index, paneID -> PaneGrid.PaneSnapshot? in
                guard let pane = paneStates[paneID],
                      pane.status == .attached,
                      let tmuxPaneID = pane.tmuxPaneID,
                      let size = pane.size
                else {
                    return nil
                }
                return PaneGrid.PaneSnapshot(
                    paneID: paneID,
                    tmuxPaneID: tmuxPaneID,
                    streamID: pane.stream.streamID,
                    title: paneID.rawValue,
                    rect: PaneGrid.PaneRect(x: index * size.columns, y: 0, columns: size.columns, rows: size.rows)
                )
            }
            guard !panes.isEmpty else {
                return nil
            }
            return PaneGrid.WindowSnapshot(
                windowID: window.windowID,
                tmuxWindowID: window.tmuxWindowID.rawValue,
                index: window.index,
                title: window.title,
                activePaneID: window.activePaneID,
                panes: panes
            )
        }
        guard windows.contains(where: { $0.windowID == activeWindowID }) else {
            return nil
        }
        return PaneGrid.SessionSnapshot(
            workspaceID: workspace.workspaceID,
            tmuxSessionID: tmuxSessionID.rawValue,
            activeWindowID: activeWindowID,
            windows: windows
        )
    }
}
