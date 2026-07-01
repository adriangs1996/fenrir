import Foundation
import FenrirNativeShared
import WorkspaceIndex

extension WorkspaceShell {
    protocol WorkspaceShellClock: Sendable {
        func now() -> FenrirTimestamp
    }

    protocol WorkspaceIndexCommanding: Sendable {
        func listWorkspaces(requestID: RequestID, includeRemote: Bool) async throws -> WorkspaceIndex.ListWorkspacesResult
        func resolveWorkspace(requestID: RequestID, identity: WorkspaceIndex.WorkspaceIdentity) async throws -> WorkspaceIndex.ResolveWorkspaceResult
        func registerWorkspace(requestID: RequestID, summary: WorkspaceIndex.WorkspaceSummary) async throws -> WorkspaceIndex.RegisterWorkspaceResult
        func attachWorkspace(requestID: RequestID, workspaceID: WorkspaceID, windowID: FenrirWindowID) async throws -> WorkspaceIndex.AttachWorkspaceResult
        func markRecent(requestID: RequestID, workspaceID: WorkspaceID) async throws -> WorkspaceIndex.MarkWorkspaceRecentResult
        func removeWorkspace(requestID: RequestID, workspaceID: WorkspaceID) async throws -> WorkspaceIndex.RemoveWorkspaceResult
    }

    protocol WorkspaceWindowCommanding: Sendable {
        func openWorkspace(_ summary: WorkspaceIndex.WorkspaceSummary) async throws -> FenrirWindowID
        func switchWorkspace(_ summary: WorkspaceIndex.WorkspaceSummary) async throws -> FenrirWindowID
    }

    protocol RemoteWorkspaceAttaching: Sendable {
        func attachRemoteWorkspace(endpointID: String, identity: WorkspaceIndex.WorkspaceIdentity) async throws -> WorkspaceIndex.WorkspaceSummary
    }

    protocol WorkspaceShellEventPublishing: Sendable {
        func publish(_ event: EventEnvelope<Event>) async
    }

    protocol WorkspaceSidebarToggling: Sendable {
        func toggleSidebar(_ input: ToggleWorkspaceSidebarInput) async throws -> ToggleWorkspaceSidebarResult
    }
}
