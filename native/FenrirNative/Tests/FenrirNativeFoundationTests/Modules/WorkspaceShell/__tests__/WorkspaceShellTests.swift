import Foundation
import Testing
import FenrirNativeShared
@testable import WorkspaceIndex
@testable import WorkspaceShell

@Suite("WorkspaceShell command actions")
struct WorkspaceShellTests {
    @Test("Command parser is separated from product actions")
    func parserBuildsTypedCommandRequest() throws {
        let parsed = try WorkspaceShell.CommandParser.parse(
            requestID: "parse",
            arguments: ["open", "/repo/a", "--json"],
            source: .clientControl
        ).get()

        #expect(parsed.verb == .open)
        #expect(parsed.outputFormat == .jsonLines)
        #expect(parsed.workspaceIdentity?.canonicalPath == "/repo/a")
    }

    @Test("OpenWorkspace resolves, opens, attaches, and marks recent")
    func openWorkspaceSuccess() async throws {
        let index = IndexPort(workspaces: [summary("workspace-a", name: "Alpha", path: "/repo/a")])
        let windows = WindowPort()
        let action = WorkspaceShell.OpenWorkspace(index: index, windows: windows, clock: FixedClock())

        let result = try await action.run(.init(
            requestID: "open",
            identity: WorkspaceIndex.WorkspaceIdentity(kind: .localPath, canonicalPath: "/repo/a"),
            source: .clientControl
        )).get()

        #expect(result.status == "opened")
        #expect(result.nativeWindowID == "window-workspace-a")
        #expect(await index.attached == ["workspace-a"])
        #expect(await index.recent == ["workspace-a"])
    }

    @Test("OpenWorkspace maps invalid workspace to shell error")
    func openWorkspaceInvalidWorkspace() async {
        let action = WorkspaceShell.OpenWorkspace(index: IndexPort(workspaces: []), windows: WindowPort(), clock: FixedClock())

        let result = await action.run(.init(
            requestID: "open",
            identity: WorkspaceIndex.WorkspaceIdentity(kind: .localPath, canonicalPath: "/missing"),
            source: .clientControl
        ))

        #expect(result == .failure(WorkspaceShell.WorkspaceShellError.workspaceNotFound))
    }

    @Test("AttachRemoteWorkspace registers remote summary and opens it")
    func attachRemoteWorkspace() async throws {
        let index = IndexPort(workspaces: [])
        let windows = WindowPort()
        let remote = RemotePort(summary: summary("workspace-r", name: "Remote", serverID: "remote:main"))
        let action = WorkspaceShell.AttachRemoteWorkspace(index: index, remoteAttacher: remote, windows: windows, clock: FixedClock())

        let result = try await action.run(.init(
            requestID: "attach",
            endpointID: "endpoint-1",
            identity: WorkspaceIndex.WorkspaceIdentity(kind: .remote, serverID: "remote:main"),
            source: .clientControl
        )).get()

        #expect(result.status == "attached")
        #expect(result.workspace?.workspaceID == "workspace-r")
        #expect(await remote.requests == ["endpoint-1"])
        #expect(await index.registered == ["workspace-r"])
    }

    @Test("SwitchWorkspace only switches already-open workspace")
    func switchWorkspaceSemantics() async throws {
        let open = summary(
            "workspace-a",
            name: "Alpha",
            path: "/repo/a",
            openState: WorkspaceIndex.WorkspaceOpenState(isOpenLocally: true, windowIDs: ["window-a"])
        )
        let closed = summary("workspace-b", name: "Beta", path: "/repo/b")
        let index = IndexPort(workspaces: [open, closed])
        let windows = WindowPort()
        let action = WorkspaceShell.SwitchWorkspace(index: index, windows: windows, clock: FixedClock())

        let switched = try await action.run(.init(
            requestID: "switch",
            identity: WorkspaceIndex.WorkspaceIdentity(kind: .localPath, canonicalPath: "/repo/a"),
            source: .clientControl
        )).get()
        let invalid = await action.run(.init(
            requestID: "switch-closed",
            identity: WorkspaceIndex.WorkspaceIdentity(kind: .localPath, canonicalPath: "/repo/b"),
            source: .clientControl
        ))

        #expect(switched.status == "switched")
        #expect(await windows.switched == ["workspace-a"])
        #expect(invalid == .failure(WorkspaceShell.WorkspaceShellError.workspaceNotFound))
    }

    @Test("List, remove, and formatter produce stable CLI outputs")
    func listRemoveAndFormat() async throws {
        let index = IndexPort(workspaces: [summary("workspace-a", name: "Alpha", path: "/repo/a")])
        let list = WorkspaceShell.ListShellWorkspaces(index: index, clock: FixedClock())
        let remove = WorkspaceShell.RemoveWorkspace(index: index, clock: FixedClock())
        let formatter = WorkspaceShell.FormatCommandResult(clock: FixedClock())

        let listed = try await list.run(.init(requestID: "list", includeRemote: true, source: .clientControl)).get()
        let formattedList = try await formatter.run(.init(requestID: "format-list", result: listed, source: .clientControl)).get()
        let removed = try await remove.run(.init(
            requestID: "remove",
            identity: WorkspaceIndex.WorkspaceIdentity(kind: .localPath, canonicalPath: "/repo/a"),
            source: .clientControl
        )).get()
        let formattedError = try await formatter.run(.init(requestID: "format-error", error: .workspaceNotFound, source: .clientControl)).get()

        #expect(formattedList.output == "workspace-a\tAlpha\tavailable")
        #expect(removed.status == "removed")
        #expect(await index.removed == ["workspace-a"])
        #expect(formattedError.exitCode == 1)
        #expect(formattedError.output == "error: WorkspaceShellWorkspaceNotFound")
    }
}

