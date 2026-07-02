import Foundation
import FenrirNativeShared

struct WorkspaceSwitcherPaletteProvider: WorkspaceOverlays.BoundedPaletteSearchProvider {
    let providerID = "workspace-switcher"
    let domains: Set<WorkspaceOverlays.PaletteDomain> = [.workspaces]
    private let workspaces: [WorkspaceOverlays.WorkspaceSwitcherEntry]

    init(workspaces: [WorkspaceOverlays.WorkspaceSwitcherEntry]) {
        self.workspaces = workspaces
    }

    func searchPalette(
        query: WorkspaceOverlays.PaletteQuery,
        workspaceID: WorkspaceID
    ) async throws -> [WorkspaceOverlays.PaletteItem] {
        try await searchPalette(query: query, workspaceID: workspaceID, maxResults: Int.max)
    }

    func searchPalette(
        query: WorkspaceOverlays.PaletteQuery,
        workspaceID _: WorkspaceID,
        maxResults: Int
    ) async throws -> [WorkspaceOverlays.PaletteItem] {
        guard query.domain == .workspaces else {
            return []
        }

        var ranked: [RankedPaletteCandidate] = []
        let limit = max(1, maxResults)
        for workspace in workspaces {
            let item = WorkspaceOverlays.PaletteItem(
                id: "workspace:\(workspace.workspaceID.rawValue)",
                domain: .workspaces,
                title: workspace.title,
                subtitle: workspace.subtitle,
                keywords: workspace.keywords,
                action: .switchWorkspace(workspace.workspaceID),
                baseScore: workspaceBaseScore(workspace)
            )
            insertBounded(item, searchText: query.searchText, into: &ranked, limit: limit)
        }
        return ranked.map(\.item)
    }

    private func workspaceBaseScore(_ workspace: WorkspaceOverlays.WorkspaceSwitcherEntry) -> Int {
        let activeBoost = workspace.isActive ? 100 : 0
        let recencyBoost = max(0, 50 - workspace.recencyRank)
        return activeBoost + recencyBoost
    }
}

struct StaticPaletteProvider: WorkspaceOverlays.BoundedPaletteSearchProvider {
    let providerID: String
    let domains: Set<WorkspaceOverlays.PaletteDomain>
    private let items: [WorkspaceOverlays.PaletteItem]

    init(
        providerID: String,
        domains: Set<WorkspaceOverlays.PaletteDomain>,
        items: [WorkspaceOverlays.PaletteItem]
    ) {
        self.providerID = providerID
        self.domains = domains
        self.items = items
    }

    func searchPalette(
        query: WorkspaceOverlays.PaletteQuery,
        workspaceID: WorkspaceID
    ) async throws -> [WorkspaceOverlays.PaletteItem] {
        try await searchPalette(query: query, workspaceID: workspaceID, maxResults: Int.max)
    }

    func searchPalette(
        query: WorkspaceOverlays.PaletteQuery,
        workspaceID _: WorkspaceID,
        maxResults: Int
    ) async throws -> [WorkspaceOverlays.PaletteItem] {
        guard domains.contains(query.domain) else {
            return []
        }

        var ranked: [RankedPaletteCandidate] = []
        let limit = max(1, maxResults)
        for item in items where item.domain == query.domain {
            insertBounded(item, searchText: query.searchText, into: &ranked, limit: limit)
        }
        return ranked.map(\.item)
    }
}

private struct RankedPaletteCandidate {
    let item: WorkspaceOverlays.PaletteItem
    let score: Int
}

private func insertBounded(
    _ item: WorkspaceOverlays.PaletteItem,
    searchText: String,
    into ranked: inout [RankedPaletteCandidate],
    limit: Int
) {
    guard let score = paletteScore(item, searchText: searchText) else {
        return
    }

    let candidate = RankedPaletteCandidate(item: item, score: score)
    let index = ranked.firstIndex { current in
        if candidate.score != current.score {
            return candidate.score > current.score
        }

        return candidate.item.title.localizedCaseInsensitiveCompare(current.item.title) == .orderedAscending
    } ?? ranked.endIndex

    guard index < limit || ranked.count < limit else {
        return
    }

    ranked.insert(candidate, at: index)
    if ranked.count > limit {
        ranked.removeLast()
    }
}

private func paletteScore(_ item: WorkspaceOverlays.PaletteItem, searchText: String) -> Int? {
    let needle = searchText
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased()

    guard !needle.isEmpty else {
        return item.baseScore
    }

    let title = item.title.lowercased()
    let subtitle = item.subtitle?.lowercased() ?? ""
    let keywords = item.keywords.map { $0.lowercased() }

    if title == needle {
        return item.baseScore + 1_000
    }

    if title.hasPrefix(needle) {
        return item.baseScore + 700
    }

    if title.contains(needle) {
        return item.baseScore + 400
    }

    if keywords.contains(where: { $0.hasPrefix(needle) }) {
        return item.baseScore + 300
    }

    if keywords.contains(where: { $0.contains(needle) }) {
        return item.baseScore + 200
    }

    if subtitle.contains(needle) {
        return item.baseScore + 100
    }

    return nil
}
