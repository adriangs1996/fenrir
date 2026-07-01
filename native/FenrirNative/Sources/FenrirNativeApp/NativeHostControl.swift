import Foundation
import FenrirNativeShared
import WorkspaceIndex
import ServerConnection
import WorkspaceCoordinator
import ClientControl

enum NativeHostControlCommand: String, Codable, Equatable, Sendable {
    case open
    case `switch`
    case list
    case attach
    case remove
    case focus
    case control
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

struct NativeHostControlController: Sendable {
    let dispatcher: any NativeHostClientControlDispatching

    init(dispatcher: any NativeHostClientControlDispatching) {
        self.dispatcher = dispatcher
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
                [
                    "workspaceCount": String(result.workspaces.count),
                    "workspaceIDs": result.workspaces.map(\.workspaceID.rawValue).joined(separator: ",")
                ]
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

    private static func serverSelection(from parameters: [String: String]) -> WorkspaceCoordinator.ServerSelection {
        if let profileID = parameters["profileID"] {
            return .profile(ProfileID(rawValue: profileID))
        }

        if let serverURL = parameters["serverURL"] {
            let endpoint = ServerConnection.Endpoint(
                endpointID: parameters["endpointID"],
                kind: .remote,
                transport: .webSocketURL(serverURL),
                displayName: parameters["serverName"] ?? serverURL
            )
            return .remote(endpoint)
        }

        return .local
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
