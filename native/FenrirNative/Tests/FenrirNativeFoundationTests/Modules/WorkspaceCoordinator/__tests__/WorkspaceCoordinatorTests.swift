import Foundation
import Testing
import FenrirNativeShared
@testable import WorkspaceIndex
@testable import ServerConnection
@testable import NativeRuntime
@testable import PaneGrid
@testable import WorkspaceCoordinator

@Suite("WorkspaceCoordinator actions")
struct WorkspaceCoordinatorTests {
    @Test("OpenWorkspace attaches runtime, opens window, updates index, and emits ordered events")
    func openWorkspaceSuccess() async throws {
        let events = EventRecorder()
        let index = IndexPort(workspace: workspace(open: false))
        let action = WorkspaceCoordinator.OpenWorkspace(
            index: index,
            serverSelector: ServerSelector(),
            windows: WindowPort(),
            runtime: RuntimePort(),
            clock: FixedClock(),
            events: events
        )

        let result = try await action.run(.init(
            requestID: "open",
            identity: identity(),
            mode: .focusExisting,
            serverSelection: .local,
            source: .test
        )).get()

        #expect(result.didCreateWindow)
        #expect(result.experience.runtime?.status == .attached)
        #expect(await index.attached == ["workspace-a"])
        #expect(await events.kinds == ["WorkspaceResolved", "ServerSelected", "WorkspaceRuntimeAttached", "WorkspaceWindowOpened", "WorkspaceOpened"])
    }

    @Test("SwitchWorkspace focuses already open workspace and marks recent")
    func switchWorkspaceSuccess() async throws {
        let index = IndexPort(workspace: workspace(open: true))
        let windows = WindowPort()
        let action = WorkspaceCoordinator.SwitchWorkspace(index: index, windows: windows, clock: FixedClock())

        let result = try await action.run(.init(requestID: "switch", identity: identity(), source: .test)).get()

        #expect(result.experience.windowID == "window-workspace-a")
        #expect(await windows.focused == ["workspace-a"])
        #expect(await index.recent == ["workspace-a"])
    }

    @Test("ReconnectWorkspaceExperience restores pane grid and visible panes")
    func reconnectRestoresVisiblePanes() async throws {
        let layout = LayoutRestorer()
        let viewports = ViewportRestorer()
        let action = WorkspaceCoordinator.ReconnectWorkspaceExperience(
            index: IndexPort(workspace: workspace(open: true)),
            serverSelector: ServerSelector(),
            runtime: RuntimePort(),
            layoutRestorer: layout,
            viewportRestorer: viewports,
            clock: FixedClock()
        )

        let result = try await action.run(.init(requestID: "reconnect", identity: identity(), serverSelection: .local, source: .test)).get()

        #expect(result.experience.runtime?.generation == 2)
        #expect(result.experience.restoredPanes.map(\.paneID) == ["pane-1", "pane-2"])
        #expect(await layout.restoredSnapshots.count == 1)
        #expect(await viewports.restored == ["pane-1", "pane-2"])
    }

    @Test("OpenWorkspace reports partial attach failure without opening a window")
    func openPartialAttachFailure() async {
        let events = EventRecorder()
        let windows = WindowPort()
        let action = WorkspaceCoordinator.OpenWorkspace(
            index: IndexPort(workspace: workspace(open: false)),
            serverSelector: ServerSelector(),
            windows: windows,
            runtime: RuntimePort(failAttach: true),
            clock: FixedClock(),
            events: events
        )

        let result = await action.run(.init(requestID: "open", identity: identity(), mode: .focusExisting, serverSelection: .local, source: .test))

        #expect(result == .failure(WorkspaceCoordinator.WorkspaceCoordinatorError.partialAttachFailed))
        #expect(await windows.opened.isEmpty)
        #expect(await events.kinds == ["WorkspaceResolved", "ServerSelected", "WorkspacePartialAttachFailed"])
    }

    @Test("RestoreVisiblePanes maps restore failures to typed error")
    func restoreVisiblePanesFailure() async {
        let action = WorkspaceCoordinator.RestoreVisiblePanes(
            layoutRestorer: LayoutRestorer(fail: true),
            viewportRestorer: ViewportRestorer(),
            clock: FixedClock()
        )

        let result = await action.run(.init(requestID: "restore", workspace: workspace(open: true), layoutSnapshot: snapshot(), source: .test))

        #expect(result == .failure(WorkspaceCoordinator.WorkspaceCoordinatorError.restoreFailed))
    }

