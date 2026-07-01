import Foundation
import FenrirNativeShared

public extension WorkspaceIndex {
    struct ListWorkspaces: FenrirAction {
        public typealias Failure = WorkspaceIndexError

        let store: any WorkspaceIndexStore
        let serverListing: (any WorkspaceServerListing)?
        let clock: any WorkspaceIndexClock

        init(store: any WorkspaceIndexStore, serverListing: (any WorkspaceServerListing)? = nil, clock: any WorkspaceIndexClock) {
            self.store = store
            self.serverListing = serverListing
            self.clock = clock
        }

        public func run(_ input: ListWorkspacesInput) async -> Result<ListWorkspacesResult, WorkspaceIndexError> {
            do {
                let local = try await store.loadIndex().workspaces
                let serverResult = await WorkspaceIndex.serverWorkspaces(includeServer: input.includeServer, serverListing: serverListing)
                switch serverResult {
                case .success(let server):
                    let timestamp = clock.now()
                    let merged = WorkspaceIndex.list(WorkspaceIndex.merge(local: local, server: server), includeHidden: input.includeHidden, sort: input.sort)
                    return .success(ListWorkspacesResult(requestID: input.requestID, snapshot: WorkspaceIndexSnapshot(workspaces: merged, capturedAt: timestamp), timestamp: timestamp))
                case .failure:
                    guard input.degradeToLocalOnServerFailure else {
                        return .failure(.serverUnavailable)
                    }
                    let timestamp = clock.now()
                    let filtered = WorkspaceIndex.list(local, includeHidden: input.includeHidden, sort: input.sort)
                    return .success(ListWorkspacesResult(requestID: input.requestID, snapshot: WorkspaceIndexSnapshot(workspaces: filtered, capturedAt: timestamp), isDegraded: true, timestamp: timestamp))
                }
            } catch {
                return .failure(.readFailed)
            }
        }
    }

    struct RegisterWorkspace: FenrirAction {
        public typealias Failure = WorkspaceIndexError

        let store: any WorkspaceIndexStore
        let clock: any WorkspaceIndexClock
        let events: (any WorkspaceIndexEventPublishing)?

        init(store: any WorkspaceIndexStore, clock: any WorkspaceIndexClock, events: (any WorkspaceIndexEventPublishing)? = nil) {
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: RegisterWorkspaceInput) async -> Result<RegisterWorkspaceResult, WorkspaceIndexError> {
            do {
                var snapshot = try await store.loadIndex()
                try WorkspaceIndex.validate(input.summary.identity)
                guard !snapshot.workspaces.contains(where: { $0.workspaceID == input.summary.workspaceID || WorkspaceIndex.sameIdentity($0.identity, input.summary.identity) }) else {
                    return .failure(.duplicateIdentity)
                }
                let timestamp = clock.now()
                let summary = input.summary
                snapshot = WorkspaceIndexSnapshot(workspaces: WorkspaceIndex.list(snapshot.workspaces + [summary], includeHidden: true, sort: .displayName), capturedAt: timestamp)
                try await store.saveIndex(snapshot)
                await WorkspaceIndex.publish(input.requestID, "WorkspaceRegistered", timestamp, .workspaceRegistered(summary.workspaceID), events)
                return .success(RegisterWorkspaceResult(requestID: input.requestID, summary: summary, timestamp: timestamp))
            } catch let error as WorkspaceIndexError {
                return .failure(error)
            } catch {
                return .failure(.writeFailed)
            }
        }
    }

    struct AttachWorkspace: FenrirAction {
        public typealias Failure = WorkspaceIndexError

        let store: any WorkspaceIndexStore
        let clock: any WorkspaceIndexClock
        let events: (any WorkspaceIndexEventPublishing)?

