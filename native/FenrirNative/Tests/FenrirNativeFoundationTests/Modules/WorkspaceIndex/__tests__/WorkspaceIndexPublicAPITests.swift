import Foundation
import Testing
import FenrirNativeShared
import WorkspaceIndex

@Suite("WorkspaceIndex public API")
struct WorkspaceIndexPublicAPITests {
    @Test("Sidebar projection action and service ports are constructible from normal imports")
    func sidebarProjectionIsAvailableThroughPublicSurface() {
        let store = PublicWorkspaceIndexStore()
        let server = PublicWorkspaceServerListing()
        let clock = PublicWorkspaceIndexClock()

        let action = WorkspaceIndex.ProjectWorkspaceSidebar(store: store, serverListing: server, clock: clock)

        #expect(String(describing: type(of: action)).contains("ProjectWorkspaceSidebar"))
    }
}

private struct PublicWorkspaceIndexClock: WorkspaceIndex.WorkspaceIndexClock {
    func now() -> FenrirTimestamp {
        FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_000))
    }
}

private actor PublicWorkspaceIndexStore: WorkspaceIndex.WorkspaceIndexStore {
    func loadIndex() async throws -> WorkspaceIndex.WorkspaceIndexSnapshot {
        WorkspaceIndex.WorkspaceIndexSnapshot(workspaces: [], capturedAt: PublicWorkspaceIndexClock().now())
    }

    func saveIndex(_ snapshot: WorkspaceIndex.WorkspaceIndexSnapshot) async throws {}
}

private struct PublicWorkspaceServerListing: WorkspaceIndex.WorkspaceServerListing {
    func listServerWorkspaces() async throws -> [WorkspaceIndex.WorkspaceSummary] {
        []
    }
}
