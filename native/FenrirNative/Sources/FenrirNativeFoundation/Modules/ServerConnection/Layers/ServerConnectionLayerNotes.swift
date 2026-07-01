import Foundation
import FenrirNativeShared

extension ServerConnection {
    enum LayerBoundary {
        static let processSupervision = "Local server process supervision belongs to NativeHost, not ServerConnection."
    }
}
