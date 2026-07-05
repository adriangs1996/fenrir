import Foundation
import Testing
import FenrirNativeShared
import NativeRuntime
@testable import PaneGrid

@Suite("PaneGrid actions")
struct PaneGridTests {
    @Test("CreatePaneGrid projects tmux windows and hosts visible panes")
    func createProjectsWindowSnapshot() async throws {
        let store = GridStore()
        let host = ViewportHost()
        let action = PaneGrid.CreatePaneGrid(store: store, viewportHost: host, clock: PaneGridFixedClock())

        let result = try await action.run(PaneGrid.CreatePaneGridInput(requestID: "create", snapshot: snapshot(), source: .test)).get()

        #expect(result.state.windows.count == 2)
        #expect(result.state.activeWindowID == "window-1")
        #expect(result.state.window("window-1")?.activePaneID == "pane-1")
        #expect(result.state.window("window-1")?.panes.map(\.tmuxPaneID.rawValue) == ["%1", "%2"])
        #expect(result.state.window("window-1")?.panes.map(\.rect) == [
            PaneGrid.PaneRect(x: 0, y: 0, columns: 80, rows: 24),
            PaneGrid.PaneRect(x: 80, y: 0, columns: 80, rows: 24)
        ])
        #expect(await host.created.map(\.paneID) == ["pane-1", "pane-2", "pane-3"])
    }

    @Test("MovePaneFocus resolves directional focus deterministically")
    func moveFocusRight() async throws {
        let store = GridStore()
        let host = ViewportHost()
        let kernel = KernelController()
        let create = PaneGrid.CreatePaneGrid(store: store, viewportHost: host, clock: PaneGridFixedClock())
        _ = try await create.run(PaneGrid.CreatePaneGridInput(requestID: "create", snapshot: snapshot(), source: .test)).get()
        let move = PaneGrid.MovePaneFocus(store: store, kernel: kernel, clock: PaneGridFixedClock())

        let result = try await move.run(PaneGrid.MovePaneFocusInput(requestID: "move", workspaceID: "workspace-1", windowID: "window-1", direction: .right, source: .test)).get()

        #expect(result.fromPaneID == "pane-1")
        #expect(result.toPaneID == "pane-2")
        #expect(result.state.window("window-1")?.activePaneID == "pane-2")
        #expect(await kernel.focuses.map(\.target.tmuxPaneID.rawValue) == ["%2"])
    }

    @Test("CreatePaneGrid projects nested real tmux pane geometry")
    func createProjectsNestedTmuxPaneGeometry() async throws {
        let store = GridStore()
        let host = ViewportHost()
        let action = PaneGrid.CreatePaneGrid(store: store, viewportHost: host, clock: PaneGridFixedClock())

        let result = try await action.run(PaneGrid.CreatePaneGridInput(requestID: "create-nested", snapshot: nestedSnapshot(), source: .test)).get()
        let window = try #require(result.state.window("window-1"))

        #expect(window.panes.map(\.tmuxPaneID.rawValue) == ["%1", "%2", "%3"])
        #expect(window.root == .split(axis: .horizontal, children: [
            .pane(presentation("pane-1", tmuxPaneID: "%1", title: "left", viewportID: "viewport-pane-1", focused: true, x: 0, y: 0, columns: 80, rows: 48)),
            .split(axis: .vertical, children: [
                .pane(presentation("pane-2", tmuxPaneID: "%2", title: "top-right", viewportID: "viewport-pane-2", focused: false, x: 80, y: 0)),
                .pane(presentation("pane-3", tmuxPaneID: "%3", title: "bottom-right", viewportID: "viewport-pane-3", focused: false, x: 80, y: 24))
            ])
        ]))
    }

    @Test("SplitPane emits atomic kernel split request")
    func splitPaneRequestsKernel() async throws {
        let (store, kernel) = try await preparedStoreAndKernel()
        let action = PaneGrid.SplitPane(store: store, kernel: kernel, clock: PaneGridFixedClock())

        let result = try await action.run(PaneGrid.SplitPaneInput(requestID: "split", workspaceID: "workspace-1", windowID: "window-1", paneID: "pane-1", axis: .vertical, source: .test)).get()

        #expect(result.createdPaneID == "pane-new")
        #expect(await kernel.splits.map(\.target.tmuxPaneID.rawValue) == ["%1"])
    }

    @Test("ClosePane and MovePane validate visible panes")
    func closeAndMoveValidateVisiblePanes() async throws {
        let (store, kernel) = try await preparedStoreAndKernel()
        let close = PaneGrid.ClosePane(store: store, kernel: kernel, clock: PaneGridFixedClock())
        let move = PaneGrid.MovePane(store: store, kernel: kernel, clock: PaneGridFixedClock())

        let closed = try await close.run(PaneGrid.ClosePaneInput(requestID: "close", workspaceID: "workspace-1", windowID: "window-1", paneID: "pane-2", source: .test)).get()
        let moved = try await move.run(PaneGrid.MovePaneInput(requestID: "move-pane-valid", workspaceID: "workspace-1", fromWindowID: "window-1", toWindowID: "window-2", paneID: "pane-1", source: .test)).get()
        let missingMove = await move.run(PaneGrid.MovePaneInput(requestID: "move-pane", workspaceID: "workspace-1", fromWindowID: "window-1", toWindowID: "window-2", paneID: "missing", source: .test))

        #expect(closed.paneID == "pane-2")
        #expect(moved.targetWindowID == "window-2")
        #expect(await kernel.closes.map(\.target.tmuxPaneID.rawValue) == ["%2"])
        #expect(await kernel.moves.map(\.target.tmuxPaneID.rawValue) == ["%1"])
        #expect(await kernel.moves.map(\.destinationTmuxWindowID) == ["tmux-window-2"])
        #expect(missingMove == .failure(PaneGrid.PaneGridError.paneNotFound))
    }

    @Test("ResizePaneAllocation and SelectTabWindow produce specific kernel intents")
    func resizeAndSelectWindow() async throws {
        let (store, kernel) = try await preparedStoreAndKernel()
        let resize = PaneGrid.ResizePaneAllocation(store: store, kernel: kernel, clock: PaneGridFixedClock())
        let select = PaneGrid.SelectTabWindow(store: store, kernel: kernel, clock: PaneGridFixedClock())
        let allocation = PaneGrid.PaneResizeAllocation(paneID: "pane-1", delta: 4, unit: .cells, direction: .right)

        let resized = try await resize.run(PaneGrid.ResizePaneAllocationInput(requestID: "resize", workspaceID: "workspace-1", windowID: "window-1", allocation: allocation, source: .test)).get()
        let selected = try await select.run(PaneGrid.SelectTabWindowInput(requestID: "select", workspaceID: "workspace-1", windowID: "window-2", source: .test)).get()

        #expect(resized.allocation == allocation)
        #expect(selected.state.activeWindowID == "window-2")
        #expect(await kernel.resizes.map { PaneGrid.PaneResizeAllocation(paneID: $0.target.paneID, delta: $0.delta, unit: $0.unit, direction: $0.direction) } == [allocation])
        #expect(await kernel.resizes.map(\.target.tmuxPaneID.rawValue) == ["%1"])
        #expect(await kernel.selections.map(\.tmuxWindowID) == ["tmux-window-2"])
    }

    @Test("ReconcileRuntimeLayout disposes stale panes and preserves surviving viewport ids")
    func reconcileDisposesStalePanes() async throws {
        let store = GridStore()
        let host = ViewportHost()
        let create = PaneGrid.CreatePaneGrid(store: store, viewportHost: host, clock: PaneGridFixedClock())
        _ = try await create.run(PaneGrid.CreatePaneGridInput(requestID: "create", snapshot: snapshot(), source: .test)).get()
        let reconcile = PaneGrid.ReconcileRuntimeLayout(store: store, viewportHost: host, clock: PaneGridFixedClock())

        let result = try await reconcile.run(PaneGrid.ReconcileRuntimeLayoutInput(requestID: "reconcile", snapshot: snapshot(pane2Status: .closed), source: .test)).get()

        #expect(result.state.window("window-1")?.panes.map(\.paneID) == ["pane-1"])
        #expect(result.state.window("window-1")?.panes.first?.tmuxPaneID.rawValue == "%1")
        #expect(result.createdViewportIDs.isEmpty)
        #expect(result.disposedViewportIDs == [ViewportID(rawValue: "viewport-pane-2")])
        #expect(await host.disposed == [ViewportID(rawValue: "viewport-pane-2")])
    }

    @Test("ReconcileRuntimeLayout rejects fake or duplicated tmux panes")
    func reconcileRejectsInvalidTmuxPaneIdentity() async {
        let store = GridStore()
        let host = ViewportHost()
        let action = PaneGrid.ReconcileRuntimeLayout(store: store, viewportHost: host, clock: PaneGridFixedClock())
        let invalid = snapshot(pane1TmuxPaneID: "", pane2TmuxPaneID: "%2")
        let duplicate = snapshot(pane1TmuxPaneID: "%same", pane2TmuxPaneID: "%same")

        let missingResult = await action.run(PaneGrid.ReconcileRuntimeLayoutInput(requestID: "missing-tmux-pane", snapshot: invalid, source: .test))
        let duplicateResult = await action.run(PaneGrid.ReconcileRuntimeLayoutInput(requestID: "duplicate-tmux-pane", snapshot: duplicate, source: .test))

        #expect(missingResult == .failure(PaneGrid.PaneGridError.layoutInvalid))
        #expect(duplicateResult == .failure(PaneGrid.PaneGridError.layoutInvalid))
    }

    @Test("ReconcileRuntimeLayout chooses a surviving pane when active pane is stale")
    func reconcileChoosesSurvivingPaneWhenActiveIsStale() async throws {
        let store = GridStore()
        let host = ViewportHost()
        let create = PaneGrid.CreatePaneGrid(store: store, viewportHost: host, clock: PaneGridFixedClock())
        _ = try await create.run(PaneGrid.CreatePaneGridInput(requestID: "create", snapshot: snapshot(), source: .test)).get()
        let reconcile = PaneGrid.ReconcileRuntimeLayout(store: store, viewportHost: host, clock: PaneGridFixedClock())

        let result = try await reconcile.run(
            PaneGrid.ReconcileRuntimeLayoutInput(
                requestID: "reconcile-active",
                snapshot: snapshot(pane1Status: .closed),
                source: .test
            )
        ).get()

        #expect(result.state.window("window-1")?.panes.map(\.paneID) == ["pane-2"])
        #expect(result.state.window("window-1")?.activePaneID == "pane-2")
        #expect(result.state.window("window-1")?.panes.first?.isFocused == true)
        #expect(result.disposedViewportIDs == [ViewportID(rawValue: "viewport-pane-1")])
    }

    @Test("Zoomed windows render only the zoomed pane while keeping every viewport alive")
    func zoomedWindowRendersOnlyZoomedPane() async throws {
        let store = GridStore()
        let host = ViewportHost()
        let create = PaneGrid.CreatePaneGrid(store: store, viewportHost: host, clock: PaneGridFixedClock())
        _ = try await create.run(PaneGrid.CreatePaneGridInput(requestID: "create", snapshot: snapshot(), source: .test)).get()
        let reconcile = PaneGrid.ReconcileRuntimeLayout(store: store, viewportHost: host, clock: PaneGridFixedClock())

        let zoomed = try await reconcile.run(PaneGrid.ReconcileRuntimeLayoutInput(
            requestID: "reconcile-zoom",
            snapshot: snapshot(window1ZoomedPaneID: "pane-1"),
            source: .test
        )).get()
        let window = try #require(zoomed.state.window("window-1"))

        // tmux zoom parity: the layout renders ONLY the zoomed pane…
        #expect(window.zoomedPaneID == "pane-1")
        if case let .pane(pane) = window.root {
            #expect(pane.paneID == "pane-1")
        } else {
            Issue.record("Expected the zoomed window root to be the zoomed pane, got \(window.root)")
        }
        // …while the hidden pane stays in the pane set with its viewport
        // alive (no dispose), so content and streams survive the toggle.
        #expect(window.panes.map(\.paneID) == ["pane-1", "pane-2"])
        #expect(zoomed.disposedViewportIDs.isEmpty)
        #expect(await host.disposed.isEmpty)

        let unzoomed = try await reconcile.run(PaneGrid.ReconcileRuntimeLayoutInput(
            requestID: "reconcile-unzoom",
            snapshot: snapshot(),
            source: .test
        )).get()
        let restored = try #require(unzoomed.state.window("window-1"))
        #expect(restored.zoomedPaneID == nil)
        if case .split = restored.root {
        } else {
            Issue.record("Expected the unzoomed window to restore its split, got \(restored.root)")
        }
        #expect(restored.panes.map(\.viewportID) == ["viewport-pane-1", "viewport-pane-2"])
    }

    @Test("Focusing another pane of a zoomed window transfers the zoom rendering")
    func focusingTransfersZoomRendering() async throws {
        let store = GridStore()
        let host = ViewportHost()
        let kernel = KernelController()
        let create = PaneGrid.CreatePaneGrid(store: store, viewportHost: host, clock: PaneGridFixedClock())
        _ = try await create.run(PaneGrid.CreatePaneGridInput(
            requestID: "create",
            snapshot: snapshot(window1ZoomedPaneID: "pane-1"),
            source: .test
        )).get()
        let focus = PaneGrid.FocusPane(store: store, kernel: kernel, clock: PaneGridFixedClock())

        let result = try await focus.run(PaneGrid.FocusPaneInput(
            requestID: "focus-zoomed",
            workspaceID: "workspace-1",
            windowID: "window-1",
            paneID: "pane-2",
            source: .test
        )).get()
        let window = try #require(result.state.window("window-1"))

        // Focus must never land on an invisible pane: the zoom rendering
        // follows the newly focused pane until the next server projection.
        #expect(window.activePaneID == "pane-2")
        #expect(window.zoomedPaneID == "pane-2")
        if case let .pane(pane) = window.root {
            #expect(pane.paneID == "pane-2")
        } else {
            Issue.record("Expected zoom rendering to follow focus, got \(window.root)")
        }
    }

    @Test("ReconcileRuntimeLayout maps invalid snapshots to layout failure")
    func reconcileMapsInvalidLayoutFailure() async {
        let store = GridStore()
        let host = ViewportHost()
        let action = PaneGrid.ReconcileRuntimeLayout(store: store, viewportHost: host, clock: PaneGridFixedClock())
        let invalid = PaneGrid.SessionSnapshot(
            workspaceID: "workspace-1",
            tmuxSessionID: "tmux-session-1",
            activeWindowID: "window-1",
            windows: [
                PaneGrid.WindowSnapshot(windowID: "window-1", tmuxWindowID: "tmux-window-1", index: 0, title: "one", activePaneID: nil, panes: [])
            ]
        )

        let result = await action.run(PaneGrid.ReconcileRuntimeLayoutInput(requestID: "bad", snapshot: invalid, source: .test))

        #expect(result == .failure(PaneGrid.PaneGridError.layoutInvalid))
    }
}

