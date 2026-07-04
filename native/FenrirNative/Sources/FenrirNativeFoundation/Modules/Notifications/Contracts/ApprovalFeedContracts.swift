import Foundation
import FenrirNativeShared

public extension Notifications {
    /// D-042 agent approval feed contracts.
    ///
    /// Approval cards carry ONLY the structured payload the hook reported
    /// (kind, tool/action summary, options) — never terminal content. The
    /// feed is an accelerator: hooks soft-wait on the server and fall back
    /// to the agent's own TUI, so a missing/ignored card never blocks an
    /// agent. Decisions dispatch through the server decide RPC; the client
    /// never writes decision keystrokes into panes (D-040 authority).
    enum ApprovalRequestKind: String, Codable, Equatable, Sendable, CaseIterable {
        case permission
        case planExit
        case question

        public var displayName: String {
            switch self {
            case .permission: "Permission"
            case .planExit: "Plan review"
            case .question: "Question"
            }
        }

        /// SF Symbol rendered as the card's kind icon in the feed overlay.
        public var symbolName: String {
            switch self {
            case .permission: "lock.shield"
            case .planExit: "map"
            case .question: "questionmark.bubble"
            }
        }
    }

    struct ApprovalOption: Codable, Equatable, Sendable {
        public let id: String
        public let label: String

        public init(id: String, label: String) {
            self.id = id
            self.label = label
        }
    }

    struct ApprovalFeedCard: Codable, Equatable, Sendable {
        public let requestID: String
        public let workspaceID: WorkspaceID
        /// Server-side pane hint (tmux pane id) — opaque to the client.
        public let paneID: String?
        public let agentID: String
        public let kind: ApprovalRequestKind
        public let summary: String
        public let options: [ApprovalOption]
        public let createdAt: String
        public let expiresAt: String

        public init(
            requestID: String,
            workspaceID: WorkspaceID,
            paneID: String?,
            agentID: String,
            kind: ApprovalRequestKind,
            summary: String,
            options: [ApprovalOption],
            createdAt: String,
            expiresAt: String
        ) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.paneID = paneID
            self.agentID = agentID
            self.kind = kind
            self.summary = summary
            self.options = options
            self.createdAt = createdAt
            self.expiresAt = expiresAt
        }
    }

    enum ApprovalSettleReason: String, Codable, Equatable, Sendable {
        case decided
        case timeout
    }

    /// One event on the server's approval-feed relay stream.
    enum ApprovalFeedStreamEvent: Equatable, Sendable {
        case pending(ApprovalFeedCard)
        case settled(requestID: String, reason: ApprovalSettleReason, optionID: String?)
    }

    /// Result of applying a stream event to the pending-card store.
    enum ApprovalFeedApplyOutcome: Equatable, Sendable {
        case added(ApprovalFeedCard)
        case settled(ApprovalFeedCard, reason: ApprovalSettleReason, optionID: String?)
        /// Duplicate pending, unknown settle, or evicted request: no change.
        case ignored
    }

    /// Pure identifier mapping for actionable approval banners (D-042:
    /// banner buttons decide directly). AppKit/UserNotifications-free so the
    /// mapping is unit-testable; the live banner layer builds
    /// `UNNotificationCategory`/`UNNotificationAction` from these ids.
    enum ApprovalBannerAction {
        public static let categoryIdentifier = "fenrir.approval"
        public static let requestIDUserInfoKey = "fenrirApprovalRequestID"
        private static let actionPrefix = "fenrir.approval.option."

        public static func actionIdentifier(optionID: String) -> String {
            actionPrefix + optionID
        }

        public static func optionID(fromActionIdentifier identifier: String) -> String? {
            guard identifier.hasPrefix(actionPrefix) else {
                return nil
            }
            let optionID = String(identifier.dropFirst(actionPrefix.count))
            return optionID.isEmpty ? nil : optionID
        }

        /// Maps a banner response to a decision. Returns nil for plain taps
        /// or dismissals — only explicit option buttons decide.
        public static func decision(
            forActionIdentifier identifier: String,
            userInfo: [AnyHashable: Any]
        ) -> (requestID: String, optionID: String)? {
            guard let optionID = optionID(fromActionIdentifier: identifier),
                  let requestID = userInfo[requestIDUserInfoKey] as? String,
                  !requestID.isEmpty
            else {
                return nil
            }
            return (requestID, optionID)
        }
    }
}
