import Foundation
import FenrirNativeShared
import NativeRuntime

public extension PaneGrid {
    struct CreatePaneGrid: FenrirAction {
        public typealias Failure = PaneGridError

        let store: any PaneGridStore
        let projector: any PaneLayoutProjecting
        let viewportHost: any PaneViewportHosting
        let clock: any PaneGridClock
        let events: (any PaneGridEventPublishing)?

        public init(store: any PaneGridStore, viewportHost: any PaneViewportHosting, clock: any PaneGridClock, events: (any PaneGridEventPublishing)? = nil) {
            self.init(store: store, projector: DefaultPaneLayoutProjector(), viewportHost: viewportHost, clock: clock, events: events)
        }

        public init(store: any PaneGridStore, projector: any PaneLayoutProjecting, viewportHost: any PaneViewportHosting, clock: any PaneGridClock, events: (any PaneGridEventPublishing)? = nil) {
            self.store = store
            self.projector = projector
            self.viewportHost = viewportHost
            self.clock = clock
            self.events = events
        }

        public func run(_ input: CreatePaneGridInput) async -> Result<CreatePaneGridResult, PaneGridError> {
            do {
                let existing = try await store.loadGrid(workspaceID: input.snapshot.workspaceID)
                var state = try await projector.project(input.snapshot, existing: existing)
                let hosted = try await PaneGrid.hostMissingViewports(in: state, viewportHost: viewportHost)
                state = hosted.state
                try await store.saveGrid(state)
                let timestamp = clock.now()
                await events?.publish(PaneGrid.envelope(input.requestID, "PaneGridCreated", timestamp, .paneGridCreated(state.workspaceID)))
                return .success(CreatePaneGridResult(requestID: input.requestID, state: state, timestamp: timestamp))
            } catch let error as PaneGridError {
                return .failure(error)
            } catch {
                return .failure(.createFailed)
            }
        }
    }

    struct DisposePaneGrid: FenrirAction {
        public typealias Failure = PaneGridError

        let store: any PaneGridStore
        let viewportHost: any PaneViewportHosting
        let clock: any PaneGridClock
        let events: (any PaneGridEventPublishing)?

        public init(store: any PaneGridStore, viewportHost: any PaneViewportHosting, clock: any PaneGridClock, events: (any PaneGridEventPublishing)? = nil) {
            self.store = store
            self.viewportHost = viewportHost
            self.clock = clock
            self.events = events
        }

        public func run(_ input: DisposePaneGridInput) async -> Result<DisposePaneGridResult, PaneGridError> {
            do {
                guard let state = try await store.loadGrid(workspaceID: input.workspaceID) else {
                    return .failure(.paneNotFound)
                }
                for viewportID in state.allViewportIDs {
                    try await viewportHost.disposeViewport(viewportID: viewportID)
                }
                try await store.deleteGrid(workspaceID: input.workspaceID)
                let timestamp = clock.now()
                await events?.publish(PaneGrid.envelope(input.requestID, "PaneGridDisposed", timestamp, .paneGridDisposed(input.workspaceID)))
                return .success(DisposePaneGridResult(requestID: input.requestID, workspaceID: input.workspaceID, timestamp: timestamp))
            } catch let error as PaneGridError {
                return .failure(error)
            } catch {
                return .failure(.disposeFailed)
            }
        }
    }

    struct ReconcileRuntimeLayout: FenrirAction {
        public typealias Failure = PaneGridError

        let store: any PaneGridStore
        let projector: any PaneLayoutProjecting
        let viewportHost: any PaneViewportHosting
        let clock: any PaneGridClock
        let events: (any PaneGridEventPublishing)?

        public init(store: any PaneGridStore, viewportHost: any PaneViewportHosting, clock: any PaneGridClock, events: (any PaneGridEventPublishing)? = nil) {
            self.init(store: store, projector: DefaultPaneLayoutProjector(), viewportHost: viewportHost, clock: clock, events: events)
        }

