import Foundation
import Testing
import FenrirNativeShared
import WorkspaceIndex
import WorkspaceShell

@Suite("WorkspaceShell public API")
struct WorkspaceShellPublicAPITests {
    @Test("Actions and service ports are constructible from normal imports")
    func actionsAndPortsAreConstructibleFromNormalImports() {
        let index = PublicShellIndex()
        let windows = PublicShellWindows()
        let remote = PublicRemoteAttacher()
        let clock = PublicShellClock()
        let events = PublicShellEvents()
        let sidebar = PublicSidebarToggler()

        _ = WorkspaceShell.OpenWorkspace(index: index, windows: windows, clock: clock, events: events)
        _ = WorkspaceShell.SwitchWorkspace(index: index, windows: windows, clock: clock, events: events)
        _ = WorkspaceShell.AttachRemoteWorkspace(index: index, remoteAttacher: remote, windows: windows, clock: clock, events: events)
        _ = WorkspaceShell.RemoveWorkspace(index: index, windows: windows, clock: clock, events: events)
        _ = WorkspaceShell.ListShellWorkspaces(index: index, clock: clock, events: events)
        _ = WorkspaceShell.FormatCommandResult(clock: clock, events: events)
        _ = WorkspaceShell.ToggleWorkspaceSidebar(toggling: sidebar)
    }
}

private struct PublicShellClock: WorkspaceShell.WorkspaceShellClock {
    func now() -> FenrirTimestamp {
        FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_000))
    }
}

private actor PublicShellIndex: WorkspaceShell.WorkspaceIndexCommanding {
    func listWorkspaces(requestID: RequestID, includeRemote: Bool) async throws -> WorkspaceIndex.ListWorkspacesResult {
        throw WorkspaceShell.WorkspaceShellError.listFailed
    }

    func resolveWorkspace(requestID: RequestID, identity: WorkspaceIndex.WorkspaceIdentity) async throws -> WorkspaceIndex.ResolveWorkspaceResult {
        throw WorkspaceShell.WorkspaceShellError.workspaceNotFound
    }

    func registerWorkspace(requestID: RequestID, summary: WorkspaceIndex.WorkspaceSummary) async throws -> WorkspaceIndex.RegisterWorkspaceResult {
        throw WorkspaceShell.WorkspaceShellError.workspaceNotFound
    }

    func attachWorkspace(requestID: RequestID, workspaceID: WorkspaceID, targetIdentity: WorkspaceIndex.WorkspaceIdentity?, windowID: FenrirWindowID) async throws -> WorkspaceIndex.AttachWorkspaceResult {
        throw WorkspaceShell.WorkspaceShellError.workspaceNotFound
    }

    func markRecent(requestID: RequestID, workspaceID: WorkspaceID, targetIdentity: WorkspaceIndex.WorkspaceIdentity?) async throws -> WorkspaceIndex.MarkWorkspaceRecentResult {
        throw WorkspaceShell.WorkspaceShellError.workspaceNotFound
    }

    func removeWorkspace(requestID: RequestID, workspaceID: WorkspaceID, targetIdentity: WorkspaceIndex.WorkspaceIdentity?) async throws -> WorkspaceIndex.RemoveWorkspaceResult {
        throw WorkspaceShell.WorkspaceShellError.removeFailed
    }
}

private actor PublicShellWindows: WorkspaceShell.WorkspaceWindowCommanding {
    func openWorkspace(_ summary: WorkspaceIndex.WorkspaceSummary) async throws -> FenrirWindowID {
        "window-a"
    }

    func switchWorkspace(_ summary: WorkspaceIndex.WorkspaceSummary) async throws -> FenrirWindowID {
        "window-a"
    }

    func closeWorkspace(_ summary: WorkspaceIndex.WorkspaceSummary) async throws {}
}

private struct PublicRemoteAttacher: WorkspaceShell.RemoteWorkspaceAttaching {
    func attachRemoteWorkspace(endpointID: String, identity: WorkspaceIndex.WorkspaceIdentity) async throws -> WorkspaceIndex.WorkspaceSummary {
        publicShellSummary()
    }
}

private actor PublicShellEvents: WorkspaceShell.WorkspaceShellEventPublishing {
    func publish(_ event: EventEnvelope<WorkspaceShell.Event>) async {}
}

private struct PublicSidebarToggler: WorkspaceShell.WorkspaceSidebarToggling {
    func toggleSidebar(_ input: WorkspaceShell.ToggleWorkspaceSidebarInput) async throws -> WorkspaceShell.ToggleWorkspaceSidebarResult {
        throw WorkspaceShell.WorkspaceShellError.switcherFailed
    }
}

private func publicShellSummary() -> WorkspaceIndex.WorkspaceSummary {
    WorkspaceIndex.WorkspaceSummary(
        workspaceID: "workspace-a",
        displayName: "Alpha",
        identity: WorkspaceIndex.WorkspaceIdentity(kind: .project, workspaceID: "workspace-a")
    )
}
