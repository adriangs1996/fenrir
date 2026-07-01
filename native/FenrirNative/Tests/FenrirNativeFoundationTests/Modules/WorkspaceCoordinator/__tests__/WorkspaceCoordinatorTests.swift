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
}

private func identity() -> WorkspaceIndex.WorkspaceIdentity {
    WorkspaceIndex.WorkspaceIdentity(kind: .localPath, workspaceID: "workspace-a", canonicalPath: "/repo/a")
}

private func workspace(open: Bool) -> WorkspaceIndex.WorkspaceSummary {
    WorkspaceIndex.WorkspaceSummary(
        workspaceID: "workspace-a",
        displayName: "Alpha",
        canonicalPath: "/repo/a",
        identity: identity(),
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
                    PaneGrid.PaneSnapshot(paneID: "pane-1", rect: PaneGrid.PaneRect(x: 0, y: 0, columns: 80, rows: 24)),
                    PaneGrid.PaneSnapshot(paneID: "pane-2", rect: PaneGrid.PaneRect(x: 80, y: 0, columns: 80, rows: 24))
                ]
            )
        ]
    )
}

private actor IndexPort: WorkspaceCoordinator.WorkspaceIndexCoordinating {
    private let current: WorkspaceIndex.WorkspaceSummary
    private(set) var attached: [WorkspaceID] = []
    private(set) var detached: [WorkspaceID] = []
    private(set) var recent: [WorkspaceID] = []

    init(workspace: WorkspaceIndex.WorkspaceSummary) {
        self.current = workspace
    }

    func resolveWorkspace(requestID: RequestID, identity: WorkspaceIndex.WorkspaceIdentity) async throws -> WorkspaceIndex.WorkspaceSummary {
        current
    }

    func attachWorkspace(requestID: RequestID, workspaceID: WorkspaceID, windowID: FenrirWindowID) async throws -> WorkspaceIndex.WorkspaceSummary {
        attached.append(workspaceID)
        return current
    }

    func detachWorkspace(requestID: RequestID, workspaceID: WorkspaceID) async throws -> WorkspaceIndex.WorkspaceSummary {
        detached.append(workspaceID)
        return current
    }

    func markRecent(requestID: RequestID, workspaceID: WorkspaceID) async throws {
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

    func openWindow(workspace: WorkspaceIndex.WorkspaceSummary) async throws -> FenrirWindowID {
        opened.append(workspace.workspaceID)
        return FenrirWindowID(rawValue: "window-\(workspace.workspaceID.rawValue)")
    }

    func focusWindow(workspace: WorkspaceIndex.WorkspaceSummary) async throws -> FenrirWindowID {
        focused.append(workspace.workspaceID)
        return workspace.openState.windowIDs.first ?? FenrirWindowID(rawValue: "window-\(workspace.workspaceID.rawValue)")
    }

    func closeWindow(workspaceID: WorkspaceID) async throws {
        closed.append(workspaceID)
    }
}

private struct RuntimePort: WorkspaceCoordinator.WorkspaceRuntimeCoordinating {
    let failAttach: Bool

    init(failAttach: Bool = false) {
        self.failAttach = failAttach
    }

    func attachWorkspaceRuntime(requestID: RequestID, workspaceID: WorkspaceID, server: ServerConnection.Endpoint?) async throws -> NativeRuntime.WorkspaceRuntimeState {
        if failAttach {
            throw WorkspaceCoordinator.WorkspaceCoordinatorError.attachFailed
        }
        return NativeRuntime.WorkspaceRuntimeState(workspaceID: workspaceID, status: .attached, attachedPaneIDs: ["pane-1", "pane-2"], generation: 1)
    }

    func reconnectWorkspaceRuntime(requestID: RequestID, workspaceID: WorkspaceID, server: ServerConnection.Endpoint?) async throws -> NativeRuntime.WorkspaceRuntimeState {
        NativeRuntime.WorkspaceRuntimeState(workspaceID: workspaceID, status: .reconnecting, attachedPaneIDs: ["pane-1", "pane-2"], generation: 2)
    }

    func detachWorkspaceRuntime(requestID: RequestID, workspaceID: WorkspaceID) async throws {}
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
            PaneGrid.PanePresentation(paneID: $0.paneID, viewportID: ViewportID(rawValue: "viewport-\($0.paneID.rawValue)"), rect: $0.rect, isFocused: $0.paneID == snapshot.windows[0].activePaneID)
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
