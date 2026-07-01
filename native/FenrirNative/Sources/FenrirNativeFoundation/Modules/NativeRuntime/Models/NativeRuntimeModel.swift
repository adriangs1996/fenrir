import Foundation
import FenrirNativeShared

extension NativeRuntime {
    struct NativeRuntimeModel: Sendable {
        var paneStreams: [PaneID: PaneStreamState]
    }
}
