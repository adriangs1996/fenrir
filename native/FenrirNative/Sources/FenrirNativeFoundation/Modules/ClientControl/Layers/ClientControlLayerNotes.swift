import Foundation
import FenrirNativeShared

extension ClientControl {
    enum LayerBoundary {
        static let delivery = "IPC decoding belongs to NativeHost before typed ClientControl actions run."
    }
}
