import Foundation
import Testing
import FenrirNativeShared
@testable import WorkspaceIndex
@testable import ServerConnection
@testable import WorkspaceCoordinator
@testable import ClientControl
@testable import FenrirNativeApp

@Suite("ClientControl actions")
struct ClientControlTests {
    @Test("Open, switch, attach, focus, remove, control, and list dispatch to specific ports")
    func routesSpecificClientControlActions() async throws {
        let ports = ClientPorts()
        let summary = WorkspaceIndex.WorkspaceSummary(workspaceID: "workspace-a", displayName: "Alpha", isOpenLocally: true)
        await ports.set(summary: summary)

        let identity = WorkspaceIndex.WorkspaceIdentity(kind: .project, workspaceID: "workspace-a")
        _ = try await ClientControl.OpenWorkspace(opening: ports).run(.init(requestID: "open-1", identity: identity)).get()
        _ = try await ClientControl.SwitchWorkspace(switching: ports).run(.init(requestID: "switch-1", identity: identity)).get()
        _ = try await ClientControl.AttachWorkspace(opening: ports).run(.init(requestID: "attach-1", identity: identity, serverSelection: .profile("profile-a"))).get()
        _ = try await ClientControl.FocusWorkspace(switching: ports).run(.init(requestID: "focus-1", identity: identity)).get()
        _ = try await ClientControl.RemoveWorkspace(removing: ports).run(.init(requestID: "remove-1", workspaceID: "workspace-a")).get()
        _ = try await ClientControl.ControlWorkspace(controlling: ports).run(.init(requestID: "close-1", operation: .close, workspaceID: "workspace-a")).get()
        let listed = try await ClientControl.ListWorkspaces(listing: ports).run(.init(requestID: "list-1", includeServer: false)).get()

        let calls = await ports.calls
        #expect(calls == [
            "open:open-1:focusExisting:local",
            "switch:switch-1",
            "open:attach-1:attach:profile-a",
            "switch:focus-1",
            "remove:remove-1",
            "close:close-1",
            "list:list-1:false"
        ])
        #expect(listed.workspaces == [summary])
    }

    @Test("Coordinator and index failures map to typed ClientControl failures")
    func mapsTypedFailures() async throws {
        let ports = ClientPorts()
        await ports.set(openError: WorkspaceCoordinator.WorkspaceCoordinatorError.notOpen)
        let identity = WorkspaceIndex.WorkspaceIdentity(kind: .project, workspaceID: "missing")

        let open = await ClientControl.OpenWorkspace(opening: ports).run(.init(requestID: "open-fail", identity: identity))
        #expect(open == .failure(.workspaceNotOpen))

        await ports.set(removeError: WorkspaceIndex.WorkspaceIndexError.permissionDenied)
        let remove = await ClientControl.RemoveWorkspace(removing: ports).run(.init(requestID: "remove-fail", workspaceID: "missing"))
        #expect(remove == .failure(.permissionError))
    }

    @Test("Control close validates workspace identity before dispatch")
    func closeRequiresWorkspaceIdentity() async {
        let result = await ClientControl.ControlWorkspace(controlling: ClientPorts()).run(.init(requestID: "bad-close", operation: .close))

        #expect(result == .failure(.decodeError))
    }

    @Test("ClientControl source exposes no generic command action")
    func noGenericCommandActionExists() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let actions = root.appending(path: "Sources/FenrirNativeFoundation/Modules/ClientControl/Actions/ClientControlActions.swift")
        let source = try String(contentsOf: actions)

        #expect(!source.contains("HandleCommand"))
        #expect(!source.contains("HandleClientControlCommand"))
    }
}

@Suite("NativeHost client control delivery")
struct NativeHostControlTests {
    @Test("NativeHost parses requests and dispatches typed ClientControl actions")
    func dispatchesTypedActionsFromDeliveryRequests() async throws {
        let dispatcher = NativeHostDispatcher()
        let controller = NativeHostControlController(dispatcher: dispatcher)

        let response = await controller.dispatch(NativeHostControlRequest(
            requestID: "native-open-1",
            command: .open,
            parameters: ["workspaceID": "workspace-a"]
        ))

        #expect(response.ok)
        #expect(response.resultKind == "WorkspaceOpened")
        #expect(response.payload["workspaceID"] == "workspace-a")
        #expect(await dispatcher.calls == ["open:native-open-1:workspace-a"])
    }

    @Test("NativeHost returns typed failures for invalid requests and action errors")
    func returnsTypedNativeHostFailures() async throws {
        let dispatcher = NativeHostDispatcher()
        await dispatcher.set(focusError: .workspaceNotOpen)
        let controller = NativeHostControlController(dispatcher: dispatcher)

        let invalid = await controller.dispatch(NativeHostControlRequest(requestID: "bad-1", command: .remove))
        #expect(!invalid.ok)
        #expect(invalid.error == .decodeError)

        let focus = await controller.dispatch(NativeHostControlRequest(
            requestID: "focus-1",
            command: .focus,
            parameters: ["workspaceID": "workspace-a"]
        ))
        #expect(!focus.ok)
        #expect(focus.error == .workspaceNotOpen)
    }

