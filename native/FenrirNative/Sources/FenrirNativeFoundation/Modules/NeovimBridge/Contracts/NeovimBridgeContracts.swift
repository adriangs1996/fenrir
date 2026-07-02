import Foundation
import FenrirNativeShared
import NativeRuntime

public extension NeovimBridge {
    enum NeovimBridgeError: Error, Codable, Equatable, Sendable {
        case noActiveNeovimPane
        case stalePane(PaneID)
        case paneNotFound(PaneID)
        case unsupportedBridge(PaneID)
        case runtimeFailure(String)
        case bridgeFailure(String)
        case createFailed(String)
    }

    enum OpenFilePolicy: String, Codable, Equatable, Sendable {
        case requireActivePane
        case createIfNeeded
    }

    enum BridgeCapability: String, Codable, Equatable, Sendable {
        case supported
        case unsupported
        case unknown
    }

    enum OpenFileRoute: Codable, Equatable, Sendable {
        case bridge(PaneID)
        case focusedWithoutBridge(PaneID)
        case created(PaneID)
    }

    struct FileTarget: Codable, Equatable, Sendable {
        public let path: String
        public let line: Int?
        public let column: Int?

        public init(path: String, line: Int? = nil, column: Int? = nil) {
            self.path = path
            self.line = line
            self.column = column
        }
    }

    struct NeovimPaneDescriptor: Codable, Equatable, Sendable {
        public let workspaceID: WorkspaceID
        public let windowID: FenrirWindowID
        public let paneID: PaneID
        public let tmuxPaneID: NativeRuntime.TmuxPaneID?
        public let bridgeSocketPath: String?
        public let bridgeCapability: BridgeCapability
        public let bootstrapID: String?

        public init(
            workspaceID: WorkspaceID,
            windowID: FenrirWindowID,
            paneID: PaneID,
            tmuxPaneID: NativeRuntime.TmuxPaneID? = nil,
            bridgeSocketPath: String? = nil,
            bridgeCapability: BridgeCapability = .unknown,
            bootstrapID: String? = nil
        ) {
            self.workspaceID = workspaceID
            self.windowID = windowID
            self.paneID = paneID
            self.tmuxPaneID = tmuxPaneID
            self.bridgeSocketPath = bridgeSocketPath
            self.bridgeCapability = bridgeCapability
            self.bootstrapID = bootstrapID
        }
    }

    struct ActiveNeovimState: Codable, Equatable, Sendable {
        public let paneID: PaneID
        public let bufferPath: String?
        public let cursorLine: Int?
        public let cursorColumn: Int?
        public let bridgeCapability: BridgeCapability

        public init(
            paneID: PaneID,
            bufferPath: String? = nil,
            cursorLine: Int? = nil,
            cursorColumn: Int? = nil,
            bridgeCapability: BridgeCapability
        ) {
            self.paneID = paneID
            self.bufferPath = bufferPath
            self.cursorLine = cursorLine
            self.cursorColumn = cursorColumn
            self.bridgeCapability = bridgeCapability
        }
    }

    struct OpenFileInNeovimInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let windowID: FenrirWindowID?
        public let actor: NativeRuntime.RuntimeActorIdentity
        public let target: FileTarget
        public let policy: OpenFilePolicy
        public let source: ActionSource

        public init(
            requestID: RequestID,
            workspaceID: WorkspaceID,
            windowID: FenrirWindowID? = nil,
            actor: NativeRuntime.RuntimeActorIdentity,
            target: FileTarget,
            policy: OpenFilePolicy = .createIfNeeded,
            source: ActionSource
        ) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.windowID = windowID
            self.actor = actor
            self.target = target
            self.policy = policy
            self.source = source
        }
    }

    struct OpenFileInNeovimResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let route: OpenFileRoute
        public let pane: NeovimPaneDescriptor
        public let activeState: ActiveNeovimState?
        public let timestamp: FenrirTimestamp
    }

    struct FocusNeovimPaneInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let paneID: PaneID?
        public let actor: NativeRuntime.RuntimeActorIdentity
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, paneID: PaneID? = nil, actor: NativeRuntime.RuntimeActorIdentity, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.paneID = paneID
            self.actor = actor
            self.source = source
        }
    }

    struct FocusNeovimPaneResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let pane: NeovimPaneDescriptor
        public let timestamp: FenrirTimestamp
    }

    struct DetectActiveNeovimStateInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let actor: NativeRuntime.RuntimeActorIdentity
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, actor: NativeRuntime.RuntimeActorIdentity, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.actor = actor
            self.source = source
        }
    }

    struct DetectActiveNeovimStateResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let pane: NeovimPaneDescriptor?
        public let state: ActiveNeovimState?
        public let timestamp: FenrirTimestamp
    }
}
