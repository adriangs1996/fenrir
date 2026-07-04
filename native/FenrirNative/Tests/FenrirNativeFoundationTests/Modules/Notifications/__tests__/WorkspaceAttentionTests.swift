import Foundation
import Testing
import FenrirNativeShared
import Notifications

@Suite("Workspace attention feed")
struct WorkspaceAttentionTests {
    @Test("Append coalesces identical title+body+pane within the window")
    func appendCoalescesIdenticalEventsWithinWindow() async throws {
        let clock = ManualAttentionClock(seconds: 100)
        let store = Notifications.inMemoryWorkspaceNotificationStore(clock: clock)

        let first = try #require(await store.append(.init(
            workspaceID: "workspace-a",
            paneID: "pane-1",
            title: "Build",
            body: "Build finished",
            source: .terminalOSC
        )))
        clock.advance(seconds: 1)
        let second = try #require(await store.append(.init(
            workspaceID: "workspace-a",
            paneID: "pane-1",
            title: "Build",
            body: "Build finished",
            source: .terminalOSC
        )))

        let feed = await store.notifications(workspaceID: "workspace-a")

        #expect(!first.coalesced)
        #expect(second.coalesced)
        #expect(second.notification.id == first.notification.id)
        #expect(second.notification.timestamp > first.notification.timestamp)
        #expect(feed.count == 1)
    }

    @Test("Append does not coalesce outside the window or across panes")
    func appendDoesNotCoalesceOutsideWindowOrAcrossPanes() async throws {
        let clock = ManualAttentionClock(seconds: 100)
        let store = Notifications.inMemoryWorkspaceNotificationStore(clock: clock)
        let draft = Notifications.WorkspaceNotificationDraft(
            workspaceID: "workspace-a",
            paneID: "pane-1",
            title: "Tests",
            body: "Suite passed",
            source: .terminalOSC
        )

        _ = try #require(await store.append(draft))
        let otherPane = try #require(await store.append(.init(
            workspaceID: "workspace-a",
            paneID: "pane-2",
            title: "Tests",
            body: "Suite passed",
            source: .terminalOSC
        )))
        clock.advance(seconds: 3)
        let lateRepeat = try #require(await store.append(draft))

        let feed = await store.notifications(workspaceID: "workspace-a")

        #expect(!otherPane.coalesced)
        #expect(!lateRepeat.coalesced)
        #expect(feed.count == 3)
    }

    @Test("Unread count tracks appends, markRead, and markAllRead per workspace")
    func unreadCountTracksReadTransitions() async throws {
        let clock = ManualAttentionClock(seconds: 100)
        let store = Notifications.inMemoryWorkspaceNotificationStore(clock: clock)

        let first = try #require(await store.append(.init(
            workspaceID: "workspace-a",
            body: "First",
            source: .system
        )))
        clock.advance(seconds: 5)
        _ = try #require(await store.append(.init(
            workspaceID: "workspace-a",
            body: "Second",
            source: .agentPresence
        )))
        _ = try #require(await store.append(.init(
            workspaceID: "workspace-b",
            body: "Other workspace",
            source: .system
        )))

        #expect(await store.unreadCount(workspaceID: "workspace-a") == 2)

        let marked = await store.markRead(first.notification.id)
        let markedAgain = await store.markRead(first.notification.id)

        #expect(marked)
        #expect(!markedAgain)
        #expect(await store.unreadCount(workspaceID: "workspace-a") == 1)

        let markedAll = await store.markAllRead(workspaceID: "workspace-a")

        #expect(markedAll == 1)
        #expect(await store.unreadCount(workspaceID: "workspace-a") == 0)
        #expect(await store.unreadCount(workspaceID: "workspace-b") == 1)
    }

    @Test("Latest and latestUnread expose the sidebar line and jump source")
    func latestAndLatestUnreadFollowRecency() async throws {
        let clock = ManualAttentionClock(seconds: 100)
        let store = Notifications.inMemoryWorkspaceNotificationStore(clock: clock)

        _ = try #require(await store.append(.init(
            workspaceID: "workspace-a",
            body: "Older",
            source: .system
        )))
        clock.advance(seconds: 5)
        let newest = try #require(await store.append(.init(
            workspaceID: "workspace-a",
            paneID: "pane-9",
            body: "Newest",
            source: .terminalOSC
        )))

        #expect(await store.latest(workspaceID: "workspace-a")?.id == newest.notification.id)
        #expect(await store.latestUnread(workspaceID: "workspace-a")?.id == newest.notification.id)

        _ = await store.markRead(newest.notification.id)

        #expect(await store.latest(workspaceID: "workspace-a")?.id == newest.notification.id)
        #expect(await store.latestUnread(workspaceID: "workspace-a")?.body == "Older")
    }

    @Test("Retention is bounded per workspace and drops the oldest records")
    func retentionIsBoundedPerWorkspace() async throws {
        let clock = ManualAttentionClock(seconds: 100)
        let store = Notifications.inMemoryWorkspaceNotificationStore(
            clock: clock,
            maxNotificationsPerWorkspace: 3
        )

        for index in 0..<5 {
            clock.advance(seconds: 10)
            _ = try #require(await store.append(.init(
                workspaceID: "workspace-a",
                body: "Event \(index)",
                source: .system
            )))
            _ = try #require(await store.append(.init(
                workspaceID: "workspace-b",
                body: "Other \(index)",
                source: .system
            )))
        }

        let boundedFeed = await store.notifications(workspaceID: "workspace-a")
        let siblingFeed = await store.notifications(workspaceID: "workspace-b")

        #expect(boundedFeed.map(\.body) == ["Event 2", "Event 3", "Event 4"])
        #expect(siblingFeed.count == 3)
        #expect(await store.unreadCount(workspaceID: "workspace-a") == 3)
    }

    @Test("Jump target resolves latest unread to workspace and pane")
    func jumpTargetResolvesLatestUnread() async throws {
        let clock = ManualAttentionClock(seconds: 100)
        let store = Notifications.inMemoryWorkspaceNotificationStore(clock: clock)

        _ = try #require(await store.append(.init(
            workspaceID: "workspace-a",
            paneID: "pane-1",
            body: "Older",
            source: .terminalOSC
        )))
        clock.advance(seconds: 5)
        let newest = try #require(await store.append(.init(
            workspaceID: "workspace-a",
            paneID: "pane-2",
            body: "Newest",
            source: .agentPresence
        )))

        let feed = await store.notifications(workspaceID: "workspace-a")
        let target = Notifications.jumpTargetForLatestUnread(in: feed, workspaceID: "workspace-a")

        #expect(target == Notifications.NotificationJumpTarget(workspaceID: "workspace-a", paneID: "pane-2"))
        #expect(Notifications.jumpTarget(for: newest.notification).paneID == "pane-2")

        _ = await store.markAllRead(workspaceID: "workspace-a")
        let readFeed = await store.notifications(workspaceID: "workspace-a")

        #expect(Notifications.jumpTargetForLatestUnread(in: readFeed, workspaceID: "workspace-a") == nil)
    }

    @Test("Jump target omits the pane for workspace-level notifications")
    func jumpTargetOmitsPaneWhenAbsent() {
        let notification = Notifications.WorkspaceNotification(
            id: "note-1",
            workspaceID: "workspace-a",
            body: "Connection restored",
            source: .system,
            timestamp: FenrirTimestamp(Date(timeIntervalSince1970: 100))
        )

        let target = Notifications.jumpTarget(for: notification)

        #expect(target.workspaceID == "workspace-a")
        #expect(target.paneID == nil)
    }

    @Test("Malformed payloads are dropped without touching the feed")
    func malformedPayloadsAreDropped() async throws {
        let clock = ManualAttentionClock(seconds: 100)
        let store = Notifications.inMemoryWorkspaceNotificationStore(clock: clock)

        let dropped = await store.append(.init(
            workspaceID: "workspace-a",
            body: "\u{07}\u{1B}\u{00} \t\n",
            source: .terminalOSC
        ))
        let feed = await store.notifications(workspaceID: "workspace-a")

        #expect(dropped == nil)
        #expect(feed.isEmpty)
    }

    @Test("Payload sanitization strips control characters and caps length")
    func payloadSanitizationStripsControlCharactersAndCapsLength() throws {
        let payload = try #require(Notifications.sanitizedWorkspaceNotificationPayload(
            title: "Build\u{1B}[31m done",
            body: String(repeating: "a", count: 1000) + "\u{07}"
        ))

        #expect(payload.title == "Build [31m done")
        #expect(payload.body.count == Notifications.WorkspaceAttentionPolicy.maxBodyCharacters)
        #expect(Notifications.sanitizedWorkspaceNotificationPayload(title: nil, body: "\u{00}\u{1F}") == nil)
    }
}