        public init(store: any PaneGridStore, projector: any PaneLayoutProjecting, viewportHost: any PaneViewportHosting, clock: any PaneGridClock, events: (any PaneGridEventPublishing)? = nil) {
            self.store = store
            self.projector = projector
            self.viewportHost = viewportHost
            self.clock = clock
            self.events = events
        }

        public func run(_ input: ReconcileRuntimeLayoutInput) async -> Result<ReconcileRuntimeLayoutResult, PaneGridError> {
            do {
                let existing = try await store.loadGrid(workspaceID: input.snapshot.workspaceID)
                var state = try await projector.project(input.snapshot, existing: existing)
                let previousViewportIDs = Set(existing?.allViewportIDs ?? [])
                let hosted = try await PaneGrid.hostMissingViewports(in: state, viewportHost: viewportHost)
                state = hosted.state
                let nextViewportIDs = Set(state.allViewportIDs)
                let disposedViewportIDs = Array(previousViewportIDs.subtracting(nextViewportIDs)).sorted { $0.rawValue < $1.rawValue }
                for viewportID in disposedViewportIDs {
                    try await viewportHost.disposeViewport(viewportID: viewportID)
                }
                try await store.saveGrid(state)
                let timestamp = clock.now()
                await events?.publish(PaneGrid.envelope(input.requestID, "RuntimeLayoutReconciled", timestamp, .runtimeLayoutReconciled(state.workspaceID, state.generation)))
                return .success(ReconcileRuntimeLayoutResult(
                    requestID: input.requestID,
                    state: state,
                    createdViewportIDs: hosted.createdViewportIDs,
                    disposedViewportIDs: disposedViewportIDs,
                    timestamp: timestamp
                ))
            } catch let error as PaneGridError {
                return .failure(error)
            } catch {
                return .failure(.layoutInvalid)
            }
        }
    }

    struct FocusPane: FenrirAction {
        public typealias Failure = PaneGridError

        let store: any PaneGridStore
        let kernel: any PaneKernelControlling
        let clock: any PaneGridClock
        let events: (any PaneGridEventPublishing)?

        public init(store: any PaneGridStore, kernel: any PaneKernelControlling, clock: any PaneGridClock, events: (any PaneGridEventPublishing)? = nil) {
            self.store = store
            self.kernel = kernel
            self.clock = clock
            self.events = events
        }

        public func run(_ input: FocusPaneInput) async -> Result<FocusPaneResult, PaneGridError> {
            do {
                let state = try await PaneGrid.loadMatchingState(store, workspaceID: input.workspaceID, windowID: input.windowID)
                guard state.window(input.windowID)?.containsPane(input.paneID) == true else {
                    return .failure(.paneNotFound)
                }
                try await kernel.focusPane(try state.focusCommand(input))
                let next = try state.focusing(windowID: input.windowID, paneID: input.paneID)
                try await store.saveGrid(next)
                let timestamp = clock.now()
                await events?.publish(PaneGrid.envelope(input.requestID, "PaneFocused", timestamp, .paneFocused(input.paneID)))
                return .success(FocusPaneResult(requestID: input.requestID, state: next, timestamp: timestamp))
            } catch let error as PaneGridError {
                return .failure(error)
            } catch {
                return .failure(.focusFailed)
            }
        }
    }

    struct MovePaneFocus: FenrirAction {
        public typealias Failure = PaneGridError

        let store: any PaneGridStore
        let kernel: any PaneKernelControlling
        let clock: any PaneGridClock
        let events: (any PaneGridEventPublishing)?

        public init(store: any PaneGridStore, kernel: any PaneKernelControlling, clock: any PaneGridClock, events: (any PaneGridEventPublishing)? = nil) {
            self.store = store
            self.kernel = kernel
            self.clock = clock
            self.events = events
        }