        init(store: any WorkspaceIndexStore, clock: any WorkspaceIndexClock, events: (any WorkspaceIndexEventPublishing)? = nil) {
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: AttachWorkspaceInput) async -> Result<AttachWorkspaceResult, WorkspaceIndexError> {
            await WorkspaceIndex.mutate(store: store, clock: clock, requestID: input.requestID, events: events, eventKind: "WorkspaceAttached") { summary, timestamp in
                guard summary.workspaceID == input.workspaceID else { return nil }
                var windows = summary.openState.windowIDs
                if !windows.contains(input.windowID) {
                    windows.append(input.windowID)
                }
                return summary.updated(
                    openState: WorkspaceOpenState(isOpenLocally: true, windowIDs: windows.sorted { $0.rawValue < $1.rawValue }, attachedAt: timestamp),
                    lastOpenedAt: timestamp,
                    lastFocusedAt: timestamp,
                    status: .open
                )
            } event: { .workspaceAttached(input.workspaceID) }
            .map { pair in AttachWorkspaceResult(requestID: input.requestID, summary: pair.0, timestamp: pair.1) }
        }
    }

    struct DetachWorkspace: FenrirAction {
        public typealias Failure = WorkspaceIndexError

        let store: any WorkspaceIndexStore
        let clock: any WorkspaceIndexClock
        let events: (any WorkspaceIndexEventPublishing)?

        init(store: any WorkspaceIndexStore, clock: any WorkspaceIndexClock, events: (any WorkspaceIndexEventPublishing)? = nil) {
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: DetachWorkspaceInput) async -> Result<DetachWorkspaceResult, WorkspaceIndexError> {
            await WorkspaceIndex.mutate(store: store, clock: clock, requestID: input.requestID, events: events, eventKind: "WorkspaceDetached") { summary, _ in
                guard summary.workspaceID == input.workspaceID else { return nil }
                let windows = input.windowID.map { detached in
                    summary.openState.windowIDs.filter { $0 != detached }
                } ?? []
                return summary.updated(
                    openState: WorkspaceOpenState(isOpenLocally: !windows.isEmpty, windowIDs: windows, attachedAt: windows.isEmpty ? nil : summary.openState.attachedAt),
                    status: windows.isEmpty ? .available : .open
                )
            } event: { .workspaceDetached(input.workspaceID) }
            .map { pair in DetachWorkspaceResult(requestID: input.requestID, summary: pair.0, timestamp: pair.1) }
        }
    }

    struct RemoveWorkspace: FenrirAction {
        public typealias Failure = WorkspaceIndexError

        let store: any WorkspaceIndexStore
        let clock: any WorkspaceIndexClock
        let events: (any WorkspaceIndexEventPublishing)?

        init(store: any WorkspaceIndexStore, clock: any WorkspaceIndexClock, events: (any WorkspaceIndexEventPublishing)? = nil) {
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: RemoveWorkspaceInput) async -> Result<RemoveWorkspaceResult, WorkspaceIndexError> {
            do {
                let snapshot = try await store.loadIndex()
                guard snapshot.workspaces.contains(where: { $0.workspaceID == input.workspaceID }) else {
                    return .failure(.workspaceNotFound)
                }
                let timestamp = clock.now()
                let next = snapshot.workspaces.filter { $0.workspaceID != input.workspaceID }
                try await store.saveIndex(WorkspaceIndexSnapshot(workspaces: next, capturedAt: timestamp))
                await WorkspaceIndex.publish(input.requestID, "WorkspaceRemoved", timestamp, .workspaceRemoved(input.workspaceID), events)
                return .success(RemoveWorkspaceResult(requestID: input.requestID, workspaceID: input.workspaceID, timestamp: timestamp))
            } catch let error as WorkspaceIndexError {
                return .failure(error)
            } catch {
                return .failure(.writeFailed)
            }
        }
    }

    struct MarkWorkspaceRecent: FenrirAction {
        public typealias Failure = WorkspaceIndexError

        let store: any WorkspaceIndexStore
        let clock: any WorkspaceIndexClock
        let events: (any WorkspaceIndexEventPublishing)?

        init(store: any WorkspaceIndexStore, clock: any WorkspaceIndexClock, events: (any WorkspaceIndexEventPublishing)? = nil) {
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: MarkWorkspaceRecentInput) async -> Result<MarkWorkspaceRecentResult, WorkspaceIndexError> {
            await WorkspaceIndex.mutate(store: store, clock: clock, requestID: input.requestID, events: events, eventKind: "WorkspaceRecentMarked") { summary, timestamp in
                guard summary.workspaceID == input.workspaceID else { return nil }
                return summary.updated(lastFocusedAt: timestamp)
            } event: { .workspaceRecentMarked(input.workspaceID) }
            .map { pair in MarkWorkspaceRecentResult(requestID: input.requestID, summary: pair.0, timestamp: pair.1) }
        }
    }