    @Test("CloseWorkspaceExperience resolves identity before closing scoped resources")
    func closeWorkspaceResolvesScopedIdentityBeforeSideEffects() async throws {
        let scoped = workspace(open: true, profileID: "profile-a")
        let index = IndexPort(workspace: scoped)
        let windows = WindowPort()
        let runtime = RuntimePort()
        let action = WorkspaceCoordinator.CloseWorkspaceExperience(index: index, windows: windows, runtime: runtime, clock: FixedClock())

        let result = try await action.run(.init(requestID: "close", workspaceID: "workspace-a", targetIdentity: scoped.identity, source: .test)).get()

        #expect(result.workspaceID == "workspace-a")
        #expect(await index.resolved == [scoped.identity])
        #expect(await index.detachedTargets == [scoped.identity])
        #expect(await windows.closedTargets == [scoped.identity])
        #expect(await runtime.detachedTargets == [scoped.identity])
    }

    @Test("CloseWorkspaceExperience does not close resources when identity cannot resolve")
    func closeWorkspaceStopsBeforeSideEffectsWhenResolveFails() async {
        let index = IndexPort(workspace: workspace(open: true), failResolve: true)
        let windows = WindowPort()
        let runtime = RuntimePort()
        let action = WorkspaceCoordinator.CloseWorkspaceExperience(index: index, windows: windows, runtime: runtime, clock: FixedClock())

        let result = await action.run(.init(requestID: "close", workspaceID: "workspace-a", targetIdentity: identity(), source: .test))

        #expect(result == .failure(WorkspaceCoordinator.WorkspaceCoordinatorError.closeFailed))
        #expect(await windows.closed.isEmpty)
        #expect(await runtime.detached.isEmpty)
        #expect(await index.detached.isEmpty)
    }
}

private func identity() -> WorkspaceIndex.WorkspaceIdentity {
    WorkspaceIndex.WorkspaceIdentity(kind: .localPath, workspaceID: "workspace-a", canonicalPath: "/repo/a")
}

private func workspace(open: Bool, profileID: ProfileID? = nil) -> WorkspaceIndex.WorkspaceSummary {
    WorkspaceIndex.WorkspaceSummary(
        workspaceID: "workspace-a",
        displayName: "Alpha",
        canonicalPath: "/repo/a",
        profileID: profileID,
        identity: profileID.map { WorkspaceIndex.WorkspaceIdentity(kind: .remote, workspaceID: "workspace-a", serverID: "remote-main", profileID: $0) } ?? identity(),
        openState: WorkspaceIndex.WorkspaceOpenState(isOpenLocally: open, windowIDs: open ? ["window-workspace-a"] : []),
        status: open ? .open : .available
    )
}

private func snapshot() -> PaneGrid.SessionSnapshot {
    PaneGrid.SessionSnapshot(
        workspaceID: "workspace-a",
        tmuxSessionID: "workspace-a",
        activeWindowID: "window-workspace-a",
        windows: [
            PaneGrid.WindowSnapshot(
                windowID: "window-workspace-a",
                tmuxWindowID: "tmux-window-workspace-a",
                index: 0,
                title: "Alpha",
                activePaneID: "pane-1",
                panes: [
                    PaneGrid.PaneSnapshot(paneID: "pane-1", tmuxPaneID: "%1", rect: PaneGrid.PaneRect(x: 0, y: 0, columns: 80, rows: 24)),
                    PaneGrid.PaneSnapshot(paneID: "pane-2", tmuxPaneID: "%2", rect: PaneGrid.PaneRect(x: 80, y: 0, columns: 80, rows: 24))
                ]
            )
        ]
    )
}

