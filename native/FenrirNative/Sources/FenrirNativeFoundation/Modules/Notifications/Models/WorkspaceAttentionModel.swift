import Foundation
import FenrirNativeShared

public extension Notifications {
    /// Tunables for the workspace attention feed. Values are module policy
    /// (D-043 coalescing, bounded retention) and shared by store and tests.
    enum WorkspaceAttentionPolicy {
        /// Identical title+body+pane events within this window collapse into one record.
        public static let coalescingWindowSeconds: TimeInterval = 2
        /// Per-workspace retention bound; the oldest records are dropped past it.
        public static let maxNotificationsPerWorkspace = 500
        /// D-043 payload caps: notification text is length-capped well under
        /// libghostty's OSC ceiling before it can reach banners or the panel.
        public static let maxTitleCharacters = 120
        public static let maxBodyCharacters = 500
    }

    /// Sanitized D-043 notification payload: control characters stripped,
    /// whitespace collapsed, fields length-capped.
    struct SanitizedWorkspaceNotificationPayload: Equatable, Sendable {
        public let title: String?
        public let body: String

        public init(title: String?, body: String) {
            self.title = title
            self.body = body
        }
    }

    /// D-043 payload sanitization boundary. Control characters (C0, DEL, C1)
    /// are removed, whitespace runs collapse to single spaces, and title/body
    /// are capped at the module policy lengths. Returns nil for malformed
    /// payloads — an empty body after sanitization — which callers must drop
    /// with a diagnostics count instead of storing or presenting.
    static func sanitizedWorkspaceNotificationPayload(
        title: String?,
        body: String
    ) -> SanitizedWorkspaceNotificationPayload? {
        guard let sanitizedBody = sanitizedNotificationText(
            body,
            maxCharacters: WorkspaceAttentionPolicy.maxBodyCharacters
        ) else {
            return nil
        }
        let sanitizedTitle = title.flatMap {
            sanitizedNotificationText($0, maxCharacters: WorkspaceAttentionPolicy.maxTitleCharacters)
        }
        return SanitizedWorkspaceNotificationPayload(title: sanitizedTitle, body: sanitizedBody)
    }

    internal static func sanitizedNotificationText(_ text: String, maxCharacters: Int) -> String? {
        var scalars = String.UnicodeScalarView()
        for scalar in text.unicodeScalars {
            let isControl = scalar.value < 0x20
                || scalar.value == 0x7F
                || (0x80...0x9F).contains(scalar.value)
            scalars.append(isControl ? " " : scalar)
        }
        let collapsed = String(scalars)
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
        guard !collapsed.isEmpty else {
            return nil
        }
        return String(collapsed.prefix(maxCharacters))
    }

    /// Banner policy: macOS banners only present when the app is NOT active.
    /// The caller supplies `isAppActive` (typically `NSApplication.shared.isActive`)
    /// so this module never imports AppKit.
    static func shouldPresentBanner(isAppActive: Bool) -> Bool {
        !isAppActive
    }

    /// Pure jump-target resolution: where the shell should focus for a notification.
    static func jumpTarget(for notification: WorkspaceNotification) -> NotificationJumpTarget {
        NotificationJumpTarget(workspaceID: notification.workspaceID, paneID: notification.paneID)
    }

    /// Pure jump-target resolution over a feed: target of the latest unread
    /// notification in the workspace, or nil when everything is read.
    static func jumpTargetForLatestUnread(
        in notifications: [WorkspaceNotification],
        workspaceID: WorkspaceID
    ) -> NotificationJumpTarget? {
        latestUnreadWorkspaceNotification(in: notifications, workspaceID: workspaceID)
            .map(jumpTarget(for:))
    }
}

