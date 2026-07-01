import Foundation
import FenrirNativeShared

public extension PaneGrid {
    enum SplitAxis: String, Codable, Equatable, Sendable {
        case horizontal
        case vertical
    }

    enum FocusDirection: String, Codable, Equatable, Sendable {
        case left
        case right
        case up
        case down
    }

    enum PaneLifecycleStatus: String, Codable, Equatable, Sendable {
        case open
        case closed
    }

    enum ResizeUnit: String, Codable, Equatable, Sendable {
        case cells
        case pixels
    }

    enum PaneGridError: String, Error, Codable, Equatable, Sendable {
        case createFailed = "PaneGridCreateFailed"
        case disposeFailed = "PaneGridDisposeFailed"
        case layoutInvalid = "PaneGridLayoutInvalid"
        case paneNotFound = "PaneGridPaneNotFound"
        case focusFailed = "PaneGridFocusFailed"
        case splitFailed = "PaneGridSplitFailed"
        case closeFailed = "PaneGridCloseFailed"
        case moveFailed = "PaneGridMoveFailed"
        case resizeFailed = "PaneGridResizeFailed"
        case selectWindowFailed = "PaneGridSelectWindowFailed"
        case viewportHostFailed = "PaneGridViewportHostFailed"
    }

    struct PaneRect: Codable, Equatable, Sendable {
        public let x: Int
        public let y: Int
        public let columns: Int
        public let rows: Int

        public init(x: Int, y: Int, columns: Int, rows: Int) {
            self.x = x
            self.y = y
            self.columns = columns
            self.rows = rows
        }
    }

    struct PaneSnapshot: Codable, Equatable, Sendable {
        public let paneID: PaneID
        public let title: String?
        public let rect: PaneRect
        public let status: PaneLifecycleStatus

        public init(paneID: PaneID, title: String? = nil, rect: PaneRect, status: PaneLifecycleStatus = .open) {
            self.paneID = paneID
            self.title = title
            self.rect = rect
            self.status = status
        }
    }

    struct WindowSnapshot: Codable, Equatable, Sendable {
        public let windowID: FenrirWindowID
        public let tmuxWindowID: String
        public let index: Int
        public let title: String
        public let activePaneID: PaneID?
        public let panes: [PaneSnapshot]

        public init(
            windowID: FenrirWindowID,
            tmuxWindowID: String,
            index: Int,
            title: String,
            activePaneID: PaneID?,
            panes: [PaneSnapshot]
        ) {
            self.windowID = windowID
            self.tmuxWindowID = tmuxWindowID
            self.index = index
            self.title = title
            self.activePaneID = activePaneID
            self.panes = panes
        }
    }

    struct SessionSnapshot: Codable, Equatable, Sendable {
        public let workspaceID: WorkspaceID
        public let tmuxSessionID: String
        public let activeWindowID: FenrirWindowID
        public let windows: [WindowSnapshot]

        public init(
            workspaceID: WorkspaceID,
            tmuxSessionID: String,
            activeWindowID: FenrirWindowID,
            windows: [WindowSnapshot]
        ) {
            self.workspaceID = workspaceID
            self.tmuxSessionID = tmuxSessionID
            self.activeWindowID = activeWindowID
            self.windows = windows
        }
    }

    struct PanePresentation: Codable, Equatable, Sendable {
        public let paneID: PaneID
        public let viewportID: ViewportID
        public let title: String?
        public let rect: PaneRect
        public let isFocused: Bool

        public init(paneID: PaneID, viewportID: ViewportID, title: String? = nil, rect: PaneRect, isFocused: Bool) {
            self.paneID = paneID
            self.viewportID = viewportID
            self.title = title
            self.rect = rect
            self.isFocused = isFocused
        }
    }

    indirect enum LayoutNode: Codable, Equatable, Sendable {
        case pane(PanePresentation)
        case split(axis: SplitAxis, children: [LayoutNode])
    }

    struct WindowPresentation: Codable, Equatable, Sendable {
        public let windowID: FenrirWindowID
        public let tmuxWindowID: String
        public let index: Int
        public let title: String
        public let root: LayoutNode
        public let activePaneID: PaneID
        public let panes: [PanePresentation]

        public init(
            windowID: FenrirWindowID,
            tmuxWindowID: String,
            index: Int,
            title: String,
            root: LayoutNode,
            activePaneID: PaneID,
            panes: [PanePresentation]
        ) {
            self.windowID = windowID
            self.tmuxWindowID = tmuxWindowID
            self.index = index
            self.title = title
            self.root = root
            self.activePaneID = activePaneID
            self.panes = panes
        }
    }

    struct State: Codable, Equatable, Sendable {
        public let workspaceID: WorkspaceID
        public let tmuxSessionID: String
        public let activeWindowID: FenrirWindowID
        public let windows: [WindowPresentation]
        public let generation: UInt64

