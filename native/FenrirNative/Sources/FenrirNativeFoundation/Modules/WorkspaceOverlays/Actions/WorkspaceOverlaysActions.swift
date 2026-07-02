import Foundation
import FenrirNativeShared
import Keybinding

public extension WorkspaceOverlays {
    struct DescribeWorkspaceOverlaysModule: FenrirAction {
        public typealias Failure = WorkspaceOverlaysError

        public let clock: any WorkspaceOverlaysClock

        public init(clock: any WorkspaceOverlaysClock) {
            self.clock = clock
        }

        public func run(_ input: DescribeWorkspaceOverlaysModuleInput) async -> Result<DescribeWorkspaceOverlaysModuleResult, WorkspaceOverlaysError> {
            let timestamp = clock.now()
            return .success(DescribeWorkspaceOverlaysModuleResult(
                requestID: input.requestID,
                summary: ModuleSummary(registeredAt: timestamp),
                timestamp: timestamp
            ))
        }
    }

    struct OpenOverlay: FenrirAction {
        public typealias Failure = WorkspaceOverlaysError

        public let clock: any WorkspaceOverlaysClock
        public let store: any OverlayStore

        public init(clock: any WorkspaceOverlaysClock, store: any OverlayStore) {
            self.clock = clock
            self.store = store
        }

        public func run(_ input: OpenOverlayInput) async -> Result<OpenOverlayResult, WorkspaceOverlaysError> {
            let timestamp = clock.now()

            do {
                let opened = try await store.openOverlay(
                    descriptor: input.descriptor,
                    workspaceID: input.workspaceID,
                    timestamp: timestamp
                )
                return .success(OpenOverlayResult(
                    requestID: input.requestID,
                    overlay: opened.overlay,
                    stack: opened.stack,
                    timestamp: timestamp
                ))
            } catch let error as WorkspaceOverlaysError {
                return .failure(error)
            } catch {
                return .failure(.storeFailure(String(describing: error)))
            }
        }
    }

    struct CloseOverlay: FenrirAction {
        public typealias Failure = WorkspaceOverlaysError

        public let clock: any WorkspaceOverlaysClock
        public let store: any OverlayStore

        public init(clock: any WorkspaceOverlaysClock, store: any OverlayStore) {
            self.clock = clock
            self.store = store
        }

        public func run(_ input: CloseOverlayInput) async -> Result<CloseOverlayResult, WorkspaceOverlaysError> {
            let timestamp = clock.now()

            do {
                let closed = try await store.closeOverlay(
                    workspaceID: input.workspaceID,
                    overlayID: input.overlayID,
                    kind: input.kind
                )
                return .success(CloseOverlayResult(
                    requestID: input.requestID,
                    closedOverlay: closed.closed,
                    stack: closed.stack,
                    timestamp: timestamp
                ))
            } catch let error as WorkspaceOverlaysError {
                return .failure(error)
            } catch {
                return .failure(.storeFailure(String(describing: error)))
            }
        }
    }

    struct ToggleOverlay: FenrirAction {
        public typealias Failure = WorkspaceOverlaysError

        public let clock: any WorkspaceOverlaysClock
        public let store: any OverlayStore

        public init(clock: any WorkspaceOverlaysClock, store: any OverlayStore) {
            self.clock = clock
            self.store = store
        }

        public func run(_ input: ToggleOverlayInput) async -> Result<ToggleOverlayResult, WorkspaceOverlaysError> {
            let timestamp = clock.now()

            do {
                let toggled = try await store.toggleOverlay(
                    descriptor: input.descriptor,
                    workspaceID: input.workspaceID,
                    timestamp: timestamp
                )
                return .success(ToggleOverlayResult(
                    requestID: input.requestID,
                    openedOverlay: toggled.opened,
                    closedOverlay: toggled.closed,
                    stack: toggled.stack,
                    timestamp: timestamp
                ))
            } catch let error as WorkspaceOverlaysError {
                return .failure(error)
            } catch {
                return .failure(.storeFailure(String(describing: error)))
            }
        }
    }

    struct ListOverlays: FenrirAction {
        public typealias Failure = WorkspaceOverlaysError

        public let clock: any WorkspaceOverlaysClock
        public let store: any OverlayStore

        public init(clock: any WorkspaceOverlaysClock, store: any OverlayStore) {
            self.clock = clock
            self.store = store
        }

        public func run(_ input: ListOverlaysInput) async -> Result<ListOverlaysResult, WorkspaceOverlaysError> {
            let timestamp = clock.now()

            do {
                let stack = try await store.listOverlays(workspaceID: input.workspaceID)
                return .success(ListOverlaysResult(
                    requestID: input.requestID,
                    stack: stack,
                    timestamp: timestamp
                ))
            } catch let error as WorkspaceOverlaysError {
                return .failure(error)
            } catch {
                return .failure(.storeFailure(String(describing: error)))
            }
        }
    }

    struct RestoreWorkspaceOverlays: FenrirAction {
        public typealias Failure = WorkspaceOverlaysError

