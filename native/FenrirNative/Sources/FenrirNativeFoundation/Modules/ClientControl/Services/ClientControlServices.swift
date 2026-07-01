import Foundation
import FenrirNativeShared
import WorkspaceIndex
import WorkspaceCoordinator

extension ClientControl {
    protocol WorkspaceOpening: Sendable {
        func openWorkspace(_ input: WorkspaceCoordinator.OpenWorkspaceInput) async throws -> WorkspaceCoordinator.OpenWorkspaceResult
    }

    protocol WorkspaceSwitching: Sendable {
        func switchWorkspace(_ input: WorkspaceCoordinator.SwitchWorkspaceInput) async throws -> WorkspaceCoordinator.SwitchWorkspaceResult
    }

    protocol WorkspaceListing: Sendable {
        func listWorkspaces(_ input: WorkspaceIndex.ListWorkspacesInput) async throws -> WorkspaceIndex.ListWorkspacesResult
    }

    protocol WorkspaceRemoving: Sendable {
        func removeWorkspace(_ input: WorkspaceIndex.RemoveWorkspaceInput) async throws -> WorkspaceIndex.RemoveWorkspaceResult
    }

    protocol WorkspaceControlling: Sendable {
        func closeWorkspace(_ input: WorkspaceCoordinator.CloseWorkspaceExperienceInput) async throws -> WorkspaceCoordinator.CloseWorkspaceExperienceResult
        func reconnectWorkspace(_ input: WorkspaceCoordinator.ReconnectWorkspaceExperienceInput) async throws -> WorkspaceCoordinator.ReconnectWorkspaceExperienceResult
    }
}