    @Test("NativeHost remote attach keeps server selection explicit")
    func parsesRemoteAttachSelection() async throws {
        let dispatcher = NativeHostDispatcher()
        let controller = NativeHostControlController(dispatcher: dispatcher)

        let response = await controller.dispatch(NativeHostControlRequest(
            requestID: "attach-remote-1",
            command: .attach,
            parameters: [
                "workspaceID": "workspace-a",
                "serverID": "server-a",
                "serverURL": "ws://127.0.0.1:9876"
            ]
        ))

        #expect(response.ok)
        #expect(await dispatcher.calls == ["attach:attach-remote-1:remote:ws://127.0.0.1:9876"])
    }
}

private actor ClientPorts:
    ClientControl.WorkspaceOpening,
    ClientControl.WorkspaceSwitching,
    ClientControl.WorkspaceListing,
    ClientControl.WorkspaceRemoving,
    ClientControl.WorkspaceControlling
{
    private(set) var calls: [String] = []
    private var summary = WorkspaceIndex.WorkspaceSummary(workspaceID: "workspace-a", displayName: "Alpha")
    private var openError: Error?
    private var removeError: Error?

    func set(summary: WorkspaceIndex.WorkspaceSummary) {
        self.summary = summary
    }

    func set(openError: Error? = nil, removeError: Error? = nil) {
        self.openError = openError
        self.removeError = removeError
    }

    func openWorkspace(_ input: WorkspaceCoordinator.OpenWorkspaceInput) async throws -> WorkspaceCoordinator.OpenWorkspaceResult {
        if let openError {
            throw openError
        }
        let selection = switch input.serverSelection {
        case .local:
            "local"
        case .profile(let profileID):
            profileID.rawValue
        case .remote(let endpoint):
            endpoint.endpointID
        }
        calls.append("open:\(input.requestID.rawValue):\(input.mode.rawValue):\(selection)")
        return WorkspaceCoordinator.OpenWorkspaceResult(
            requestID: input.requestID,
            experience: WorkspaceCoordinator.WorkspaceExperience(workspace: summary, serverSelection: input.serverSelection, windowID: "window-a"),
            didCreateWindow: input.mode != .focusExisting,
            didFocusExistingWindow: input.mode == .focusExisting,
            timestamp: FixedClock().now()
        )
    }

    func switchWorkspace(_ input: WorkspaceCoordinator.SwitchWorkspaceInput) async throws -> WorkspaceCoordinator.SwitchWorkspaceResult {
        calls.append("switch:\(input.requestID.rawValue)")
        return WorkspaceCoordinator.SwitchWorkspaceResult(
            requestID: input.requestID,
            experience: WorkspaceCoordinator.WorkspaceExperience(workspace: summary, serverSelection: .local, windowID: "window-a"),
            timestamp: FixedClock().now()
        )
    }

    func listWorkspaces(_ input: WorkspaceIndex.ListWorkspacesInput) async throws -> WorkspaceIndex.ListWorkspacesResult {
        calls.append("list:\(input.requestID.rawValue):\(input.includeServer)")
        let timestamp = FixedClock().now()
        return WorkspaceIndex.ListWorkspacesResult(
            requestID: input.requestID,
            snapshot: WorkspaceIndex.WorkspaceIndexSnapshot(workspaces: [summary], capturedAt: timestamp),
            timestamp: timestamp
        )
    }

    func removeWorkspace(_ input: WorkspaceIndex.RemoveWorkspaceInput) async throws -> WorkspaceIndex.RemoveWorkspaceResult {
        if let removeError {
            throw removeError
        }
        calls.append("remove:\(input.requestID.rawValue)")
        return WorkspaceIndex.RemoveWorkspaceResult(
            requestID: input.requestID,
            workspaceID: input.workspaceID,
            timestamp: FixedClock().now()
        )
    }

    func closeWorkspace(_ input: WorkspaceCoordinator.CloseWorkspaceExperienceInput) async throws -> WorkspaceCoordinator.CloseWorkspaceExperienceResult {
        calls.append("close:\(input.requestID.rawValue)")
        return WorkspaceCoordinator.CloseWorkspaceExperienceResult(
            requestID: input.requestID,
            workspaceID: input.workspaceID,
            timestamp: FixedClock().now()
        )
    }

    func reconnectWorkspace(_ input: WorkspaceCoordinator.ReconnectWorkspaceExperienceInput) async throws -> WorkspaceCoordinator.ReconnectWorkspaceExperienceResult {
        calls.append("reconnect:\(input.requestID.rawValue)")
        return WorkspaceCoordinator.ReconnectWorkspaceExperienceResult(
            requestID: input.requestID,
            experience: WorkspaceCoordinator.WorkspaceExperience(workspace: summary, serverSelection: input.serverSelection, windowID: "window-a"),
            timestamp: FixedClock().now()
        )
    }
}

