import Foundation
import FenrirNativeShared
import WorkspaceIndex
import ServerConnection
import NativeRuntime
import PaneGrid
import TerminalViewport

public extension WorkspaceCoordinator {
    enum OpenMode: String, Codable, Equatable, Sendable {
        case focusExisting
        case newWindow
        case attach
    }

    enum ServerSelection: Codable, Equatable, Sendable {
        case local
        case remote(ServerConnection.Endpoint)
        case profile(ProfileID)
    }

    enum WorkspaceCoordinatorError: String, Error, Codable, Equatable, Sendable {
        case resolutionFailed = "WorkspaceResolutionFailed"
        case alreadyOpen = "WorkspaceAlreadyOpen"
        case notOpen = "WorkspaceNotOpen"
        case notFound = "WorkspaceNotFound"
        case serverSelectionFailed = "WorkspaceServerSelectionFailed"
        case serverUnavailable = "WorkspaceServerUnavailable"
        case creationFailed = "WorkspaceCreationFailed"
        case attachFailed = "WorkspaceAttachFailed"
        case focusFailed = "WorkspaceFocusFailed"
        case closeFailed = "WorkspaceCloseFailed"
        case reconnectFailed = "WorkspaceReconnectFailed"
        case restoreFailed = "WorkspaceRestoreFailed"
        case partialAttachFailed = "WorkspacePartialAttachFailed"
        case permissionDenied = "WorkspacePermissionDenied"
    }

    struct VisiblePaneRestore: Codable, Equatable, Sendable {
        public let paneID: PaneID
        public let viewportID: ViewportID
        public let streamID: StreamID

        public init(paneID: PaneID, viewportID: ViewportID, streamID: StreamID) {
            self.paneID = paneID
            self.viewportID = viewportID
            self.streamID = streamID
        }
    }

    struct WorkspaceExperience: Codable, Equatable, Sendable {
        public let workspace: WorkspaceIndex.WorkspaceSummary
        public let serverSelection: ServerSelection
        public let windowID: FenrirWindowID?
        public let runtime: NativeRuntime.WorkspaceRuntimeState?
        public let layout: PaneGrid.State?
        public let restoredPanes: [VisiblePaneRestore]

        public init(
            workspace: WorkspaceIndex.WorkspaceSummary,
            serverSelection: ServerSelection,
            windowID: FenrirWindowID? = nil,
            runtime: NativeRuntime.WorkspaceRuntimeState? = nil,
            layout: PaneGrid.State? = nil,
            restoredPanes: [VisiblePaneRestore] = []
        ) {
            self.workspace = workspace
            self.serverSelection = serverSelection
            self.windowID = windowID
            self.runtime = runtime
            self.layout = layout
            self.restoredPanes = restoredPanes
        }
    }

    struct OpenWorkspaceInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let identity: WorkspaceIndex.WorkspaceIdentity
        public let mode: OpenMode
        public let serverSelection: ServerSelection
        public let source: ActionSource

        public init(requestID: RequestID, identity: WorkspaceIndex.WorkspaceIdentity, mode: OpenMode = .focusExisting, serverSelection: ServerSelection = .local, source: ActionSource) {
            self.requestID = requestID
            self.identity = identity
            self.mode = mode
            self.serverSelection = serverSelection
            self.source = source
        }
    }

    struct OpenWorkspaceResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let experience: WorkspaceExperience
        public let didCreateWindow: Bool
        public let didFocusExistingWindow: Bool
        public let timestamp: FenrirTimestamp
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

    struct SwitchWorkspaceResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let experience: WorkspaceExperience
        public let timestamp: FenrirTimestamp
    }

    struct CloseWorkspaceExperienceInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.source = source
        }
    }

    struct CloseWorkspaceExperienceResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let timestamp: FenrirTimestamp
    }

    struct ReconnectWorkspaceExperienceInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let identity: WorkspaceIndex.WorkspaceIdentity
        public let serverSelection: ServerSelection
        public let source: ActionSource

        public init(requestID: RequestID, identity: WorkspaceIndex.WorkspaceIdentity, serverSelection: ServerSelection = .local, source: ActionSource) {
            self.requestID = requestID
            self.identity = identity
            self.serverSelection = serverSelection
            self.source = source
        }
    }

    struct ReconnectWorkspaceExperienceResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let experience: WorkspaceExperience
        public let timestamp: FenrirTimestamp
    }

    struct RestoreVisiblePanesInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspace: WorkspaceIndex.WorkspaceSummary
        public let layoutSnapshot: PaneGrid.SessionSnapshot
        public let source: ActionSource

        public init(requestID: RequestID, workspace: WorkspaceIndex.WorkspaceSummary, layoutSnapshot: PaneGrid.SessionSnapshot, source: ActionSource) {
            self.requestID = requestID
            self.workspace = workspace
            self.layoutSnapshot = layoutSnapshot
            self.source = source
        }
    }

    struct RestoreVisiblePanesResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let layout: PaneGrid.State
        public let restoredPanes: [VisiblePaneRestore]
        public let timestamp: FenrirTimestamp
    }

    enum Event: Codable, Equatable, Sendable {
        case workspaceResolved(WorkspaceID)
        case serverSelected(WorkspaceID)
        case workspaceRuntimeAttached(WorkspaceID)
        case workspaceWindowOpened(WorkspaceID, FenrirWindowID)
        case workspaceFocused(WorkspaceID)
        case visiblePanesRestored(WorkspaceID, Int)
        case workspaceOpened(WorkspaceID)
        case workspaceSwitched(WorkspaceID)
        case workspaceClosed(WorkspaceID)
        case workspaceReconnected(WorkspaceID)
        case workspacePartialAttachFailed(WorkspaceID)
    }
}
