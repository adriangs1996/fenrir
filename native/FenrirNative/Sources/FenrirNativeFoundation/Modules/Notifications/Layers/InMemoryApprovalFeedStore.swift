import Foundation
import FenrirNativeShared

extension Notifications {
    /// Bounded in-memory pending-approval store (D-042). Oldest cards are
    /// evicted beyond `maxPendingCards`; eviction is safe because the hook
    /// soft-wait times out server-side and the agent falls back to its own
    /// TUI — the feed never gates an agent.
    actor InMemoryApprovalFeedStore: ApprovalFeedStoring {
        private let maxPendingCards: Int
        private var cards: [ApprovalFeedCard] = []

        init(maxPendingCards: Int) {
            self.maxPendingCards = max(1, maxPendingCards)
        }

        func apply(_ event: ApprovalFeedStreamEvent) async -> ApprovalFeedApplyOutcome {
            switch event {
            case .pending(let card):
                guard !cards.contains(where: { $0.requestID == card.requestID }) else {
                    return .ignored
                }
                cards.append(card)
                if cards.count > maxPendingCards {
                    cards.removeFirst(cards.count - maxPendingCards)
                }
                return .added(card)
            case .settled(let requestID, let reason, let optionID):
                guard let index = cards.firstIndex(where: { $0.requestID == requestID }) else {
                    return .ignored
                }
                let card = cards.remove(at: index)
                return .settled(card, reason: reason, optionID: optionID)
            }
        }

        func pendingCards(workspaceID: WorkspaceID?) async -> [ApprovalFeedCard] {
            guard let workspaceID else {
                return cards
            }
            return cards.filter { $0.workspaceID == workspaceID }
        }

        func pendingCount(workspaceID: WorkspaceID?) async -> Int {
            await pendingCards(workspaceID: workspaceID).count
        }

        func card(requestID: String) async -> ApprovalFeedCard? {
            cards.first { $0.requestID == requestID }
        }

        func removeAll() async {
            cards.removeAll()
        }
    }
}
