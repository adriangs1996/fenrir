import Foundation
import FenrirNativeShared

public extension WorkspaceIndex {
    enum WorkspaceStatus: String, Codable, Equatable, Sendable {
        case unknown
        case available
        case open
        case unavailable
    }

    enum WorkspaceIdentityKind: String, Codable, Equatable, Sendable {
        case localPath
        case project
        case remote
    }

    enum WorkspaceVisibility: String, Codable, Equatable, Sendable {
        case visible
        case hidden
    }

    enum WorkspaceNotificationLevel: String, Codable, Equatable, Sendable {
        case none
        case badge
        case attention
    }

    enum WorkspaceListSurface: String, Codable, Equatable, Sendable {
        case sidebar
        case quickSwitcher
        case cli
    }

    enum WorkspaceSort: String, Codable, Equatable, Sendable {
        case displayName
        case recent
        case favoriteThenRecent
    }

    struct WorkspaceIdentity: Codable, Equatable, Sendable {
        public let kind: WorkspaceIdentityKind
        public let workspaceID: WorkspaceID?
        public let projectID: String?
        public let canonicalPath: String?
        public let serverID: String?
        public let profileID: ProfileID?

        public init(
            kind: WorkspaceIdentityKind,
            workspaceID: WorkspaceID? = nil,
            projectID: String? = nil,
            canonicalPath: String? = nil,
            serverID: String? = nil,
            profileID: ProfileID? = nil
        ) {
            self.kind = kind
            self.workspaceID = workspaceID
            self.projectID = projectID
            self.canonicalPath = canonicalPath
            self.serverID = serverID
            self.profileID = profileID
        }
    }

    struct WorkspaceOpenState: Codable, Equatable, Sendable {
        public let isOpenLocally: Bool
        public let windowIDs: [FenrirWindowID]
        public let attachedAt: FenrirTimestamp?

        public init(isOpenLocally: Bool = false, windowIDs: [FenrirWindowID] = [], attachedAt: FenrirTimestamp? = nil) {
            self.isOpenLocally = isOpenLocally
            self.windowIDs = windowIDs
            self.attachedAt = attachedAt
        }
    }

    struct WorkspaceNotificationState: Codable, Equatable, Sendable {
        public let unreadCount: Int
        public let level: WorkspaceNotificationLevel

        public init(unreadCount: Int = 0, level: WorkspaceNotificationLevel = .none) {
            self.unreadCount = unreadCount
            self.level = level
        }
    }

    struct WorkspaceSummary: Codable, Equatable, Sendable {
        public let workspaceID: WorkspaceID
        public let displayName: String
        public let projectID: String?
        public let canonicalPath: String?
        public let serverID: String?
        public let profileID: ProfileID?
        public let identity: WorkspaceIdentity
        public let isFavorite: Bool
        public let openState: WorkspaceOpenState
        public let visibility: WorkspaceVisibility
        public let notifications: WorkspaceNotificationState
        public let lastOpenedAt: FenrirTimestamp?
        public let lastFocusedAt: FenrirTimestamp?
        public let status: WorkspaceStatus

        public var isOpenLocally: Bool {
            openState.isOpenLocally
        }

        public init(
            workspaceID: WorkspaceID,
            displayName: String,
            projectID: String? = nil,
            canonicalPath: String? = nil,
            serverID: String? = nil,
            profileID: ProfileID? = nil,
            identity: WorkspaceIdentity? = nil,
            isFavorite: Bool = false,
            isOpenLocally: Bool = false,
            openState: WorkspaceOpenState? = nil,
            visibility: WorkspaceVisibility = .visible,
            notifications: WorkspaceNotificationState = WorkspaceNotificationState(),
            lastOpenedAt: FenrirTimestamp? = nil,
            lastFocusedAt: FenrirTimestamp? = nil,
            status: WorkspaceStatus = .unknown
        ) {
            self.workspaceID = workspaceID
            self.displayName = displayName
            self.projectID = projectID
            self.canonicalPath = canonicalPath
            self.serverID = serverID
            self.profileID = profileID
            self.identity = identity ?? WorkspaceIdentity(
                kind: canonicalPath == nil ? .project : .localPath,
                workspaceID: workspaceID,
                projectID: projectID,
                canonicalPath: canonicalPath,
                serverID: serverID,
                profileID: profileID
            )
            self.isFavorite = isFavorite
            self.openState = openState ?? WorkspaceOpenState(isOpenLocally: isOpenLocally)
            self.visibility = visibility
            self.notifications = notifications
            self.lastOpenedAt = lastOpenedAt
            self.lastFocusedAt = lastFocusedAt
            self.status = status
        }
    }

    struct WorkspaceIndexSnapshot: Codable, Equatable, Sendable {
        public let workspaces: [WorkspaceSummary]
        public let capturedAt: FenrirTimestamp

        public init(workspaces: [WorkspaceSummary], capturedAt: FenrirTimestamp) {
            self.workspaces = workspaces
            self.capturedAt = capturedAt
        }
    }

