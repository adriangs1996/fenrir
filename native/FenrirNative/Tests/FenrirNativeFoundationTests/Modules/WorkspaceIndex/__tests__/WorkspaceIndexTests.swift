import Foundation
import Testing
import FenrirNativeShared
@testable import WorkspaceIndex

@Suite("WorkspaceIndex actions")
struct WorkspaceIndexTests {
    @Test("ListWorkspaces merges sidebar and switcher data without duplicates")
    func listWorkspacesMergesSummaries() async throws {
        let local = summary("workspace-a", name: "Alpha", path: "/repo/a", favorite: true, focusedAt: 20)
        let hidden = summary("workspace-hidden", name: "Hidden", path: "/repo/hidden", visibility: .hidden)
        let remoteOnly = summary("workspace-b", name: "Beta", serverID: "remote-beta", status: .available)
        let duplicateRemote = summary("workspace-remote-a", name: "Alpha remote", path: "/repo/a", status: .available)
        let action = WorkspaceIndex.ListWorkspaces(
            store: WorkspaceStore(workspaces: [hidden, local]),
            serverListing: WorkspaceServer(workspaces: [remoteOnly, duplicateRemote]),
            clock: FixedClock()
        )

        let result = try await action.run(
            WorkspaceIndex.ListWorkspacesInput(
                requestID: "list-1",
                includeServer: true,
                surface: .quickSwitcher,
                source: .clientControl
            )
        ).get()

        #expect(result.snapshot.workspaces.map(\.workspaceID) == ["workspace-a", "workspace-b"])
        #expect(result.snapshot.workspaces[0].isFavorite)
        #expect(result.snapshot.workspaces[0].status == .available)
    }

    @Test("ListWorkspaces degrades to local summaries when server listing fails")
    func listWorkspacesDegradesToLocalOnServerFailure() async throws {
        let local = summary("workspace-a", name: "Alpha", path: "/repo/a", status: .open)
        let action = WorkspaceIndex.ListWorkspaces(
            store: WorkspaceStore(workspaces: [local]),
            serverListing: FailingWorkspaceServer(),
            clock: FixedClock()
        )

        let result = try await action.run(
            WorkspaceIndex.ListWorkspacesInput(requestID: "list-1", includeServer: true, source: .clientControl)
        ).get()

        #expect(result.isDegraded)
        #expect(result.snapshot.workspaces == [local])
    }

    @Test("ListWorkspaces can fail closed on server listing errors when policy disallows degradation")
    func listWorkspacesFailsClosedWhenDegradationDisabled() async {
        let action = WorkspaceIndex.ListWorkspaces(
            store: WorkspaceStore(workspaces: []),
            serverListing: FailingWorkspaceServer(),
            clock: FixedClock()
        )

        let result = await action.run(
            WorkspaceIndex.ListWorkspacesInput(
                requestID: "list-1",
                includeServer: true,
                degradeToLocalOnServerFailure: false,
                source: .clientControl
            )
        )

        #expect(result == .failure(WorkspaceIndex.WorkspaceIndexError.serverUnavailable))
    }

    @Test("RegisterWorkspace rejects duplicate local or remote identity")
    func registerRejectsDuplicateIdentity() async throws {
        let store = WorkspaceStore(workspaces: [summary("workspace-a", name: "Alpha", path: "/repo/a")])
        let action = WorkspaceIndex.RegisterWorkspace(store: store, clock: FixedClock())

        let result = await action.run(
            WorkspaceIndex.RegisterWorkspaceInput(
                requestID: "register",
                summary: summary("workspace-b", name: "Duplicate", path: "/repo/a"),
                source: .test
            )
        )

        #expect(result == .failure(WorkspaceIndex.WorkspaceIndexError.duplicateIdentity))
    }

    @Test("Attach, detach, and remove update local open state without terminating workspace")
    func attachDetachRemoveWorkspace() async throws {
        let store = WorkspaceStore(workspaces: [summary("workspace-a", name: "Alpha", path: "/repo/a")])
        let attach = WorkspaceIndex.AttachWorkspace(store: store, clock: FixedClock())
        let detach = WorkspaceIndex.DetachWorkspace(store: store, clock: FixedClock())
        let remove = WorkspaceIndex.RemoveWorkspace(store: store, clock: FixedClock())

        let attached = try await attach.run(
            WorkspaceIndex.AttachWorkspaceInput(requestID: "attach", workspaceID: "workspace-a", windowID: "window-1", source: .test)
        ).get()
        let detached = try await detach.run(
            WorkspaceIndex.DetachWorkspaceInput(requestID: "detach", workspaceID: "workspace-a", windowID: "window-1", source: .test)
        ).get()
        let removed = try await remove.run(
            WorkspaceIndex.RemoveWorkspaceInput(requestID: "remove", workspaceID: "workspace-a", source: .test)
        ).get()

        #expect(attached.summary.isOpenLocally)
        #expect(attached.summary.openState.windowIDs == ["window-1"])
        #expect(!detached.summary.isOpenLocally)
        #expect(removed.workspaceID == "workspace-a")
        #expect(try await store.loadIndex().workspaces.isEmpty)
    }

