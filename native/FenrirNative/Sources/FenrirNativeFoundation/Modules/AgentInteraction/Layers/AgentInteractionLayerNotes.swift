import Foundation
import FenrirNativeShared

extension AgentInteraction {
    enum LayerBoundary {
        static let serverAdapters = "Live agent adapters use ServerConnection behind service ports and are not public API."
    }
}