        public func run(_ input: MovePaneFocusInput) async -> Result<MovePaneFocusResult, PaneGridError> {
            do {
                let state = try await PaneGrid.loadMatchingState(store, workspaceID: input.workspaceID, windowID: input.windowID)
                guard let window = state.window(input.windowID), let target = window.focusTarget(direction: input.direction) else {
                    return .failure(.paneNotFound)
                }
                let focusInput = FocusPaneInput(requestID: input.requestID, workspaceID: input.workspaceID, windowID: input.windowID, paneID: target.to, source: input.source)
                try await kernel.focusPane(try state.focusCommand(focusInput))
                let next = try state.focusing(windowID: input.windowID, paneID: target.to)
                try await store.saveGrid(next)
                let timestamp = clock.now()
                await events?.publish(PaneGrid.envelope(input.requestID, "PaneFocusMoved", timestamp, .paneFocusMoved(target.from, target.to)))
                return .success(MovePaneFocusResult(requestID: input.requestID, state: next, fromPaneID: target.from, toPaneID: target.to, timestamp: timestamp))
            } catch let error as PaneGridError {
                return .failure(error)
            } catch {
                return .failure(.focusFailed)
            }
        }
    }

    struct SplitPane: FenrirAction {
        public typealias Failure = PaneGridError

        let store: any PaneGridStore
        let kernel: any PaneKernelControlling
        let clock: any PaneGridClock
        let events: (any PaneGridEventPublishing)?

        public init(store: any PaneGridStore, kernel: any PaneKernelControlling, clock: any PaneGridClock, events: (any PaneGridEventPublishing)? = nil) {
            self.store = store
            self.kernel = kernel
            self.clock = clock
            self.events = events
        }

        public func run(_ input: SplitPaneInput) async -> Result<SplitPaneResult, PaneGridError> {
            do {
                let state = try await PaneGrid.loadMatchingState(store, workspaceID: input.workspaceID, windowID: input.windowID)
                guard state.window(input.windowID)?.containsPane(input.paneID) == true else {
                    return .failure(.paneNotFound)
                }
                let paneID = try await kernel.splitPane(try state.splitCommand(input))
                let timestamp = clock.now()
                await events?.publish(PaneGrid.envelope(input.requestID, "PaneSplitRequested", timestamp, .paneSplitRequested(input.paneID, input.axis)))
                return .success(SplitPaneResult(requestID: input.requestID, createdPaneID: paneID, timestamp: timestamp))
            } catch let error as PaneGridError {
                return .failure(error)
            } catch {
                return .failure(.splitFailed)
            }
        }
    }

    struct ClosePane: FenrirAction {
        public typealias Failure = PaneGridError

        let store: any PaneGridStore
        let kernel: any PaneKernelControlling
        let clock: any PaneGridClock
        let events: (any PaneGridEventPublishing)?

        public init(store: any PaneGridStore, kernel: any PaneKernelControlling, clock: any PaneGridClock, events: (any PaneGridEventPublishing)? = nil) {
            self.store = store
            self.kernel = kernel
            self.clock = clock
            self.events = events
        }

        public func run(_ input: ClosePaneInput) async -> Result<ClosePaneResult, PaneGridError> {
            do {
                let state = try await PaneGrid.loadMatchingState(store, workspaceID: input.workspaceID, windowID: input.windowID)
                guard state.window(input.windowID)?.containsPane(input.paneID) == true else {
                    return .failure(.paneNotFound)
                }
                try await kernel.closePane(try state.closeCommand(input))
                let timestamp = clock.now()
                await events?.publish(PaneGrid.envelope(input.requestID, "PaneCloseRequested", timestamp, .paneCloseRequested(input.paneID)))
                return .success(ClosePaneResult(requestID: input.requestID, paneID: input.paneID, timestamp: timestamp))
            } catch let error as PaneGridError {
                return .failure(error)
            } catch {
                return .failure(.closeFailed)
            }
        }
    }

    struct MovePane: FenrirAction {
        public typealias Failure = PaneGridError

        let store: any PaneGridStore
        let kernel: any PaneKernelControlling
        let clock: any PaneGridClock
        let events: (any PaneGridEventPublishing)?

        public init(store: any PaneGridStore, kernel: any PaneKernelControlling, clock: any PaneGridClock, events: (any PaneGridEventPublishing)? = nil) {
            self.store = store
            self.kernel = kernel
            self.clock = clock
            self.events = events
        }

