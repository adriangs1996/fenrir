import Foundation
import FenrirNativeShared

extension WorkspaceIndex {
    struct PersistedWorkspaceIndex: Sendable {
        var workspaces: [WorkspaceID: WorkspaceSummary]
    }
}
