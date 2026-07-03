import Darwin
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
            "remove:remove-1:none",
            "close:close-1",
            "list:list-1:false"
        ])
        #expect(listed.workspaces == [summary])
    }

    @Test("Remove forwards scoped workspace identity to the index")
    func removeForwardsScopedIdentity() async throws {
        let ports = ClientPorts()
        let identity = WorkspaceIndex.WorkspaceIdentity(
            kind: .remote,
            workspaceID: "workspace-a",
            serverID: "server-a",
            profileID: "profile-a"
        )

        _ = try await ClientControl.RemoveWorkspace(removing: ports).run(.init(
            requestID: "remove-remote-1",
            workspaceID: "workspace-a",
            targetIdentity: identity
        )).get()

        #expect(await ports.calls == ["remove:remove-remote-1:remote:server-a:profile-a"])
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
        #expect(await dispatcher.calls == ["attach:attach-remote-1:remote:server-a:ws://127.0.0.1:9876"])
    }

    @Test("NativeHost remove preserves scoped remote identity")
    func removePreservesScopedRemoteIdentity() async throws {
        let dispatcher = NativeHostDispatcher()
        let controller = NativeHostControlController(dispatcher: dispatcher)

        let response = await controller.dispatch(NativeHostControlRequest(
            requestID: "remove-remote-1",
            command: .remove,
            parameters: [
                "workspaceID": "workspace-a",
                "serverID": "server-a",
                "profileID": "profile-a"
            ]
        ))

        #expect(response.ok)
        #expect(await dispatcher.calls == ["remove:remove-remote-1:workspace-a:remote:server-a:profile-a"])
    }

    @Test("NativeHost composes public ClientControl actions")
    func composesPublicClientControlActions() async throws {
        let ports = ClientPorts()
        let actions = NativeHostClientControlActions(
            opening: ports,
            switching: ports,
            listing: ports,
            removing: ports,
            controlling: ports
        )
        let controller = NativeHostControlController(dispatcher: actions)

        let response = await controller.dispatch(NativeHostControlRequest(
            requestID: "native-compose-open",
            command: .open,
            parameters: ["workspaceID": "workspace-a"]
        ))

        #expect(response.ok)
        #expect(await ports.calls == ["open:native-compose-open:focusExisting:local"])
    }

    @Test("NativeHost routes explicit product commands without generic command blobs")
    func routesExplicitProductCommands() async throws {
        let dispatcher = NativeHostDispatcher()
        let product = NativeHostProductDispatcher()
        let controller = NativeHostControlController(dispatcher: dispatcher, productDispatcher: product)

        let palette = await controller.dispatch(NativeHostControlRequest(
            requestID: "palette-open-1",
            command: .palette,
            parameters: ["query": "diag"]
        ))
        let paletteRun = await controller.dispatch(NativeHostControlRequest(
            requestID: "palette-run-1",
            command: .palette,
            parameters: ["operation": "run", "actionID": "action-diagnostics"]
        ))
        let workflow = await controller.dispatch(NativeHostControlRequest(
            requestID: "workflow-timeline-1",
            command: .workflow,
            parameters: ["operation": "timeline", "runID": "run-a"]
        ))
        let diagnostics = await controller.dispatch(NativeHostControlRequest(
            requestID: "diagnostics-open-1",
            command: .diagnostics
        ))
        let agentStatus = await controller.dispatch(NativeHostControlRequest(
            requestID: "agent-status-1",
            command: .diagnostics,
            parameters: ["operation": "agent-integration-status", "agentID": "codex"]
        ))

        #expect(palette.resultKind == "PalettePresented")
        #expect(palette.payload["query"] == "diag")
        #expect(paletteRun.resultKind == "PaletteActionExecuted")
        #expect(workflow.resultKind == "WorkflowPresented")
        #expect(diagnostics.resultKind == "DiagnosticsPresented")
        #expect(agentStatus.resultKind == "DiagnosticsPresented")
        #expect(await product.calls == [
            "palette:palette-open-1:diag",
            "palette-run:palette-run-1:action-diagnostics",
            "workflow:workflow-timeline-1:timeline:run-a",
            "diagnostics:diagnostics-open-1:open:none",
            "diagnostics:agent-status-1:agent-integration-status:codex"
        ])
    }

    @Test("NativeHost CLI socket route roundtrips product commands")
    func localCLISocketRouteRoundtripsProductCommands() async throws {
        let product = NativeHostProductDispatcher()
        let route = NativeHostLocalCLISocketRoute(controller: NativeHostControlController(
            dispatcher: NativeHostDispatcher(),
            productDispatcher: product
        ))
        let request = NativeHostCLIProtocol.WireRequest(
            protocolVersion: NativeHostCLIProtocol.version,
            requestID: "cli-diagnostics-1",
            command: .diagnostics
        )

        let responseFrame = await route.handleFrame(try NativeHostCLIProtocol.encodeFrame(JSONEncoder().encode(request)))
        let response = try JSONDecoder().decode(
            NativeHostCLIProtocol.WireResponse.self,
            from: NativeHostCLIProtocol.decodeFrame(responseFrame)
        )

        #expect(response.ok)
        #expect(response.resultKind == "DiagnosticsPresented")
        #expect(await product.calls == ["diagnostics:cli-diagnostics-1:open:none"])
    }

    @Test("NativeHost CLI socket route decodes requests and encodes responses")
    func localCLISocketRouteIsThin() async throws {
        let dispatcher = NativeHostDispatcher()
        let route = NativeHostLocalCLISocketRoute(controller: NativeHostControlController(dispatcher: dispatcher))
        let request = NativeHostControlRequest(
            requestID: "cli-list-1",
            command: .list,
            parameters: ["includeServer": "false", "includeHidden": "true"]
        )
        let data = try JSONEncoder().encode(request)

        let responseData = await route.handle(data)
        let response = try JSONDecoder().decode(NativeHostControlResponse.self, from: responseData)

        #expect(response.ok)
        #expect(response.resultKind == "WorkspacesListed")
        #expect(response.payload["workspaceCount"] == "1")
        #expect(await dispatcher.calls == ["list:cli-list-1:false:true"])
    }

    @Test("NativeHost CLI socket protocol frames versioned requests and responses")
    func localCLISocketProtocolFramesRequestsAndResponses() async throws {
        let dispatcher = NativeHostDispatcher()
        let route = NativeHostLocalCLISocketRoute(controller: NativeHostControlController(dispatcher: dispatcher))
        let request = NativeHostCLIProtocol.WireRequest(
            protocolVersion: NativeHostCLIProtocol.version,
            requestID: "cli-frame-1",
            command: .open,
            parameters: ["workspaceID": "workspace-a"]
        )
        let frame = try NativeHostCLIProtocol.encodeFrame(JSONEncoder().encode(request))

        let responseFrame = await route.handleFrame(frame)
        let responsePayload = try NativeHostCLIProtocol.decodeFrame(responseFrame)
        let response = try JSONDecoder().decode(NativeHostCLIProtocol.WireResponse.self, from: responsePayload)

        #expect(response.protocolVersion == NativeHostCLIProtocol.version)
        #expect(response.ok)
        #expect(response.resultKind == "WorkspaceOpened")
        #expect(response.payload["workspaceID"] == "workspace-a")
        #expect(await dispatcher.calls == ["open:cli-frame-1:workspace-a"])
    }

    @Test("NativeHost CLI socket protocol returns stable errors for malformed requests")
    func localCLISocketProtocolRejectsMalformedRequests() async throws {
        let route = NativeHostLocalCLISocketRoute(controller: NativeHostControlController(dispatcher: NativeHostDispatcher()))
        let malformedPayload = Data("{".utf8)
        let malformedFrame = try NativeHostCLIProtocol.encodeFrame(malformedPayload)

        let responseFrame = await route.handleFrame(malformedFrame)
        let response = try JSONDecoder().decode(
            NativeHostCLIProtocol.WireResponse.self,
            from: NativeHostCLIProtocol.decodeFrame(responseFrame)
        )

        #expect(!response.ok)
        #expect(response.error == NativeHostCLIProtocol.ProtocolError.malformedRequest.rawValue)
    }

    @Test("NativeHost CLI socket protocol rejects unsupported versions")
    func localCLISocketProtocolRejectsUnsupportedVersions() async throws {
        let route = NativeHostLocalCLISocketRoute(controller: NativeHostControlController(dispatcher: NativeHostDispatcher()))
        let request = NativeHostCLIProtocol.WireRequest(
            protocolVersion: NativeHostCLIProtocol.version + 1,
            requestID: "cli-version-1",
            command: .list
        )
        let frame = try NativeHostCLIProtocol.encodeFrame(JSONEncoder().encode(request))

        let responseFrame = await route.handleFrame(frame)
        let response = try JSONDecoder().decode(
            NativeHostCLIProtocol.WireResponse.self,
            from: NativeHostCLIProtocol.decodeFrame(responseFrame)
        )

        #expect(!response.ok)
        #expect(response.requestID == "cli-version-1")
        #expect(response.error == NativeHostCLIProtocol.ProtocolError.unsupportedVersion.rawValue)
    }

    @Test("NativeHost CLI socket protocol enforces bounded payloads")
    func localCLISocketProtocolRejectsOversizedPayloads() throws {
        let payload = Data(repeating: 1, count: NativeHostCLIProtocol.maxPayloadBytes + 1)

        #expect(throws: NativeHostCLIProtocol.ProtocolError.payloadTooLarge) {
            _ = try NativeHostCLIProtocol.encodeFrame(payload)
        }
    }

    @Test("NativeHost CLI socket server binds owned endpoint and serves framed requests")
    func localCLISocketServerBindsAndServesFrames() async throws {
        let dispatcher = NativeHostDispatcher()
        let route = NativeHostLocalCLISocketRoute(controller: NativeHostControlController(dispatcher: dispatcher))
        let socketURL = try makeTemporarySocketURL()
        let server = NativeHostLocalCLISocketServer(socketPath: socketURL.path, route: route)
        try server.start()
        defer {
            server.stop()
        }

        var socketStat = stat()
        #expect(lstat(socketURL.path, &socketStat) == 0)
        #expect(socketStat.st_uid == getuid())
        #expect((socketStat.st_mode & S_IFMT) == S_IFSOCK)
        #expect((socketStat.st_mode & 0o777) == 0o600)

        let request = NativeHostCLIProtocol.WireRequest(
            protocolVersion: NativeHostCLIProtocol.version,
            requestID: "cli-live-socket-1",
            command: .list,
            parameters: ["includeServer": "false"]
        )
        let responseFrame = try await sendNativeHostSocketRequest(
            frame: NativeHostCLIProtocol.encodeFrame(JSONEncoder().encode(request)),
            socketPath: socketURL.path
        )
        let response = try JSONDecoder().decode(
            NativeHostCLIProtocol.WireResponse.self,
            from: NativeHostCLIProtocol.decodeFrame(responseFrame)
        )

        #expect(response.ok)
        #expect(response.resultKind == "WorkspacesListed")
        #expect(response.payload["workspaceCount"] == "1")
        #expect(await dispatcher.calls == ["list:cli-live-socket-1:false:false"])
    }

    @Test("NativeHost CLI socket server roundtrips product commands")
    func localCLISocketServerRoundtripsProductCommands() async throws {
        let product = NativeHostProductDispatcher()
        let route = NativeHostLocalCLISocketRoute(controller: NativeHostControlController(
            dispatcher: NativeHostDispatcher(),
            productDispatcher: product
        ))
        let socketURL = try makeTemporarySocketURL()
        let server = NativeHostLocalCLISocketServer(socketPath: socketURL.path, route: route)
        try server.start()
        defer {
            server.stop()
        }

        let request = NativeHostCLIProtocol.WireRequest(
            protocolVersion: NativeHostCLIProtocol.version,
            requestID: "cli-live-diagnostics-1",
            command: .diagnostics
        )
        let responseFrame = try await sendNativeHostSocketRequest(
            frame: NativeHostCLIProtocol.encodeFrame(JSONEncoder().encode(request)),
            socketPath: socketURL.path
        )
        let response = try JSONDecoder().decode(
            NativeHostCLIProtocol.WireResponse.self,
            from: NativeHostCLIProtocol.decodeFrame(responseFrame)
        )

        #expect(response.ok)
        #expect(response.resultKind == "DiagnosticsPresented")
        #expect(await product.calls == ["diagnostics:cli-live-diagnostics-1:open:none"])
    }

    @Test("NativeHost CLI socket server replaces same-user stale endpoint")
    func localCLISocketServerReplacesSameUserStaleEndpoint() throws {
        let socketURL = try makeTemporarySocketURL()
        try Data("stale".utf8).write(to: socketURL)
        let server = NativeHostLocalCLISocketServer(
            socketPath: socketURL.path,
            route: NativeHostLocalCLISocketRoute(controller: NativeHostControlController(dispatcher: NativeHostDispatcher()))
        )
        try server.start()
        defer {
            server.stop()
        }

        var socketStat = stat()
        #expect(lstat(socketURL.path, &socketStat) == 0)
        #expect((socketStat.st_mode & S_IFMT) == S_IFSOCK)
    }

    @Test("NativeHost CLI socket server does not chmod existing override parent directories")
    func localCLISocketServerDoesNotChmodExistingParents() throws {
        let directory = try makeShortTemporaryDirectory()
        guard chmod(directory.path, 0o755) == 0 else {
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
        let socketURL = directory.appendingPathComponent("override.sock")
        let server = NativeHostLocalCLISocketServer(
            socketPath: socketURL.path,
            route: NativeHostLocalCLISocketRoute(controller: NativeHostControlController(dispatcher: NativeHostDispatcher()))
        )

        try server.start()
        defer {
            server.stop()
        }

        var directoryStat = stat()
        #expect(lstat(directory.path, &directoryStat) == 0)
        #expect((directoryStat.st_mode & 0o777) == 0o755)
    }

    @Test("NativeHost CLI socket server locks down newly created socket parent")
    func localCLISocketServerLocksDownNewParent() throws {
        let baseDirectory = try makeShortTemporaryDirectory()
        let socketDirectory = baseDirectory.appendingPathComponent("managed", isDirectory: true)
        let socketURL = socketDirectory.appendingPathComponent("native-control.sock")
        let server = NativeHostLocalCLISocketServer(
            socketPath: socketURL.path,
            route: NativeHostLocalCLISocketRoute(controller: NativeHostControlController(dispatcher: NativeHostDispatcher()))
        )

        try server.start()
        defer {
            server.stop()
        }

        var directoryStat = stat()
        #expect(lstat(socketDirectory.path, &directoryStat) == 0)
        #expect((directoryStat.st_mode & 0o777) == 0o700)
    }

    @Test("NativeHost app events extract params before dispatch")
    func appEventRouteExtractsParams() async throws {
        let dispatcher = NativeHostDispatcher()
        let route = NativeHostAppEventController(controller: NativeHostControlController(dispatcher: dispatcher))

        let response = await route.dispatch(.openWorkspace(
            requestID: "app-open-1",
            projectID: "project-a"
        ))

        #expect(response.ok)
        #expect(response.payload["workspaceID"] == "workspace-a")
        #expect(await dispatcher.calls == ["open:app-open-1:workspace-a"])
    }

    @Test("NativeHost server events extract explicit remote params before dispatch")
    func serverEventRouteExtractsParams() async throws {
        let dispatcher = NativeHostDispatcher()
        let route = NativeHostServerEventController(controller: NativeHostControlController(dispatcher: dispatcher))

        let response = await route.dispatch(.reconnectWorkspace(
            requestID: "server-reconnect-1",
            workspaceID: "workspace-a",
            serverID: "server-a",
            serverURL: "ws://127.0.0.1:9876"
        ))

        #expect(response.ok)
        #expect(await dispatcher.calls == ["control:server-reconnect-1:reconnect:remote:server-a:ws://127.0.0.1:9876"])
    }

    @Test("Native foundation modules do not import NativeHost")
    func modulesDoNotImportNativeHost() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let modules = root.appending(path: "Sources/FenrirNativeFoundation/Modules")
        let enumerator = FileManager.default.enumerator(at: modules, includingPropertiesForKeys: nil)
        var offenders: [String] = []

        while let file = enumerator?.nextObject() as? URL {
            guard file.pathExtension == "swift" else {
                continue
            }
            let source = try String(contentsOf: file)
            if source.contains("import FenrirNativeApp") {
                offenders.append(file.lastPathComponent)
            }
        }

        #expect(offenders.isEmpty)
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
        calls.append("remove:\(input.requestID.rawValue):\(identityDescription(input.targetIdentity))")
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
        calls.append("list:\(input.requestID.rawValue):\(input.includeServer):\(input.includeHidden)")
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
            "remote:\(endpoint.endpointID):\(endpoint.transport.description)"
        }
        calls.append("attach:\(input.requestID.rawValue):\(selection)")
        return .success(ClientControl.AttachWorkspaceResult(requestID: input.requestID, workspace: workspace, windowID: "window-a", timestamp: FixedClock().now()))
    }

    func removeWorkspace(_ input: ClientControl.RemoveWorkspaceInput) async -> Result<ClientControl.RemoveWorkspaceResult, ClientControl.ClientControlError> {
        calls.append("remove:\(input.requestID.rawValue):\(input.workspaceID.rawValue):\(identityDescription(input.targetIdentity))")
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
        let selection = switch input.serverSelection {
        case .local:
            "local"
        case .profile(let profileID):
            "profile:\(profileID.rawValue)"
        case .remote(let endpoint):
            "remote:\(endpoint.endpointID):\(endpoint.transport.description)"
        }
        calls.append("control:\(input.requestID.rawValue):\(input.operation.rawValue):\(selection)")
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

private actor NativeHostProductDispatcher: NativeHostProductCommandDispatching {
    private(set) var calls: [String] = []

    func presentPalette(_ input: NativeHostPaletteInput) async -> Result<NativeHostProductCommandResult, ClientControl.ClientControlError> {
        calls.append("palette:\(input.requestID.rawValue):\(input.query ?? "none")")
        return .success(NativeHostProductCommandResult(
            requestID: input.requestID,
            resultKind: "PalettePresented",
            payload: ["query": input.query ?? ""]
        ))
    }

    func executePaletteAction(_ input: NativeHostPaletteInput) async -> Result<NativeHostProductCommandResult, ClientControl.ClientControlError> {
        calls.append("palette-run:\(input.requestID.rawValue):\(input.actionID ?? "none")")
        return .success(NativeHostProductCommandResult(
            requestID: input.requestID,
            resultKind: "PaletteActionExecuted",
            payload: ["actionID": input.actionID ?? ""]
        ))
    }

    func presentWorkflow(_ input: NativeHostWorkflowInput) async -> Result<NativeHostProductCommandResult, ClientControl.ClientControlError> {
        calls.append("workflow:\(input.requestID.rawValue):\(input.operation):\(input.runID ?? "none")")
        return .success(NativeHostProductCommandResult(
            requestID: input.requestID,
            resultKind: "WorkflowPresented",
            payload: ["operation": input.operation]
        ))
    }

    func presentDiagnostics(_ input: NativeHostDiagnosticsInput) async -> Result<NativeHostProductCommandResult, ClientControl.ClientControlError> {
        calls.append("diagnostics:\(input.requestID.rawValue):\(input.operation):\(input.agentID ?? "none")")
        return .success(NativeHostProductCommandResult(
            requestID: input.requestID,
            resultKind: "DiagnosticsPresented"
        ))
    }
}

private func identityDescription(_ identity: WorkspaceIndex.WorkspaceIdentity?) -> String {
    guard let identity else {
        return "none"
    }

    switch identity.kind {
    case .localPath:
        return "localPath:\(identity.workspaceID?.rawValue ?? "none"):\(identity.canonicalPath ?? "none")"
    case .project:
        return "project:\(identity.workspaceID?.rawValue ?? "none"):\(identity.projectID ?? "none")"
    case .remote:
        return "remote:\(identity.serverID ?? "none"):\(identity.profileID?.rawValue ?? "none")"
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

private func makeTemporarySocketURL() throws -> URL {
    let directory = try makeShortTemporaryDirectory()
    return directory.appendingPathComponent("ctl.sock")
}

private func makeShortTemporaryDirectory() throws -> URL {
    let directory = URL(fileURLWithPath: "/tmp", isDirectory: true)
        .appendingPathComponent("fnr-\(UUID().uuidString.prefix(8))", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
}

private func sendNativeHostSocketRequest(frame: Data, socketPath: String) async throws -> Data {
    try await Task.detached(priority: .userInitiated) {
        let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else {
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
        defer {
            close(fd)
        }

        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let maxPathLength = MemoryLayout.size(ofValue: address.sun_path)
        guard socketPath.utf8.count < maxPathLength else {
            throw POSIXError(.ENAMETOOLONG)
        }
        socketPath.withCString { pathPointer in
            withUnsafeMutablePointer(to: &address.sun_path) { sunPathPointer in
                sunPathPointer.withMemoryRebound(to: CChar.self, capacity: maxPathLength) { destination in
                    _ = strncpy(destination, pathPointer, maxPathLength - 1)
                }
            }
        }

        let connected = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
                connect(fd, socketAddress, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard connected == 0 else {
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .ECONNREFUSED)
        }
        guard writeAllForTest(frame, to: fd) else {
            throw POSIXError(.EIO)
        }
        guard let responseHeader = readExactForTest(byteCount: 4, from: fd) else {
            throw POSIXError(.EIO)
        }
        let responseLength = responseHeader.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
        guard let responsePayload = readExactForTest(byteCount: Int(responseLength), from: fd) else {
            throw POSIXError(.EIO)
        }
        var responseFrame = Data(responseHeader)
        responseFrame.append(responsePayload)
        return responseFrame
    }.value
}

private func readExactForTest(byteCount: Int, from fd: Int32) -> Data? {
    var data = Data(count: byteCount)
    var offset = 0
    let success = data.withUnsafeMutableBytes { buffer -> Bool in
        guard let baseAddress = buffer.baseAddress else {
            return byteCount == 0
        }
        while offset < byteCount {
            let count = read(fd, baseAddress.advanced(by: offset), byteCount - offset)
            if count <= 0 {
                return false
            }
            offset += count
        }
        return true
    }
    return success ? data : nil
}

private func writeAllForTest(_ data: Data, to fd: Int32) -> Bool {
    data.withUnsafeBytes { buffer -> Bool in
        guard let baseAddress = buffer.baseAddress else {
            return data.isEmpty
        }
        var offset = 0
        while offset < data.count {
            let count = write(fd, baseAddress.advanced(by: offset), data.count - offset)
            if count <= 0 {
                return false
            }
            offset += count
        }
        return true
    }
}