        public func run(_ input: MovePaneInput) async -> Result<MovePaneResult, PaneGridError> {
            do {
                let state = try await PaneGrid.loadMatchingState(store, workspaceID: input.workspaceID, windowID: input.fromWindowID)
                guard state.window(input.fromWindowID)?.containsPane(input.paneID) == true, state.window(input.toWindowID) != nil else {
                    return .failure(.paneNotFound)
                }
                try await kernel.movePane(try state.moveCommand(input))
                let timestamp = clock.now()
                await events?.publish(PaneGrid.envelope(input.requestID, "PaneMoveRequested", timestamp, .paneMoveRequested(input.paneID, input.toWindowID)))
                return .success(MovePaneResult(requestID: input.requestID, paneID: input.paneID, targetWindowID: input.toWindowID, timestamp: timestamp))
            } catch let error as PaneGridError {
                return .failure(error)
            } catch {
                return .failure(.moveFailed)
            }
        }
    }

    struct ResizePaneAllocation: FenrirAction {
        public typealias Failure = PaneGridError

        let store: any PaneGridStore
        let kernel: any PaneKernelControlling
        let clock: any PaneGridClock
        let events: (any PaneGridEventPublishing)?

        public init(store: any PaneGridStore, kernel: any PaneKernelControlling, clock: any PaneGridClock, events: (any PaneGridEventPublishing)? = nil) {
            self.store = store
            self.kernel = kernel
            self.clock = clock
            self.events = events
        }

        public func run(_ input: ResizePaneAllocationInput) async -> Result<ResizePaneAllocationResult, PaneGridError> {
            do {
                let state = try await PaneGrid.loadMatchingState(store, workspaceID: input.workspaceID, windowID: input.windowID)
                guard input.allocation.delta != 0, state.window(input.windowID)?.containsPane(input.allocation.paneID) == true else {
                    return .failure(.resizeFailed)
                }
                try await kernel.resizePaneAllocation(try state.resizeCommand(input))
                let timestamp = clock.now()
                await events?.publish(PaneGrid.envelope(input.requestID, "PaneResizeAllocationRequested", timestamp, .paneResizeAllocationRequested(input.allocation)))
                return .success(ResizePaneAllocationResult(requestID: input.requestID, allocation: input.allocation, timestamp: timestamp))
            } catch let error as PaneGridError {
                return .failure(error)
            } catch {
                return .failure(.resizeFailed)
            }
        }
    }

    struct SelectTabWindow: FenrirAction {
        public typealias Failure = PaneGridError

        let store: any PaneGridStore
        let kernel: any PaneKernelControlling
        let clock: any PaneGridClock
        let events: (any PaneGridEventPublishing)?

        public init(store: any PaneGridStore, kernel: any PaneKernelControlling, clock: any PaneGridClock, events: (any PaneGridEventPublishing)? = nil) {
            self.store = store
            self.kernel = kernel
            self.clock = clock
            self.events = events
        }

        public func run(_ input: SelectTabWindowInput) async -> Result<SelectTabWindowResult, PaneGridError> {
            do {
                let state = try await PaneGrid.loadMatchingState(store, workspaceID: input.workspaceID, windowID: input.windowID)
                try await kernel.selectWindow(try state.selectWindowCommand(input))
                let next = state.selecting(windowID: input.windowID)
                try await store.saveGrid(next)
                let timestamp = clock.now()
                await events?.publish(PaneGrid.envelope(input.requestID, "TabWindowSelected", timestamp, .tabWindowSelected(input.windowID)))
                return .success(SelectTabWindowResult(requestID: input.requestID, state: next, timestamp: timestamp))
            } catch let error as PaneGridError {
                return .failure(error)
            } catch {
                return .failure(.selectWindowFailed)
            }
        }
    }
}

