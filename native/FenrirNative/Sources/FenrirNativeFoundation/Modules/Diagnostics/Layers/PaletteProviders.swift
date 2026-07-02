import Foundation
import FenrirNativeShared
import WorkspaceOverlays

struct DiagnosticsPaletteProvider: WorkspaceOverlays.PaletteSearchProvider {
    let providerID = "diagnostics"
    let domains: Set<WorkspaceOverlays.PaletteDomain> = [.actions, .help]

    func searchPalette(
        query: WorkspaceOverlays.PaletteQuery,
        workspaceID _: WorkspaceID
    ) async throws -> [WorkspaceOverlays.PaletteItem] {
        guard domains.contains(query.domain) else {
            return []
        }

        return [
            WorkspaceOverlays.PaletteItem(
                id: "action-diagnostics",
                domain: query.domain,
                title: "Open Diagnostics",
                subtitle: "Inspect server, tmux, workflow, and keybinding events",
                keywords: ["health", "server", "tmux", "workflow", "keybinding", "logs"],
                action: .openDiagnostics,
                baseScore: 90
            )
        ]
    }
}
