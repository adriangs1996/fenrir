import Foundation
import FenrirNativeShared

extension Notifications {
    struct NotificationsState: Sendable {
        var notifications: [NotificationRecord]

        init(notifications: [NotificationRecord] = []) {
            self.notifications = notifications
        }
    }

    static func sortedForAttention(_ notifications: [NotificationRecord]) -> [NotificationRecord] {
        notifications.sorted { lhs, rhs in
            if lhs.severity != rhs.severity {
                return lhs.severity > rhs.severity
            }

            if lhs.updatedAt != rhs.updatedAt {
                return lhs.updatedAt > rhs.updatedAt
            }

            return lhs.id.rawValue < rhs.id.rawValue
        }
    }

    static func visibleNotifications(
        from notifications: [NotificationRecord],
        workspaceID: WorkspaceID,
        includeAcknowledged: Bool,
        includeExpired: Bool
    ) -> [NotificationRecord] {
        sortedForAttention(notifications.filter { notification in
            guard notification.workspaceID == workspaceID else {
                return false
            }

            switch notification.lifecycle {
            case .active:
                return true
            case .acknowledged:
                return includeAcknowledged
            case .expired:
                return includeExpired
            }
        })
    }

    static func activeProjection(
        from notifications: [NotificationRecord],
        workspaceID: WorkspaceID
    ) -> WorkspaceNotificationProjection {
        let active = sortedForAttention(notifications.filter {
            $0.workspaceID == workspaceID && $0.lifecycle == .active
        })

        return WorkspaceNotificationProjection(
            workspaceID: workspaceID,
            activeCount: active.count,
            unacknowledgedCount: active.count,
            highestSeverity: active.first?.severity,
            items: active
        )
    }

    static func isExpired(_ notification: NotificationRecord, now: FenrirTimestamp) -> Bool {
        guard let expiresAt = notification.expiresAt else {
            return false
        }

        return expiresAt <= now
    }
}
