import Foundation
import FenrirNativeShared
@testable import AuthSession
@testable import ServerConnection
@testable import NativeRuntime
@testable import TerminalViewport
@testable import WorkspaceIndex
@testable import WorkspaceShell
@testable import WorkspaceCoordinator

struct FixedClock:
    AuthSession.AuthSessionClock,
    ServerConnection.ServerConnectionClock,
    NativeRuntime.NativeRuntimeClock,
    TerminalViewport.TerminalViewportClock,
    WorkspaceIndex.WorkspaceIndexClock,
    WorkspaceShell.WorkspaceShellClock,
    WorkspaceCoordinator.WorkspaceCoordinatorClock
{
    let timestamp: FenrirTimestamp

    init(timestamp: FenrirTimestamp = FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_000))) {
        self.timestamp = timestamp
    }

    func now() -> FenrirTimestamp {
        timestamp
    }
}
