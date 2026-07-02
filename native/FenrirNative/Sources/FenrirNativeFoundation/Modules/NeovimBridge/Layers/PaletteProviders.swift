import Foundation
import FenrirNativeShared
import NativeRuntime
import WorkspaceOverlays

struct NeovimFilePaletteProvider: WorkspaceOverlays.PaletteSearchProvider {
    let providerID = "neovim-files"
    let domains: Set<WorkspaceOverlays.PaletteDomain> = [.files]
    private let files: [NeovimBridge.FileTarget]

    init(files: [NeovimBridge.FileTarget]) {
        self.files = files
    }

    func searchPalette(
        query: WorkspaceOverlays.PaletteQuery,
        workspaceID _: WorkspaceID
    ) async throws -> [WorkspaceOverlays.PaletteItem] {
        guard query.domain == .files else {
            return []
        }

        return files.map { target in
            WorkspaceOverlays.PaletteItem(
                id: "file:\(target.path)",
                domain: .files,
                title: URL(fileURLWithPath: target.path).lastPathComponent,
                subtitle: target.path,
                keywords: [target.path],
                action: .openFile(target.path),
                baseScore: 10
            )
        }
    }
}

struct NeovimPaletteOpenFileExecutor: WorkspaceOverlays.PaletteActionExecutor {
    let action: NeovimBridge.OpenFileInNeovim
    let actor: NativeRuntime.RuntimeActorIdentity

    func executePaletteAction(
        _ paletteAction: WorkspaceOverlays.PaletteAction,
        workspaceID: WorkspaceID,
        source: ActionSource
    ) async throws {
        guard case let .openFile(path) = paletteAction else {
            return
        }

        _ = try await action.run(NeovimBridge.OpenFileInNeovimInput(
            requestID: .generated(),
            workspaceID: workspaceID,
            actor: actor,
            target: NeovimBridge.FileTarget(path: path),
            policy: .createIfNeeded,
            source: source
        )).get()
    }
}
