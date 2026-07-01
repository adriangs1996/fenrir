import Foundation
import FenrirNativeShared

extension PaneGrid {
    protocol PaneGridClock: Sendable {
        func now() -> FenrirTimestamp
    }

    protocol PaneGridStore: Sendable {
        func loadGrid(workspaceID: WorkspaceID) async throws -> State?
        func saveGrid(_ state: State) async throws
        func deleteGrid(workspaceID: WorkspaceID) async throws
    }

    protocol PaneLayoutProjecting: Sendable {
        func project(_ snapshot: SessionSnapshot, existing: State?) async throws -> State
    }

    protocol PaneViewportHosting: Sendable {
        func createViewport(workspaceID: WorkspaceID, windowID: FenrirWindowID, paneID: PaneID) async throws -> ViewportID
        func disposeViewport(viewportID: ViewportID) async throws
    }

    protocol PaneKernelControlling: Sendable {
        func focusPane(_ input: FocusPaneInput) async throws
        func splitPane(_ input: SplitPaneInput) async throws -> PaneID
        func closePane(_ input: ClosePaneInput) async throws
        func movePane(_ input: MovePaneInput) async throws
        func resizePaneAllocation(_ input: ResizePaneAllocationInput) async throws
        func selectWindow(_ input: SelectTabWindowInput) async throws
    }

    protocol PaneGridEventPublishing: Sendable {
        func publish(_ event: EventEnvelope<Event>) async
    }
}