    struct MarkWorkspaceFavorite: FenrirAction {
        public typealias Failure = WorkspaceIndexError

        let store: any WorkspaceIndexStore
        let clock: any WorkspaceIndexClock
        let events: (any WorkspaceIndexEventPublishing)?

        init(store: any WorkspaceIndexStore, clock: any WorkspaceIndexClock, events: (any WorkspaceIndexEventPublishing)? = nil) {
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: MarkWorkspaceFavoriteInput) async -> Result<MarkWorkspaceFavoriteResult, WorkspaceIndexError> {
            await WorkspaceIndex.mutate(store: store, clock: clock, requestID: input.requestID, events: events, eventKind: "WorkspaceFavoriteChanged") { summary, _ in
                guard summary.workspaceID == input.workspaceID else { return nil }
                return summary.updated(isFavorite: input.isFavorite)
            } event: { .workspaceFavoriteChanged(input.workspaceID, input.isFavorite) }
            .map { pair in MarkWorkspaceFavoriteResult(requestID: input.requestID, summary: pair.0, timestamp: pair.1) }
        }
    }

    struct UpdateWorkspaceVisibility: FenrirAction {
        public typealias Failure = WorkspaceIndexError

        let store: any WorkspaceIndexStore
        let clock: any WorkspaceIndexClock
        let events: (any WorkspaceIndexEventPublishing)?

        init(store: any WorkspaceIndexStore, clock: any WorkspaceIndexClock, events: (any WorkspaceIndexEventPublishing)? = nil) {
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: UpdateWorkspaceVisibilityInput) async -> Result<UpdateWorkspaceVisibilityResult, WorkspaceIndexError> {
            await WorkspaceIndex.mutate(store: store, clock: clock, requestID: input.requestID, events: events, eventKind: "WorkspaceVisibilityChanged") { summary, _ in
                guard summary.workspaceID == input.workspaceID else { return nil }
                return summary.updated(visibility: input.visibility)
            } event: { .workspaceVisibilityChanged(input.workspaceID, input.visibility) }
            .map { pair in UpdateWorkspaceVisibilityResult(requestID: input.requestID, summary: pair.0, timestamp: pair.1) }
        }
    }

    struct UpdateWorkspaceNotifications: FenrirAction {
        public typealias Failure = WorkspaceIndexError

        let store: any WorkspaceIndexStore
        let clock: any WorkspaceIndexClock
        let events: (any WorkspaceIndexEventPublishing)?

        init(store: any WorkspaceIndexStore, clock: any WorkspaceIndexClock, events: (any WorkspaceIndexEventPublishing)? = nil) {
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: UpdateWorkspaceNotificationsInput) async -> Result<UpdateWorkspaceNotificationsResult, WorkspaceIndexError> {
            guard input.notifications.unreadCount >= 0 else {
                return .failure(.decodeFailed)
            }
            return await WorkspaceIndex.mutate(store: store, clock: clock, requestID: input.requestID, events: events, eventKind: "WorkspaceNotificationsChanged") { summary, _ in
                guard summary.workspaceID == input.workspaceID else { return nil }
                return summary.updated(notifications: input.notifications)
            } event: { .workspaceNotificationsChanged(input.workspaceID, input.notifications) }
            .map { pair in UpdateWorkspaceNotificationsResult(requestID: input.requestID, summary: pair.0, timestamp: pair.1) }
        }
    }

    struct ResolveWorkspace: FenrirAction {
        public typealias Failure = WorkspaceIndexError

        let store: any WorkspaceIndexStore
        let serverListing: (any WorkspaceServerListing)?
        let clock: any WorkspaceIndexClock
        let events: (any WorkspaceIndexEventPublishing)?

        init(store: any WorkspaceIndexStore, serverListing: (any WorkspaceServerListing)? = nil, clock: any WorkspaceIndexClock, events: (any WorkspaceIndexEventPublishing)? = nil) {
            self.store = store
            self.serverListing = serverListing
            self.clock = clock
            self.events = events
        }

