import Foundation
import FenrirNativeShared

public extension Notifications {
    enum NotificationsError: Error, Codable, Equatable, Sendable {
        case unavailable
        case notificationNotFound(NotificationID)
        case storeFailure(String)
        /// D-043 sanitization left an empty payload; the event was dropped
        /// and the caller should record a diagnostics count.
        case malformedNotificationPayload
    }

    struct NotificationID: FenrirID, ExpressibleByStringLiteral {
        public let rawValue: String

        public init(rawValue: String) {
            self.rawValue = rawValue
        }

        public init(stringLiteral value: String) {
            self.init(rawValue: value)
        }

        public static func generated() -> NotificationID {
            NotificationID(rawValue: UUID().uuidString)
        }
    }

    struct ModuleSummary: Codable, Equatable, Sendable {
        public let moduleName: String
        public let registeredAt: FenrirTimestamp

        public init(moduleName: String = "Notifications", registeredAt: FenrirTimestamp) {
            self.moduleName = moduleName
            self.registeredAt = registeredAt
        }
    }

    struct DescribeNotificationsModuleInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let source: ActionSource

        public init(requestID: RequestID, source: ActionSource) {
            self.requestID = requestID
            self.source = source
        }
    }

    struct DescribeNotificationsModuleResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let summary: ModuleSummary
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, summary: ModuleSummary, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.summary = summary
            self.timestamp = timestamp
        }
    }

    enum NotificationSeverity: String, Codable, Equatable, Sendable, Comparable {
        case info
        case warning
        case critical

        public static func < (lhs: NotificationSeverity, rhs: NotificationSeverity) -> Bool {
            lhs.rank < rhs.rank
        }

        var rank: Int {
            switch self {
            case .info:
                0
            case .warning:
                1
            case .critical:
                2
            }
        }
    }

    enum NotificationSource: Codable, Equatable, Sendable {
        case workspace
        case workflow(runID: String)
        case agent(conversationID: String)
        case server(profileID: ProfileID?)
    }

    enum NotificationLifecycle: String, Codable, Equatable, Sendable {
        case active
        case acknowledged
        case expired
    }

    struct NotificationDedupeKey: Codable, Hashable, Sendable, ExpressibleByStringLiteral {
        public let rawValue: String

        public init(rawValue: String) {
            self.rawValue = rawValue
        }

        public init(stringLiteral value: String) {
            self.init(rawValue: value)
        }
    }

    struct NotificationRecord: Codable, Equatable, Sendable {
        public let id: NotificationID
        public let workspaceID: WorkspaceID
        public let source: NotificationSource
        public let severity: NotificationSeverity
        public let title: String
        public let message: String
        public let dedupeKey: NotificationDedupeKey
        public let lifecycle: NotificationLifecycle
        public let createdAt: FenrirTimestamp
        public let updatedAt: FenrirTimestamp
        public let expiresAt: FenrirTimestamp?

        public init(
            id: NotificationID,
            workspaceID: WorkspaceID,
            source: NotificationSource,
            severity: NotificationSeverity,
            title: String,
            message: String,
            dedupeKey: NotificationDedupeKey,
            lifecycle: NotificationLifecycle = .active,
            createdAt: FenrirTimestamp,
            updatedAt: FenrirTimestamp,
            expiresAt: FenrirTimestamp? = nil
        ) {
            self.id = id
            self.workspaceID = workspaceID
            self.source = source
            self.severity = severity
            self.title = title
            self.message = message
            self.dedupeKey = dedupeKey
            self.lifecycle = lifecycle
            self.createdAt = createdAt
            self.updatedAt = updatedAt
            self.expiresAt = expiresAt
        }
    }

    struct WorkspaceNotificationProjection: Codable, Equatable, Sendable {
        public let workspaceID: WorkspaceID
        public let activeCount: Int
        public let unacknowledgedCount: Int
        public let highestSeverity: NotificationSeverity?
        public let items: [NotificationRecord]

        public init(
            workspaceID: WorkspaceID,
            activeCount: Int,
            unacknowledgedCount: Int,
            highestSeverity: NotificationSeverity?,
            items: [NotificationRecord]
        ) {
            self.workspaceID = workspaceID
            self.activeCount = activeCount
            self.unacknowledgedCount = unacknowledgedCount
            self.highestSeverity = highestSeverity
            self.items = items
        }
    }

    struct CreateNotificationInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let source: NotificationSource
        public let severity: NotificationSeverity
        public let title: String
        public let message: String
        public let dedupeKey: NotificationDedupeKey
        public let ttlSeconds: TimeInterval?
        public let sourceAction: ActionSource

        public init(
            requestID: RequestID,
            workspaceID: WorkspaceID,
            source: NotificationSource,
            severity: NotificationSeverity,
            title: String,
            message: String,
            dedupeKey: NotificationDedupeKey,
            ttlSeconds: TimeInterval? = nil,
            sourceAction: ActionSource
        ) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.source = source
            self.severity = severity
            self.title = title
            self.message = message
            self.dedupeKey = dedupeKey
            self.ttlSeconds = ttlSeconds
            self.sourceAction = sourceAction
        }
    }

    struct CreateNotificationResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let notification: NotificationRecord
        public let deduped: Bool
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, notification: NotificationRecord, deduped: Bool, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.notification = notification
            self.deduped = deduped
            self.timestamp = timestamp
        }
    }

    struct AcknowledgeNotificationInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let notificationID: NotificationID
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, notificationID: NotificationID, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.notificationID = notificationID
            self.source = source
        }
    }

    struct AcknowledgeNotificationResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let notification: NotificationRecord
        public let changed: Bool
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, notification: NotificationRecord, changed: Bool, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.notification = notification
            self.changed = changed
            self.timestamp = timestamp
        }
    }

    struct ExpireNotificationsInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID?
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID? = nil, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.source = source
        }
    }

    struct ExpireNotificationsResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let expired: [NotificationRecord]
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, expired: [NotificationRecord], timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.expired = expired
            self.timestamp = timestamp
        }
    }

    struct ListNotificationsInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let includeAcknowledged: Bool
        public let includeExpired: Bool
        public let source: ActionSource

        public init(
            requestID: RequestID,
            workspaceID: WorkspaceID,
            includeAcknowledged: Bool = true,
            includeExpired: Bool = false,
            source: ActionSource
        ) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.includeAcknowledged = includeAcknowledged
            self.includeExpired = includeExpired
            self.source = source
        }
    }

    struct ListNotificationsResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let notifications: [NotificationRecord]
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, notifications: [NotificationRecord], timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.notifications = notifications
            self.timestamp = timestamp
        }
    }

    struct ProjectWorkspaceNotificationsInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.source = source
        }
    }

    struct ProjectWorkspaceNotificationsResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let projection: WorkspaceNotificationProjection
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, projection: WorkspaceNotificationProjection, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.projection = projection
            self.timestamp = timestamp
        }
    }

    enum Event: Codable, Equatable, Sendable {
        case moduleRegistered(String)
        case notificationCreated(NotificationID)
        case notificationAcknowledged(NotificationID)
        case notificationsExpired([NotificationID])
    }
}
