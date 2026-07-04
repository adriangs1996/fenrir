import Foundation
import FenrirNativeShared

extension Notifications {
    /// In-memory workspace attention feed (D-043/D-045). Coalescing and the
    /// per-workspace retention bound are delegated to the pure model helpers
    /// so the actor stays a thin, serialized state holder.
    actor InMemoryWorkspaceNotificationStore: WorkspaceNotificationStoring {
        private let clock: any NotificationsClock
        private let coalescingWindowSeconds: TimeInterval
        private let maxNotificationsPerWorkspace: Int
        private var feed: [WorkspaceNotification] = []

        init(
            clock: any NotificationsClock,
            coalescingWindowSeconds: TimeInterval = WorkspaceAttentionPolicy.coalescingWindowSeconds,
            maxNotificationsPerWorkspace: Int = WorkspaceAttentionPolicy.maxNotificationsPerWorkspace
        ) {
            self.clock = clock
            self.coalescingWindowSeconds = coalescingWindowSeconds
            self.maxNotificationsPerWorkspace = maxNotificationsPerWorkspace
        }

        func append(_ draft: WorkspaceNotificationDraft) async -> AppendWorkspaceNotificationOutcome? {
            let (notifications, outcome) = Notifications.appendingWorkspaceNotification(
                draft,
                to: feed,
                now: clock.now(),
                coalescingWindowSeconds: coalescingWindowSeconds,
                maxPerWorkspace: maxNotificationsPerWorkspace
            )
            feed = notifications
            return outcome
        }

        func markRead(_ id: NotificationID) async -> Bool {
            let (notifications, changed) = Notifications.markingWorkspaceNotificationRead(id: id, in: feed)
            feed = notifications
            return changed
        }

        func markAllRead(workspaceID: WorkspaceID) async -> Int {
            let (notifications, markedCount) = Notifications.markingAllWorkspaceNotificationsRead(
                workspaceID: workspaceID,
                in: feed
            )
            feed = notifications
            return markedCount
        }

        func unreadCount(workspaceID: WorkspaceID) async -> Int {
            Notifications.unreadWorkspaceNotificationCount(in: feed, workspaceID: workspaceID)
        }

        func latestUnread(workspaceID: WorkspaceID) async -> WorkspaceNotification? {
            Notifications.latestUnreadWorkspaceNotification(in: feed, workspaceID: workspaceID)
        }

        func latest(workspaceID: WorkspaceID) async -> WorkspaceNotification? {
            Notifications.latestWorkspaceNotification(in: feed, workspaceID: workspaceID)
        }

        func notifications(workspaceID: WorkspaceID) async -> [WorkspaceNotification] {
            feed.filter { $0.workspaceID == workspaceID }
        }
    }
}
