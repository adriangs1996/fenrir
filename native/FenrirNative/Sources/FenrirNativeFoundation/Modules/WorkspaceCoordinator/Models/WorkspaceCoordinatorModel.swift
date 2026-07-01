import Foundation
import FenrirNativeShared

extension WorkspaceCoordinator {
    struct WorkspaceActionPlan: Sendable {
        var shouldOpenWindow: Bool
        var shouldAttachRuntime: Bool
    }
}