extension PaneGrid {
    struct DefaultPaneLayoutProjector: PaneLayoutProjecting {
        func project(_ snapshot: SessionSnapshot, existing: State?) async throws -> State {
            try PaneGrid.validate(snapshot)
            let existingViewportIDs = existing?.viewportIDsByPaneID ?? [:]
            let windows = try snapshot.windows
                .sorted { $0.index == $1.index ? $0.windowID.rawValue < $1.windowID.rawValue : $0.index < $1.index }
                .map { window in
                    try PaneGrid.project(window, viewportIDs: existingViewportIDs)
                }
            guard windows.contains(where: { $0.windowID == snapshot.activeWindowID }) else {
                throw PaneGridError.layoutInvalid
            }
            return State(
                workspaceID: snapshot.workspaceID,
                tmuxSessionID: snapshot.tmuxSessionID,
                activeWindowID: snapshot.activeWindowID,
                windows: windows,
                generation: (existing?.generation ?? 0) + 1
            )
        }
    }

    static func envelope(_ requestID: RequestID, _ kind: String, _ timestamp: FenrirTimestamp, _ event: Event) -> EventEnvelope<Event> {
        EventEnvelope(eventID: requestID, eventKind: kind, timestamp: timestamp, event: event)
    }

    static func loadMatchingState(_ store: any PaneGridStore, workspaceID: WorkspaceID, windowID: FenrirWindowID) async throws -> State {
        guard let state = try await store.loadGrid(workspaceID: workspaceID) else {
            throw PaneGridError.paneNotFound
        }
        guard state.window(windowID) != nil else {
            throw PaneGridError.paneNotFound
        }
        return state
    }

    static func hostMissingViewports(in state: State, viewportHost: any PaneViewportHosting) async throws -> (state: State, createdViewportIDs: [ViewportID]) {
        var created: [ViewportID] = []
        var windows: [WindowPresentation] = []
        for window in state.windows {
            var panes: [PanePresentation] = []
            for pane in window.panes {
                let viewportID = pane.viewportID.rawValue.isEmpty
                    ? try await viewportHost.createViewport(workspaceID: state.workspaceID, windowID: window.windowID, paneID: pane.paneID)
                    : pane.viewportID
                if pane.viewportID.rawValue.isEmpty {
                    created.append(viewportID)
                }
                panes.append(PanePresentation(paneID: pane.paneID, tmuxPaneID: pane.tmuxPaneID, streamID: pane.streamID, viewportID: viewportID, title: pane.title, rect: pane.rect, isFocused: pane.isFocused))
            }
            windows.append(WindowPresentation(
                windowID: window.windowID,
                tmuxWindowID: window.tmuxWindowID,
                index: window.index,
                title: window.title,
                root: layoutRoot(panes, zoomedPaneID: window.zoomedPaneID),
                activePaneID: window.activePaneID,
                zoomedPaneID: window.zoomedPaneID,
                panes: panes
            ))
        }
        return (State(workspaceID: state.workspaceID, tmuxSessionID: state.tmuxSessionID, activeWindowID: state.activeWindowID, windows: windows, generation: state.generation), created)
    }

    static func validate(_ snapshot: SessionSnapshot) throws {
        guard !snapshot.tmuxSessionID.isEmpty, !snapshot.windows.isEmpty else {
            throw PaneGridError.layoutInvalid
        }
        var windowIDs = Set<FenrirWindowID>()
        var paneIDs = Set<PaneID>()
        var tmuxPaneIDs = Set<NativeRuntime.TmuxPaneID>()
        for window in snapshot.windows {
            guard windowIDs.insert(window.windowID).inserted, !window.tmuxWindowID.isEmpty else {
                throw PaneGridError.layoutInvalid
            }
            let openPanes = window.panes.filter { $0.status == .open }
            guard !openPanes.isEmpty else {
                throw PaneGridError.layoutInvalid
            }
            for pane in openPanes {
                guard paneIDs.insert(pane.paneID).inserted,
                      tmuxPaneIDs.insert(pane.tmuxPaneID).inserted,
                      !pane.tmuxPaneID.rawValue.isEmpty,
                      pane.rect.x >= 0,
                      pane.rect.y >= 0,
                      pane.rect.columns > 0,
                      pane.rect.rows > 0
                else {
                    throw PaneGridError.layoutInvalid
                }
            }
        }
    }

