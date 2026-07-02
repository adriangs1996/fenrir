import Foundation
import FenrirNativeShared

extension Diagnostics {
    actor InMemoryDiagnosticsStore: DiagnosticsStore {
        private var state = DiagnosticsState()

        func record(_ event: SafeDiagnosticEvent) async throws {
            state.events.append(event)
        }

        func list(workspaceID: WorkspaceID?) async throws -> [SafeDiagnosticEvent] {
            guard let workspaceID else {
                return state.events
            }

            return state.events.filter { $0.workspaceID == nil || $0.workspaceID == workspaceID }
        }
    }
}
