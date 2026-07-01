import Foundation
import FenrirNativeShared

extension TerminalViewport {
    struct TerminalViewportModel: Sendable {
        var states: [ViewportID: State]
    }
}
