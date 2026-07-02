import Foundation
import Testing
import FenrirNativeShared
import PaneGrid

@Suite("PaneGrid public API")
struct PaneGridPublicAPITests {
    @Test("Actions and service ports are constructible from normal imports")
    func actionsAndPortsAreConstructibleFromNormalImports() {
        let store = PublicPaneGridStore()
        let host = PublicPaneViewportHost()
        let kernel = PublicPaneKernel()
        let clock = PublicPaneGridClock()
        let projector = PublicPaneLayoutProjector()

        _ = PaneGrid.CreatePaneGrid(store: store, viewportHost: host, clock: clock)
        _ = PaneGrid.CreatePaneGrid(store: store, projector: projector, viewportHost: host, clock: clock)
        _ = PaneGrid.DisposePaneGrid(store: store, viewportHost: host, clock: clock)
        _ = PaneGrid.ReconcileRuntimeLayout(store: store, viewportHost: host, clock: clock)
        _ = PaneGrid.ReconcileRuntimeLayout(store: store, projector: projector, viewportHost: host, clock: clock)
        _ = PaneGrid.FocusPane(store: store, kernel: kernel, clock: clock)
        _ = PaneGrid.MovePaneFocus(store: store, kernel: kernel, clock: clock)
        _ = PaneGrid.SplitPane(store: store, kernel: kernel, clock: clock)
        _ = PaneGrid.ClosePane(store: store, kernel: kernel, clock: clock)
        _ = PaneGrid.MovePane(store: store, kernel: kernel, clock: clock)
        _ = PaneGrid.ResizePaneAllocation(store: store, kernel: kernel, clock: clock)
        _ = PaneGrid.SelectTabWindow(store: store, kernel: kernel, clock: clock)
    }
}

private struct PublicPaneGridClock: PaneGrid.PaneGridClock {
    func now() -> FenrirTimestamp {
        FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_000))
    }
}

private struct PublicPaneLayoutProjector: PaneGrid.PaneLayoutProjecting {
    func project(_ snapshot: PaneGrid.SessionSnapshot, existing: PaneGrid.State?) async throws -> PaneGrid.State {
        throw PaneGrid.PaneGridError.layoutInvalid
    }
}

private actor PublicPaneGridStore: PaneGrid.PaneGridStore {
    func loadGrid(workspaceID: WorkspaceID) async throws -> PaneGrid.State? {
        nil
    }

    func saveGrid(_ state: PaneGrid.State) async throws {}

    func deleteGrid(workspaceID: WorkspaceID) async throws {}
}

private actor PublicPaneViewportHost: PaneGrid.PaneViewportHosting {
    func createViewport(workspaceID: WorkspaceID, windowID: FenrirWindowID, paneID: PaneID) async throws -> ViewportID {
        ViewportID(rawValue: "viewport-\(paneID.rawValue)")
    }

    func disposeViewport(viewportID: ViewportID) async throws {}
}

private actor PublicPaneKernel: PaneGrid.PaneKernelControlling {
    func focusPane(_ command: PaneGrid.FocusPaneCommand) async throws {}

    func splitPane(_ command: PaneGrid.SplitPaneCommand) async throws -> PaneID {
        command.target.paneID
    }

    func closePane(_ command: PaneGrid.ClosePaneCommand) async throws {}

    func movePane(_ command: PaneGrid.MovePaneCommand) async throws {}

    func resizePaneAllocation(_ command: PaneGrid.ResizePaneAllocationCommand) async throws {}

    func selectWindow(_ command: PaneGrid.SelectTabWindowCommand) async throws {}
}
