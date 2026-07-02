import Foundation
import Testing
import FenrirNativeShared
import WorkspaceIndex
import ServerConnection
import NativeRuntime
import PaneGrid
import TerminalViewport
import WorkspaceCoordinator

@Suite("WorkspaceCoordinator public API")
struct WorkspaceCoordinatorPublicAPITests {
    @Test("Actions and service ports are constructible from normal imports")
    func actionsAndPortsAreConstructibleFromNormalImports() {
        let index = PublicCoordinatorIndex()
        let selector = PublicServerSelector()
        let windows = PublicCoordinatorWindows()
        let runtime = PublicCoordinatorRuntime()
        let layout = PublicLayoutRestorer()
        let viewport = PublicViewportRestorer()
        let clock = PublicCoordinatorClock()
        let events = PublicCoordinatorEvents()

        _ = WorkspaceCoordinator.OpenWorkspace(index: index, serverSelector: selector, windows: windows, runtime: runtime, clock: clock, events: events)
        _ = WorkspaceCoordinator.SwitchWorkspace(index: index, windows: windows, clock: clock, events: events)
        _ = WorkspaceCoordinator.CloseWorkspaceExperience(index: index, windows: windows, runtime: runtime, clock: clock, events: events)
        _ = WorkspaceCoordinator.ReconnectWorkspaceExperience(index: index, serverSelector: selector, runtime: runtime, layoutRestorer: layout, viewportRestorer: viewport, clock: clock, events: events)
        _ = WorkspaceCoordinator.RestoreVisiblePanes(layoutRestorer: layout, viewportRestorer: viewport, clock: clock, events: events)
    }
}

private struct PublicCoordinatorClock: WorkspaceCoordinator.WorkspaceCoordinatorClock {
    func now() -> FenrirTimestamp {
        FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_000))
    }
}

private actor PublicCoordinatorIndex: WorkspaceCoordinator.WorkspaceIndexCoordinating {
    func resolveWorkspace(requestID: RequestID, identity: WorkspaceIndex.WorkspaceIdentity) async throws -> WorkspaceIndex.WorkspaceSummary {
        publicCoordinatorSummary()
    }

    func attachWorkspace(requestID: RequestID, workspaceID: WorkspaceID, targetIdentity: WorkspaceIndex.WorkspaceIdentity?, windowID: FenrirWindowID) async throws -> WorkspaceIndex.WorkspaceSummary {
        publicCoordinatorSummary()
    }

    func detachWorkspace(requestID: RequestID, workspaceID: WorkspaceID, targetIdentity: WorkspaceIndex.WorkspaceIdentity?) async throws -> WorkspaceIndex.WorkspaceSummary {
        publicCoordinatorSummary()
    }

    func markRecent(requestID: RequestID, workspaceID: WorkspaceID, targetIdentity: WorkspaceIndex.WorkspaceIdentity?) async throws {}
}

private struct PublicServerSelector: WorkspaceCoordinator.WorkspaceServerSelecting {
    func selectServer(_ selection: WorkspaceCoordinator.ServerSelection, workspace: WorkspaceIndex.WorkspaceSummary) async throws -> ServerConnection.Endpoint? {
        nil
    }
}

private actor PublicCoordinatorWindows: WorkspaceCoordinator.WorkspaceWindowCoordinating {
    func openWindow(workspace: WorkspaceIndex.WorkspaceSummary) async throws -> FenrirWindowID {
        "window-a"
    }

    func focusWindow(workspace: WorkspaceIndex.WorkspaceSummary) async throws -> FenrirWindowID {
        "window-a"
    }

    func closeWindow(workspace: WorkspaceIndex.WorkspaceSummary) async throws {}
}

private actor PublicCoordinatorRuntime: WorkspaceCoordinator.WorkspaceRuntimeCoordinating {
    func attachWorkspaceRuntime(requestID: RequestID, workspaceID: WorkspaceID, server: ServerConnection.Endpoint?) async throws -> NativeRuntime.WorkspaceRuntimeState {
        publicRuntimeState(workspaceID: workspaceID)
    }

    func reconnectWorkspaceRuntime(requestID: RequestID, workspaceID: WorkspaceID, server: ServerConnection.Endpoint?) async throws -> (workspace: NativeRuntime.WorkspaceRuntimeState, panes: [NativeRuntime.PaneRuntimeState]) {
        (publicRuntimeState(workspaceID: workspaceID), [])
    }

    func detachWorkspaceRuntime(requestID: RequestID, workspaceID: WorkspaceID, targetIdentity: WorkspaceIndex.WorkspaceIdentity?) async throws {}
}

private actor PublicLayoutRestorer: WorkspaceCoordinator.WorkspaceLayoutRestoring {
    func restorePaneGrid(requestID: RequestID, snapshot: PaneGrid.SessionSnapshot) async throws -> PaneGrid.State {
        PaneGrid.State(workspaceID: snapshot.workspaceID, tmuxSessionID: snapshot.tmuxSessionID, activeWindowID: snapshot.activeWindowID, windows: [])
    }
}

private actor PublicViewportRestorer: WorkspaceCoordinator.WorkspaceViewportRestoring {
    func restoreViewport(requestID: RequestID, workspaceID: WorkspaceID, paneID: PaneID) async throws -> WorkspaceCoordinator.VisiblePaneRestore {
        WorkspaceCoordinator.VisiblePaneRestore(paneID: paneID, viewportID: "viewport-a", streamID: "stream-a")
    }
}

private actor PublicCoordinatorEvents: WorkspaceCoordinator.WorkspaceCoordinatorEventPublishing {
    func publish(_ event: EventEnvelope<WorkspaceCoordinator.Event>) async {}
}

private func publicCoordinatorSummary() -> WorkspaceIndex.WorkspaceSummary {
    WorkspaceIndex.WorkspaceSummary(
        workspaceID: "workspace-a",
        displayName: "Alpha",
        identity: WorkspaceIndex.WorkspaceIdentity(kind: .project, workspaceID: "workspace-a")
    )
}

private func publicRuntimeState(workspaceID: WorkspaceID) -> NativeRuntime.WorkspaceRuntimeState {
    NativeRuntime.WorkspaceRuntimeState(
        workspaceID: workspaceID,
        status: .attached,
        tmuxSessionID: NativeRuntime.TmuxSessionID(rawValue: "tmux-session-\(workspaceID.rawValue)"),
        windows: [],
        activeWindowID: nil,
        attachedPaneIDs: [],
        generation: 1
    )
}
