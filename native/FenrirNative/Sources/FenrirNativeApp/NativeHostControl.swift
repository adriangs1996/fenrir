import Darwin
import Foundation
import FenrirNativeShared
import Keybinding
import Notifications
import WorkspaceIndex
import ServerConnection
import WorkspaceCoordinator
import ClientControl
import WorkflowControl

enum NativeHostControlCommand: String, Codable, Equatable, Sendable {
    case open
    case `switch`
    case list
    case attach
    case remove
    case focus
    case control
    case palette
    case workflow
    case diagnostics
}

struct NativeHostControlRequest: Codable, Equatable, Sendable {
    let requestID: RequestID
    let command: NativeHostControlCommand
    let parameters: [String: String]

    init(requestID: RequestID, command: NativeHostControlCommand, parameters: [String: String] = [:]) {
        self.requestID = requestID
        self.command = command
        self.parameters = parameters
    }
}

struct NativeHostControlResponse: Codable, Equatable, Sendable {
    let requestID: RequestID
    let command: NativeHostControlCommand
    let ok: Bool
    let resultKind: String
    let payload: [String: String]
    let error: ClientControl.ClientControlError?

    init(
        requestID: RequestID,
        command: NativeHostControlCommand,
        ok: Bool,
        resultKind: String,
        payload: [String: String] = [:],
        error: ClientControl.ClientControlError? = nil
    ) {
        self.requestID = requestID
        self.command = command
        self.ok = ok
        self.resultKind = resultKind
        self.payload = payload
        self.error = error
    }
}

protocol NativeHostClientControlDispatching: Sendable {
    func openWorkspace(_ input: ClientControl.OpenWorkspaceInput) async -> Result<ClientControl.OpenWorkspaceResult, ClientControl.ClientControlError>
    func switchWorkspace(_ input: ClientControl.SwitchWorkspaceInput) async -> Result<ClientControl.SwitchWorkspaceResult, ClientControl.ClientControlError>
    func listWorkspaces(_ input: ClientControl.ListWorkspacesInput) async -> Result<ClientControl.ListWorkspacesResult, ClientControl.ClientControlError>
    func attachWorkspace(_ input: ClientControl.AttachWorkspaceInput) async -> Result<ClientControl.AttachWorkspaceResult, ClientControl.ClientControlError>
    func removeWorkspace(_ input: ClientControl.RemoveWorkspaceInput) async -> Result<ClientControl.RemoveWorkspaceResult, ClientControl.ClientControlError>
    func focusWorkspace(_ input: ClientControl.FocusWorkspaceInput) async -> Result<ClientControl.FocusWorkspaceResult, ClientControl.ClientControlError>
    func controlWorkspace(_ input: ClientControl.ControlWorkspaceInput) async -> Result<ClientControl.ControlWorkspaceResult, ClientControl.ClientControlError>
}

protocol NativeHostProductCommandDispatching: Sendable {
    func presentPalette(_ input: NativeHostPaletteInput) async -> Result<NativeHostProductCommandResult, ClientControl.ClientControlError>
    func executePaletteAction(_ input: NativeHostPaletteInput) async -> Result<NativeHostProductCommandResult, ClientControl.ClientControlError>
    func presentWorkflow(_ input: NativeHostWorkflowInput) async -> Result<NativeHostProductCommandResult, ClientControl.ClientControlError>
    func presentDiagnostics(_ input: NativeHostDiagnosticsInput) async -> Result<NativeHostProductCommandResult, ClientControl.ClientControlError>
}

struct NativeHostPaletteInput: Equatable, Sendable {
    let requestID: RequestID
    let actionID: String?
    let query: String?

    init(requestID: RequestID, actionID: String? = nil, query: String? = nil) {
        self.requestID = requestID
        self.actionID = actionID
        self.query = query
    }
}

struct NativeHostWorkflowInput: Equatable, Sendable {
    let requestID: RequestID
    let operation: String
    let runID: String?

    init(requestID: RequestID, operation: String = "open", runID: String? = nil) {
        self.requestID = requestID
        self.operation = operation
        self.runID = runID
    }
}

struct NativeHostDiagnosticsInput: Equatable, Sendable {
    let requestID: RequestID
    let operation: String
    let workspaceID: WorkspaceID?
    let runID: WorkflowControl.WorkflowRunID?
    let agentID: String?
    let contextSource: Keybinding.AgentComposerContextSource?
    let expectedMarker: String?
    let selectionText: String?

    init(
        requestID: RequestID,
        operation: String = "open",
        workspaceID: WorkspaceID? = nil,
        runID: WorkflowControl.WorkflowRunID? = nil,
        agentID: String? = nil,
        contextSource: Keybinding.AgentComposerContextSource? = nil,
        expectedMarker: String? = nil,
        selectionText: String? = nil
    ) {
        self.requestID = requestID
        self.operation = operation
        self.workspaceID = workspaceID
        self.runID = runID
        self.agentID = agentID
        self.contextSource = contextSource
        self.expectedMarker = expectedMarker
        self.selectionText = selectionText
    }
}