@Suite("Workspace attention banners")
struct WorkspaceAttentionBannerTests {
    @Test("Banner presents only while the app is inactive")
    func bannerPresentsOnlyWhileAppInactive() async {
        let presenter = RecordingBannerPresenter()
        let notification = Notifications.WorkspaceNotification(
            id: "note-1",
            workspaceID: "workspace-a",
            paneID: "pane-1",
            title: "Build",
            body: "Build finished",
            source: .terminalOSC,
            timestamp: FenrirTimestamp(Date(timeIntervalSince1970: 100))
        )

        let whileActive = await Notifications.presentBannerIfNeeded(
            for: notification,
            isAppActive: true,
            using: presenter
        )
        let whileInactive = await Notifications.presentBannerIfNeeded(
            for: notification,
            isAppActive: false,
            using: presenter
        )
        let presented = await presenter.presented()

        #expect(!whileActive)
        #expect(whileInactive)
        #expect(Notifications.shouldPresentBanner(isAppActive: true) == false)
        #expect(Notifications.shouldPresentBanner(isAppActive: false) == true)
        #expect(presented.count == 1)
        #expect(presented.first?.title == "Build")
        #expect(presented.first?.body == "Build finished")
        #expect(presented.first?.workspaceID == "workspace-a")
        #expect(presented.first?.paneID == "pane-1")
    }