extension Notifications {
    /// Appends a draft to the feed, coalescing identical title+body+pane events
    /// within the coalescing window and enforcing the per-workspace bound.
    /// The feed array is kept in recency order (coalesced records move to the end).
    ///
    /// The draft payload is sanitized first (D-043: control characters removed,
    /// length-capped); malformed payloads are dropped — the feed is returned
    /// unchanged with a nil outcome so callers can count the drop in diagnostics.
    static func appendingWorkspaceNotification(
        _ draft: WorkspaceNotificationDraft,
        to notifications: [WorkspaceNotification],
        now: FenrirTimestamp,
        coalescingWindowSeconds: TimeInterval = WorkspaceAttentionPolicy.coalescingWindowSeconds,
        maxPerWorkspace: Int = WorkspaceAttentionPolicy.maxNotificationsPerWorkspace
    ) -> (notifications: [WorkspaceNotification], outcome: AppendWorkspaceNotificationOutcome?) {
        guard let payload = sanitizedWorkspaceNotificationPayload(title: draft.title, body: draft.body) else {
            return (notifications, nil)
        }
        let draft = WorkspaceNotificationDraft(
            workspaceID: draft.workspaceID,
            paneID: draft.paneID,
            title: payload.title,
            body: payload.body,
            source: draft.source
        )
        var notifications = notifications

        if let index = notifications.lastIndex(where: { candidate in
            candidate.workspaceID == draft.workspaceID &&
                candidate.paneID == draft.paneID &&
                candidate.title == draft.title &&
                candidate.body == draft.body &&
                isWithinCoalescingWindow(
                    candidate: candidate,
                    now: now,
                    windowSeconds: coalescingWindowSeconds
                )
        }) {
            let existing = notifications.remove(at: index)
            let coalesced = WorkspaceNotification(
                id: existing.id,
                workspaceID: existing.workspaceID,
                paneID: existing.paneID,
                title: existing.title,
                body: existing.body,
                source: draft.source,
                timestamp: now,
                read: false
            )
            notifications.append(coalesced)
            return (notifications, AppendWorkspaceNotificationOutcome(notification: coalesced, coalesced: true))
        }

        let appended = WorkspaceNotification(
            id: .generated(),
            workspaceID: draft.workspaceID,
            paneID: draft.paneID,
            title: draft.title,
            body: draft.body,
            source: draft.source,
            timestamp: now,
            read: false
        )
        notifications.append(appended)
        notifications = enforcingWorkspaceBound(
            notifications,
            workspaceID: draft.workspaceID,
            maxPerWorkspace: maxPerWorkspace
        )
        return (notifications, AppendWorkspaceNotificationOutcome(notification: appended, coalesced: false))
    }

    static func markingWorkspaceNotificationRead(
        id: NotificationID,
        in notifications: [WorkspaceNotification]
    ) -> (notifications: [WorkspaceNotification], changed: Bool) {
        guard let index = notifications.firstIndex(where: { $0.id == id }),
              !notifications[index].read
        else {
            return (notifications, false)
        }

        var notifications = notifications
        notifications[index] = notifications[index].withRead(true)
        return (notifications, true)
    }

    static func markingAllWorkspaceNotificationsRead(
        workspaceID: WorkspaceID,
        in notifications: [WorkspaceNotification]
    ) -> (notifications: [WorkspaceNotification], markedCount: Int) {
        var notifications = notifications
        var markedCount = 0

        for index in notifications.indices
        where notifications[index].workspaceID == workspaceID && !notifications[index].read {
            notifications[index] = notifications[index].withRead(true)
            markedCount += 1
        }

        return (notifications, markedCount)
    }

    static func unreadWorkspaceNotificationCount(
        in notifications: [WorkspaceNotification],
        workspaceID: WorkspaceID
    ) -> Int {
        notifications.count { $0.workspaceID == workspaceID && !$0.read }
    }

    static func latestWorkspaceNotification(
        in notifications: [WorkspaceNotification],
        workspaceID: WorkspaceID
    ) -> WorkspaceNotification? {
        notifications.last { $0.workspaceID == workspaceID }
    }

    static func latestUnreadWorkspaceNotification(
        in notifications: [WorkspaceNotification],
        workspaceID: WorkspaceID
    ) -> WorkspaceNotification? {
        notifications.last { $0.workspaceID == workspaceID && !$0.read }
    }

    private static func isWithinCoalescingWindow(
        candidate: WorkspaceNotification,
        now: FenrirTimestamp,
        windowSeconds: TimeInterval
    ) -> Bool {
        let elapsed = now.date.timeIntervalSince(candidate.timestamp.date)
        return elapsed >= 0 && elapsed <= windowSeconds
    }

    private static func enforcingWorkspaceBound(
        _ notifications: [WorkspaceNotification],
        workspaceID: WorkspaceID,
        maxPerWorkspace: Int
    ) -> [WorkspaceNotification] {
        let workspaceCount = notifications.count { $0.workspaceID == workspaceID }
        var overflow = workspaceCount - maxPerWorkspace
        guard overflow > 0 else {
            return notifications
        }

        // The feed is kept in recency order, so the first matches are the oldest.
        var bounded: [WorkspaceNotification] = []
        bounded.reserveCapacity(notifications.count - overflow)
        for notification in notifications {
            if overflow > 0, notification.workspaceID == workspaceID {
                overflow -= 1
                continue
            }
            bounded.append(notification)
        }
        return bounded
    }
}

extension Notifications.WorkspaceNotification {
    func withRead(_ read: Bool) -> Notifications.WorkspaceNotification {
        Notifications.WorkspaceNotification(
            id: id,
            workspaceID: workspaceID,
            paneID: paneID,
            title: title,
            body: body,
            source: source,
            timestamp: timestamp,
            read: read
        )
    }
}
