import Foundation
import Testing
import FenrirNativeShared
import Notifications

@Suite("Notifications module registration")
struct NotificationsTests {
    @Test("DescribeNotificationsModule exposes the Notifications target")
    func describeModule() async throws {
        let action = Notifications.DescribeNotificationsModule(clock: FixedClock())

        let result = try await action.run(.init(requestID: "notifications", source: .test)).get()

        #expect(result.summary.moduleName == "Notifications")
        #expect(result.requestID == "notifications")
    }

    @Test("CreateNotification dedupes active notifications by workspace and key")
    func createNotificationDedupesActiveNotifications() async throws {
        let clock = ManualNotificationsClock(seconds: 100)
        let store = Notifications.inMemoryNotificationStore()
        let create = Notifications.CreateNotification(clock: clock, store: store)

        let first = try await create.run(.init(
            requestID: "first",
            workspaceID: "workspace-a",
            source: .workflow(runID: "run-1"),
            severity: .warning,
            title: "Workflow paused",
            message: "Input required",
            dedupeKey: "workflow/run-1/input",
            sourceAction: .test
        )).get()

        clock.advance(seconds: 10)
        let second = try await create.run(.init(
            requestID: "second",
            workspaceID: "workspace-a",
            source: .workflow(runID: "run-1"),
            severity: .critical,
            title: "Workflow blocked",
            message: "Input still required",
            dedupeKey: "workflow/run-1/input",
            sourceAction: .test
        )).get()

        let listed = try await Notifications.ListNotifications(clock: clock, store: store)
            .run(.init(requestID: "list", workspaceID: "workspace-a", source: .test))
            .get()

        #expect(!first.deduped)
        #expect(second.deduped)
        #expect(second.notification.id == first.notification.id)
        #expect(second.notification.createdAt == first.notification.createdAt)
        #expect(second.notification.updatedAt > first.notification.updatedAt)
        #expect(listed.notifications.map(\.id) == [first.notification.id])
        #expect(listed.notifications.first?.severity == .critical)
    }

    @Test("Concurrent CreateNotification calls do not lose updates")
    func concurrentCreateNotificationsDoNotLoseUpdates() async throws {
        let clock = ManualNotificationsClock(seconds: 100)
        let store = Notifications.inMemoryNotificationStore()
        let create = Notifications.CreateNotification(clock: clock, store: store)
        let count = 20

        try await withThrowingTaskGroup(of: Void.self) { group in
            for index in 0..<count {
                group.addTask {
                    _ = try await create.run(.init(
                        requestID: RequestID(rawValue: "create-\(index)"),
                        workspaceID: "workspace-a",
                        source: .server(profileID: nil),
                        severity: .info,
                        title: "Notice \(index)",
                        message: "Message \(index)",
                        dedupeKey: Notifications.NotificationDedupeKey(rawValue: "notice/\(index)"),
                        sourceAction: .test
                    )).get()
                }
            }

            try await group.waitForAll()
        }

        let listed = try await Notifications.ListNotifications(clock: clock, store: store)
            .run(.init(requestID: "list", workspaceID: "workspace-a", source: .test))
            .get()

        #expect(listed.notifications.count == count)
        #expect(Set(listed.notifications.map(\.dedupeKey.rawValue)).count == count)
    }