    @Test("IngestWorkspaceNotification appends, counts unread, and gates the banner")
    func ingestActionAppendsCountsAndGatesBanner() async throws {
        let clock = ManualAttentionClock(seconds: 100)
        let store = Notifications.inMemoryWorkspaceNotificationStore(clock: clock)
        let presenter = RecordingBannerPresenter()
        let ingest = Notifications.IngestWorkspaceNotification(
            clock: clock,
            store: store,
            bannerPresenter: presenter
        )

        let activeIngest = try await ingest.run(.init(
            requestID: "ingest-active",
            workspaceID: "workspace-a",
            paneID: "pane-1",
            title: "Tests",
            body: "Suite passed",
            notificationSource: .terminalOSC,
            isAppActive: true,
            source: .test
        )).get()
        clock.advance(seconds: 1)
        let inactiveIngest = try await ingest.run(.init(
            requestID: "ingest-inactive",
            workspaceID: "workspace-a",
            paneID: "pane-1",
            title: "Tests",
            body: "Suite passed",
            notificationSource: .terminalOSC,
            isAppActive: false,
            source: .test
        )).get()
        let presented = await presenter.presented()

        #expect(!activeIngest.bannerPresented)
        #expect(activeIngest.unreadCount == 1)
        #expect(!activeIngest.coalesced)
        #expect(inactiveIngest.bannerPresented)
        #expect(inactiveIngest.coalesced)
        #expect(inactiveIngest.unreadCount == 1)
        #expect(inactiveIngest.notification.id == activeIngest.notification.id)
        #expect(presented.count == 1)
    }

    @Test("IngestWorkspaceNotification drops malformed payloads with a typed error")
    func ingestActionDropsMalformedPayloads() async {
        let clock = ManualAttentionClock(seconds: 100)
        let store = Notifications.inMemoryWorkspaceNotificationStore(clock: clock)
        let presenter = RecordingBannerPresenter()
        let ingest = Notifications.IngestWorkspaceNotification(
            clock: clock,
            store: store,
            bannerPresenter: presenter
        )

        let result = await ingest.run(.init(
            requestID: "ingest-malformed",
            workspaceID: "workspace-a",
            body: "\u{07}\u{1B}",
            notificationSource: .terminalOSC,
            isAppActive: false,
            source: .test
        ))
        let presented = await presenter.presented()
        let feed = await store.notifications(workspaceID: "workspace-a")

        #expect(result == .failure(.malformedNotificationPayload))
        #expect(presented.isEmpty)
        #expect(feed.isEmpty)
    }

    @Test("Bundle-less banner presenter no-ops instead of crashing")
    func bundleLessBannerPresenterNoOps() async {
        // The test runner has no `.app` bundle, so the live layer must take
        // its no-op path; reaching UNUserNotificationCenter here would crash.
        let presenter = Notifications.userNotificationCenterBannerPresenter()

        await presenter.present(
            title: "Build",
            body: "Build finished",
            workspaceID: "workspace-a",
            paneID: "pane-1"
        )
    }
}

private actor RecordingBannerPresenter: Notifications.NotificationBannerPresenting {
    struct PresentedBanner: Equatable {
        let title: String?
        let body: String
        let workspaceID: WorkspaceID
        let paneID: PaneID?
    }

    private var banners: [PresentedBanner] = []

    func present(title: String?, body: String, workspaceID: WorkspaceID, paneID: PaneID?) async {
        banners.append(PresentedBanner(title: title, body: body, workspaceID: workspaceID, paneID: paneID))
    }

    func presented() -> [PresentedBanner] {
        banners
    }
}

private final class ManualAttentionClock: Notifications.NotificationsClock, @unchecked Sendable {
    private let lock = NSLock()
    private var timestamp: FenrirTimestamp

    init(seconds: TimeInterval) {
        timestamp = FenrirTimestamp(Date(timeIntervalSince1970: seconds))
    }

    func now() -> FenrirTimestamp {
        lock.withLock { timestamp }
    }

    func advance(seconds: TimeInterval) {
        lock.withLock {
            timestamp = FenrirTimestamp(timestamp.date.addingTimeInterval(seconds))
        }
    }
}