private actor IndexPort: WorkspaceCoordinator.WorkspaceIndexCoordinating {
    private let current: WorkspaceIndex.WorkspaceSummary
    private let failResolve: Bool
    private(set) var attached: [WorkspaceID] = []
    private(set) var detached: [WorkspaceID] = []
    private(set) var detachedTargets: [WorkspaceIndex.WorkspaceIdentity?] = []
    private(set) var recent: [WorkspaceID] = []
    private(set) var resolved: [WorkspaceIndex.WorkspaceIdentity] = []

    init(workspace: WorkspaceIndex.WorkspaceSummary, failResolve: Bool = false) {
        self.current = workspace
        self.failResolve = failResolve
    }

    func resolveWorkspace(requestID: RequestID, identity: WorkspaceIndex.WorkspaceIdentity) async throws -> WorkspaceIndex.WorkspaceSummary {
        if failResolve {
            throw WorkspaceIndex.WorkspaceIndexError.workspaceNotFound
        }
        resolved.append(identity)
        return current
    }

    func attachWorkspace(requestID: RequestID, workspaceID: WorkspaceID, targetIdentity: WorkspaceIndex.WorkspaceIdentity?, windowID: FenrirWindowID) async throws -> WorkspaceIndex.WorkspaceSummary {
        attached.append(workspaceID)
        return current
    }

    func detachWorkspace(requestID: RequestID, workspaceID: WorkspaceID, targetIdentity: WorkspaceIndex.WorkspaceIdentity?) async throws -> WorkspaceIndex.WorkspaceSummary {
        detached.append(workspaceID)
        detachedTargets.append(targetIdentity)
        return current
    }

    func markRecent(requestID: RequestID, workspaceID: WorkspaceID, targetIdentity: WorkspaceIndex.WorkspaceIdentity?) async throws {
        recent.append(workspaceID)
    }
}

private struct ServerSelector: WorkspaceCoordinator.WorkspaceServerSelecting {
    func selectServer(_ selection: WorkspaceCoordinator.ServerSelection, workspace: WorkspaceIndex.WorkspaceSummary) async throws -> ServerConnection.Endpoint? {
        switch selection {
        case .local:
            nil
        case .profile(let profileID):
            ServerConnection.Endpoint(kind: .profile, transport: .webSocketURL("ws://profile"), profileID: profileID, displayName: "Profile")
        case .remote(let endpoint):
            endpoint
        }
    }
}

private actor WindowPort: WorkspaceCoordinator.WorkspaceWindowCoordinating {
    private(set) var opened: [WorkspaceID] = []
    private(set) var focused: [WorkspaceID] = []
    private(set) var closed: [WorkspaceID] = []
    private(set) var closedTargets: [WorkspaceIndex.WorkspaceIdentity] = []

    func openWindow(workspace: WorkspaceIndex.WorkspaceSummary) async throws -> FenrirWindowID {
        opened.append(workspace.workspaceID)
        return FenrirWindowID(rawValue: "window-\(workspace.workspaceID.rawValue)")
    }

    func focusWindow(workspace: WorkspaceIndex.WorkspaceSummary) async throws -> FenrirWindowID {
        focused.append(workspace.workspaceID)
        return workspace.openState.windowIDs.first ?? FenrirWindowID(rawValue: "window-\(workspace.workspaceID.rawValue)")
    }

    func closeWindow(workspace: WorkspaceIndex.WorkspaceSummary) async throws {
        closed.append(workspace.workspaceID)
        closedTargets.append(workspace.identity)
    }
}

private actor RuntimePort: WorkspaceCoordinator.WorkspaceRuntimeCoordinating {
    let failAttach: Bool
    private(set) var detached: [WorkspaceID] = []
    private(set) var detachedTargets: [WorkspaceIndex.WorkspaceIdentity?] = []

    init(failAttach: Bool = false) {
        self.failAttach = failAttach
    }

    func attachWorkspaceRuntime(requestID: RequestID, workspaceID: WorkspaceID, server: ServerConnection.Endpoint?) async throws -> NativeRuntime.WorkspaceRuntimeState {
        if failAttach {
            throw WorkspaceCoordinator.WorkspaceCoordinatorError.attachFailed
        }
        return runtimeState(workspaceID: workspaceID, status: .attached, generation: 1)
    }

    func reconnectWorkspaceRuntime(requestID: RequestID, workspaceID: WorkspaceID, server: ServerConnection.Endpoint?) async throws -> (workspace: NativeRuntime.WorkspaceRuntimeState, panes: [NativeRuntime.PaneRuntimeState]) {
        let state = runtimeState(workspaceID: workspaceID, status: .reconnecting, generation: 2)
        return (state, runtimePanes(workspaceID: workspaceID))
    }

    func detachWorkspaceRuntime(requestID: RequestID, workspaceID: WorkspaceID, targetIdentity: WorkspaceIndex.WorkspaceIdentity?) async throws {
        detached.append(workspaceID)
        detachedTargets.append(targetIdentity)
    }
}