    static func project(_ window: WindowSnapshot, viewportIDs: [PaneID: ViewportID]) throws -> WindowPresentation {
        let panes = window.panes
            .filter { $0.status == .open }
            .sorted { lhs, rhs in
                if lhs.rect.y != rhs.rect.y { return lhs.rect.y < rhs.rect.y }
                if lhs.rect.x != rhs.rect.x { return lhs.rect.x < rhs.rect.x }
                return lhs.paneID.rawValue < rhs.paneID.rawValue
            }
        guard let first = panes.first else {
            throw PaneGridError.layoutInvalid
        }
        let openPaneIDs = Set(panes.map(\.paneID))
        let activePaneID = window.activePaneID.flatMap { openPaneIDs.contains($0) ? $0 : nil } ?? first.paneID
        let zoomedPaneID = window.zoomedPaneID.flatMap { openPaneIDs.contains($0) ? $0 : nil }
        let presentations = panes.map { pane in
            PanePresentation(
                paneID: pane.paneID,
                tmuxPaneID: pane.tmuxPaneID,
                streamID: pane.streamID,
                viewportID: viewportIDs[pane.paneID] ?? ViewportID(rawValue: ""),
                title: pane.title,
                rect: pane.rect,
                isFocused: pane.paneID == activePaneID
            )
        }
        return WindowPresentation(
            windowID: window.windowID,
            tmuxWindowID: window.tmuxWindowID,
            index: window.index,
            title: window.title,
            root: layoutRoot(presentations, zoomedPaneID: zoomedPaneID),
            activePaneID: activePaneID,
            zoomedPaneID: zoomedPaneID,
            panes: presentations
        )
    }

    /// Zoom-aware layout root: a zoomed window renders only the zoomed pane
    /// (tmux parity) while the remaining panes stay in the presentation's
    /// pane list so their viewports and streams survive the zoom toggle.
    static func layoutRoot(_ panes: [PanePresentation], zoomedPaneID: PaneID?) -> LayoutNode {
        if let zoomedPaneID, let zoomed = panes.first(where: { $0.paneID == zoomedPaneID }) {
            return .pane(zoomed)
        }
        return buildLayout(panes)
    }

    static func buildLayout(_ panes: [PanePresentation]) -> LayoutNode {
        guard panes.count > 1 else {
            return .pane(panes[0])
        }
        if let partition = PaneGrid.partition(panes) {
            return .split(
                axis: partition.axis,
                children: partition.groups.map { PaneGrid.buildLayout($0) }
            )
        }
        let sameRow = Set(panes.map(\.rect.y)).count == 1
        let axis: SplitAxis = sameRow ? .horizontal : .vertical
        return .split(axis: axis, children: panes.map { .pane($0) })
    }

    private struct PanePartition {
        let axis: SplitAxis
        let groups: [[PanePresentation]]
    }

    private static func partition(_ panes: [PanePresentation]) -> PanePartition? {
        partition(panes, axis: .horizontal) ?? partition(panes, axis: .vertical)
    }

    private static func partition(_ panes: [PanePresentation], axis: SplitAxis) -> PanePartition? {
        let starts = panes.map { axis == .horizontal ? $0.rect.x : $0.rect.y }
        let ends = panes.map { pane in
            axis == .horizontal ? pane.rect.x + pane.rect.columns : pane.rect.y + pane.rect.rows
        }
        guard let minStart = starts.min(), let maxEnd = ends.max(), minStart < maxEnd else {
            return nil
        }
        let candidateCuts = Set(starts + ends)
            .filter { $0 > minStart && $0 < maxEnd }
            .sorted()
        let cuts = candidateCuts.filter { cut in
            panes.allSatisfy { pane in
                let start = axis == .horizontal ? pane.rect.x : pane.rect.y
                let end = axis == .horizontal ? pane.rect.x + pane.rect.columns : pane.rect.y + pane.rect.rows
                return end <= cut || start >= cut
            }
        }
        guard !cuts.isEmpty else {
            return nil
        }
        let boundaries = [minStart] + cuts + [maxEnd]
        let groups = boundaries.dropLast().enumerated().compactMap { index, lower -> [PanePresentation]? in
            let upper = boundaries[index + 1]
            let group = panes
                .filter { pane in
                    let start = axis == .horizontal ? pane.rect.x : pane.rect.y
                    return start >= lower && start < upper
                }
                .sorted(by: PaneGrid.paneVisualOrder)
            return group.isEmpty ? nil : group
        }
        guard groups.count > 1, groups.flatMap({ $0 }).count == panes.count else {
            return nil
        }
        return PanePartition(axis: axis, groups: groups)
    }