struct NativeHostProductCommandResult: Equatable, Sendable {
    let requestID: RequestID
    let resultKind: String
    let payload: [String: String]

    init(requestID: RequestID, resultKind: String, payload: [String: String] = [:]) {
        self.requestID = requestID
        self.resultKind = resultKind
        self.payload = payload
    }
}

struct NativeHostClientControlActions: NativeHostClientControlDispatching {
    private let openAction: ClientControl.OpenWorkspace
    private let switchAction: ClientControl.SwitchWorkspace
    private let listAction: ClientControl.ListWorkspaces
    private let attachAction: ClientControl.AttachWorkspace
    private let removeAction: ClientControl.RemoveWorkspace
    private let focusAction: ClientControl.FocusWorkspace
    private let controlAction: ClientControl.ControlWorkspace

    init(
        openAction: ClientControl.OpenWorkspace,
        switchAction: ClientControl.SwitchWorkspace,
        listAction: ClientControl.ListWorkspaces,
        attachAction: ClientControl.AttachWorkspace,
        removeAction: ClientControl.RemoveWorkspace,
        focusAction: ClientControl.FocusWorkspace,
        controlAction: ClientControl.ControlWorkspace
    ) {
        self.openAction = openAction
        self.switchAction = switchAction
        self.listAction = listAction
        self.attachAction = attachAction
        self.removeAction = removeAction
        self.focusAction = focusAction
        self.controlAction = controlAction
    }

    init(
        opening: any ClientControl.WorkspaceOpening,
        switching: any ClientControl.WorkspaceSwitching,
        listing: any ClientControl.WorkspaceListing,
        removing: any ClientControl.WorkspaceRemoving,
        controlling: any ClientControl.WorkspaceControlling
    ) {
        self.init(
            openAction: ClientControl.OpenWorkspace(opening: opening),
            switchAction: ClientControl.SwitchWorkspace(switching: switching),
            listAction: ClientControl.ListWorkspaces(listing: listing),
            attachAction: ClientControl.AttachWorkspace(opening: opening),
            removeAction: ClientControl.RemoveWorkspace(removing: removing),
            focusAction: ClientControl.FocusWorkspace(switching: switching),
            controlAction: ClientControl.ControlWorkspace(controlling: controlling)
        )
    }

    func openWorkspace(_ input: ClientControl.OpenWorkspaceInput) async -> Result<ClientControl.OpenWorkspaceResult, ClientControl.ClientControlError> {
        await openAction.run(input)
    }

    func switchWorkspace(_ input: ClientControl.SwitchWorkspaceInput) async -> Result<ClientControl.SwitchWorkspaceResult, ClientControl.ClientControlError> {
        await switchAction.run(input)
    }

    func listWorkspaces(_ input: ClientControl.ListWorkspacesInput) async -> Result<ClientControl.ListWorkspacesResult, ClientControl.ClientControlError> {
        await listAction.run(input)
    }

    func attachWorkspace(_ input: ClientControl.AttachWorkspaceInput) async -> Result<ClientControl.AttachWorkspaceResult, ClientControl.ClientControlError> {
        await attachAction.run(input)
    }

    func removeWorkspace(_ input: ClientControl.RemoveWorkspaceInput) async -> Result<ClientControl.RemoveWorkspaceResult, ClientControl.ClientControlError> {
        await removeAction.run(input)
    }

    func focusWorkspace(_ input: ClientControl.FocusWorkspaceInput) async -> Result<ClientControl.FocusWorkspaceResult, ClientControl.ClientControlError> {
        await focusAction.run(input)
    }

    func controlWorkspace(_ input: ClientControl.ControlWorkspaceInput) async -> Result<ClientControl.ControlWorkspaceResult, ClientControl.ClientControlError> {
        await controlAction.run(input)
    }
}

struct NativeHostControlController: Sendable {
    let dispatcher: any NativeHostClientControlDispatching
    let productDispatcher: (any NativeHostProductCommandDispatching)?

    init(
        dispatcher: any NativeHostClientControlDispatching,
        productDispatcher: (any NativeHostProductCommandDispatching)? = nil
    ) {
        self.dispatcher = dispatcher
        self.productDispatcher = productDispatcher
    }