private func runtimeState(
    workspaceID: WorkspaceID,
    status: NativeRuntime.WorkspaceRuntimeStatus,
    generation: UInt64
) -> NativeRuntime.WorkspaceRuntimeState {
    NativeRuntime.WorkspaceRuntimeState(
        workspaceID: workspaceID,
        status: status,
        tmuxSessionID: NativeRuntime.TmuxSessionID(rawValue: "tmux-session-\(workspaceID.rawValue)"),
        windows: [
            NativeRuntime.WindowRuntimeState(
                workspaceID: workspaceID,
                windowID: FenrirWindowID(rawValue: "window-\(workspaceID.rawValue)"),
                tmuxWindowID: NativeRuntime.TmuxWindowID(rawValue: "tmux-window-\(workspaceID.rawValue)"),
                index: 0,
                title: workspaceID.rawValue,
                activePaneID: "pane-1",
                paneIDs: ["pane-1", "pane-2"]
            )
        ],
        activeWindowID: FenrirWindowID(rawValue: "window-\(workspaceID.rawValue)"),
        attachedPaneIDs: ["pane-1", "pane-2"],
        generation: generation
    )
}

private func runtimePanes(workspaceID: WorkspaceID) -> [NativeRuntime.PaneRuntimeState] {
    [
        NativeRuntime.PaneRuntimeState(
            workspaceID: workspaceID,
            paneID: "pane-1",
            status: .attached,
            windowID: FenrirWindowID(rawValue: "window-\(workspaceID.rawValue)"),
            tmuxPaneID: "%1",
            size: NativeRuntime.PaneSize(columns: 80, rows: 24),
            stream: NativeRuntime.PaneStreamState(paneID: "pane-1", streamID: "stream-1", status: .live)
        ),
        NativeRuntime.PaneRuntimeState(
            workspaceID: workspaceID,
            paneID: "pane-2",
            status: .attached,
            windowID: FenrirWindowID(rawValue: "window-\(workspaceID.rawValue)"),
            tmuxPaneID: "%2",
            size: NativeRuntime.PaneSize(columns: 80, rows: 24),
            stream: NativeRuntime.PaneStreamState(paneID: "pane-2", streamID: "stream-2", status: .live)
        )
    ]
}

private actor LayoutRestorer: WorkspaceCoordinator.WorkspaceLayoutRestoring {
    let fail: Bool
    private(set) var restoredSnapshots: [PaneGrid.SessionSnapshot] = []

    init(fail: Bool = false) {
        self.fail = fail
    }

    func restorePaneGrid(requestID: RequestID, snapshot: PaneGrid.SessionSnapshot) async throws -> PaneGrid.State {
        if fail {
            throw WorkspaceCoordinator.WorkspaceCoordinatorError.restoreFailed
        }
        restoredSnapshots.append(snapshot)
        let panes = snapshot.windows[0].panes.map {
            PaneGrid.PanePresentation(paneID: $0.paneID, tmuxPaneID: $0.tmuxPaneID, viewportID: ViewportID(rawValue: "viewport-\($0.paneID.rawValue)"), rect: $0.rect, isFocused: $0.paneID == snapshot.windows[0].activePaneID)
        }
        let window = PaneGrid.WindowPresentation(
            windowID: snapshot.windows[0].windowID,
            tmuxWindowID: snapshot.windows[0].tmuxWindowID,
            index: 0,
            title: "Alpha",
            root: PaneGrid.LayoutNode.split(axis: .horizontal, children: panes.map { .pane($0) }),
            activePaneID: "pane-1",
            panes: panes
        )
        return PaneGrid.State(workspaceID: "workspace-a", tmuxSessionID: "workspace-a", activeWindowID: "window-workspace-a", windows: [window])
    }
}

private actor ViewportRestorer: WorkspaceCoordinator.WorkspaceViewportRestoring {
    private(set) var restored: [PaneID] = []

    func restoreViewport(requestID: RequestID, workspaceID: WorkspaceID, paneID: PaneID) async throws -> WorkspaceCoordinator.VisiblePaneRestore {
        restored.append(paneID)
        return WorkspaceCoordinator.VisiblePaneRestore(paneID: paneID, viewportID: ViewportID(rawValue: "viewport-\(paneID.rawValue)"), streamID: StreamID(rawValue: "stream-\(paneID.rawValue)"))
    }
}

private actor EventRecorder: WorkspaceCoordinator.WorkspaceCoordinatorEventPublishing {
    private(set) var kinds: [String] = []

    func publish(_ event: EventEnvelope<WorkspaceCoordinator.Event>) async {
        kinds.append(event.eventKind)
    }
}
