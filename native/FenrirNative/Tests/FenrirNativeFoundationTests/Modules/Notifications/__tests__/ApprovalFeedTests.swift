import Foundation
import Testing
import FenrirNativeShared
import Notifications

@Suite("Agent approval feed store (D-042)")
struct ApprovalFeedTests {
    private func card(
        requestID: String = "approval-1",
        workspaceID: WorkspaceID = "workspace-a",
        kind: Notifications.ApprovalRequestKind = .permission,
        summary: String = "Permission request: Bash"
    ) -> Notifications.ApprovalFeedCard {
        Notifications.ApprovalFeedCard(
            requestID: requestID,
            workspaceID: workspaceID,
            paneID: "%1",
            agentID: "claude-code",
            kind: kind,
            summary: summary,
            options: [
                Notifications.ApprovalOption(id: "allow", label: "Allow"),
                Notifications.ApprovalOption(id: "deny", label: "Deny")
            ],
            createdAt: "2026-07-04T00:00:00.000Z",
            expiresAt: "2026-07-04T00:01:50.000Z"
        )
    }

    @Test("pending adds exactly once and settled removes the card")
    func pendingThenSettledLifecycle() async throws {
        let store = Notifications.inMemoryApprovalFeedStore()

        let added = await store.apply(.pending(card()))
        #expect(added == .added(card()))
        let duplicate = await store.apply(.pending(card()))
        #expect(duplicate == .ignored)
        #expect(await store.pendingCount(workspaceID: nil) == 1)

        let settled = await store.apply(.settled(requestID: "approval-1", reason: .decided, optionID: "allow"))
        #expect(settled == .settled(card(), reason: .decided, optionID: "allow"))
        #expect(await store.pendingCount(workspaceID: nil) == 0)

        // Settling an unknown/already-settled request never mutates state.
        let late = await store.apply(.settled(requestID: "approval-1", reason: .timeout, optionID: nil))
        #expect(late == .ignored)
    }

    @Test("pending cards filter by workspace")
    func pendingCardsFilterByWorkspace() async throws {
        let store = Notifications.inMemoryApprovalFeedStore()
        _ = await store.apply(.pending(card(requestID: "approval-a", workspaceID: "workspace-a")))
        _ = await store.apply(.pending(card(requestID: "approval-b", workspaceID: "workspace-b")))

        #expect(await store.pendingCount(workspaceID: nil) == 2)
        let workspaceACards = await store.pendingCards(workspaceID: "workspace-a")
        #expect(workspaceACards.map(\.requestID) == ["approval-a"])
        #expect(await store.pendingCount(workspaceID: "workspace-b") == 1)
    }

    @Test("store is bounded and evicts the oldest pending card")
    func storeEvictsOldestBeyondBound() async throws {
        let store = Notifications.inMemoryApprovalFeedStore(maxPendingCards: 2)
        _ = await store.apply(.pending(card(requestID: "approval-1")))
        _ = await store.apply(.pending(card(requestID: "approval-2")))
        _ = await store.apply(.pending(card(requestID: "approval-3")))

        let cards = await store.pendingCards(workspaceID: nil)
        #expect(cards.map(\.requestID) == ["approval-2", "approval-3"])
        // The evicted request settles server-side via timeout; a late
        // settled event for it is ignored.
        let evicted = await store.apply(.settled(requestID: "approval-1", reason: .timeout, optionID: nil))
        #expect(evicted == .ignored)
    }

    @Test("removeAll clears pending cards for stream resync")
    func removeAllClearsPending() async throws {
        let store = Notifications.inMemoryApprovalFeedStore()
        _ = await store.apply(.pending(card()))
        await store.removeAll()
        #expect(await store.pendingCount(workspaceID: nil) == 0)
    }

    @Test("banner action identifiers round-trip decisions and reject non-decisions")
    func bannerActionMapping() throws {
        let identifier = Notifications.ApprovalBannerAction.actionIdentifier(optionID: "allow")
        #expect(Notifications.ApprovalBannerAction.optionID(fromActionIdentifier: identifier) == "allow")

        let decision = Notifications.ApprovalBannerAction.decision(
            forActionIdentifier: identifier,
            userInfo: [Notifications.ApprovalBannerAction.requestIDUserInfoKey: "approval-9"]
        )
        #expect(decision?.requestID == "approval-9")
        #expect(decision?.optionID == "allow")

        // Plain banner taps and foreign identifiers never decide.
        #expect(Notifications.ApprovalBannerAction.decision(
            forActionIdentifier: "com.apple.UNNotificationDefaultActionIdentifier",
            userInfo: [Notifications.ApprovalBannerAction.requestIDUserInfoKey: "approval-9"]
        ) == nil)
        #expect(Notifications.ApprovalBannerAction.decision(
            forActionIdentifier: identifier,
            userInfo: [:]
        ) == nil)
    }

    @Test("kind metadata renders stable icons and labels")
    func kindMetadata() throws {
        #expect(Notifications.ApprovalRequestKind.permission.symbolName == "lock.shield")
        #expect(Notifications.ApprovalRequestKind.planExit.displayName == "Plan review")
        #expect(Notifications.ApprovalRequestKind(rawValue: "question") == .question)
        // Unknown kinds from future contracts must fail closed.
        #expect(Notifications.ApprovalRequestKind(rawValue: "exotic") == nil)
    }
}