    func dispatch(_ request: NativeHostControlRequest) async -> NativeHostControlResponse {
        switch request.command {
        case .open:
            guard let identity = NativeHostControlController.identity(from: request.parameters) else {
                return failure(request, .decodeError)
            }
            return await dispatcher.openWorkspace(ClientControl.OpenWorkspaceInput(
                requestID: request.requestID,
                identity: identity,
                source: .nativeHost
            )).nativeHostResponse(request, resultKind: "WorkspaceOpened", payload: { result in
                workspacePayload(result.workspace, windowID: result.windowID, extra: [
                    "didCreateWindow": String(result.didCreateWindow),
                    "didFocusExistingWindow": String(result.didFocusExistingWindow)
                ])
            })
        case .switch:
            guard let identity = NativeHostControlController.identity(from: request.parameters) else {
                return failure(request, .decodeError)
            }
            return await dispatcher.switchWorkspace(ClientControl.SwitchWorkspaceInput(
                requestID: request.requestID,
                identity: identity,
                source: .nativeHost
            )).nativeHostResponse(request, resultKind: "WorkspaceSwitched", payload: { result in
                workspacePayload(result.workspace, windowID: result.windowID)
            })
        case .list:
            let includeServer = request.parameters["includeServer"].map { $0 != "false" } ?? true
            let includeHidden = request.parameters["includeHidden"].map { $0 == "true" } ?? false
            return await dispatcher.listWorkspaces(ClientControl.ListWorkspacesInput(
                requestID: request.requestID,
                includeServer: includeServer,
                includeHidden: includeHidden,
                surface: .cli,
                source: .nativeHost
            )).nativeHostResponse(request, resultKind: "WorkspacesListed", payload: { result in
                var payload = [
                    "workspaceCount": String(result.workspaces.count),
                    "workspaceIDs": result.workspaces.map(\.workspaceID.rawValue).joined(separator: ",")
                ]
                if let activeWorkspaceID = result.activeWorkspaceID {
                    payload["activeWorkspaceID"] = activeWorkspaceID.rawValue
                }
                return payload
            })
        case .attach:
            guard let identity = NativeHostControlController.identity(from: request.parameters) else {
                return failure(request, .decodeError)
            }
            return await dispatcher.attachWorkspace(ClientControl.AttachWorkspaceInput(
                requestID: request.requestID,
                identity: identity,
                serverSelection: NativeHostControlController.serverSelection(from: request.parameters),
                source: .nativeHost
            )).nativeHostResponse(request, resultKind: "WorkspaceAttached", payload: { result in
                workspacePayload(result.workspace, windowID: result.windowID)
            })
        case .remove:
            guard let workspaceID = request.parameters["workspaceID"].map(WorkspaceID.init(rawValue:)) else {
                return failure(request, .decodeError)
            }
            return await dispatcher.removeWorkspace(ClientControl.RemoveWorkspaceInput(
                requestID: request.requestID,
                workspaceID: workspaceID,
                targetIdentity: NativeHostControlController.identity(from: request.parameters),
                source: .nativeHost
            )).nativeHostResponse(request, resultKind: "WorkspaceRemoved", payload: { result in
                ["workspaceID": result.workspaceID.rawValue]
            })
        case .focus:
            guard let identity = NativeHostControlController.identity(from: request.parameters) else {
                return failure(request, .decodeError)
            }
            return await dispatcher.focusWorkspace(ClientControl.FocusWorkspaceInput(
                requestID: request.requestID,
                identity: identity,
                source: .nativeHost
            )).nativeHostResponse(request, resultKind: "WorkspaceFocused", payload: { result in
                workspacePayload(result.workspace, windowID: result.windowID)
            })
        case .control:
            guard let operation = request.parameters["operation"].flatMap(ClientControl.WorkspaceControlOperation.init(rawValue:)) else {
                return failure(request, .decodeError)
            }
            return await dispatcher.controlWorkspace(ClientControl.ControlWorkspaceInput(
                requestID: request.requestID,
                operation: operation,
                workspaceID: request.parameters["workspaceID"].map(WorkspaceID.init(rawValue:)),
                identity: NativeHostControlController.identity(from: request.parameters),
                serverSelection: NativeHostControlController.serverSelection(from: request.parameters),
                source: .nativeHost
            )).nativeHostResponse(request, resultKind: "WorkspaceControlled", payload: { result in
                var payload = [
                    "workspaceID": result.workspaceID.rawValue,
                    "operation": result.operation.rawValue
                ]
                if let workspace = result.workspace {
                    payload["displayName"] = workspace.displayName
                }
                return payload
            })
        case .palette:
            guard let productDispatcher else {
                return failure(request, .unavailable)
            }
            let input = NativeHostPaletteInput(
                requestID: request.requestID,
                actionID: request.parameters["actionID"],
                query: request.parameters["query"]
            )
            if request.parameters["operation"] == "run" {
                guard input.actionID != nil else {
                    return failure(request, .decodeError)
                }
                return await productDispatcher.executePaletteAction(input).nativeHostResponse(request)
            }
            return await productDispatcher.presentPalette(input).nativeHostResponse(request)
        case .workflow:
            guard let productDispatcher else {
                return failure(request, .unavailable)
            }
            return await productDispatcher.presentWorkflow(NativeHostWorkflowInput(
                requestID: request.requestID,
                operation: request.parameters["operation"] ?? "open",
                runID: request.parameters["runID"]
            )).nativeHostResponse(request)
        case .diagnostics:
            guard let productDispatcher else {
                return failure(request, .unavailable)
            }
            return await productDispatcher.presentDiagnostics(NativeHostDiagnosticsInput(
                requestID: request.requestID,
                operation: request.parameters["operation"] ?? "open",
                workspaceID: request.parameters["workspaceID"].map(WorkspaceID.init(rawValue:)),
                runID: request.parameters["runID"].map(WorkflowControl.WorkflowRunID.init(rawValue:)),
                agentID: request.parameters["agentID"],
                contextSource: NativeHostControlController.agentComposerContextSource(from: request.parameters),
                expectedMarker: request.parameters["expectedMarker"],
                selectionText: request.parameters["selectionText"]
            ))
                .nativeHostResponse(request)
        }
    }

