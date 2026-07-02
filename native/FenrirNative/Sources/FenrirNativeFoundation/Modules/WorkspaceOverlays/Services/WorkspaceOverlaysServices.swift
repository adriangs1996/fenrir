import Foundation
import FenrirNativeShared

public extension WorkspaceOverlays {
    protocol WorkspaceOverlaysClock: Sendable {
        func now() -> FenrirTimestamp
    }

    protocol OverlayStore: Sendable {
        func openOverlay(
            descriptor: OverlayDescriptor,
            workspaceID: WorkspaceID,
            timestamp: FenrirTimestamp
        ) async throws -> (overlay: OverlayRecord, stack: WorkspaceOverlayStack)
        func closeOverlay(
            workspaceID: WorkspaceID,
            overlayID: OverlayID?,
            kind: OverlayKind?
        ) async throws -> (closed: OverlayRecord?, stack: WorkspaceOverlayStack)
        func toggleOverlay(
            descriptor: OverlayDescriptor,
            workspaceID: WorkspaceID,
            timestamp: FenrirTimestamp
        ) async throws -> (opened: OverlayRecord?, closed: OverlayRecord?, stack: WorkspaceOverlayStack)
        func listOverlays(workspaceID: WorkspaceID) async throws -> WorkspaceOverlayStack
    }

    protocol PaletteSearchProvider: Sendable {
        var providerID: String { get }
        var domains: Set<PaletteDomain> { get }

        func searchPalette(
            query: PaletteQuery,
            workspaceID: WorkspaceID
        ) async throws -> [PaletteItem]
    }

    protocol BoundedPaletteSearchProvider: PaletteSearchProvider {
        func searchPalette(
            query: PaletteQuery,
            workspaceID: WorkspaceID,
            maxResults: Int
        ) async throws -> [PaletteItem]
    }

    protocol PaletteActionExecutor: Sendable {
        func executePaletteAction(
            _ action: PaletteAction,
            workspaceID: WorkspaceID,
            source: ActionSource
        ) async throws
    }

    static func inMemoryOverlayStore() -> any OverlayStore {
        InMemoryOverlayStore()
    }

    static func workspaceSwitcherProvider(workspaces: [WorkspaceSwitcherEntry]) -> any PaletteSearchProvider {
        WorkspaceSwitcherPaletteProvider(workspaces: workspaces)
    }

    static func staticPaletteProvider(
        providerID: String,
        domains: Set<PaletteDomain>,
        items: [PaletteItem]
    ) -> any PaletteSearchProvider {
        StaticPaletteProvider(providerID: providerID, domains: domains, items: items)
    }
}
