import Foundation
import Testing
import FenrirNativeShared
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
        #expect(await kernel.focuses.map(\.paneID) == ["pane-2"])
    }

    @Test("SplitPane emits atomic kernel split request")
    func splitPaneRequestsKernel() async throws {
        let (store, kernel) = try await preparedStoreAndKernel()
        let action = PaneGrid.SplitPane(store: store, kernel: kernel, clock: PaneGridFixedClock())

        let result = try await action.run(PaneGrid.SplitPaneInput(requestID: "split", workspaceID: "workspace-1", windowID: "window-1", paneID: "pane-1", axis: .vertical, source: .test)).get()

        #expect(result.createdPaneID == "pane-new")
        #expect(await kernel.splits.map(\.paneID) == ["pane-1"])
    }

    @Test("ClosePane and MovePane validate visible panes")
    func closeAndMoveValidateVisiblePanes() async throws {
        let (store, kernel) = try await preparedStoreAndKernel()
        let close = PaneGrid.ClosePane(store: store, kernel: kernel, clock: PaneGridFixedClock())
        let move = PaneGrid.MovePane(store: store, kernel: kernel, clock: PaneGridFixedClock())

        let closed = try await close.run(PaneGrid.ClosePaneInput(requestID: "close", workspaceID: "workspace-1", windowID: "window-1", paneID: "pane-2", source: .test)).get()
        let missingMove = await move.run(PaneGrid.MovePaneInput(requestID: "move-pane", workspaceID: "workspace-1", fromWindowID: "window-1", toWindowID: "window-2", paneID: "missing", source: .test))

        #expect(closed.paneID == "pane-2")
        #expect(await kernel.closes.map(\.paneID) == ["pane-2"])
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
        #expect(await kernel.resizes.map(\.allocation) == [allocation])
        #expect(await kernel.selections.map(\.windowID) == ["window-2"])
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
        #expect(result.createdViewportIDs.isEmpty)
        #expect(result.disposedViewportIDs == [ViewportID(rawValue: "viewport-pane-2")])
        #expect(await host.disposed == [ViewportID(rawValue: "viewport-pane-2")])
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
    pane2Status: PaneGrid.PaneLifecycleStatus = .open
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
                panes: [
                    PaneGrid.PaneSnapshot(paneID: "pane-1", title: "left", rect: PaneGrid.PaneRect(x: 0, y: 0, columns: 80, rows: 24), status: pane1Status),
                    PaneGrid.PaneSnapshot(paneID: "pane-2", title: "right", rect: PaneGrid.PaneRect(x: 80, y: 0, columns: 80, rows: 24), status: pane2Status)
                ]
            ),
            PaneGrid.WindowSnapshot(
                windowID: "window-2",
                tmuxWindowID: "tmux-window-2",
                index: 1,
                title: "two",
                activePaneID: "pane-3",
                panes: [
                    PaneGrid.PaneSnapshot(paneID: "pane-3", title: "solo", rect: PaneGrid.PaneRect(x: 0, y: 0, columns: 160, rows: 48))
                ]
            )
        ]
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
    private(set) var focuses: [PaneGrid.FocusPaneInput] = []
    private(set) var splits: [PaneGrid.SplitPaneInput] = []
    private(set) var closes: [PaneGrid.ClosePaneInput] = []
    private(set) var moves: [PaneGrid.MovePaneInput] = []
    private(set) var resizes: [PaneGrid.ResizePaneAllocationInput] = []
    private(set) var selections: [PaneGrid.SelectTabWindowInput] = []

    func focusPane(_ input: PaneGrid.FocusPaneInput) async throws {
        focuses.append(input)
    }

    func splitPane(_ input: PaneGrid.SplitPaneInput) async throws -> PaneID {
        splits.append(input)
        return "pane-new"
    }

    func closePane(_ input: PaneGrid.ClosePaneInput) async throws {
        closes.append(input)
    }

    func movePane(_ input: PaneGrid.MovePaneInput) async throws {
        moves.append(input)
    }

    func resizePaneAllocation(_ input: PaneGrid.ResizePaneAllocationInput) async throws {
        resizes.append(input)
    }

    func selectWindow(_ input: PaneGrid.SelectTabWindowInput) async throws {
        selections.append(input)
    }
}
