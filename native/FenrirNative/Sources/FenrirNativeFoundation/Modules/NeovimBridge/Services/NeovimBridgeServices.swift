import Foundation
import FenrirNativeShared
import NativeRuntime
import WorkspaceOverlays

public extension NeovimBridge {
    protocol NeovimBridgeClock: Sendable {
        func now() -> FenrirTimestamp
    }

    protocol NeovimPaneCataloging: Sendable {
        func listNeovimPanes(workspaceID: WorkspaceID) async throws -> [NeovimPaneDescriptor]
    }

    protocol NeovimBridgeClient: Sendable {
        func openFile(_ target: FileTarget, in pane: NeovimPaneDescriptor) async throws -> ActiveNeovimState
        func activeState(in pane: NeovimPaneDescriptor) async throws -> ActiveNeovimState
    }

    protocol NeovimPaneCreating: Sendable {
        func createNeovimPane(_ input: OpenFileInNeovimInput, windowID: FenrirWindowID) async throws -> NeovimPaneDescriptor
    }

    static func filePaletteProvider(files: [FileTarget]) -> any WorkspaceOverlays.PaletteSearchProvider {
        NeovimFilePaletteProvider(files: files)
    }

    static func paletteOpenFileExecutor(action: OpenFileInNeovim, actor: NativeRuntime.RuntimeActorIdentity) -> any WorkspaceOverlays.PaletteActionExecutor {
        NeovimPaletteOpenFileExecutor(action: action, actor: actor)
    }

    static func runtimeMetadataPaneCatalog(
        enumerator: any NativeRuntime.WorkspaceRuntimeEnumerating,
        actor: NativeRuntime.RuntimeActorIdentity,
        source: ActionSource
    ) -> any NeovimPaneCataloging {
        RuntimeMetadataNeovimPaneCatalog(enumerator: enumerator, actor: actor, source: source)
    }

    static func unsupportedBridgeClient() -> any NeovimBridgeClient {
        UnsupportedNeovimBridgeClient()
    }

    static func serverTmuxPaneCreator(transport: any NativeRuntime.ServerRPCTransport) -> any NeovimPaneCreating {
        ServerTmuxNeovimPaneCreator(transport: transport)
    }
}