    @Test("ListNotifications orders active notifications by severity then recency")
    func listNotificationsOrdersBySeverity() async throws {
        let clock = ManualNotificationsClock(seconds: 100)
        let store = Notifications.inMemoryNotificationStore()
        let create = Notifications.CreateNotification(clock: clock, store: store)

        _ = try await create.run(.init(
            requestID: "info",
            workspaceID: "workspace-a",
            source: .workspace,
            severity: .info,
            title: "Info",
            message: "Workspace synced",
            dedupeKey: "info",
            sourceAction: .test
        )).get()
        clock.advance(seconds: 1)
        let criticalOlder = try await create.run(.init(
            requestID: "critical-older",
            workspaceID: "workspace-a",
            source: .server(profileID: "local"),
            severity: .critical,
            title: "Server down",
            message: "Reconnect failed",
            dedupeKey: "server/down",
            sourceAction: .test
        )).get()
        clock.advance(seconds: 1)
        let warning = try await create.run(.init(
            requestID: "warning",
            workspaceID: "workspace-a",
            source: .agent(conversationID: "agent-1"),
            severity: .warning,
            title: "Agent waiting",
            message: "Review needed",
            dedupeKey: "agent/waiting",
            sourceAction: .test
        )).get()
        clock.advance(seconds: 1)
        let criticalNewer = try await create.run(.init(
            requestID: "critical-newer",
            workspaceID: "workspace-a",
            source: .workflow(runID: "run-2"),
            severity: .critical,
            title: "Workflow failed",
            message: "Step failed",
            dedupeKey: "workflow/failed",
            sourceAction: .test
        )).get()

        let listed = try await Notifications.ListNotifications(clock: clock, store: store)
            .run(.init(requestID: "list", workspaceID: "workspace-a", source: .test))
            .get()

        #expect(listed.notifications.map(\.id).prefix(3) == [
            criticalNewer.notification.id,
            criticalOlder.notification.id,
            warning.notification.id
        ])
    }

    @Test("ExpireNotifications applies TTL by workspace")
    func expireNotificationsAppliesTTLByWorkspace() async throws {
        let clock = ManualNotificationsClock(seconds: 100)
        let store = Notifications.inMemoryNotificationStore()
        let create = Notifications.CreateNotification(clock: clock, store: store)

        let expiring = try await create.run(.init(
            requestID: "ttl-a",
            workspaceID: "workspace-a",
            source: .server(profileID: nil),
            severity: .warning,
            title: "Transient",
            message: "Retrying",
            dedupeKey: "server/transient/a",
            ttlSeconds: 5,
            sourceAction: .test
        )).get()
        _ = try await create.run(.init(
            requestID: "ttl-b",
            workspaceID: "workspace-b",
            source: .server(profileID: nil),
            severity: .critical,
            title: "Other workspace",
            message: "Still scoped",
            dedupeKey: "server/transient/b",
            ttlSeconds: 5,
            sourceAction: .test
        )).get()

        clock.advance(seconds: 6)
        let expired = try await Notifications.ExpireNotifications(clock: clock, store: store)
            .run(.init(requestID: "expire", workspaceID: "workspace-a", source: .test))
            .get()
        let workspaceA = try await Notifications.ListNotifications(clock: clock, store: store)
            .run(.init(requestID: "list-a", workspaceID: "workspace-a", includeExpired: true, source: .test))
            .get()
        let workspaceB = try await Notifications.ListNotifications(clock: clock, store: store)
            .run(.init(requestID: "list-b", workspaceID: "workspace-b", source: .test))
            .get()

        #expect(expired.expired.map(\.id) == [expiring.notification.id])
        #expect(workspaceA.notifications.first?.lifecycle == .expired)
        #expect(workspaceB.notifications.count == 1)
        #expect(workspaceB.notifications.first?.lifecycle == .active)
    }

    @Test("Workspace projection is scoped and sidebar-ready")
    func workspaceProjectionIsScopedAndSidebarReady() async throws {
        let clock = ManualNotificationsClock(seconds: 100)
        let store = Notifications.inMemoryNotificationStore()
        let create = Notifications.CreateNotification(clock: clock, store: store)

        _ = try await create.run(.init(
            requestID: "a-info",
            workspaceID: "workspace-a",
            source: .workspace,
            severity: .info,
            title: "Indexed",
            message: "Workspace indexed",
            dedupeKey: "workspace/indexed",
            sourceAction: .test
        )).get()
        let critical = try await create.run(.init(
            requestID: "a-critical",
            workspaceID: "workspace-a",
            source: .agent(conversationID: "agent-1"),
            severity: .critical,
            title: "Agent failed",
            message: "Provider failed",
            dedupeKey: "agent/failed",
            sourceAction: .test
        )).get()
        _ = try await create.run(.init(
            requestID: "b-critical",
            workspaceID: "workspace-b",
            source: .server(profileID: "remote"),
            severity: .critical,
            title: "Remote down",
            message: "Other workspace",
            dedupeKey: "server/remote/down",
            sourceAction: .test
        )).get()

        let projection = try await Notifications.ProjectWorkspaceNotifications(clock: clock, store: store)
            .run(.init(requestID: "project", workspaceID: "workspace-a", source: .test))
            .get()
            .projection

        #expect(projection.workspaceID == "workspace-a")
        #expect(projection.activeCount == 2)
        #expect(projection.unacknowledgedCount == 2)
        #expect(projection.highestSeverity == .critical)
        #expect(projection.items.first?.id == critical.notification.id)
        #expect(Set(projection.items.map(\.workspaceID)) == ["workspace-a"])
    }

    @Test("AcknowledgeNotification is idempotent and removes active attention")
    func acknowledgeNotificationIsIdempotent() async throws {
        let clock = ManualNotificationsClock(seconds: 100)
        let store = Notifications.inMemoryNotificationStore()
        let create = Notifications.CreateNotification(clock: clock, store: store)
        let acknowledge = Notifications.AcknowledgeNotification(clock: clock, store: store)

        let created = try await create.run(.init(
            requestID: "create",
            workspaceID: "workspace-a",
            source: .workflow(runID: "run-1"),
            severity: .warning,
            title: "Workflow waiting",
            message: "Input required",
            dedupeKey: "workflow/input",
            sourceAction: .test
        )).get()

        let first = try await acknowledge.run(.init(
            requestID: "ack-1",
            workspaceID: "workspace-a",
            notificationID: created.notification.id,
            source: .test
        )).get()
        let second = try await acknowledge.run(.init(
            requestID: "ack-2",
            workspaceID: "workspace-a",
            notificationID: created.notification.id,
            source: .test
        )).get()
        let active = try await Notifications.ListNotifications(clock: clock, store: store)
            .run(.init(
                requestID: "active",
                workspaceID: "workspace-a",
                includeAcknowledged: false,
                source: .test
            ))
            .get()

        #expect(first.changed)
        #expect(first.notification.lifecycle == .acknowledged)
        #expect(!second.changed)
        #expect(second.notification.lifecycle == .acknowledged)
        #expect(active.notifications.isEmpty)
    }

    @Test("Notifications contracts and actions do not import UI frameworks")
    func contractsAndActionsDoNotImportUIFrameworks() throws {
        let root = URL(filePath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appending(path: "Sources/FenrirNativeFoundation/Modules/Notifications")
        let checkedFiles = [
            root.appending(path: "Contracts/NotificationsContracts.swift"),
            root.appending(path: "Actions/NotificationsActions.swift")
        ]

        for file in checkedFiles {
            let contents = try String(contentsOf: file)
            #expect(!contents.contains("import AppKit"))
            #expect(!contents.contains("import SwiftUI"))
        }
    }
}

private final class ManualNotificationsClock: Notifications.NotificationsClock, @unchecked Sendable {
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