        public func run(_ input: ResolveWorkspaceInput) async -> Result<ResolveWorkspaceResult, WorkspaceIndexError> {
            do {
                let local = try await store.loadIndex().workspaces
                let server = try await WorkspaceIndex.serverWorkspaces(includeServer: input.includeServer, serverListing: serverListing).get()
                guard let summary = WorkspaceIndex.merge(local: local, server: server).first(where: { WorkspaceIndex.matches($0, identity: input.identity) }) else {
                    return .failure(.workspaceNotFound)
                }
                let timestamp = clock.now()
                await WorkspaceIndex.publish(input.requestID, "WorkspaceResolved", timestamp, .workspaceResolved(summary.workspaceID), events)
                return .success(ResolveWorkspaceResult(requestID: input.requestID, summary: summary, timestamp: timestamp))
            } catch let error as WorkspaceIndexError {
                return .failure(error)
            } catch {
                return .failure(.readFailed)
            }
        }
    }
}

extension WorkspaceIndex {
    static func serverWorkspaces(includeServer: Bool, serverListing: (any WorkspaceServerListing)?) async -> Result<[WorkspaceSummary], WorkspaceIndexError> {
        guard includeServer else {
            return .success([])
        }
        do {
            return .success(try await (serverListing?.listServerWorkspaces() ?? []))
        } catch let error as WorkspaceIndexError {
            return .failure(error)
        } catch {
            return .failure(.serverUnavailable)
        }
    }

    static func merge(local: [WorkspaceSummary], server: [WorkspaceSummary]) -> [WorkspaceSummary] {
        var summaries = Dictionary(uniqueKeysWithValues: local.map { ($0.workspaceID, $0) })
        for remote in server {
            if let existing = summaries[remote.workspaceID] {
                summaries[remote.workspaceID] = remote.mergedWithLocal(existing)
            } else if let localMatch = local.first(where: { sameIdentity($0.identity, remote.identity) }) {
                summaries[localMatch.workspaceID] = remote.mergedWithLocal(localMatch)
            } else {
                summaries[remote.workspaceID] = remote
            }
        }
        return Array(summaries.values)
    }

    static func list(_ workspaces: [WorkspaceSummary], includeHidden: Bool, sort: WorkspaceSort) -> [WorkspaceSummary] {
        let visible = includeHidden ? workspaces : workspaces.filter { $0.visibility == .visible }
        return visible.sorted { lhs, rhs in
            switch sort {
            case .displayName:
                return byName(lhs, rhs)
            case .recent:
                return byRecent(lhs, rhs)
            case .favoriteThenRecent:
                if lhs.isFavorite != rhs.isFavorite {
                    return lhs.isFavorite && !rhs.isFavorite
                }
                return byRecent(lhs, rhs)
            }
        }
    }

