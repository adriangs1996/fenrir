import Foundation
import FenrirNativeShared
@testable import AuthSession
@testable import ServerConnection
@testable import NativeRuntime
@testable import TerminalViewport
@testable import WorkspaceIndex
@testable import WorkspaceShell
@testable import WorkspaceCoordinator
import Settings
import Keybinding
import Notifications
import WorkspaceOverlays
import AgentInteraction
import WorkflowControl
import Diagnostics
import NativeDistribution
import NeovimBridge

struct FixedClock:
    AuthSession.AuthSessionClock,
    ServerConnection.ServerConnectionClock,
    NativeRuntime.NativeRuntimeClock,
    TerminalViewport.TerminalViewportClock,
    WorkspaceIndex.WorkspaceIndexClock,
    WorkspaceShell.WorkspaceShellClock,
    WorkspaceCoordinator.WorkspaceCoordinatorClock,
    Settings.SettingsClock,
    Keybinding.KeybindingClock,
    Notifications.NotificationsClock,
    WorkspaceOverlays.WorkspaceOverlaysClock,
    AgentInteraction.AgentInteractionClock,
    WorkflowControl.WorkflowControlClock,
    Diagnostics.DiagnosticsClock,
    NativeDistribution.NativeDistributionClock,
    NeovimBridge.NeovimBridgeClock
{
    let timestamp: FenrirTimestamp

    init(timestamp: FenrirTimestamp = FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_000))) {
        self.timestamp = timestamp
    }

    func now() -> FenrirTimestamp {
        timestamp
    }
}