    private func failure(_ request: NativeHostControlRequest, _ error: ClientControl.ClientControlError) -> NativeHostControlResponse {
        NativeHostControlResponse(
            requestID: request.requestID,
            command: request.command,
            ok: false,
            resultKind: "ClientControlFailed",
            error: error
        )
    }

    private static func identity(from parameters: [String: String]) -> WorkspaceIndex.WorkspaceIdentity? {
        if let canonicalPath = parameters["path"] {
            return WorkspaceIndex.WorkspaceIdentity(
                kind: .localPath,
                workspaceID: parameters["workspaceID"].map(WorkspaceID.init(rawValue:)),
                canonicalPath: canonicalPath
            )
        }

        if let serverID = parameters["serverID"] {
            return WorkspaceIndex.WorkspaceIdentity(
                kind: .remote,
                workspaceID: parameters["workspaceID"].map(WorkspaceID.init(rawValue:)),
                serverID: serverID,
                profileID: parameters["profileID"].map(ProfileID.init(rawValue:))
            )
        }

        if let projectID = parameters["projectID"] {
            return WorkspaceIndex.WorkspaceIdentity(
                kind: .project,
                workspaceID: parameters["workspaceID"].map(WorkspaceID.init(rawValue:)),
                projectID: projectID
            )
        }

        return parameters["workspaceID"].map { workspaceID in
            WorkspaceIndex.WorkspaceIdentity(kind: .project, workspaceID: WorkspaceID(rawValue: workspaceID))
        }
    }

    private static func agentComposerContextSource(from parameters: [String: String]) -> Keybinding.AgentComposerContextSource? {
        switch parameters["contextSource"] {
        case "selection":
            return .selection
        case "viewport":
            return .viewport
        case "lastLines":
            let maxLines = parameters["maxLines"].flatMap(Int.init) ?? 3
            return .lastLines(maxLines)
        default:
            return nil
        }
    }

    private static func serverSelection(from parameters: [String: String]) -> WorkspaceCoordinator.ServerSelection {
        if let profileID = parameters["profileID"] {
            return .profile(ProfileID(rawValue: profileID))
        }

        if let serverURL = parameters["serverURL"] {
            let endpoint = ServerConnection.Endpoint(
                endpointID: parameters["serverID"] ?? parameters["endpointID"],
                kind: .remote,
                transport: .webSocketURL(serverURL),
                displayName: parameters["serverName"] ?? serverURL
            )
            return .remote(endpoint)
        }

        return .local
    }
}

struct NativeHostLocalCLISocketRoute: Sendable {
    let controller: NativeHostControlController

    init(controller: NativeHostControlController) {
        self.controller = controller
    }

    func handle(_ data: Data) async -> Data {
        let decoder = JSONDecoder()
        let encoder = JSONEncoder()
        let response: NativeHostControlResponse
        do {
            response = await controller.dispatch(try decoder.decode(NativeHostControlRequest.self, from: data))
        } catch {
            response = NativeHostControlResponse(
                requestID: "decode-error",
                command: .control,
                ok: false,
                resultKind: "ClientControlFailed",
                error: .decodeError
            )
        }
        return (try? encoder.encode(response)) ?? Data()
    }

