import Foundation
import FenrirNativeShared

extension WorkspaceShell {
    enum LayerBoundary {
        static let appKit = "AppKit owns the primary shell composition in live layers only."
    }
}