    private static func paneVisualOrder(_ lhs: PanePresentation, _ rhs: PanePresentation) -> Bool {
        if lhs.rect.y != rhs.rect.y { return lhs.rect.y < rhs.rect.y }
        if lhs.rect.x != rhs.rect.x { return lhs.rect.x < rhs.rect.x }
        return lhs.paneID.rawValue < rhs.paneID.rawValue
    }
}

extension PaneGrid.State {
    var allViewportIDs: [ViewportID] {
        windows.flatMap(\.panes).map(\.viewportID)
    }

    var viewportIDsByPaneID: [PaneID: ViewportID] {
        Dictionary(uniqueKeysWithValues: windows.flatMap(\.panes).map { ($0.paneID, $0.viewportID) })
    }

    func window(_ windowID: FenrirWindowID) -> PaneGrid.WindowPresentation? {
        windows.first { $0.windowID == windowID }
    }

    func focusing(windowID: FenrirWindowID, paneID: PaneID) throws -> PaneGrid.State {
        guard window(windowID)?.containsPane(paneID) == true else {
            throw PaneGrid.PaneGridError.paneNotFound
        }
        return replacing(windowID: windowID) { window in
            let panes = window.panes.map {
                PaneGrid.PanePresentation(paneID: $0.paneID, tmuxPaneID: $0.tmuxPaneID, streamID: $0.streamID, viewportID: $0.viewportID, title: $0.title, rect: $0.rect, isFocused: $0.paneID == paneID)
            }
            // tmux parity: focusing a different pane of a zoomed window keeps
            // the window zoomed on the newly active pane locally, so focus
            // never lands on an invisible pane; the next server projection
            // reconciles whatever tmux actually did with the zoom.
            let zoomedPaneID = window.zoomedPaneID != nil ? paneID : nil
            return PaneGrid.WindowPresentation(
                windowID: window.windowID,
                tmuxWindowID: window.tmuxWindowID,
                index: window.index,
                title: window.title,
                root: PaneGrid.layoutRoot(panes, zoomedPaneID: zoomedPaneID),
                activePaneID: paneID,
                zoomedPaneID: zoomedPaneID,
                panes: panes
            )
        }
    }

    func selecting(windowID: FenrirWindowID) -> PaneGrid.State {
        PaneGrid.State(workspaceID: workspaceID, tmuxSessionID: tmuxSessionID, activeWindowID: windowID, windows: windows, generation: generation)
    }

    private func replacing(windowID: FenrirWindowID, transform: (PaneGrid.WindowPresentation) -> PaneGrid.WindowPresentation) -> PaneGrid.State {
        PaneGrid.State(
            workspaceID: workspaceID,
            tmuxSessionID: tmuxSessionID,
            activeWindowID: activeWindowID,
            windows: windows.map { $0.windowID == windowID ? transform($0) : $0 },
            generation: generation
        )
    }

    func focusCommand(_ input: PaneGrid.FocusPaneInput) throws -> PaneGrid.FocusPaneCommand {
        PaneGrid.FocusPaneCommand(requestID: input.requestID, target: try target(windowID: input.windowID, paneID: input.paneID), source: input.source)
    }

    func splitCommand(_ input: PaneGrid.SplitPaneInput) throws -> PaneGrid.SplitPaneCommand {
        PaneGrid.SplitPaneCommand(requestID: input.requestID, target: try target(windowID: input.windowID, paneID: input.paneID), axis: input.axis, source: input.source)
    }

    func closeCommand(_ input: PaneGrid.ClosePaneInput) throws -> PaneGrid.ClosePaneCommand {
        PaneGrid.ClosePaneCommand(requestID: input.requestID, target: try target(windowID: input.windowID, paneID: input.paneID), source: input.source)
    }

