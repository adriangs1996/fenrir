import Foundation
import FenrirNativeShared
import Keybinding

public extension WorkspaceOverlays {
    enum WorkspaceOverlaysError: Error, Codable, Equatable, Sendable {
        case unavailable
        case overlayNotFound(OverlayID)
        case storeFailure(String)
    }

    struct OverlayID: FenrirID, ExpressibleByStringLiteral {
        public let rawValue: String

        public init(rawValue: String) {
            self.rawValue = rawValue
        }

        public init(stringLiteral value: String) {
            self.init(rawValue: value)
        }

        public static func generated() -> OverlayID {
            OverlayID(rawValue: UUID().uuidString)
        }
    }

    struct ModuleSummary: Codable, Equatable, Sendable {
        public let moduleName: String
        public let registeredAt: FenrirTimestamp

        public init(moduleName: String = "WorkspaceOverlays", registeredAt: FenrirTimestamp) {
            self.moduleName = moduleName
            self.registeredAt = registeredAt
        }
    }

    struct DescribeWorkspaceOverlaysModuleInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let source: ActionSource

        public init(requestID: RequestID, source: ActionSource) {
            self.requestID = requestID
            self.source = source
        }
    }

    struct DescribeWorkspaceOverlaysModuleResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let summary: ModuleSummary
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, summary: ModuleSummary, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.summary = summary
            self.timestamp = timestamp
        }
    }

    enum OverlayKind: String, Codable, Equatable, Sendable {
        case commandPalette
        case agentComposer
        case workflowPanel
        case diagnostics
        case transientModal
    }

    enum PaletteDomain: String, Codable, Equatable, Hashable, CaseIterable, Sendable {
        case workspaces
        case actions
        case files
        case panes
        case workflows
        case help

        public init(prefix: Keybinding.PalettePrefix?) {
            switch prefix {
            case .none:
                self = .workspaces
            case .agent:
                self = .actions
            case .shell:
                self = .files
            case .pane:
                self = .panes
            case .workflow:
                self = .workflows
            case .help:
                self = .help
            }
        }
    }

    struct PaletteQuery: Codable, Equatable, Sendable {
        public let rawText: String
        public let domain: PaletteDomain
        public let searchText: String
        public let prefix: Keybinding.PalettePrefix?

        public init(rawText: String, domain: PaletteDomain, searchText: String, prefix: Keybinding.PalettePrefix?) {
            self.rawText = rawText
            self.domain = domain
            self.searchText = searchText
            self.prefix = prefix
        }
    }

    enum PaletteAction: Codable, Equatable, Sendable {
        case switchWorkspace(WorkspaceID)
        case runAction(String)
        case openFile(String)
        case focusPane(PaneID)
        case openWorkflow(String)
        case openDiagnostics
        case openHelp(String)
    }

    struct PaletteItem: Codable, Equatable, Identifiable, Sendable {
        public let id: String
        public let domain: PaletteDomain
        public let title: String
        public let subtitle: String?
        public let keywords: [String]
        public let action: PaletteAction
        public let baseScore: Int

        public init(
            id: String,
            domain: PaletteDomain,
            title: String,
            subtitle: String? = nil,
            keywords: [String] = [],
            action: PaletteAction,
            baseScore: Int = 0
        ) {
            self.id = id
            self.domain = domain
            self.title = title
            self.subtitle = subtitle
            self.keywords = keywords
            self.action = action
            self.baseScore = baseScore
        }
    }

    struct RankedPaletteItem: Codable, Equatable, Identifiable, Sendable {
        public let item: PaletteItem
        public let score: Int

        public init(item: PaletteItem, score: Int) {
            self.item = item
            self.score = score
        }

        public var id: String {
            item.id
        }
    }

    struct WorkspaceSwitcherEntry: Codable, Equatable, Sendable {
        public let workspaceID: WorkspaceID
        public let title: String
        public let subtitle: String?
        public let keywords: [String]
        public let isActive: Bool
        public let recencyRank: Int

        public init(
            workspaceID: WorkspaceID,
            title: String,
            subtitle: String? = nil,
            keywords: [String] = [],
            isActive: Bool = false,
            recencyRank: Int = 0
        ) {
            self.workspaceID = workspaceID
            self.title = title
            self.subtitle = subtitle
            self.keywords = keywords
            self.isActive = isActive
            self.recencyRank = recencyRank
        }
    }

    struct SearchCommandPaletteInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let rawText: String
        public let maxResults: Int
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, rawText: String, maxResults: Int = 50, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.rawText = rawText
            self.maxResults = max(1, maxResults)
            self.source = source
        }
    }

    struct SearchCommandPaletteResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let query: PaletteQuery
        public let items: [RankedPaletteItem]
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, query: PaletteQuery, items: [RankedPaletteItem], timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.query = query
            self.items = items
            self.timestamp = timestamp
        }
    }

    struct ExecutePaletteSelectionInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let item: PaletteItem
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, item: PaletteItem, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.item = item
            self.source = source
        }
    }

    struct ExecutePaletteSelectionResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let executedAction: PaletteAction
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, executedAction: PaletteAction, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.executedAction = executedAction
            self.timestamp = timestamp
        }
    }

    enum OverlayPresentation: String, Codable, Equatable, Sendable {
        case stackable
        case modal
    }

    enum OverlayFocusReturnTarget: Codable, Equatable, Sendable {
        case workspaceShell
        case pane(PaneID)
        case sidebar
    }

    struct OverlayDescriptor: Codable, Equatable, Sendable {
        public let kind: OverlayKind
        public let presentation: OverlayPresentation
        public let title: String
        public let focusReturnTarget: OverlayFocusReturnTarget

        public init(
            kind: OverlayKind,
            presentation: OverlayPresentation? = nil,
            title: String,
            focusReturnTarget: OverlayFocusReturnTarget = .workspaceShell
        ) {
            self.kind = kind
            self.presentation = presentation ?? kind.defaultPresentation
            self.title = title
            self.focusReturnTarget = focusReturnTarget
        }
    }

    struct OverlayRecord: Codable, Equatable, Sendable {
        public let id: OverlayID
        public let workspaceID: WorkspaceID
        public let descriptor: OverlayDescriptor
        public let openedAt: FenrirTimestamp
        public let focusedAt: FenrirTimestamp

        public init(
            id: OverlayID,
            workspaceID: WorkspaceID,
            descriptor: OverlayDescriptor,
            openedAt: FenrirTimestamp,
            focusedAt: FenrirTimestamp
        ) {
            self.id = id
            self.workspaceID = workspaceID
            self.descriptor = descriptor
            self.openedAt = openedAt
            self.focusedAt = focusedAt
        }
    }

    struct WorkspaceOverlayStack: Codable, Equatable, Sendable {
        public let workspaceID: WorkspaceID
        public let overlays: [OverlayRecord]
        public let focusedOverlayID: OverlayID?

        public init(workspaceID: WorkspaceID, overlays: [OverlayRecord], focusedOverlayID: OverlayID?) {
            self.workspaceID = workspaceID
            self.overlays = overlays
            self.focusedOverlayID = focusedOverlayID
        }

        public var focusedOverlay: OverlayRecord? {
            guard let focusedOverlayID else {
                return nil
            }

            return overlays.first { $0.id == focusedOverlayID }
        }
    }

    struct OpenOverlayInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let descriptor: OverlayDescriptor
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, descriptor: OverlayDescriptor, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.descriptor = descriptor
            self.source = source
        }
    }

    struct OpenOverlayResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let overlay: OverlayRecord
        public let stack: WorkspaceOverlayStack
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, overlay: OverlayRecord, stack: WorkspaceOverlayStack, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.overlay = overlay
            self.stack = stack
            self.timestamp = timestamp
        }
    }

    struct CloseOverlayInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let overlayID: OverlayID?
        public let kind: OverlayKind?
        public let source: ActionSource

        public init(
            requestID: RequestID,
            workspaceID: WorkspaceID,
            overlayID: OverlayID? = nil,
            kind: OverlayKind? = nil,
            source: ActionSource
        ) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.overlayID = overlayID
            self.kind = kind
            self.source = source
        }
    }

    struct CloseOverlayResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let closedOverlay: OverlayRecord?
        public let stack: WorkspaceOverlayStack
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, closedOverlay: OverlayRecord?, stack: WorkspaceOverlayStack, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.closedOverlay = closedOverlay
            self.stack = stack
            self.timestamp = timestamp
        }
    }

    struct ToggleOverlayInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let descriptor: OverlayDescriptor
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, descriptor: OverlayDescriptor, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.descriptor = descriptor
            self.source = source
        }
    }

    struct ToggleOverlayResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let openedOverlay: OverlayRecord?
        public let closedOverlay: OverlayRecord?
        public let stack: WorkspaceOverlayStack
        public let timestamp: FenrirTimestamp

        public init(
            requestID: RequestID,
            openedOverlay: OverlayRecord?,
            closedOverlay: OverlayRecord?,
            stack: WorkspaceOverlayStack,
            timestamp: FenrirTimestamp
        ) {
            self.requestID = requestID
            self.openedOverlay = openedOverlay
            self.closedOverlay = closedOverlay
            self.stack = stack
            self.timestamp = timestamp
        }
    }

    struct ListOverlaysInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.source = source
        }
    }

    struct ListOverlaysResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let stack: WorkspaceOverlayStack
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, stack: WorkspaceOverlayStack, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.stack = stack
            self.timestamp = timestamp
        }
    }

    struct RestoreWorkspaceOverlaysInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.source = source
        }
    }

    struct RestoreWorkspaceOverlaysResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let stack: WorkspaceOverlayStack
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, stack: WorkspaceOverlayStack, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.stack = stack
            self.timestamp = timestamp
        }
    }

    enum Event: Codable, Equatable, Sendable {
        case moduleRegistered(String)
        case overlayOpened(WorkspaceID, OverlayID)
        case overlayClosed(WorkspaceID, OverlayID)
        case workspaceOverlaysRestored(WorkspaceID)
    }
}

public extension WorkspaceOverlays.OverlayKind {
    var defaultPresentation: WorkspaceOverlays.OverlayPresentation {
        switch self {
        case .commandPalette, .transientModal:
            .modal
        case .agentComposer, .workflowPanel, .diagnostics:
            .stackable
        }
    }
}