    func handleFrame(_ frame: Data) async -> Data {
        let encoder = JSONEncoder()
        let response: NativeHostCLIProtocol.WireResponse

        do {
            let payload = try NativeHostCLIProtocol.decodeFrame(frame)
            let request = try JSONDecoder().decode(NativeHostCLIProtocol.WireRequest.self, from: payload)
            guard request.protocolVersion == NativeHostCLIProtocol.version else {
                response = NativeHostCLIProtocol.failure(
                    requestID: request.requestID,
                    command: request.command,
                    error: .unsupportedVersion
                )
                return NativeHostCLIProtocol.encodeResponse(response, encoder: encoder)
            }

            let controlResponse = await controller.dispatch(NativeHostControlRequest(
                requestID: request.requestID,
                command: request.command,
                parameters: request.parameters ?? [:]
            ))
            response = NativeHostCLIProtocol.WireResponse(controlResponse)
        } catch let error as NativeHostCLIProtocol.ProtocolError {
            response = NativeHostCLIProtocol.failure(error: error)
        } catch {
            response = NativeHostCLIProtocol.failure(error: .malformedRequest)
        }

        return NativeHostCLIProtocol.encodeResponse(response, encoder: encoder)
    }
}

final class NativeHostLocalCLISocketServer: @unchecked Sendable {
    private let socketPath: String
    private let route: NativeHostLocalCLISocketRoute
    private let queue: DispatchQueue
    private let fileManager: FileManager
    private var listenFileDescriptor: Int32?

    init(
        socketPath: String = NativeHostLocalCLISocketEndpoint.defaultSocketPath(),
        route: NativeHostLocalCLISocketRoute,
        queue: DispatchQueue = DispatchQueue(label: "app.fenrir.native.cli-socket"),
        fileManager: FileManager = .default
    ) {
        self.socketPath = socketPath
        self.route = route
        self.queue = queue
        self.fileManager = fileManager
    }

    var endpointPath: String {
        socketPath
    }

    func start() throws {
        guard listenFileDescriptor == nil else {
            return
        }

        try prepareEndpointPath()
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else {
            throw NativeHostLocalCLISocketServerError.posix("socket", errno)
        }

        do {
            try bindSocket(fd)
            guard chmod(socketPath, 0o600) == 0 else {
                throw NativeHostLocalCLISocketServerError.posix("chmod", errno)
            }
            guard listen(fd, 16) == 0 else {
                throw NativeHostLocalCLISocketServerError.posix("listen", errno)
            }
            listenFileDescriptor = fd
            queue.async { [weak self] in
                self?.acceptLoop(fileDescriptor: fd)
            }
        } catch {
            close(fd)
            unlink(socketPath)
            throw error
        }
    }

    func stop() {
        guard let fd = listenFileDescriptor else {
            return
        }
        listenFileDescriptor = nil
        shutdown(fd, SHUT_RDWR)
        close(fd)
        unlink(socketPath)
    }

    private func prepareEndpointPath() throws {
        let endpoint = URL(fileURLWithPath: socketPath)
        let directory = endpoint.deletingLastPathComponent()
        let directoryAlreadyExists = fileManager.fileExists(atPath: directory.path)
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        if !directoryAlreadyExists {
            guard chmod(directory.path, 0o700) == 0 else {
                throw NativeHostLocalCLISocketServerError.posix("chmod", errno)
            }
        }

        var statBuffer = stat()
        guard lstat(socketPath, &statBuffer) == 0 else {
            if errno == ENOENT {
                return
            }
            throw NativeHostLocalCLISocketServerError.posix("lstat", errno)
        }
        guard statBuffer.st_uid == getuid() else {
            throw NativeHostLocalCLISocketServerError.endpointOwnedByAnotherUser(socketPath)
        }
        guard unlink(socketPath) == 0 else {
            throw NativeHostLocalCLISocketServerError.posix("unlink", errno)
        }
    }

