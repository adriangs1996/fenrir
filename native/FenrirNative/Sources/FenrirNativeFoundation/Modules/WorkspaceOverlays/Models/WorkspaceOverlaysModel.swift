import Foundation
import FenrirNativeShared

extension WorkspaceOverlays {
    struct WorkspaceOverlaysState: Codable, Equatable, Sendable {
        var overlaysByWorkspace: [WorkspaceID: [OverlayRecord]]

        init(overlaysByWorkspace: [WorkspaceID: [OverlayRecord]] = [:]) {
            self.overlaysByWorkspace = overlaysByWorkspace
        }
    }

    static func stack(for workspaceID: WorkspaceID, in state: WorkspaceOverlaysState) -> WorkspaceOverlayStack {
        let overlays = state.overlaysByWorkspace[workspaceID] ?? []
        return WorkspaceOverlayStack(
            workspaceID: workspaceID,
            overlays: overlays,
            focusedOverlayID: overlays.last?.id
        )
    }

    static func opening(
        descriptor: OverlayDescriptor,
        workspaceID: WorkspaceID,
        timestamp: FenrirTimestamp,
        in state: WorkspaceOverlaysState
    ) -> (state: WorkspaceOverlaysState, overlay: OverlayRecord, stack: WorkspaceOverlayStack) {
        var state = state
        var overlays = state.overlaysByWorkspace[workspaceID] ?? []

        if let existingIndex = overlays.firstIndex(where: { $0.descriptor.kind == descriptor.kind }) {
            let existing = overlays.remove(at: existingIndex)
            let overlay = OverlayRecord(
                id: existing.id,
                workspaceID: workspaceID,
                descriptor: descriptor,
                openedAt: existing.openedAt,
                focusedAt: timestamp
            )
            overlays = removingModalConflicts(for: descriptor, from: overlays)
            overlays.append(overlay)
            state.overlaysByWorkspace[workspaceID] = overlays
            return (state, overlay, stack(for: workspaceID, in: state))
        }

        let overlay = OverlayRecord(
            id: .generated(),
            workspaceID: workspaceID,
            descriptor: descriptor,
            openedAt: timestamp,
            focusedAt: timestamp
        )
        overlays = removingModalConflicts(for: descriptor, from: overlays)
        overlays.append(overlay)
        state.overlaysByWorkspace[workspaceID] = overlays
        return (state, overlay, stack(for: workspaceID, in: state))
    }

    static func closing(
        workspaceID: WorkspaceID,
        overlayID: OverlayID?,
        kind: OverlayKind?,
        in state: WorkspaceOverlaysState
    ) -> (state: WorkspaceOverlaysState, closed: OverlayRecord?, stack: WorkspaceOverlayStack) {
        var state = state
        var overlays = state.overlaysByWorkspace[workspaceID] ?? []

        let closeIndex: Int?
        if let overlayID {
            closeIndex = overlays.lastIndex { $0.id == overlayID }
        } else if let kind {
            closeIndex = overlays.lastIndex { $0.descriptor.kind == kind }
        } else {
            closeIndex = overlays.indices.last
        }

        guard let closeIndex else {
            state.overlaysByWorkspace[workspaceID] = overlays
            return (state, nil, stack(for: workspaceID, in: state))
        }

        let closed = overlays.remove(at: closeIndex)
        state.overlaysByWorkspace[workspaceID] = overlays
        return (state, closed, stack(for: workspaceID, in: state))
    }

    static func toggling(
        descriptor: OverlayDescriptor,
        workspaceID: WorkspaceID,
        timestamp: FenrirTimestamp,
        in state: WorkspaceOverlaysState
    ) -> (state: WorkspaceOverlaysState, opened: OverlayRecord?, closed: OverlayRecord?, stack: WorkspaceOverlayStack) {
        let overlays = state.overlaysByWorkspace[workspaceID] ?? []
        if overlays.contains(where: { $0.descriptor.kind == descriptor.kind }) {
            let result = closing(workspaceID: workspaceID, overlayID: nil, kind: descriptor.kind, in: state)
            return (result.state, nil, result.closed, result.stack)
        }

        let result = opening(descriptor: descriptor, workspaceID: workspaceID, timestamp: timestamp, in: state)
        return (result.state, result.overlay, nil, result.stack)
    }

    private static func removingModalConflicts(
        for descriptor: OverlayDescriptor,
        from overlays: [OverlayRecord]
    ) -> [OverlayRecord] {
        guard descriptor.presentation == .modal else {
            return overlays
        }

        return overlays.filter { $0.descriptor.presentation != .modal }
    }
}
