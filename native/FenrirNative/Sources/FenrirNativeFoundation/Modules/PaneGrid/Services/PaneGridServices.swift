import Foundation
import FenrirNativeShared

public extension PaneGrid {
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
        func focusPane(_ command: FocusPaneCommand) async throws
        func splitPane(_ command: SplitPaneCommand) async throws -> PaneID
        func closePane(_ command: ClosePaneCommand) async throws
        func movePane(_ command: MovePaneCommand) async throws
        func resizePaneAllocation(_ command: ResizePaneAllocationCommand) async throws
        func selectWindow(_ command: SelectTabWindowCommand) async throws
    }

    protocol PaneGridEventPublishing: Sendable {
        func publish(_ event: EventEnvelope<Event>) async
    }
}