private func preparedStoreAndKernel() async throws -> (GridStore, KernelController) {
    let store = GridStore()
    let host = ViewportHost()
    let kernel = KernelController()
    let create = PaneGrid.CreatePaneGrid(store: store, viewportHost: host, clock: PaneGridFixedClock())
    _ = try await create.run(PaneGrid.CreatePaneGridInput(requestID: "create", snapshot: snapshot(), source: .test)).get()
    return (store, kernel)
}

private func snapshot(
    pane1Status: PaneGrid.PaneLifecycleStatus = .open,
    pane2Status: PaneGrid.PaneLifecycleStatus = .open,
    pane1TmuxPaneID: String = "%1",
    pane2TmuxPaneID: String = "%2",
    window1ZoomedPaneID: PaneID? = nil
) -> PaneGrid.SessionSnapshot {
    PaneGrid.SessionSnapshot(
        workspaceID: "workspace-1",
        tmuxSessionID: "tmux-session-1",
        activeWindowID: "window-1",
        windows: [
            PaneGrid.WindowSnapshot(
                windowID: "window-1",
                tmuxWindowID: "tmux-window-1",
                index: 0,
                title: "one",
                activePaneID: "pane-1",
                zoomedPaneID: window1ZoomedPaneID,
                panes: [
                    PaneGrid.PaneSnapshot(paneID: "pane-1", tmuxPaneID: .init(rawValue: pane1TmuxPaneID), title: "left", rect: PaneGrid.PaneRect(x: 0, y: 0, columns: 80, rows: 24), status: pane1Status),
                    PaneGrid.PaneSnapshot(paneID: "pane-2", tmuxPaneID: .init(rawValue: pane2TmuxPaneID), title: "right", rect: PaneGrid.PaneRect(x: 80, y: 0, columns: 80, rows: 24), status: pane2Status)
                ]
            ),
            PaneGrid.WindowSnapshot(
                windowID: "window-2",
                tmuxWindowID: "tmux-window-2",
                index: 1,
                title: "two",
                activePaneID: "pane-3",
                panes: [
                    PaneGrid.PaneSnapshot(paneID: "pane-3", tmuxPaneID: "%3", title: "solo", rect: PaneGrid.PaneRect(x: 0, y: 0, columns: 160, rows: 48))
                ]
            )
        ]
    )
}

