import AppKit
import Foundation
import FenrirNativeShared

public extension WorkspaceIndex {
    /// NSWorkspace-backed application lookup.
    struct SystemEditorApplicationLocator: EditorApplicationLocating {
        public init() {}

        public func applicationURL(forBundleIdentifier bundleIdentifier: String) -> URL? {
            NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleIdentifier)
        }
    }

    /// FileManager-backed filesystem probe.
    struct SystemEditorFileChecker: EditorFileChecking {
        public init() {}

        public func fileExists(atPath path: String) -> Bool {
            FileManager.default.fileExists(atPath: path)
        }
    }

    /// ProcessInfo-backed environment lookup.
    struct SystemEditorEnvironment: EditorEnvironmentReading {
        public init() {}

        public func environmentValue(forKey key: String) -> String? {
            ProcessInfo.processInfo.environment[key]
        }
    }

    /// Production launcher: opens paths via NSWorkspace or spawns detached
    /// helper processes (editor CLIs, JetBrains Toolbox scripts). `$EDITOR`
    /// never reaches this launcher — `OpenWorkspaceInEditor` returns a
    /// `routeToTerminalPane` marker for it instead.
    struct SystemEditorTargetLauncher: EditorTargetLaunching {
        public init() {}

        public func openApplication(at applicationURL: URL, arguments: [String]) async throws {
            let itemURLs = arguments.map { URL(fileURLWithPath: $0) }
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = true
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
                NSWorkspace.shared.open(itemURLs, withApplicationAt: applicationURL, configuration: configuration) { _, error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else {
                        continuation.resume()
                    }
                }
            }
        }

        public func launchProcess(executablePath: String, arguments: [String]) async throws {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: executablePath)
            process.arguments = arguments
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            try process.run()
        }
    }

    /// Convenience factory wiring the system adapters into a resolver.
    static func systemEditorTargetResolver(catalog: [EditorTarget] = EditorTargetCatalog.all) -> EditorTargetResolver {
        EditorTargetResolver(
            catalog: catalog,
            applicationLocator: SystemEditorApplicationLocator(),
            fileChecker: SystemEditorFileChecker(),
            environment: SystemEditorEnvironment()
        )
    }
}
