import Foundation
import FenrirNativeShared

extension WorkspaceOverlays {
    actor InMemoryOverlayStore: OverlayStore {
        private var state: WorkspaceOverlaysState

        init(initialState: WorkspaceOverlaysState = WorkspaceOverlaysState()) {
            self.state = initialState
        }

        func openOverlay(
            descriptor: OverlayDescriptor,
            workspaceID: WorkspaceID,
            timestamp: FenrirTimestamp
        ) async throws -> (overlay: OverlayRecord, stack: WorkspaceOverlayStack) {
            let opened = WorkspaceOverlays.opening(
                descriptor: descriptor,
                workspaceID: workspaceID,
                timestamp: timestamp,
                in: state
            )
            state = opened.state
            return (opened.overlay, opened.stack)
        }

        func closeOverlay(
            workspaceID: WorkspaceID,
            overlayID: OverlayID?,
            kind: OverlayKind?
        ) async throws -> (closed: OverlayRecord?, stack: WorkspaceOverlayStack) {
            let closed = WorkspaceOverlays.closing(
                workspaceID: workspaceID,
                overlayID: overlayID,
                kind: kind,
                in: state
            )
            state = closed.state
            return (closed.closed, closed.stack)
        }

        func toggleOverlay(
            descriptor: OverlayDescriptor,
            workspaceID: WorkspaceID,
            timestamp: FenrirTimestamp
        ) async throws -> (opened: OverlayRecord?, closed: OverlayRecord?, stack: WorkspaceOverlayStack) {
            let toggled = WorkspaceOverlays.toggling(
                descriptor: descriptor,
                workspaceID: workspaceID,
                timestamp: timestamp,
                in: state
            )
            state = toggled.state
            return (toggled.opened, toggled.closed, toggled.stack)
        }

        func listOverlays(workspaceID: WorkspaceID) async throws -> WorkspaceOverlayStack {
            WorkspaceOverlays.stack(for: workspaceID, in: state)
        }
    }
}
