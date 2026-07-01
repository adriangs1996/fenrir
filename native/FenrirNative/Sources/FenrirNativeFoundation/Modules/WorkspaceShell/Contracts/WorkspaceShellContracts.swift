import Foundation
import FenrirNativeShared
import WorkspaceIndex

public extension WorkspaceShell {
    enum SidebarVisibility: String, Codable, Equatable, Sendable {
        case expanded
        case collapsed
    }

    enum WorkspaceShellError: String, Error, Codable, Equatable, Sendable {
        case createFailed = "WorkspaceShellCreateFailed"
        case closeFailed = "WorkspaceShellCloseFailed"
        case focusFailed = "WorkspaceShellFocusFailed"
        case notFound = "WorkspaceShellNotFound"
        case invalidCommand = "WorkspaceShellInvalidCommand"
        case workspaceNotFound = "WorkspaceShellWorkspaceNotFound"
        case remoteAttachFailed = "WorkspaceShellRemoteAttachFailed"
        case removeFailed = "WorkspaceShellRemoveFailed"
        case listFailed = "WorkspaceShellListFailed"
        case formatFailed = "WorkspaceShellFormatFailed"
        case switcherFailed = "WorkspaceShellSwitcherFailed"
        case tabNotFound = "WorkspaceShellTabNotFound"
        case paneNotFound = "WorkspaceShellPaneNotFound"
    }

    enum CommandVerb: String, Codable, Equatable, Sendable {
        case open
        case list
        case `switch`
        case attach
        case remove
    }

    enum CommandOutputFormat: String, Codable, Equatable, Sendable {
        case text
        case jsonLines
    }

    struct TabPresentation: Codable, Equatable, Sendable {
        public let windowID: FenrirWindowID
        public let title: String
        public let isActive: Bool

        public init(windowID: FenrirWindowID, title: String, isActive: Bool) {
            self.windowID = windowID
            self.title = title
            self.isActive = isActive
        }
    }

    struct State: Codable, Equatable, Sendable {
        public let workspaceID: WorkspaceID
        public let nativeWindowID: FenrirWindowID
        public let sidebarVisibility: SidebarVisibility
        public let activeTabID: FenrirWindowID?
        public let activePaneID: PaneID?
        public let tabs: [TabPresentation]

        public init(
            workspaceID: WorkspaceID,
            nativeWindowID: FenrirWindowID,
            sidebarVisibility: SidebarVisibility,
            activeTabID: FenrirWindowID?,
            activePaneID: PaneID?,
            tabs: [TabPresentation]
        ) {
            self.workspaceID = workspaceID
            self.nativeWindowID = nativeWindowID
            self.sidebarVisibility = sidebarVisibility
            self.activeTabID = activeTabID
            self.activePaneID = activePaneID
            self.tabs = tabs
        }
    }

    struct CommandRequest: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let verb: CommandVerb
        public let workspaceIdentity: WorkspaceIndex.WorkspaceIdentity?
        public let remoteEndpointID: String?
        public let outputFormat: CommandOutputFormat
        public let source: ActionSource

        public init(
            requestID: RequestID,
            verb: CommandVerb,
            workspaceIdentity: WorkspaceIndex.WorkspaceIdentity? = nil,
            remoteEndpointID: String? = nil,
            outputFormat: CommandOutputFormat = .text,
            source: ActionSource
        ) {
            self.requestID = requestID
            self.verb = verb
            self.workspaceIdentity = workspaceIdentity
            self.remoteEndpointID = remoteEndpointID
            self.outputFormat = outputFormat
            self.source = source
        }
    }

    struct CommandResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let verb: CommandVerb
        public let status: String
        public let workspace: WorkspaceIndex.WorkspaceSummary?
        public let workspaces: [WorkspaceIndex.WorkspaceSummary]
        public let nativeWindowID: FenrirWindowID?
        public let timestamp: FenrirTimestamp

        public init(
            requestID: RequestID,
            verb: CommandVerb,
            status: String,
            workspace: WorkspaceIndex.WorkspaceSummary? = nil,
            workspaces: [WorkspaceIndex.WorkspaceSummary] = [],
            nativeWindowID: FenrirWindowID? = nil,
            timestamp: FenrirTimestamp
        ) {
            self.requestID = requestID
            self.verb = verb
            self.status = status
            self.workspace = workspace
            self.workspaces = workspaces
            self.nativeWindowID = nativeWindowID
            self.timestamp = timestamp
        }
    }

    struct OpenWorkspaceInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let identity: WorkspaceIndex.WorkspaceIdentity
        public let source: ActionSource

        public init(requestID: RequestID, identity: WorkspaceIndex.WorkspaceIdentity, source: ActionSource) {
            self.requestID = requestID
            self.identity = identity
            self.source = source
        }
    }

    struct SwitchWorkspaceInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let identity: WorkspaceIndex.WorkspaceIdentity
        public let source: ActionSource

        public init(requestID: RequestID, identity: WorkspaceIndex.WorkspaceIdentity, source: ActionSource) {
            self.requestID = requestID
            self.identity = identity
            self.source = source
        }
    }

    struct AttachRemoteWorkspaceInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let endpointID: String
        public let identity: WorkspaceIndex.WorkspaceIdentity
        public let source: ActionSource

        public init(requestID: RequestID, endpointID: String, identity: WorkspaceIndex.WorkspaceIdentity, source: ActionSource) {
            self.requestID = requestID
            self.endpointID = endpointID
            self.identity = identity
            self.source = source
        }
    }

    struct RemoveWorkspaceInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let identity: WorkspaceIndex.WorkspaceIdentity
        public let source: ActionSource

        public init(requestID: RequestID, identity: WorkspaceIndex.WorkspaceIdentity, source: ActionSource) {
            self.requestID = requestID
            self.identity = identity
            self.source = source
        }
    }

    struct ListShellWorkspacesInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let includeRemote: Bool
        public let source: ActionSource

        public init(requestID: RequestID, includeRemote: Bool = true, source: ActionSource) {
            self.requestID = requestID
            self.includeRemote = includeRemote
            self.source = source
        }
    }

    struct FormatCommandResultInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let result: CommandResult?
        public let error: WorkspaceShellError?
        public let outputFormat: CommandOutputFormat
        public let source: ActionSource

        public init(
            requestID: RequestID,
            result: CommandResult? = nil,
            error: WorkspaceShellError? = nil,
            outputFormat: CommandOutputFormat = .text,
            source: ActionSource
        ) {
            self.requestID = requestID
            self.result = result
            self.error = error
            self.outputFormat = outputFormat
            self.source = source
        }
    }

    struct FormatCommandResultResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let exitCode: Int
        public let output: String
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, exitCode: Int, output: String, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.exitCode = exitCode
            self.output = output
            self.timestamp = timestamp
        }
    }

    struct ToggleWorkspaceSidebarInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let nativeWindowID: FenrirWindowID

        public init(requestID: RequestID, nativeWindowID: FenrirWindowID) {
            self.requestID = requestID
            self.nativeWindowID = nativeWindowID
        }
    }

    struct ToggleWorkspaceSidebarResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let state: State
        public let timestamp: FenrirTimestamp
    }

    enum Event: Codable, Equatable, Sendable {
        case workspaceOpened(WorkspaceID)
        case workspaceSwitched(WorkspaceID)
        case remoteWorkspaceAttached(WorkspaceID)
        case workspaceRemoved(WorkspaceID)
        case workspacesListed(Int)
        case commandResultFormatted(RequestID)
        case workspaceSidebarVisibilityChanged(FenrirWindowID, SidebarVisibility)
    }
}
