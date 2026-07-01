import Foundation
import FenrirNativeShared
import WorkspaceIndex
import ServerConnection
import NativeRuntime
import PaneGrid
import TerminalViewport

extension WorkspaceCoordinator {
    protocol WorkspaceCoordinatorClock: Sendable {
        func now() -> FenrirTimestamp
    }

    protocol WorkspaceIndexCoordinating: Sendable {
        func resolveWorkspace(requestID: RequestID, identity: WorkspaceIndex.WorkspaceIdentity) async throws -> WorkspaceIndex.WorkspaceSummary
        func attachWorkspace(requestID: RequestID, workspaceID: WorkspaceID, windowID: FenrirWindowID) async throws -> WorkspaceIndex.WorkspaceSummary
        func detachWorkspace(requestID: RequestID, workspaceID: WorkspaceID) async throws -> WorkspaceIndex.WorkspaceSummary
        func markRecent(requestID: RequestID, workspaceID: WorkspaceID) async throws
    }

    protocol WorkspaceServerSelecting: Sendable {
        func selectServer(_ selection: ServerSelection, workspace: WorkspaceIndex.WorkspaceSummary) async throws -> ServerConnection.Endpoint?
    }

    protocol WorkspaceWindowCoordinating: Sendable {
        func openWindow(workspace: WorkspaceIndex.WorkspaceSummary) async throws -> FenrirWindowID
        func focusWindow(workspace: WorkspaceIndex.WorkspaceSummary) async throws -> FenrirWindowID
        func closeWindow(workspaceID: WorkspaceID) async throws
    }

    protocol WorkspaceRuntimeCoordinating: Sendable {
        func attachWorkspaceRuntime(requestID: RequestID, workspaceID: WorkspaceID, server: ServerConnection.Endpoint?) async throws -> NativeRuntime.WorkspaceRuntimeState
        func reconnectWorkspaceRuntime(requestID: RequestID, workspaceID: WorkspaceID, server: ServerConnection.Endpoint?) async throws -> NativeRuntime.WorkspaceRuntimeState
        func detachWorkspaceRuntime(requestID: RequestID, workspaceID: WorkspaceID) async throws
    }

    protocol WorkspaceLayoutRestoring: Sendable {
        func restorePaneGrid(requestID: RequestID, snapshot: PaneGrid.SessionSnapshot) async throws -> PaneGrid.State
    }

    protocol WorkspaceViewportRestoring: Sendable {
        func restoreViewport(requestID: RequestID, workspaceID: WorkspaceID, paneID: PaneID) async throws -> VisiblePaneRestore
    }

    protocol WorkspaceCoordinatorEventPublishing: Sendable {
        func publish(_ event: EventEnvelope<Event>) async
    }
}
