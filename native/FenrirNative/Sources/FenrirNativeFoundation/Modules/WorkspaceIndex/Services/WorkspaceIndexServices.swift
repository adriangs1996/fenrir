import Foundation
import FenrirNativeShared

public extension WorkspaceIndex {
    protocol WorkspaceIndexClock: Sendable {
        func now() -> FenrirTimestamp
    }

    protocol WorkspaceIndexStore: Sendable {
        func loadIndex() async throws -> WorkspaceIndexSnapshot
        func saveIndex(_ snapshot: WorkspaceIndexSnapshot) async throws
    }

    protocol WorkspaceServerListing: Sendable {
        func listServerWorkspaces() async throws -> [WorkspaceSummary]
    }

    protocol WorkspaceIndexEventPublishing: Sendable {
        func publish(_ event: EventEnvelope<Event>) async
    }
}