    static func byName(_ lhs: WorkspaceSummary, _ rhs: WorkspaceSummary) -> Bool {
        let comparison = lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName)
        return comparison == .orderedSame ? lhs.workspaceID.rawValue < rhs.workspaceID.rawValue : comparison == .orderedAscending
    }

    static func byRecent(_ lhs: WorkspaceSummary, _ rhs: WorkspaceSummary) -> Bool {
        switch (lhs.lastFocusedAt, rhs.lastFocusedAt) {
        case let (left?, right?) where left != right:
            return left > right
        case (_?, nil):
            return true
        case (nil, _?):
            return false
        default:
            return byName(lhs, rhs)
        }
    }

    static func mutate(
        store: any WorkspaceIndexStore,
        clock: any WorkspaceIndexClock,
        requestID: RequestID,
        events: (any WorkspaceIndexEventPublishing)?,
        eventKind: String,
        update: (WorkspaceSummary, FenrirTimestamp) -> WorkspaceSummary?,
        event: () -> Event
    ) async -> Result<(WorkspaceSummary, FenrirTimestamp), WorkspaceIndexError> {
        do {
            let snapshot = try await store.loadIndex()
            let timestamp = clock.now()
            var updated: WorkspaceSummary?
            let workspaces = snapshot.workspaces.map { summary in
                guard let next = update(summary, timestamp) else {
                    return summary
                }
                updated = next
                return next
            }
            guard let updated else {
                return .failure(.workspaceNotFound)
            }
            try await store.saveIndex(WorkspaceIndexSnapshot(workspaces: workspaces, capturedAt: timestamp))
            await publish(requestID, eventKind, timestamp, event(), events)
            return .success((updated, timestamp))
        } catch let error as WorkspaceIndexError {
            return .failure(error)
        } catch {
            return .failure(.writeFailed)
        }
    }

    static func publish(_ requestID: RequestID, _ kind: String, _ timestamp: FenrirTimestamp, _ event: Event, _ events: (any WorkspaceIndexEventPublishing)?) async {
        await events?.publish(EventEnvelope(eventID: requestID, eventKind: kind, timestamp: timestamp, event: event))
        await events?.publish(EventEnvelope(eventID: requestID, eventKind: "WorkspaceIndexChanged", timestamp: timestamp, event: .workspaceIndexChanged))
    }

    static func validate(_ identity: WorkspaceIdentity) throws {
        switch identity.kind {
        case .localPath:
            guard identity.canonicalPath?.isEmpty == false else { throw WorkspaceIndexError.invalidIdentity }
        case .project:
            guard identity.projectID?.isEmpty == false || identity.workspaceID != nil else { throw WorkspaceIndexError.invalidIdentity }
        case .remote:
            guard identity.serverID?.isEmpty == false || identity.workspaceID != nil else { throw WorkspaceIndexError.invalidIdentity }
        }
    }

    static func sameIdentity(_ lhs: WorkspaceIdentity, _ rhs: WorkspaceIdentity) -> Bool {
        if let left = lhs.workspaceID, let right = rhs.workspaceID, left == right { return true }
        if let left = lhs.canonicalPath, let right = rhs.canonicalPath, left == right { return true }
        if let left = lhs.projectID, let right = rhs.projectID, left == right { return true }
        if let left = lhs.serverID, let right = rhs.serverID, left == right, lhs.profileID == rhs.profileID { return true }
        return false
    }

    static func matches(_ summary: WorkspaceSummary, identity: WorkspaceIdentity) -> Bool {
        sameIdentity(summary.identity, identity)
            || summary.workspaceID == identity.workspaceID
            || identity.projectID.map { summary.projectID == $0 } == true
            || identity.canonicalPath.map { summary.canonicalPath == $0 } == true
            || identity.serverID.map { summary.serverID == $0 } == true
    }
}

extension WorkspaceIndex.WorkspaceSummary {
    func updated(
        displayName: String? = nil,
        isFavorite: Bool? = nil,
        openState: WorkspaceIndex.WorkspaceOpenState? = nil,
        visibility: WorkspaceIndex.WorkspaceVisibility? = nil,
        notifications: WorkspaceIndex.WorkspaceNotificationState? = nil,
        lastOpenedAt: FenrirTimestamp?? = nil,
        lastFocusedAt: FenrirTimestamp?? = nil,
        status: WorkspaceIndex.WorkspaceStatus? = nil
    ) -> WorkspaceIndex.WorkspaceSummary {
        WorkspaceIndex.WorkspaceSummary(
            workspaceID: workspaceID,
            displayName: displayName ?? self.displayName,
            projectID: projectID,
            canonicalPath: canonicalPath,
            serverID: serverID,
            profileID: profileID,
            identity: identity,
            isFavorite: isFavorite ?? self.isFavorite,
            openState: openState ?? self.openState,
            visibility: visibility ?? self.visibility,
            notifications: notifications ?? self.notifications,
            lastOpenedAt: lastOpenedAt ?? self.lastOpenedAt,
            lastFocusedAt: lastFocusedAt ?? self.lastFocusedAt,
            status: status ?? self.status
        )
    }

    func mergedWithLocal(_ local: WorkspaceIndex.WorkspaceSummary) -> WorkspaceIndex.WorkspaceSummary {
        WorkspaceIndex.WorkspaceSummary(
            workspaceID: local.workspaceID,
            displayName: local.displayName.isEmpty ? displayName : local.displayName,
            projectID: local.projectID ?? projectID,
            canonicalPath: local.canonicalPath ?? canonicalPath,
            serverID: local.serverID ?? serverID,
            profileID: local.profileID ?? profileID,
            identity: local.identity,
            isFavorite: local.isFavorite,
            openState: local.openState,
            visibility: local.visibility,
            notifications: local.notifications,
            lastOpenedAt: local.lastOpenedAt,
            lastFocusedAt: local.lastFocusedAt,
            status: status
        )
    }
}