private func nestedSnapshot() -> PaneGrid.SessionSnapshot {
    PaneGrid.SessionSnapshot(
        workspaceID: "workspace-1",
        tmuxSessionID: "tmux-session-1",
        activeWindowID: "window-1",
        windows: [
            PaneGrid.WindowSnapshot(
                windowID: "window-1",
                tmuxWindowID: "tmux-window-1",
                index: 0,
                title: "nested",
                activePaneID: "pane-1",
                panes: [
                    PaneGrid.PaneSnapshot(paneID: "pane-1", tmuxPaneID: "%1", title: "left", rect: PaneGrid.PaneRect(x: 0, y: 0, columns: 80, rows: 48)),
                    PaneGrid.PaneSnapshot(paneID: "pane-2", tmuxPaneID: "%2", title: "top-right", rect: PaneGrid.PaneRect(x: 80, y: 0, columns: 80, rows: 24)),
                    PaneGrid.PaneSnapshot(paneID: "pane-3", tmuxPaneID: "%3", title: "bottom-right", rect: PaneGrid.PaneRect(x: 80, y: 24, columns: 80, rows: 24))
                ]
            )
        ]
    )
}

private func presentation(
    _ paneID: PaneID,
    tmuxPaneID: String,
    title: String?,
    viewportID: ViewportID,
    focused: Bool,
    x: Int,
    y: Int,
    columns: Int = 80,
    rows: Int = 24
) -> PaneGrid.PanePresentation {
    PaneGrid.PanePresentation(
        paneID: paneID,
        tmuxPaneID: NativeRuntime.TmuxPaneID(rawValue: tmuxPaneID),
        viewportID: viewportID,
        title: title,
        rect: PaneGrid.PaneRect(x: x, y: y, columns: columns, rows: rows),
        isFocused: focused
    )
}

