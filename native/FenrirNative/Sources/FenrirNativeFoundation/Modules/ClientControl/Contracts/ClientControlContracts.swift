import Foundation
import FenrirNativeShared
import WorkspaceIndex
import WorkspaceCoordinator

public extension ClientControl {
    enum CommandKind: String, Codable, Equatable, Sendable {
        case openWorkspace
        case switchWorkspace
        case listWorkspaces
        case attachWorkspace
        case removeWorkspace
        case focusWorkspace
        case controlWorkspace
    }

    enum WorkspaceControlOperation: String, Codable, Equatable, Sendable {
        case close
        case reconnect
    }

    enum ClientControlError: String, Error, Codable, Equatable, Sendable {
        case unavailable = "ClientControlUnavailable"
        case decodeError = "ClientControlDecodeError"
        case permissionError = "ClientControlPermissionError"
        case workspaceNotFound = "ClientControlWorkspaceNotFound"
        case workspaceNotOpen = "ClientControlWorkspaceNotOpen"
        case confirmationRequired = "ClientControlConfirmationRequired"
    }

    struct OpenWorkspaceInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let identity: WorkspaceIndex.WorkspaceIdentity
        public let source: ActionSource

        public init(requestID: RequestID, identity: WorkspaceIndex.WorkspaceIdentity, source: ActionSource = .clientControl) {
            self.requestID = requestID
            self.identity = identity
            self.source = source
        }
    }

    struct OpenWorkspaceResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspace: WorkspaceIndex.WorkspaceSummary
        public let windowID: FenrirWindowID?
        public let didCreateWindow: Bool
        public let didFocusExistingWindow: Bool
        public let timestamp: FenrirTimestamp

        public init(
            requestID: RequestID,
            workspace: WorkspaceIndex.WorkspaceSummary,
            windowID: FenrirWindowID?,
            didCreateWindow: Bool,
            didFocusExistingWindow: Bool,
            timestamp: FenrirTimestamp
        ) {
            self.requestID = requestID
            self.workspace = workspace
            self.windowID = windowID
            self.didCreateWindow = didCreateWindow
            self.didFocusExistingWindow = didFocusExistingWindow
            self.timestamp = timestamp
        }
    }

    struct SwitchWorkspaceInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let identity: WorkspaceIndex.WorkspaceIdentity
        public let source: ActionSource

        public init(requestID: RequestID, identity: WorkspaceIndex.WorkspaceIdentity, source: ActionSource = .clientControl) {
            self.requestID = requestID
            self.identity = identity
            self.source = source
        }
    }

    struct SwitchWorkspaceResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspace: WorkspaceIndex.WorkspaceSummary
        public let windowID: FenrirWindowID?
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, workspace: WorkspaceIndex.WorkspaceSummary, windowID: FenrirWindowID?, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.workspace = workspace
            self.windowID = windowID
            self.timestamp = timestamp
        }
    }

    struct ListWorkspacesInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let includeServer: Bool
        public let includeHidden: Bool
        public let surface: WorkspaceIndex.WorkspaceListSurface
        public let sort: WorkspaceIndex.WorkspaceSort
        public let source: ActionSource

        public init(
            requestID: RequestID,
            includeServer: Bool = true,
            includeHidden: Bool = false,
            surface: WorkspaceIndex.WorkspaceListSurface = .cli,
            sort: WorkspaceIndex.WorkspaceSort = .favoriteThenRecent,
            source: ActionSource = .clientControl
        ) {
            self.requestID = requestID
            self.includeServer = includeServer
            self.includeHidden = includeHidden
            self.surface = surface
            self.sort = sort
            self.source = source
        }
    }

    struct ListWorkspacesResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaces: [WorkspaceIndex.WorkspaceSummary]
        public let activeWorkspaceID: WorkspaceID?
        public let timestamp: FenrirTimestamp

        public init(
            requestID: RequestID,
            workspaces: [WorkspaceIndex.WorkspaceSummary],
            activeWorkspaceID: WorkspaceID? = nil,
            timestamp: FenrirTimestamp
        ) {
            self.requestID = requestID
            self.workspaces = workspaces
            self.activeWorkspaceID = activeWorkspaceID
            self.timestamp = timestamp
        }
    }

    struct AttachWorkspaceInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let identity: WorkspaceIndex.WorkspaceIdentity
        public let serverSelection: WorkspaceCoordinator.ServerSelection
        public let source: ActionSource

        public init(
            requestID: RequestID,
            identity: WorkspaceIndex.WorkspaceIdentity,
            serverSelection: WorkspaceCoordinator.ServerSelection = .local,
            source: ActionSource = .clientControl
        ) {
            self.requestID = requestID
            self.identity = identity
            self.serverSelection = serverSelection
            self.source = source
        }
    }

    struct AttachWorkspaceResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspace: WorkspaceIndex.WorkspaceSummary
        public let windowID: FenrirWindowID?
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, workspace: WorkspaceIndex.WorkspaceSummary, windowID: FenrirWindowID?, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.workspace = workspace
            self.windowID = windowID
            self.timestamp = timestamp
        }
    }

    struct RemoveWorkspaceInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let targetIdentity: WorkspaceIndex.WorkspaceIdentity?
        public let source: ActionSource

        public init(
            requestID: RequestID,
            workspaceID: WorkspaceID,
            targetIdentity: WorkspaceIndex.WorkspaceIdentity? = nil,
            source: ActionSource = .clientControl
        ) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.targetIdentity = targetIdentity
            self.source = source
        }
    }

    struct RemoveWorkspaceResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, workspaceID: WorkspaceID, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.timestamp = timestamp
        }
    }

    struct FocusWorkspaceInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let identity: WorkspaceIndex.WorkspaceIdentity
        public let source: ActionSource

        public init(requestID: RequestID, identity: WorkspaceIndex.WorkspaceIdentity, source: ActionSource = .clientControl) {
            self.requestID = requestID
            self.identity = identity
            self.source = source
        }
    }

    struct FocusWorkspaceResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspace: WorkspaceIndex.WorkspaceSummary
        public let windowID: FenrirWindowID?
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, workspace: WorkspaceIndex.WorkspaceSummary, windowID: FenrirWindowID?, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.workspace = workspace
            self.windowID = windowID
            self.timestamp = timestamp
        }
    }

    struct ControlWorkspaceInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let operation: WorkspaceControlOperation
        public let workspaceID: WorkspaceID?
        public let identity: WorkspaceIndex.WorkspaceIdentity?
        public let serverSelection: WorkspaceCoordinator.ServerSelection
        public let source: ActionSource

        public init(
            requestID: RequestID,
            operation: WorkspaceControlOperation,
            workspaceID: WorkspaceID? = nil,
            identity: WorkspaceIndex.WorkspaceIdentity? = nil,
            serverSelection: WorkspaceCoordinator.ServerSelection = .local,
            source: ActionSource = .clientControl
        ) {
            self.requestID = requestID
            self.operation = operation
            self.workspaceID = workspaceID
            self.identity = identity
            self.serverSelection = serverSelection
            self.source = source
        }
    }

    struct ControlWorkspaceResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let operation: WorkspaceControlOperation
        public let workspaceID: WorkspaceID
        public let workspace: WorkspaceIndex.WorkspaceSummary?
        public let timestamp: FenrirTimestamp

        public init(
            requestID: RequestID,
            operation: WorkspaceControlOperation,
            workspaceID: WorkspaceID,
            workspace: WorkspaceIndex.WorkspaceSummary? = nil,
            timestamp: FenrirTimestamp
        ) {
            self.requestID = requestID
            self.operation = operation
            self.workspaceID = workspaceID
            self.workspace = workspace
            self.timestamp = timestamp
        }
    }
}
