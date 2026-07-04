import Foundation
import FenrirNativeShared

public extension Notifications {
    /// Store port for the workspace attention feed (D-043 routing target,
    /// D-045 badge/latest-line/jump source). Implementations own coalescing
    /// and bounded retention via the module policy.
    protocol WorkspaceNotificationStoring: Sendable {
        /// Appends a draft, coalescing identical title+body+pane events that
        /// arrive within `WorkspaceAttentionPolicy.coalescingWindowSeconds`.
        /// Payloads are sanitized per D-043 (control characters stripped,
        /// length-capped); malformed drafts are dropped and return nil so the
        /// caller can record a diagnostics count.
        func append(_ draft: WorkspaceNotificationDraft) async -> AppendWorkspaceNotificationOutcome?
        /// Marks one notification read; returns whether anything changed.
        func markRead(_ id: NotificationID) async -> Bool
        /// Marks every notification in the workspace read; returns how many changed.
        func markAllRead(workspaceID: WorkspaceID) async -> Int
        func unreadCount(workspaceID: WorkspaceID) async -> Int
        /// Most recent unread notification (jump-to-latest-unread source).
        func latestUnread(workspaceID: WorkspaceID) async -> WorkspaceNotification?
        /// Most recent notification regardless of read state (sidebar latest line).
        func latest(workspaceID: WorkspaceID) async -> WorkspaceNotification?
        /// Full feed for the workspace in recency order (oldest first).
        func notifications(workspaceID: WorkspaceID) async -> [WorkspaceNotification]
    }

    /// macOS banner port. Implementations present a user-visible banner; they do
    /// NOT decide whether one should show. Gating on app activity belongs to the
    /// caller through `Notifications.shouldPresentBanner(isAppActive:)` — the
    /// caller reads `NSApplication.shared.isActive` so this module stays AppKit-free.
    protocol NotificationBannerPresenting: Sendable {
        func present(title: String?, body: String, workspaceID: WorkspaceID, paneID: PaneID?) async
    }

    static func inMemoryWorkspaceNotificationStore(
        clock: any NotificationsClock,
        coalescingWindowSeconds: TimeInterval = WorkspaceAttentionPolicy.coalescingWindowSeconds,
        maxNotificationsPerWorkspace: Int = WorkspaceAttentionPolicy.maxNotificationsPerWorkspace
    ) -> any WorkspaceNotificationStoring {
        InMemoryWorkspaceNotificationStore(
            clock: clock,
            coalescingWindowSeconds: coalescingWindowSeconds,
            maxNotificationsPerWorkspace: maxNotificationsPerWorkspace
        )
    }

    /// Live macOS banner layer over `UNUserNotificationCenter`. No-ops (with a
    /// debug log) when the process has no bundle identifier, so `swift run` of
    /// the bare executable never crashes.
    static func userNotificationCenterBannerPresenter() -> any NotificationBannerPresenting {
        UserNotificationCenterBannerPresenter()
    }

    /// Applies the banner policy and presents when appropriate. Returns whether
    /// a banner was handed to the presenter. Coalesced repeats are the caller's
    /// concern; this only gates on app activity.
    @discardableResult
    static func presentBannerIfNeeded(
        for notification: WorkspaceNotification,
        isAppActive: Bool,
        using presenter: any NotificationBannerPresenting
    ) async -> Bool {
        guard shouldPresentBanner(isAppActive: isAppActive) else {
            return false
        }

        await presenter.present(
            title: notification.title,
            body: notification.body,
            workspaceID: notification.workspaceID,
            paneID: notification.paneID
        )
        return true
    }
}

/// Live clock for wiring the attention store outside tests.
extension SystemFenrirClock: Notifications.NotificationsClock {}
