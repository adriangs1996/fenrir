import Foundation
import FenrirNativeShared

extension WorkflowControl {
    enum LayerBoundary {
        static let serverAdapters = "Live workflow adapters use ServerConnection behind service ports and are not public API."
    }
}