    enum WorkspaceIndexError: String, Error, Codable, Equatable, Sendable {
        case readFailed = "WorkspaceIndexReadFailed"
        case writeFailed = "WorkspaceIndexWriteFailed"
        case decodeFailed = "WorkspaceIndexDecodeFailed"
        case workspaceNotFound = "WorkspaceIndexWorkspaceNotFound"
        case duplicateIdentity = "WorkspaceIndexDuplicateIdentity"
        case invalidIdentity = "WorkspaceIndexInvalidIdentity"
        case serverUnavailable = "WorkspaceIndexServerUnavailable"
        case permissionDenied = "WorkspaceIndexPermissionDenied"
    }

    struct ListWorkspacesInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let includeServer: Bool
        public let degradeToLocalOnServerFailure: Bool
        public let includeHidden: Bool
        public let surface: WorkspaceListSurface
        public let sort: WorkspaceSort
        public let source: ActionSource

        public init(
            requestID: RequestID,
            includeServer: Bool,
            degradeToLocalOnServerFailure: Bool = true,
            includeHidden: Bool = false,
            surface: WorkspaceListSurface = .sidebar,
            sort: WorkspaceSort = .favoriteThenRecent,
            source: ActionSource
        ) {
            self.requestID = requestID
            self.includeServer = includeServer
            self.degradeToLocalOnServerFailure = degradeToLocalOnServerFailure
            self.includeHidden = includeHidden
            self.surface = surface
            self.sort = sort
            self.source = source
        }
    }

    struct ListWorkspacesResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let snapshot: WorkspaceIndexSnapshot
        public let isDegraded: Bool
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, snapshot: WorkspaceIndexSnapshot, isDegraded: Bool = false, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.snapshot = snapshot
            self.isDegraded = isDegraded
            self.timestamp = timestamp
        }
    }

    struct RegisterWorkspaceInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let summary: WorkspaceSummary
        public let source: ActionSource

        public init(requestID: RequestID, summary: WorkspaceSummary, source: ActionSource) {
            self.requestID = requestID
            self.summary = summary
            self.source = source
        }
    }

    struct RegisterWorkspaceResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let summary: WorkspaceSummary
        public let timestamp: FenrirTimestamp
    }

    struct AttachWorkspaceInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let windowID: FenrirWindowID
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, windowID: FenrirWindowID, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.windowID = windowID
            self.source = source
        }
    }

    struct AttachWorkspaceResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let summary: WorkspaceSummary
        public let timestamp: FenrirTimestamp
    }

    struct DetachWorkspaceInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let windowID: FenrirWindowID?
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, windowID: FenrirWindowID? = nil, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.windowID = windowID
            self.source = source
        }
    }

    struct DetachWorkspaceResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let summary: WorkspaceSummary
        public let timestamp: FenrirTimestamp
    }

    struct RemoveWorkspaceInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.source = source
        }
    }

    struct RemoveWorkspaceResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let timestamp: FenrirTimestamp
    }

    struct MarkWorkspaceRecentInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.source = source
        }
    }

    struct MarkWorkspaceRecentResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let summary: WorkspaceSummary
        public let timestamp: FenrirTimestamp
    }

    struct MarkWorkspaceFavoriteInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let isFavorite: Bool
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, isFavorite: Bool, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.isFavorite = isFavorite
            self.source = source
        }
    }

    struct MarkWorkspaceFavoriteResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let summary: WorkspaceSummary
        public let timestamp: FenrirTimestamp
    }

    struct UpdateWorkspaceVisibilityInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let visibility: WorkspaceVisibility
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, visibility: WorkspaceVisibility, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.visibility = visibility
            self.source = source
        }
    }

    struct UpdateWorkspaceVisibilityResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let summary: WorkspaceSummary
        public let timestamp: FenrirTimestamp
    }

    struct UpdateWorkspaceNotificationsInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let notifications: WorkspaceNotificationState
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, notifications: WorkspaceNotificationState, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.notifications = notifications
            self.source = source
        }
    }

    struct UpdateWorkspaceNotificationsResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let summary: WorkspaceSummary
        public let timestamp: FenrirTimestamp
    }

    struct ResolveWorkspaceInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let identity: WorkspaceIdentity
        public let includeServer: Bool
        public let source: ActionSource

        public init(requestID: RequestID, identity: WorkspaceIdentity, includeServer: Bool = true, source: ActionSource) {
            self.requestID = requestID
            self.identity = identity
            self.includeServer = includeServer
            self.source = source
        }
    }

    struct ResolveWorkspaceResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let summary: WorkspaceSummary
        public let timestamp: FenrirTimestamp
    }

    enum Event: Codable, Equatable, Sendable {
        case workspaceIndexChanged
        case workspaceRegistered(WorkspaceID)
        case workspaceAttached(WorkspaceID)
        case workspaceDetached(WorkspaceID)
        case workspaceRemoved(WorkspaceID)
        case workspaceRecentMarked(WorkspaceID)
        case workspaceFavoriteChanged(WorkspaceID, Bool)
        case workspaceVisibilityChanged(WorkspaceID, WorkspaceVisibility)
        case workspaceNotificationsChanged(WorkspaceID, WorkspaceNotificationState)
        case workspaceResolved(WorkspaceID)
    }
}