    func moveCommand(_ input: PaneGrid.MovePaneInput) throws -> PaneGrid.MovePaneCommand {
        guard let destination = window(input.toWindowID) else {
            throw PaneGrid.PaneGridError.paneNotFound
        }
        return PaneGrid.MovePaneCommand(
            requestID: input.requestID,
            target: try target(windowID: input.fromWindowID, paneID: input.paneID),
            destinationWindowID: destination.windowID,
            destinationTmuxWindowID: destination.tmuxWindowID,
            source: input.source
        )
    }

    func resizeCommand(_ input: PaneGrid.ResizePaneAllocationInput) throws -> PaneGrid.ResizePaneAllocationCommand {
        PaneGrid.ResizePaneAllocationCommand(
            requestID: input.requestID,
            target: try target(windowID: input.windowID, paneID: input.allocation.paneID),
            delta: input.allocation.delta,
            unit: input.allocation.unit,
            direction: input.allocation.direction,
            source: input.source
        )
    }

    func selectWindowCommand(_ input: PaneGrid.SelectTabWindowInput) throws -> PaneGrid.SelectTabWindowCommand {
        guard let window = window(input.windowID) else {
            throw PaneGrid.PaneGridError.paneNotFound
        }
        return PaneGrid.SelectTabWindowCommand(requestID: input.requestID, workspaceID: input.workspaceID, windowID: window.windowID, tmuxWindowID: window.tmuxWindowID, source: input.source)
    }

    func target(windowID: FenrirWindowID, paneID: PaneID) throws -> PaneGrid.PaneKernelTarget {
        guard let window = window(windowID), let pane = window.panes.first(where: { $0.paneID == paneID }) else {
            throw PaneGrid.PaneGridError.paneNotFound
        }
        return PaneGrid.PaneKernelTarget(
            workspaceID: workspaceID,
            windowID: window.windowID,
            tmuxWindowID: window.tmuxWindowID,
            paneID: pane.paneID,
            tmuxPaneID: pane.tmuxPaneID
        )
    }
}

extension PaneGrid.WindowPresentation {
    func containsPane(_ paneID: PaneID) -> Bool {
        panes.contains { $0.paneID == paneID }
    }

    func focusTarget(direction: PaneGrid.FocusDirection) -> (from: PaneID, to: PaneID)? {
        guard let current = panes.first(where: \.isFocused) ?? panes.first(where: { $0.paneID == activePaneID }) else {
            return nil
        }
        let candidates = panes.filter { $0.paneID != current.paneID }
        let ranked: [PaneGrid.PanePresentation]
        switch direction {
        case .left:
            ranked = candidates
                .filter { $0.rect.x < current.rect.x }
                .sorted { abs($0.rect.y - current.rect.y) == abs($1.rect.y - current.rect.y) ? $0.rect.x > $1.rect.x : abs($0.rect.y - current.rect.y) < abs($1.rect.y - current.rect.y) }
        case .right:
            ranked = candidates
                .filter { $0.rect.x > current.rect.x }
                .sorted { abs($0.rect.y - current.rect.y) == abs($1.rect.y - current.rect.y) ? $0.rect.x < $1.rect.x : abs($0.rect.y - current.rect.y) < abs($1.rect.y - current.rect.y) }
        case .up:
            ranked = candidates
                .filter { $0.rect.y < current.rect.y }
                .sorted { abs($0.rect.x - current.rect.x) == abs($1.rect.x - current.rect.x) ? $0.rect.y > $1.rect.y : abs($0.rect.x - current.rect.x) < abs($1.rect.x - current.rect.x) }
        case .down:
            ranked = candidates
                .filter { $0.rect.y > current.rect.y }
                .sorted { abs($0.rect.x - current.rect.x) == abs($1.rect.x - current.rect.x) ? $0.rect.y < $1.rect.y : abs($0.rect.x - current.rect.x) < abs($1.rect.x - current.rect.x) }
        }
        guard let target = ranked.first else {
            return nil
        }
        return (current.paneID, target.paneID)
    }
}
