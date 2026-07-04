import Foundation
import FenrirNativeShared

public extension WorkspaceIndex {
    /// Looks up installed applications by bundle identifier
    /// (NSWorkspace-backed in production, fakeable in tests).
    protocol EditorApplicationLocating: Sendable {
        func applicationURL(forBundleIdentifier bundleIdentifier: String) -> URL?
    }

    /// Filesystem existence probe (FileManager-backed in production,
    /// fakeable in tests).
    protocol EditorFileChecking: Sendable {
        func fileExists(atPath path: String) -> Bool
    }

    /// Environment lookup used to resolve `$EDITOR`.
    protocol EditorEnvironmentReading: Sendable {
        func environmentValue(forKey key: String) -> String?
    }

    /// Launcher port for `OpenWorkspaceInEditor` so tests can fake the
    /// actual open/spawn side effects.
    protocol EditorTargetLaunching: Sendable {
        /// Opens `arguments` (filesystem paths) with the application at
        /// `applicationURL` via the OS open service.
        func openApplication(at applicationURL: URL, arguments: [String]) async throws
        /// Spawns a detached helper process (editor CLIs, JetBrains Toolbox
        /// scripts). Never used for `$EDITOR`, which must run in a tmux pane.
        func launchProcess(executablePath: String, arguments: [String]) async throws
    }
}