private func summary(
    _ id: WorkspaceID,
    name: String,
    path: String? = nil,
    serverID: String? = nil,
    openState: WorkspaceIndex.WorkspaceOpenState = WorkspaceIndex.WorkspaceOpenState()
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
        openState: openState,
        status: openState.isOpenLocally ? .open : .available
    )
}

private actor IndexPort: WorkspaceShell.WorkspaceIndexCommanding {
    private var workspaces: [WorkspaceIndex.WorkspaceSummary]
    private(set) var attached: [WorkspaceID] = []
    private(set) var recent: [WorkspaceID] = []
    private(set) var registered: [WorkspaceID] = []
    private(set) var removed: [WorkspaceID] = []

    init(workspaces: [WorkspaceIndex.WorkspaceSummary]) {
        self.workspaces = workspaces
    }

    func listWorkspaces(requestID: RequestID, includeRemote: Bool) async throws -> WorkspaceIndex.ListWorkspacesResult {
        WorkspaceIndex.ListWorkspacesResult(
            requestID: requestID,
            snapshot: WorkspaceIndex.WorkspaceIndexSnapshot(workspaces: workspaces, capturedAt: FixedClock().timestamp),
            timestamp: FixedClock().timestamp
        )
    }

    func resolveWorkspace(requestID: RequestID, identity: WorkspaceIndex.WorkspaceIdentity) async throws -> WorkspaceIndex.ResolveWorkspaceResult {
        guard let workspace = workspaces.first(where: { workspace in
            workspace.workspaceID == identity.workspaceID
                || identity.canonicalPath.map { workspace.canonicalPath == $0 } == true
                || identity.serverID.map { workspace.serverID == $0 } == true
        }) else {
            throw WorkspaceIndex.WorkspaceIndexError.workspaceNotFound
        }
        return WorkspaceIndex.ResolveWorkspaceResult(requestID: requestID, summary: workspace, timestamp: FixedClock().timestamp)
    }

    func registerWorkspace(requestID: RequestID, summary: WorkspaceIndex.WorkspaceSummary) async throws -> WorkspaceIndex.RegisterWorkspaceResult {
        registered.append(summary.workspaceID)
        workspaces.append(summary)
        return WorkspaceIndex.RegisterWorkspaceResult(requestID: requestID, summary: summary, timestamp: FixedClock().timestamp)
    }

    func attachWorkspace(requestID: RequestID, workspaceID: WorkspaceID, windowID: FenrirWindowID) async throws -> WorkspaceIndex.AttachWorkspaceResult {
        attached.append(workspaceID)
        let workspace = try resolved(workspaceID)
        return WorkspaceIndex.AttachWorkspaceResult(requestID: requestID, summary: workspace, timestamp: FixedClock().timestamp)
    }

    func markRecent(requestID: RequestID, workspaceID: WorkspaceID) async throws -> WorkspaceIndex.MarkWorkspaceRecentResult {
        recent.append(workspaceID)
        let workspace = try resolved(workspaceID)
        return WorkspaceIndex.MarkWorkspaceRecentResult(requestID: requestID, summary: workspace, timestamp: FixedClock().timestamp)
    }

    func removeWorkspace(requestID: RequestID, workspaceID: WorkspaceID) async throws -> WorkspaceIndex.RemoveWorkspaceResult {
        removed.append(workspaceID)
        workspaces.removeAll { $0.workspaceID == workspaceID }
        return WorkspaceIndex.RemoveWorkspaceResult(requestID: requestID, workspaceID: workspaceID, timestamp: FixedClock().timestamp)
    }

    private func resolved(_ workspaceID: WorkspaceID) throws -> WorkspaceIndex.WorkspaceSummary {
        guard let workspace = workspaces.first(where: { $0.workspaceID == workspaceID }) else {
            throw WorkspaceIndex.WorkspaceIndexError.workspaceNotFound
        }
        return workspace
    }
}

private actor WindowPort: WorkspaceShell.WorkspaceWindowCommanding {
    private(set) var opened: [WorkspaceID] = []
    private(set) var switched: [WorkspaceID] = []

    func openWorkspace(_ summary: WorkspaceIndex.WorkspaceSummary) async throws -> FenrirWindowID {
        opened.append(summary.workspaceID)
        return FenrirWindowID(rawValue: "window-\(summary.workspaceID.rawValue)")
    }

    func switchWorkspace(_ summary: WorkspaceIndex.WorkspaceSummary) async throws -> FenrirWindowID {
        switched.append(summary.workspaceID)
        return summary.openState.windowIDs.first ?? FenrirWindowID(rawValue: "window-\(summary.workspaceID.rawValue)")
    }
}

private actor RemotePort: WorkspaceShell.RemoteWorkspaceAttaching {
    let summary: WorkspaceIndex.WorkspaceSummary
    private(set) var requests: [String] = []

    init(summary: WorkspaceIndex.WorkspaceSummary) {
        self.summary = summary
    }

    func attachRemoteWorkspace(endpointID: String, identity: WorkspaceIndex.WorkspaceIdentity) async throws -> WorkspaceIndex.WorkspaceSummary {
        requests.append(endpointID)
        return summary
    }
}