    @Test("Favorite, recent, visibility, and notification state publish sidebar metadata")
    func metadataMutationsUpdateSidebarState() async throws {
        let events = EventRecorder()
        let store = WorkspaceStore(workspaces: [summary("workspace-a", name: "Alpha", path: "/repo/a")])
        let favorite = WorkspaceIndex.MarkWorkspaceFavorite(store: store, clock: FixedClock(), events: events)
        let recent = WorkspaceIndex.MarkWorkspaceRecent(store: store, clock: FixedClock(), events: events)
        let visibility = WorkspaceIndex.UpdateWorkspaceVisibility(store: store, clock: FixedClock(), events: events)
        let notifications = WorkspaceIndex.UpdateWorkspaceNotifications(store: store, clock: FixedClock(), events: events)

        let favorited = try await favorite.run(.init(requestID: "favorite", workspaceID: "workspace-a", isFavorite: true, source: .test)).get()
        let marked = try await recent.run(.init(requestID: "recent", workspaceID: "workspace-a", source: .test)).get()
        let hidden = try await visibility.run(.init(requestID: "visibility", workspaceID: "workspace-a", visibility: .hidden, source: .test)).get()
        let notified = try await notifications.run(.init(
            requestID: "notify",
            workspaceID: "workspace-a",
            notifications: WorkspaceIndex.WorkspaceNotificationState(unreadCount: 3, level: .badge),
            source: .test
        )).get()

        #expect(favorited.summary.isFavorite)
        #expect(marked.summary.lastFocusedAt == FixedClock().timestamp)
        #expect(hidden.summary.visibility == .hidden)
        #expect(notified.summary.notifications.unreadCount == 3)
        #expect(await events.kinds.contains("WorkspaceNotificationsChanged"))
    }

    @Test("ResolveWorkspace resolves local and remote identities")
    func resolveWorkspaceByIdentity() async throws {
        let local = summary("workspace-a", name: "Alpha", path: "/repo/a")
        let remote = summary("workspace-b", name: "Beta", serverID: "remote-beta")
        let action = WorkspaceIndex.ResolveWorkspace(
            store: WorkspaceStore(workspaces: [local]),
            serverListing: WorkspaceServer(workspaces: [remote]),
            clock: FixedClock()
        )

        let localResult = try await action.run(.init(
            requestID: "resolve-local",
            identity: WorkspaceIndex.WorkspaceIdentity(kind: .localPath, canonicalPath: "/repo/a"),
            source: .test
        )).get()
        let remoteResult = try await action.run(.init(
            requestID: "resolve-remote",
            identity: WorkspaceIndex.WorkspaceIdentity(kind: .remote, serverID: "remote-beta"),
            source: .test
        )).get()

        #expect(localResult.summary.workspaceID == "workspace-a")
        #expect(remoteResult.summary.workspaceID == "workspace-b")
    }

    @Test("Mutation actions map persistence failures to write failed")
    func mutationMapsPersistenceFailure() async {
        let action = WorkspaceIndex.MarkWorkspaceFavorite(
            store: WorkspaceStore(workspaces: [summary("workspace-a", name: "Alpha", path: "/repo/a")], failWrites: true),
            clock: FixedClock()
        )

        let result = await action.run(.init(requestID: "favorite", workspaceID: "workspace-a", isFavorite: true, source: .test))

        #expect(result == .failure(WorkspaceIndex.WorkspaceIndexError.writeFailed))
    }
}

private func summary(
    _ id: WorkspaceID,
    name: String,
    path: String? = nil,
    serverID: String? = nil,
    favorite: Bool = false,
    visibility: WorkspaceIndex.WorkspaceVisibility = .visible,
    focusedAt: TimeInterval? = nil,
    status: WorkspaceIndex.WorkspaceStatus = .unknown
) -> WorkspaceIndex.WorkspaceSummary {
    WorkspaceIndex.WorkspaceSummary(
        workspaceID: id,
        displayName: name,
        canonicalPath: path,
        serverID: serverID,
        identity: WorkspaceIndex.WorkspaceIdentity(
            kind: serverID == nil ? .localPath : .remote,
            workspaceID: id,
            canonicalPath: path,
            serverID: serverID
        ),
        isFavorite: favorite,
        visibility: visibility,
        lastFocusedAt: focusedAt.map { FenrirTimestamp(Date(timeIntervalSince1970: $0)) },
        status: status
    )
}

private actor WorkspaceStore: WorkspaceIndex.WorkspaceIndexStore {
    private var snapshot: WorkspaceIndex.WorkspaceIndexSnapshot
    private let failWrites: Bool

    init(workspaces: [WorkspaceIndex.WorkspaceSummary], failWrites: Bool = false) {
        self.snapshot = WorkspaceIndex.WorkspaceIndexSnapshot(workspaces: workspaces, capturedAt: FixedClock().timestamp)
        self.failWrites = failWrites
    }

    func loadIndex() async throws -> WorkspaceIndex.WorkspaceIndexSnapshot {
        snapshot
    }

    func saveIndex(_ snapshot: WorkspaceIndex.WorkspaceIndexSnapshot) async throws {
        if failWrites {
            throw WorkspaceIndex.WorkspaceIndexError.writeFailed
        }
        self.snapshot = snapshot
    }
}

private struct WorkspaceServer: WorkspaceIndex.WorkspaceServerListing {
    let workspaces: [WorkspaceIndex.WorkspaceSummary]

    func listServerWorkspaces() async throws -> [WorkspaceIndex.WorkspaceSummary] {
        workspaces
    }
}

private struct FailingWorkspaceServer: WorkspaceIndex.WorkspaceServerListing {
    func listServerWorkspaces() async throws -> [WorkspaceIndex.WorkspaceSummary] {
        throw WorkspaceIndex.WorkspaceIndexError.serverUnavailable
    }
}

private actor EventRecorder: WorkspaceIndex.WorkspaceIndexEventPublishing {
    private(set) var kinds: [String] = []

    func publish(_ event: EventEnvelope<WorkspaceIndex.Event>) async {
        kinds.append(event.eventKind)
    }
}
