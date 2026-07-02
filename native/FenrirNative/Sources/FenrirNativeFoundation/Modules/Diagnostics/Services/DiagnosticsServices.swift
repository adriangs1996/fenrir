import Foundation
import FenrirNativeShared
import WorkspaceOverlays

public extension Diagnostics {
    protocol DiagnosticsClock: Sendable {
        func now() -> FenrirTimestamp
    }

    protocol DiagnosticsStore: Sendable {
        func record(_ event: SafeDiagnosticEvent) async throws
        func list(workspaceID: WorkspaceID?) async throws -> [SafeDiagnosticEvent]
    }

    protocol DiagnosticsRedactor: Sendable {
        func safeEvent(from event: DiagnosticEvent, policy: DiagnosticsPolicy) -> SafeDiagnosticEvent
    }

    static func inMemoryDiagnosticsStore() -> any DiagnosticsStore {
        InMemoryDiagnosticsStore()
    }

    static func supportBundleRedactor() -> any DiagnosticsRedactor {
        SupportBundleRedactor()
    }

    static func paletteProvider() -> any WorkspaceOverlays.PaletteSearchProvider {
        DiagnosticsPaletteProvider()
    }
}
