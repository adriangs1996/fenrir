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

        init(
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

                if input.mode == .focusExisting, workspace.isOpenLocally {
                    let windowID = try await windows.focusWindow(workspace: workspace)
                    try await index.markRecent(requestID: input.requestID, workspaceID: workspace.workspaceID)
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
                let attached = try await index.attachWorkspace(requestID: input.requestID, workspaceID: workspace.workspaceID, windowID: windowID)
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

        init(index: any WorkspaceIndexCoordinating, windows: any WorkspaceWindowCoordinating, clock: any WorkspaceCoordinatorClock, events: (any WorkspaceCoordinatorEventPublishing)? = nil) {
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
                try await index.markRecent(requestID: input.requestID, workspaceID: workspace.workspaceID)
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

        init(index: any WorkspaceIndexCoordinating, windows: any WorkspaceWindowCoordinating, runtime: any WorkspaceRuntimeCoordinating, clock: any WorkspaceCoordinatorClock, events: (any WorkspaceCoordinatorEventPublishing)? = nil) {
            self.index = index
            self.windows = windows
            self.runtime = runtime
            self.clock = clock
            self.events = events
        }

        public func run(_ input: CloseWorkspaceExperienceInput) async -> Result<CloseWorkspaceExperienceResult, WorkspaceCoordinatorError> {
            do {
                try await windows.closeWindow(workspaceID: input.workspaceID)
                try await runtime.detachWorkspaceRuntime(requestID: input.requestID, workspaceID: input.workspaceID)
                _ = try await index.detachWorkspace(requestID: input.requestID, workspaceID: input.workspaceID)
                let timestamp = clock.now()
                await WorkspaceCoordinator.publish(input.requestID, "WorkspaceClosed", timestamp, .workspaceClosed(input.workspaceID), events)
                return .success(CloseWorkspaceExperienceResult(requestID: input.requestID, workspaceID: input.workspaceID, timestamp: timestamp))
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

        init(
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
                let runtimeState = try await runtime.reconnectWorkspaceRuntime(requestID: input.requestID, workspaceID: workspace.workspaceID, server: server)
                guard let snapshot = WorkspaceCoordinator.layoutSnapshot(from: runtimeState, workspace: workspace) else {
                    return .failure(.restoreFailed)
                }
                let restore = try await WorkspaceCoordinator.restore(requestID: input.requestID, workspace: workspace, snapshot: snapshot, layoutRestorer: layoutRestorer, viewportRestorer: viewportRestorer)
                let timestamp = clock.now()
                await WorkspaceCoordinator.publish(input.requestID, "WorkspaceReconnected", timestamp, .workspaceReconnected(workspace.workspaceID), events)
                return .success(ReconnectWorkspaceExperienceResult(
                    requestID: input.requestID,
                    experience: WorkspaceExperience(workspace: workspace, serverSelection: input.serverSelection, runtime: runtimeState, layout: restore.layout, restoredPanes: restore.restoredPanes),
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

        init(layoutRestorer: any WorkspaceLayoutRestoring, viewportRestorer: any WorkspaceViewportRestoring, clock: any WorkspaceCoordinatorClock, events: (any WorkspaceCoordinatorEventPublishing)? = nil) {
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

    static func layoutSnapshot(from runtime: NativeRuntime.WorkspaceRuntimeState, workspace: WorkspaceIndex.WorkspaceSummary) -> PaneGrid.SessionSnapshot? {
        guard let firstPaneID = runtime.attachedPaneIDs.first else {
            return nil
        }
        let panes = runtime.attachedPaneIDs.enumerated().map { index, paneID in
            PaneGrid.PaneSnapshot(
                paneID: paneID,
                title: paneID.rawValue,
                rect: PaneGrid.PaneRect(x: index * 80, y: 0, columns: 80, rows: 24)
            )
        }
        return PaneGrid.SessionSnapshot(
            workspaceID: workspace.workspaceID,
            tmuxSessionID: runtime.workspaceID.rawValue,
            activeWindowID: FenrirWindowID(rawValue: "window-\(workspace.workspaceID.rawValue)"),
            windows: [
                PaneGrid.WindowSnapshot(
                    windowID: FenrirWindowID(rawValue: "window-\(workspace.workspaceID.rawValue)"),
                    tmuxWindowID: "tmux-window-\(workspace.workspaceID.rawValue)",
                    index: 0,
                    title: workspace.displayName,
                    activePaneID: firstPaneID,
                    panes: panes
                )
            ]
        )
    }
}