    private func bindSocket(_ fd: Int32) throws {
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let maxPathLength = MemoryLayout.size(ofValue: address.sun_path)
        guard socketPath.utf8.count < maxPathLength else {
            throw NativeHostLocalCLISocketServerError.pathTooLong(socketPath)
        }

        socketPath.withCString { pathPointer in
            withUnsafeMutablePointer(to: &address.sun_path) { sunPathPointer in
                sunPathPointer.withMemoryRebound(to: CChar.self, capacity: maxPathLength) { destination in
                    _ = strncpy(destination, pathPointer, maxPathLength - 1)
                }
            }
        }

        let result = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
                bind(fd, socketAddress, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard result == 0 else {
            throw NativeHostLocalCLISocketServerError.posix("bind", errno)
        }
    }

    private func acceptLoop(fileDescriptor: Int32) {
        while listenFileDescriptor == fileDescriptor {
            let client = accept(fileDescriptor, nil, nil)
            if client < 0 {
                if errno == EBADF || errno == EINVAL {
                    return
                }
                continue
            }
            handleClient(client)
        }
    }

    private func handleClient(_ client: Int32) {
        Task.detached(priority: .userInitiated) { [route] in
            defer {
                close(client)
            }

            guard let requestFrame = NativeHostLocalCLISocketServer.readFrame(from: client) else {
                return
            }
            let responseFrame = await route.handleFrame(requestFrame)
            _ = NativeHostLocalCLISocketServer.writeAll(responseFrame, to: client)
        }
    }

    private static func readFrame(from fd: Int32) -> Data? {
        guard let header = readExact(byteCount: 4, from: fd) else {
            return nil
        }
        let length = header.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
        guard length <= NativeHostCLIProtocol.maxPayloadBytes else {
            return header
        }
        guard let payload = readExact(byteCount: Int(length), from: fd) else {
            return nil
        }
        var frame = Data(header)
        frame.append(payload)
        return frame
    }

    private static func readExact(byteCount: Int, from fd: Int32) -> Data? {
        var data = Data(count: byteCount)
        var offset = 0
        let result = data.withUnsafeMutableBytes { buffer -> Bool in
            guard let baseAddress = buffer.baseAddress else {
                return byteCount == 0
            }
            while offset < byteCount {
                let readCount = read(fd, baseAddress.advanced(by: offset), byteCount - offset)
                if readCount <= 0 {
                    return false
                }
                offset += readCount
            }
            return true
        }
        return result ? data : nil
    }

    private static func writeAll(_ data: Data, to fd: Int32) -> Bool {
        data.withUnsafeBytes { buffer -> Bool in
            guard let baseAddress = buffer.baseAddress else {
                return data.isEmpty
            }
            var offset = 0
            while offset < data.count {
                let written = write(fd, baseAddress.advanced(by: offset), data.count - offset)
                if written <= 0 {
                    return false
                }
                offset += written
            }
            return true
        }
    }
}

enum NativeHostLocalCLISocketEndpoint {
    static func defaultSocketPath(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        uid: uid_t = getuid(),
        temporaryDirectory: URL = FileManager.default.temporaryDirectory
    ) -> String {
        if let override = environment["FENRIR_NATIVE_CONTROL_SOCKET"], !override.isEmpty {
            return override
        }
        if let runtimeDirectory = environment["XDG_RUNTIME_DIR"], !runtimeDirectory.isEmpty {
            return URL(fileURLWithPath: runtimeDirectory)
                .appendingPathComponent("fenrir")
                .appendingPathComponent("native-control.sock")
                .path
        }
        if let tmpdir = environment["TMPDIR"], !tmpdir.isEmpty {
            return URL(fileURLWithPath: tmpdir)
                .appendingPathComponent("fenrir-\(uid)")
                .appendingPathComponent("native-control.sock")
                .path
        }
        return temporaryDirectory
            .appendingPathComponent("fenrir-\(uid)")
            .appendingPathComponent("native-control.sock")
            .path
    }
}

enum NativeHostLocalCLISocketServerError: Error, Equatable, Sendable {
    case endpointOwnedByAnotherUser(String)
    case pathTooLong(String)
    case posix(String, Int32)
}

enum NativeHostCLIProtocol {
    static let version = 1
    static let maxPayloadBytes = 1024 * 1024

    enum ProtocolError: String, Error, Codable, Equatable, Sendable {
        case malformedRequest = "NativeHostProtocolMalformedRequest"
        case unsupportedVersion = "NativeHostProtocolUnsupportedVersion"
        case payloadTooLarge = "NativeHostProtocolPayloadTooLarge"
        case responseEncodingFailed = "NativeHostProtocolResponseEncodingFailed"
    }

    struct WireRequest: Codable, Equatable, Sendable {
        let protocolVersion: Int
        let requestID: RequestID
        let command: NativeHostControlCommand
        let parameters: [String: String]?

        init(
            protocolVersion: Int,
            requestID: RequestID,
            command: NativeHostControlCommand,
            parameters: [String: String]? = nil
        ) {
            self.protocolVersion = protocolVersion
            self.requestID = requestID
            self.command = command
            self.parameters = parameters
        }
    }

    struct WireResponse: Codable, Equatable, Sendable {
        let protocolVersion: Int
        let requestID: RequestID
        let command: NativeHostControlCommand
        let ok: Bool
        let resultKind: String
        let payload: [String: String]
        let error: String?

        init(
            protocolVersion: Int = NativeHostCLIProtocol.version,
            requestID: RequestID,
            command: NativeHostControlCommand,
            ok: Bool,
            resultKind: String,
            payload: [String: String] = [:],
            error: String? = nil
        ) {
            self.protocolVersion = protocolVersion
            self.requestID = requestID
            self.command = command
            self.ok = ok
            self.resultKind = resultKind
            self.payload = payload
            self.error = error
        }

        init(_ response: NativeHostControlResponse) {
            self.init(
                requestID: response.requestID,
                command: response.command,
                ok: response.ok,
                resultKind: response.resultKind,
                payload: response.payload,
                error: response.error?.rawValue
            )
        }
    }

