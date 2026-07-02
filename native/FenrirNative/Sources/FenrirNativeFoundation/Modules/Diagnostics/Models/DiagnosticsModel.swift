import Foundation
import FenrirNativeShared

extension Diagnostics {
    struct DiagnosticsState: Sendable {
        var events: [SafeDiagnosticEvent]

        init(events: [SafeDiagnosticEvent] = []) {
            self.events = events
        }
    }
}