private actor NativeHostDispatcher: NativeHostClientControlDispatching {
    private(set) var calls: [String] = []
    private var focusError: ClientControl.ClientControlError?

    func set(focusError: ClientControl.ClientControlError?) {
        self.focusError = focusError
    }

    func openWorkspace(_ input: ClientControl.OpenWorkspaceInput) async -> Result<ClientControl.OpenWorkspaceResult, ClientControl.ClientControlError> {
        let workspace = summary(for: input.identity)
        calls.append("open:\(input.requestID.rawValue):\(workspace.workspaceID.rawValue)")
        return .success(ClientControl.OpenWorkspaceResult(
            requestID: input.requestID,
            workspace: workspace,
            windowID: "window-a",
            didCreateWindow: true,
            didFocusExistingWindow: false,
            timestamp: FixedClock().now()
        ))
    }

    func switchWorkspace(_ input: ClientControl.SwitchWorkspaceInput) async -> Result<ClientControl.SwitchWorkspaceResult, ClientControl.ClientControlError> {
        let workspace = summary(for: input.identity)
        calls.append("switch:\(input.requestID.rawValue):\(workspace.workspaceID.rawValue)")
        return .success(ClientControl.SwitchWorkspaceResult(requestID: input.requestID, workspace: workspace, windowID: "window-a", timestamp: FixedClock().now()))
    }

    func listWorkspaces(_ input: ClientControl.ListWorkspacesInput) async -> Result<ClientControl.ListWorkspacesResult, ClientControl.ClientControlError> {
        calls.append("list:\(input.requestID.rawValue)")
        return .success(ClientControl.ListWorkspacesResult(
            requestID: input.requestID,
            workspaces: [summary(for: WorkspaceIndex.WorkspaceIdentity(kind: .project, workspaceID: "workspace-a"))],
            timestamp: FixedClock().now()
        ))
    }

    func attachWorkspace(_ input: ClientControl.AttachWorkspaceInput) async -> Result<ClientControl.AttachWorkspaceResult, ClientControl.ClientControlError> {
        let workspace = summary(for: input.identity)
        let selection = switch input.serverSelection {
        case .local:
            "local"
        case .profile(let profileID):
            "profile:\(profileID.rawValue)"
        case .remote(let endpoint):
            "remote:\(endpoint.transport.description)"
        }
        calls.append("attach:\(input.requestID.rawValue):\(selection)")
        return .success(ClientControl.AttachWorkspaceResult(requestID: input.requestID, workspace: workspace, windowID: "window-a", timestamp: FixedClock().now()))
    }

    func removeWorkspace(_ input: ClientControl.RemoveWorkspaceInput) async -> Result<ClientControl.RemoveWorkspaceResult, ClientControl.ClientControlError> {
        calls.append("remove:\(input.requestID.rawValue):\(input.workspaceID.rawValue)")
        return .success(ClientControl.RemoveWorkspaceResult(requestID: input.requestID, workspaceID: input.workspaceID, timestamp: FixedClock().now()))
    }

    func focusWorkspace(_ input: ClientControl.FocusWorkspaceInput) async -> Result<ClientControl.FocusWorkspaceResult, ClientControl.ClientControlError> {
        if let focusError {
            return .failure(focusError)
        }
        let workspace = summary(for: input.identity)
        calls.append("focus:\(input.requestID.rawValue):\(workspace.workspaceID.rawValue)")
        return .success(ClientControl.FocusWorkspaceResult(requestID: input.requestID, workspace: workspace, windowID: "window-a", timestamp: FixedClock().now()))
    }

    func controlWorkspace(_ input: ClientControl.ControlWorkspaceInput) async -> Result<ClientControl.ControlWorkspaceResult, ClientControl.ClientControlError> {
        let workspaceID = input.workspaceID ?? input.identity?.workspaceID ?? "workspace-a"
        calls.append("control:\(input.requestID.rawValue):\(input.operation.rawValue)")
        return .success(ClientControl.ControlWorkspaceResult(requestID: input.requestID, operation: input.operation, workspaceID: workspaceID, timestamp: FixedClock().now()))
    }

    private func summary(for identity: WorkspaceIndex.WorkspaceIdentity) -> WorkspaceIndex.WorkspaceSummary {
        WorkspaceIndex.WorkspaceSummary(
            workspaceID: identity.workspaceID ?? "workspace-a",
            displayName: "Alpha",
            identity: identity,
            isOpenLocally: true
        )
    }
}

private extension ServerConnection.EndpointTransport {
    var description: String {
        switch self {
        case .webSocketURL(let url):
            return url
        case .unixDomainSocket(let path):
            return path
        }
    }
}
