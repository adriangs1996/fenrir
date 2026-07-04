import Foundation
import FenrirNativeShared

public extension Notifications {
    /// Origin of a workspace attention notification (D-043).
    ///
    /// - `agentPresence`: derived from reserved-channel agent presence events (D-038).
    /// - `terminalOSC`: generic OSC 9 / OSC 99 / OSC 777;notify sequences parsed by
    ///   `TerminalViewport` and routed here (D-043).
    /// - `system`: Fenrir-internal signals (connection state, workflow milestones, ...).
    enum WorkspaceNotificationSource: String, Codable, Equatable, Sendable {
        case agentPresence
        case terminalOSC
        case system
    }

    /// Workspace-scoped notification record feeding the notifications panel,
    /// sidebar latest-notification line, unread badge, and attention loop (D-045).
    struct WorkspaceNotification: Codable, Equatable, Sendable {
        public let id: NotificationID
        public let workspaceID: WorkspaceID
        public let paneID: PaneID?
        public let title: String?
        public let body: String
        public let source: WorkspaceNotificationSource
        public let timestamp: FenrirTimestamp
        public let read: Bool

        public init(
            id: NotificationID,
            workspaceID: WorkspaceID,
            paneID: PaneID? = nil,
            title: String? = nil,
            body: String,
            source: WorkspaceNotificationSource,
            timestamp: FenrirTimestamp,
            read: Bool = false
        ) {
            self.id = id
            self.workspaceID = workspaceID
            self.paneID = paneID
            self.title = title
            self.body = body
            self.source = source
            self.timestamp = timestamp
            self.read = read
        }
    }

    /// Unstamped notification payload; the store assigns id and timestamp on append.
    struct WorkspaceNotificationDraft: Codable, Equatable, Sendable {
        public let workspaceID: WorkspaceID
        public let paneID: PaneID?
        public let title: String?
        public let body: String
        public let source: WorkspaceNotificationSource

        public init(
            workspaceID: WorkspaceID,
            paneID: PaneID? = nil,
            title: String? = nil,
            body: String,
            source: WorkspaceNotificationSource
        ) {
            self.workspaceID = workspaceID
            self.paneID = paneID
            self.title = title
            self.body = body
            self.source = source
        }
    }

    /// Result of appending a draft: the stored (possibly coalesced) record.
    struct AppendWorkspaceNotificationOutcome: Codable, Equatable, Sendable {
        public let notification: WorkspaceNotification
        public let coalesced: Bool

        public init(notification: WorkspaceNotification, coalesced: Bool) {
            self.notification = notification
            self.coalesced = coalesced
        }
    }

    /// Where the shell should move focus for a notification (jump-to-latest-unread,
    /// D-045). Pure data: the shell owns the actual focus change.
    struct NotificationJumpTarget: Codable, Equatable, Sendable {
        public let workspaceID: WorkspaceID
        public let paneID: PaneID?

        public init(workspaceID: WorkspaceID, paneID: PaneID? = nil) {
            self.workspaceID = workspaceID
            self.paneID = paneID
        }
    }

    struct IngestWorkspaceNotificationInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let paneID: PaneID?
        public let title: String?
        public let body: String
        public let notificationSource: WorkspaceNotificationSource
        /// Whether the app currently has user attention. The caller supplies this
        /// (typically `NSApplication.shared.isActive`) so this module stays
        /// AppKit-free; banners only present when the app is NOT active.
        public let isAppActive: Bool
        public let source: ActionSource

        public init(
            requestID: RequestID,
            workspaceID: WorkspaceID,
            paneID: PaneID? = nil,
            title: String? = nil,
            body: String,
            notificationSource: WorkspaceNotificationSource,
            isAppActive: Bool,
            source: ActionSource
        ) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.paneID = paneID
            self.title = title
            self.body = body
            self.notificationSource = notificationSource
            self.isAppActive = isAppActive
            self.source = source
        }
    }

    struct IngestWorkspaceNotificationResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let notification: WorkspaceNotification
        public let coalesced: Bool
        public let unreadCount: Int
        public let bannerPresented: Bool
        public let timestamp: FenrirTimestamp

        public init(
            requestID: RequestID,
            notification: WorkspaceNotification,
            coalesced: Bool,
            unreadCount: Int,
            bannerPresented: Bool,
            timestamp: FenrirTimestamp
        ) {
            self.requestID = requestID
            self.notification = notification
            self.coalesced = coalesced
            self.unreadCount = unreadCount
            self.bannerPresented = bannerPresented
            self.timestamp = timestamp
        }
    }
}