    static func decodeFrame(_ frame: Data) throws -> Data {
        guard frame.count >= 4 else {
            throw ProtocolError.malformedRequest
        }

        let length = frame.prefix(4).reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
        guard length <= maxPayloadBytes else {
            throw ProtocolError.payloadTooLarge
        }
        guard frame.count == Int(length) + 4 else {
            throw ProtocolError.malformedRequest
        }
        return Data(frame.dropFirst(4))
    }

    static func encodeFrame(_ payload: Data) throws -> Data {
        guard payload.count <= maxPayloadBytes else {
            throw ProtocolError.payloadTooLarge
        }

        var length = UInt32(payload.count).bigEndian
        var frame = Data(bytes: &length, count: MemoryLayout<UInt32>.size)
        frame.append(payload)
        return frame
    }

    static func failure(
        requestID: RequestID = "decode-error",
        command: NativeHostControlCommand = .control,
        error: ProtocolError
    ) -> WireResponse {
        WireResponse(
            requestID: requestID,
            command: command,
            ok: false,
            resultKind: "NativeHostProtocolFailed",
            error: error.rawValue
        )
    }

    static func encodeResponse(_ response: WireResponse, encoder: JSONEncoder = JSONEncoder()) -> Data {
        do {
            return try encodeFrame(try encoder.encode(response))
        } catch {
            let fallback = WireResponse(
                requestID: response.requestID,
                command: response.command,
                ok: false,
                resultKind: "NativeHostProtocolFailed",
                error: ProtocolError.responseEncodingFailed.rawValue
            )
            return (try? encodeFrame(try encoder.encode(fallback))) ?? Data()
        }
    }
}

enum NativeHostAppEvent: Equatable, Sendable {
    case openWorkspace(requestID: RequestID, workspaceID: WorkspaceID? = nil, projectID: String? = nil, path: String? = nil)
    case focusWorkspace(requestID: RequestID, workspaceID: WorkspaceID)
    case listWorkspaces(requestID: RequestID, includeServer: Bool = true)
}

struct NativeHostAppEventController: Sendable {
    let controller: NativeHostControlController

    init(controller: NativeHostControlController) {
        self.controller = controller
    }

    func dispatch(_ event: NativeHostAppEvent) async -> NativeHostControlResponse {
        switch event {
        case .openWorkspace(let requestID, let workspaceID, let projectID, let path):
            return await controller.dispatch(NativeHostControlRequest(
                requestID: requestID,
                command: .open,
                parameters: NativeHostEventParameters.identity(workspaceID: workspaceID, projectID: projectID, path: path)
            ))
        case .focusWorkspace(let requestID, let workspaceID):
            return await controller.dispatch(NativeHostControlRequest(
                requestID: requestID,
                command: .focus,
                parameters: NativeHostEventParameters.identity(workspaceID: workspaceID)
            ))
        case .listWorkspaces(let requestID, let includeServer):
            return await controller.dispatch(NativeHostControlRequest(
                requestID: requestID,
                command: .list,
                parameters: ["includeServer": String(includeServer)]
            ))
        }
    }
}

enum NativeHostServerEvent: Equatable, Sendable {
    case attachWorkspace(requestID: RequestID, workspaceID: WorkspaceID, serverID: String, serverURL: String)
    case reconnectWorkspace(
        requestID: RequestID,
        workspaceID: WorkspaceID,
        serverID: String,
        serverURL: String,
        sessionID: ServerConnection.SessionID? = nil,
        generation: UInt64 = 0
    )
}

struct NativeHostServerEventController: Sendable {
    let controller: NativeHostControlController
    let integration: (any NativeServerEventReconnectIntegrating)?
    let defaultSessionID: ServerConnection.SessionID?
    let projectionApplier: (any NativeServerReconnectProjectionApplying)?

    init(
        controller: NativeHostControlController,
        integration: (any NativeServerEventReconnectIntegrating)? = nil,
        defaultSessionID: ServerConnection.SessionID? = nil,
        projectionApplier: (any NativeServerReconnectProjectionApplying)? = nil
    ) {
        self.controller = controller
        self.integration = integration
        self.defaultSessionID = defaultSessionID
        self.projectionApplier = projectionApplier
    }