        public let clock: any WorkspaceOverlaysClock
        public let store: any OverlayStore

        public init(clock: any WorkspaceOverlaysClock, store: any OverlayStore) {
            self.clock = clock
            self.store = store
        }

        public func run(_ input: RestoreWorkspaceOverlaysInput) async -> Result<RestoreWorkspaceOverlaysResult, WorkspaceOverlaysError> {
            let timestamp = clock.now()

            do {
                let stack = try await store.listOverlays(workspaceID: input.workspaceID)
                return .success(RestoreWorkspaceOverlaysResult(
                    requestID: input.requestID,
                    stack: stack,
                    timestamp: timestamp
                ))
            } catch let error as WorkspaceOverlaysError {
                return .failure(error)
            } catch {
                return .failure(.storeFailure(String(describing: error)))
            }
        }
    }

    struct SearchCommandPalette: FenrirAction {
        public typealias Failure = WorkspaceOverlaysError

        public let clock: any WorkspaceOverlaysClock
        public let providers: [any PaletteSearchProvider]

        public init(clock: any WorkspaceOverlaysClock, providers: [any PaletteSearchProvider]) {
            self.clock = clock
            self.providers = providers
        }

        public func run(_ input: SearchCommandPaletteInput) async -> Result<SearchCommandPaletteResult, WorkspaceOverlaysError> {
            let query = parsePaletteQuery(input.rawText)
            let matchingProviders = providers.filter { $0.domains.contains(query.domain) }

            do {
                var items: [PaletteItem] = []
                for provider in matchingProviders {
                    if let boundedProvider = provider as? any BoundedPaletteSearchProvider {
                        items.append(contentsOf: try await boundedProvider.searchPalette(
                            query: query,
                            workspaceID: input.workspaceID,
                            maxResults: input.maxResults
                        ))
                    } else {
                        items.append(contentsOf: try await provider.searchPalette(
                            query: query,
                            workspaceID: input.workspaceID
                        ))
                    }
                }

                return .success(SearchCommandPaletteResult(
                    requestID: input.requestID,
                    query: query,
                    items: rankPaletteItems(items, searchText: query.searchText, maxResults: input.maxResults),
                    timestamp: clock.now()
                ))
            } catch let error as WorkspaceOverlaysError {
                return .failure(error)
            } catch {
                return .failure(.storeFailure(String(describing: error)))
            }
        }
    }

    struct ExecutePaletteSelection: FenrirAction {
        public typealias Failure = WorkspaceOverlaysError

        public let clock: any WorkspaceOverlaysClock
        public let executor: any PaletteActionExecutor

        public init(clock: any WorkspaceOverlaysClock, executor: any PaletteActionExecutor) {
            self.clock = clock
            self.executor = executor
        }

        public func run(_ input: ExecutePaletteSelectionInput) async -> Result<ExecutePaletteSelectionResult, WorkspaceOverlaysError> {
            do {
                try await executor.executePaletteAction(
                    input.item.action,
                    workspaceID: input.workspaceID,
                    source: input.source
                )

                return .success(ExecutePaletteSelectionResult(
                    requestID: input.requestID,
                    executedAction: input.item.action,
                    timestamp: clock.now()
                ))
            } catch let error as WorkspaceOverlaysError {
                return .failure(error)
            } catch {
                return .failure(.storeFailure(String(describing: error)))
            }
        }
    }
}

private extension WorkspaceOverlays {
    static func parsePaletteQuery(_ rawText: String) -> PaletteQuery {
        let trimmed = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = trimmed.first,
              let prefix = Keybinding.PalettePrefix(rawValue: String(first))
        else {
            return PaletteQuery(
                rawText: rawText,
                domain: .workspaces,
                searchText: trimmed,
                prefix: nil
            )
        }

        let searchStart = trimmed.index(after: trimmed.startIndex)
        let searchText = String(trimmed[searchStart...])
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return PaletteQuery(
            rawText: rawText,
            domain: PaletteDomain(prefix: prefix),
            searchText: searchText,
            prefix: prefix
        )
    }

    static func rankPaletteItems(_ items: [PaletteItem], searchText: String, maxResults: Int = Int.max) -> [RankedPaletteItem] {
        let limit = max(1, maxResults)
        var ranked: [RankedPaletteItem] = []

        for item in items {
            guard let score = score(item, searchText: searchText) else {
                continue
            }
            insertBounded(RankedPaletteItem(item: item, score: score), into: &ranked, limit: limit)
        }

        return ranked
    }

    static func insertBounded(_ item: RankedPaletteItem, into ranked: inout [RankedPaletteItem], limit: Int) {
        let index = ranked.firstIndex { current in
            if item.score != current.score {
                return item.score > current.score
            }

            return item.item.title.localizedCaseInsensitiveCompare(current.item.title) == .orderedAscending
        } ?? ranked.endIndex

        guard index < limit || ranked.count < limit else {
            return
        }

        ranked.insert(item, at: index)
        if ranked.count > limit {
            ranked.removeLast()
        }
    }

    static func score(_ item: PaletteItem, searchText: String) -> Int? {
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
}
