import Foundation
import FenrirNativeShared
import NativeRuntime

struct RuntimeMetadataNeovimPaneCatalog: NeovimBridge.NeovimPaneCataloging {
    let enumerator: any NativeRuntime.WorkspaceRuntimeEnumerating
    let actor: NativeRuntime.RuntimeActorIdentity
    let source: ActionSource

    func listNeovimPanes(workspaceID: WorkspaceID) async throws -> [NeovimBridge.NeovimPaneDescriptor] {
        let snapshot = try await enumerator.enumerateWorkspaceRuntime(NativeRuntime.EnumerateWorkspaceRuntimeInput(
            requestID: RequestID(rawValue: "neovim-catalog-\(workspaceID.rawValue)"),
            workspaceID: workspaceID,
            actor: actor,
            source: source
        ))
        return snapshot.panes.compactMap { pane in
            guard pane.metadata?.kind == "neovim",
                  let metadata = pane.metadata?.neovim,
                  let windowID = pane.windowID
            else {
                return nil
            }
            return NeovimBridge.NeovimPaneDescriptor(
                workspaceID: pane.workspaceID,
                windowID: windowID,
                paneID: pane.paneID,
                tmuxPaneID: pane.tmuxPaneID,
                bridgeSocketPath: metadata.bridgeSocketPath,
                bridgeCapability: .unknown,
                bootstrapID: metadata.bootstrapID
            )
        }
    }
}

struct UnsupportedNeovimBridgeClient: NeovimBridge.NeovimBridgeClient {
    func openFile(_: NeovimBridge.FileTarget, in pane: NeovimBridge.NeovimPaneDescriptor) async throws -> NeovimBridge.ActiveNeovimState {
        throw NeovimBridge.NeovimBridgeError.unsupportedBridge(pane.paneID)
    }

    func activeState(in pane: NeovimBridge.NeovimPaneDescriptor) async throws -> NeovimBridge.ActiveNeovimState {
        throw NeovimBridge.NeovimBridgeError.unsupportedBridge(pane.paneID)
    }
}

struct ServerTmuxNeovimPaneCreator: NeovimBridge.NeovimPaneCreating {
    let transport: any NativeRuntime.ServerRPCTransport

    func createNeovimPane(
        _ input: NeovimBridge.OpenFileInNeovimInput,
        windowID: FenrirWindowID
    ) async throws -> NeovimBridge.NeovimPaneDescriptor {
        let request = try NativeRuntime.ServerRPCRequest(
            requestID: input.requestID,
            method: "tmux.neovimPane.create",
            payload: JSONEncoder().encode(ServerNeovimCreateInput(
                actor: ServerActor(sessionId: input.actor.authSessionID, subject: input.actor.subject),
                workspaceId: input.workspaceID.rawValue,
                windowId: windowID.rawValue,
                files: [input.target.path],
                line: input.target.line,
                column: input.target.column,
                split: "horizontal",
                launchSource: "user"
            ))
        )
        let snapshot = try JSONDecoder().decode(ServerSnapshot.self, from: try await transport.request(request))
        guard let descriptor = snapshot.panes
            .compactMap({ $0.neovimDescriptor() })
            .first(where: { $0.workspaceID == input.workspaceID && $0.windowID == windowID && $0.bootstrapID != nil })
        else {
            throw NeovimBridge.NeovimBridgeError.createFailed("Server did not return Neovim pane metadata")
        }
        return descriptor
    }
}

private struct ServerActor: Codable, Equatable, Sendable {
    let sessionId: String
    let subject: String
}

private struct ServerNeovimCreateInput: Codable, Equatable, Sendable {
    let actor: ServerActor
    let workspaceId: String
    let windowId: String
    let files: [String]
    let line: Int?
    let column: Int?
    let split: String
    let launchSource: String
}

private struct ServerSnapshot: Codable, Equatable, Sendable {
    let panes: [ServerPane]
}

private struct ServerPane: Codable, Equatable, Sendable {
    let paneId: String
    let workspaceId: String
    let windowId: String
    let tmuxPaneId: String
    let metadata: ServerPaneMetadata

    func neovimDescriptor() -> NeovimBridge.NeovimPaneDescriptor? {
        guard metadata.kind == "neovim", let neovim = metadata.neovim else {
            return nil
        }
        return NeovimBridge.NeovimPaneDescriptor(
            workspaceID: WorkspaceID(rawValue: workspaceId),
            windowID: FenrirWindowID(rawValue: windowId),
            paneID: PaneID(rawValue: paneId),
            tmuxPaneID: NativeRuntime.TmuxPaneID(rawValue: tmuxPaneId),
            bridgeSocketPath: neovim.bridgeSocketPath,
            bridgeCapability: .unknown,
            bootstrapID: neovim.bootstrapId
        )
    }
}

private struct ServerPaneMetadata: Codable, Equatable, Sendable {
    let kind: String
    let neovim: ServerNeovimBootstrapMetadata?
}

private struct ServerNeovimBootstrapMetadata: Codable, Equatable, Sendable {
    let bootstrapId: String
    let bridgeSocketPath: String
}
