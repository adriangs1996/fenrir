import Foundation
import FenrirNativeShared

public extension Notifications {
    /// Pending-approval card store fed by the server relay stream (D-042).
    /// Settlement (decide/timeout) always comes from the stream, so every
    /// client converges on the same pending set.
    protocol ApprovalFeedStoring: Sendable {
        func apply(_ event: ApprovalFeedStreamEvent) async -> ApprovalFeedApplyOutcome
        func pendingCards(workspaceID: WorkspaceID?) async -> [ApprovalFeedCard]
        func pendingCount(workspaceID: WorkspaceID?) async -> Int
        func card(requestID: String) async -> ApprovalFeedCard?
        /// Drops every pending card (reconnect resync: the stream replays
        /// the authoritative pending set on subscribe).
        func removeAll() async
    }

    /// Actionable macOS banner port for approval cards (D-042). Option
    /// buttons on the banner decide directly through the decide RPC.
    protocol ApprovalBannerPresenting: Sendable {
        func presentApprovalBanner(card: ApprovalFeedCard) async
        func withdrawApprovalBanner(requestID: String) async
    }

    static func inMemoryApprovalFeedStore(maxPendingCards: Int = 64) -> any ApprovalFeedStoring {
        InMemoryApprovalFeedStore(maxPendingCards: maxPendingCards)
    }
}