    func dispatch(_ event: NativeHostServerEvent) async -> NativeHostControlResponse {
        switch event {
        case .attachWorkspace(let requestID, let workspaceID, let serverID, let serverURL):
            return await controller.dispatch(NativeHostControlRequest(
                requestID: requestID,
                command: .attach,
                parameters: NativeHostEventParameters.remote(workspaceID: workspaceID, serverID: serverID, serverURL: serverURL)
            ))
        case .reconnectWorkspace(let requestID, let workspaceID, let serverID, let serverURL, let sessionID, let generation):
            if let integration {
                guard let targetSessionID = sessionID ?? defaultSessionID else {
                    return NativeHostControlResponse(
                        requestID: requestID,
                        command: .control,
                        ok: false,
                        resultKind: "ServerReconnectFailed",
                        error: .unavailable
                    )
                }
                let result = await integration.reconnectWorkspaceFromServerEvent(NativeServerWorkspaceReconnectEventInput(
                    requestID: requestID,
                    workspaceID: workspaceID,
                    serverID: serverID,
                    serverURL: serverURL,
                    sessionID: targetSessionID,
                    generation: generation
                ))
                if case .success(let projection) = result {
                    await projectionApplier?.applyServerReconnectProjection(projection)
                }
                return result.nativeHostServerReconnectResponse(requestID: requestID)
            }
            var parameters = NativeHostEventParameters.remote(workspaceID: workspaceID, serverID: serverID, serverURL: serverURL)
            parameters["operation"] = ClientControl.WorkspaceControlOperation.reconnect.rawValue
            return await controller.dispatch(NativeHostControlRequest(
                requestID: requestID,
                command: .control,
                parameters: parameters
            ))
        }
    }
}

protocol NativeServerReconnectProjectionApplying: Sendable {
    func applyServerReconnectProjection(_ projection: NativeServerReconnectProjection) async
}

private extension Result where Success == NativeServerReconnectProjection, Failure == ServerConnection.ServerConnectionError {
    func nativeHostServerReconnectResponse(requestID: RequestID) -> NativeHostControlResponse {
        switch self {
        case .success(let projection):
            var payload = [
                "sessionID": projection.session.sessionID.rawValue,
                "workspaceCount": String(projection.workspaces.count),
                "workflowRunCount": String(projection.workflowRuns.count),
                "workflowTimelineCount": String(projection.workflowTimelines.count),
                "notificationProjectionCount": String(projection.notifications.count),
                "agentInteractionCount": String(projection.agentInteractions.count),
                "failureCount": String(projection.failures.count)
            ]
            if !projection.failures.isEmpty {
                payload["failures"] = projection.failures.joined(separator: ",")
            }
            return NativeHostControlResponse(
                requestID: requestID,
                command: .control,
                ok: projection.failures.isEmpty,
                resultKind: projection.failures.isEmpty ? "ServerReconnectProjected" : "ServerReconnectPartiallyProjected",
                payload: payload,
                error: projection.failures.isEmpty ? nil : .unavailable
            )
        case .failure:
            return NativeHostControlResponse(
                requestID: requestID,
                command: .control,
                ok: false,
                resultKind: "ServerReconnectFailed",
                error: .unavailable
            )
        }
    }
}

private enum NativeHostEventParameters {
    static func identity(workspaceID: WorkspaceID? = nil, projectID: String? = nil, path: String? = nil) -> [String: String] {
        var parameters: [String: String] = [:]
        if let workspaceID {
            parameters["workspaceID"] = workspaceID.rawValue
        }
        if let projectID {
            parameters["projectID"] = projectID
        }
        if let path {
            parameters["path"] = path
        }
        return parameters
    }

    static func remote(workspaceID: WorkspaceID, serverID: String, serverURL: String) -> [String: String] {
        [
            "workspaceID": workspaceID.rawValue,
            "serverID": serverID,
            "serverURL": serverURL
        ]
    }
}

private func workspacePayload(
    _ workspace: WorkspaceIndex.WorkspaceSummary,
    windowID: FenrirWindowID?,
    extra: [String: String] = [:]
) -> [String: String] {
    var payload = [
        "workspaceID": workspace.workspaceID.rawValue,
        "displayName": workspace.displayName
    ]
    if let windowID {
        payload["windowID"] = windowID.rawValue
    }
    extra.forEach { key, value in
        payload[key] = value
    }
    return payload
}

private extension Result where Failure == ClientControl.ClientControlError {
    func nativeHostResponse(
        _ request: NativeHostControlRequest,
        resultKind: String,
        payload: (Success) -> [String: String]
    ) -> NativeHostControlResponse {
        switch self {
        case .success(let result):
            return NativeHostControlResponse(
                requestID: request.requestID,
                command: request.command,
                ok: true,
                resultKind: resultKind,
                payload: payload(result)
            )
        case .failure(let error):
            return NativeHostControlResponse(
                requestID: request.requestID,
                command: request.command,
                ok: false,
                resultKind: "ClientControlFailed",
                error: error
            )
        }
    }
}

private extension Result where Success == NativeHostProductCommandResult, Failure == ClientControl.ClientControlError {
    func nativeHostResponse(_ request: NativeHostControlRequest) -> NativeHostControlResponse {
        switch self {
        case .success(let result):
            return NativeHostControlResponse(
                requestID: result.requestID,
                command: request.command,
                ok: true,
                resultKind: result.resultKind,
                payload: result.payload
            )
        case .failure(let error):
            return NativeHostControlResponse(
                requestID: request.requestID,
                command: request.command,
                ok: false,
                resultKind: "ClientControlFailed",
                error: error
            )
        }
    }
}