private struct PaneGridFixedClock: PaneGrid.PaneGridClock {
    func now() -> FenrirTimestamp {
        FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_000))
    }
}

private actor GridStore: PaneGrid.PaneGridStore {
    private var states: [WorkspaceID: PaneGrid.State] = [:]

    func loadGrid(workspaceID: WorkspaceID) async throws -> PaneGrid.State? {
        states[workspaceID]
    }

    func saveGrid(_ state: PaneGrid.State) async throws {
        states[state.workspaceID] = state
    }

    func deleteGrid(workspaceID: WorkspaceID) async throws {
        states[workspaceID] = nil
    }
}

private actor ViewportHost: PaneGrid.PaneViewportHosting {
    private(set) var created: [(workspaceID: WorkspaceID, windowID: FenrirWindowID, paneID: PaneID)] = []
    private(set) var disposed: [ViewportID] = []

    func createViewport(workspaceID: WorkspaceID, windowID: FenrirWindowID, paneID: PaneID) async throws -> ViewportID {
        created.append((workspaceID, windowID, paneID))
        return ViewportID(rawValue: "viewport-\(paneID.rawValue)")
    }

    func disposeViewport(viewportID: ViewportID) async throws {
        disposed.append(viewportID)
    }
}

private actor KernelController: PaneGrid.PaneKernelControlling {
    private(set) var focuses: [PaneGrid.FocusPaneCommand] = []
    private(set) var splits: [PaneGrid.SplitPaneCommand] = []
    private(set) var closes: [PaneGrid.ClosePaneCommand] = []
    private(set) var moves: [PaneGrid.MovePaneCommand] = []
    private(set) var resizes: [PaneGrid.ResizePaneAllocationCommand] = []
    private(set) var selections: [PaneGrid.SelectTabWindowCommand] = []

    func focusPane(_ command: PaneGrid.FocusPaneCommand) async throws {
        focuses.append(command)
    }

    func splitPane(_ command: PaneGrid.SplitPaneCommand) async throws -> PaneID {
        splits.append(command)
        return "pane-new"
    }

    func closePane(_ command: PaneGrid.ClosePaneCommand) async throws {
        closes.append(command)
    }

    func movePane(_ command: PaneGrid.MovePaneCommand) async throws {
        moves.append(command)
    }

    func resizePaneAllocation(_ command: PaneGrid.ResizePaneAllocationCommand) async throws {
        resizes.append(command)
    }

    func selectWindow(_ command: PaneGrid.SelectTabWindowCommand) async throws {
        selections.append(command)
    }
}