        public init(
            workspaceID: WorkspaceID,
            tmuxSessionID: String,
            activeWindowID: FenrirWindowID,
            windows: [WindowPresentation],
            generation: UInt64 = 0
        ) {
            self.workspaceID = workspaceID
            self.tmuxSessionID = tmuxSessionID
            self.activeWindowID = activeWindowID
            self.windows = windows
            self.generation = generation
        }
    }

    struct PaneResizeAllocation: Codable, Equatable, Sendable {
        public let paneID: PaneID
        public let delta: Int
        public let unit: ResizeUnit
        public let direction: FocusDirection

        public init(paneID: PaneID, delta: Int, unit: ResizeUnit, direction: FocusDirection) {
            self.paneID = paneID
            self.delta = delta
            self.unit = unit
            self.direction = direction
        }
    }

    struct CreatePaneGridInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let snapshot: SessionSnapshot
        public let source: ActionSource

        public init(requestID: RequestID, snapshot: SessionSnapshot, source: ActionSource) {
            self.requestID = requestID
            self.snapshot = snapshot
            self.source = source
        }
    }

    struct CreatePaneGridResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let state: State
        public let timestamp: FenrirTimestamp
    }

    struct DisposePaneGridInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.source = source
        }
    }

    struct DisposePaneGridResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let timestamp: FenrirTimestamp
    }

    struct ReconcileRuntimeLayoutInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let snapshot: SessionSnapshot
        public let source: ActionSource

        public init(requestID: RequestID, snapshot: SessionSnapshot, source: ActionSource) {
            self.requestID = requestID
            self.snapshot = snapshot
            self.source = source
        }
    }

    struct ReconcileRuntimeLayoutResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let state: State
        public let createdViewportIDs: [ViewportID]
        public let disposedViewportIDs: [ViewportID]
        public let timestamp: FenrirTimestamp
    }

    struct FocusPaneInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let windowID: FenrirWindowID
        public let paneID: PaneID
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, windowID: FenrirWindowID, paneID: PaneID, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.windowID = windowID
            self.paneID = paneID
            self.source = source
        }
    }

    struct FocusPaneResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let state: State
        public let timestamp: FenrirTimestamp
    }

    struct MovePaneFocusInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let windowID: FenrirWindowID
        public let direction: FocusDirection
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, windowID: FenrirWindowID, direction: FocusDirection, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.windowID = windowID
            self.direction = direction
            self.source = source
        }
    }

    struct MovePaneFocusResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let state: State
        public let fromPaneID: PaneID
        public let toPaneID: PaneID
        public let timestamp: FenrirTimestamp
    }

    struct SplitPaneInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let windowID: FenrirWindowID
        public let paneID: PaneID
        public let axis: SplitAxis
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, windowID: FenrirWindowID, paneID: PaneID, axis: SplitAxis, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.windowID = windowID
            self.paneID = paneID
            self.axis = axis
            self.source = source
        }
    }

    struct SplitPaneResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let createdPaneID: PaneID
        public let timestamp: FenrirTimestamp
    }

    struct ClosePaneInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let windowID: FenrirWindowID
        public let paneID: PaneID
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, windowID: FenrirWindowID, paneID: PaneID, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.windowID = windowID
            self.paneID = paneID
            self.source = source
        }
    }

    struct ClosePaneResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let paneID: PaneID
        public let timestamp: FenrirTimestamp
    }

    struct MovePaneInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let fromWindowID: FenrirWindowID
        public let toWindowID: FenrirWindowID
        public let paneID: PaneID
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, fromWindowID: FenrirWindowID, toWindowID: FenrirWindowID, paneID: PaneID, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.fromWindowID = fromWindowID
            self.toWindowID = toWindowID
            self.paneID = paneID
            self.source = source
        }
    }

    struct MovePaneResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let paneID: PaneID
        public let targetWindowID: FenrirWindowID
        public let timestamp: FenrirTimestamp
    }

    struct ResizePaneAllocationInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let windowID: FenrirWindowID
        public let allocation: PaneResizeAllocation
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, windowID: FenrirWindowID, allocation: PaneResizeAllocation, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.windowID = windowID
            self.allocation = allocation
            self.source = source
        }
    }

    struct ResizePaneAllocationResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let allocation: PaneResizeAllocation
        public let timestamp: FenrirTimestamp
    }

    struct SelectTabWindowInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let windowID: FenrirWindowID
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, windowID: FenrirWindowID, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.windowID = windowID
            self.source = source
        }
    }

    struct SelectTabWindowResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let state: State
        public let timestamp: FenrirTimestamp
    }

    enum Event: Codable, Equatable, Sendable {
        case paneGridCreated(WorkspaceID)
        case paneGridDisposed(WorkspaceID)
        case runtimeLayoutReconciled(WorkspaceID, UInt64)
        case paneFocused(PaneID)
        case paneFocusMoved(PaneID, PaneID)
        case paneSplitRequested(PaneID, SplitAxis)
        case paneCloseRequested(PaneID)
        case paneMoveRequested(PaneID, FenrirWindowID)
        case paneResizeAllocationRequested(PaneResizeAllocation)
        case tabWindowSelected(FenrirWindowID)
    }
}
