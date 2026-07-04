import Foundation
import FenrirNativeShared

public extension WorkspaceIndex {
    /// Resolves the static `EditorTargetCatalog` against the local machine:
    /// filters to installed targets and materializes launch plans into
    /// concrete app URLs, executable paths, and argument strings. All
    /// filesystem, application, and environment lookups go through
    /// injectable ports so tests run against a fake filesystem.
    struct EditorTargetResolver: Sendable {
        public let catalog: [EditorTarget]
        public let toolboxScriptsDirectory: String

        let applicationLocator: any EditorApplicationLocating
        let fileChecker: any EditorFileChecking
        let environment: any EditorEnvironmentReading

        public init(
            catalog: [EditorTarget] = EditorTargetCatalog.all,
            applicationLocator: any EditorApplicationLocating,
            fileChecker: any EditorFileChecking,
            environment: any EditorEnvironmentReading,
            toolboxScriptsDirectory: String = EditorTargetCatalog.defaultToolboxScriptsDirectory
        ) {
            self.catalog = catalog
            self.applicationLocator = applicationLocator
            self.fileChecker = fileChecker
            self.environment = environment
            self.toolboxScriptsDirectory = toolboxScriptsDirectory
        }

        public func target(withID id: EditorTargetID) -> EditorTarget? {
            catalog.first { $0.id == id }
        }

        public func installedTargets() -> [EditorTarget] {
            catalog.filter(isInstalled)
        }

        public func isInstalled(_ target: EditorTarget) -> Bool {
            if target.detection.isAlwaysInstalled {
                return true
            }
            if target.detection.bundleIdentifiers.contains(where: { applicationLocator.applicationURL(forBundleIdentifier: $0) != nil }) {
                return true
            }
            if target.detection.applicationPaths.contains(where: fileChecker.fileExists) {
                return true
            }
            if target.detection.toolboxScriptNames.contains(where: { fileChecker.fileExists(atPath: toolboxScriptPath($0)) }) {
                return true
            }
            if let variable = target.detection.environmentVariable {
                return environmentEditorWords(variable) != nil
            }
            return false
        }

        public func workspacePathExists(_ path: String) -> Bool {
            !path.isEmpty && fileChecker.fileExists(atPath: path)
        }

        /// Picks the first viable launch plan and materializes it. Returns
        /// `.terminalPaneCommand` for `$EDITOR`-style targets — the caller
        /// must route that command into a real tmux pane instead of
        /// launching it locally.
        public func resolveLaunch(for target: EditorTarget, workspacePath: String) -> Result<ResolvedEditorLaunch, EditorTargetError> {
            for plan in target.launchPlans {
                switch plan {
                case .environmentEditor:
                    let variable = target.detection.environmentVariable ?? EditorTargetCatalog.environmentEditorVariable
                    guard let words = environmentEditorWords(variable) else { continue }
                    return .success(.terminalPaneCommand(EnvironmentEditorCommand(
                        executable: words[0],
                        arguments: Array(words.dropFirst()) + [workspacePath]
                    )))
                case .application(let arguments):
                    guard let applicationURL = applicationURL(for: target) else { continue }
                    return .success(.application(
                        applicationURL: applicationURL,
                        arguments: resolve(arguments, appPath: applicationURL.path, workspacePath: workspacePath)
                    ))
                case .process(let executable, let arguments):
                    guard let executablePath = resolveExecutablePath(executable, for: target) else { continue }
                    let appPath = applicationURL(for: target)?.path ?? executablePath
                    return .success(.process(
                        executablePath: executablePath,
                        arguments: resolve(arguments, appPath: appPath, workspacePath: workspacePath)
                    ))
                }
            }
            return .failure(.launchPlanUnavailable)
        }

        // MARK: Internals

        func applicationURL(for target: EditorTarget) -> URL? {
            for bundleIdentifier in target.detection.bundleIdentifiers {
                if let url = applicationLocator.applicationURL(forBundleIdentifier: bundleIdentifier) {
                    return url
                }
            }
            for path in target.detection.applicationPaths where fileChecker.fileExists(atPath: path) {
                return URL(fileURLWithPath: path)
            }
            return nil
        }

        func resolveExecutablePath(_ executable: EditorProcessExecutable, for target: EditorTarget) -> String? {
            switch executable {
            case .path(let path):
                return fileChecker.fileExists(atPath: path) ? path : nil
            case .appRelativePath(let relativePath):
                guard let applicationURL = applicationURL(for: target) else { return nil }
                let path = applicationURL.appendingPathComponent(relativePath).path
                return fileChecker.fileExists(atPath: path) ? path : nil
            case .toolboxScript(let scriptName):
                let path = toolboxScriptPath(scriptName)
                return fileChecker.fileExists(atPath: path) ? path : nil
            }
        }

        func toolboxScriptPath(_ scriptName: String) -> String {
            (toolboxScriptsDirectory as NSString).appendingPathComponent(scriptName)
        }

        func resolve(_ arguments: [EditorLaunchArgument], appPath: String, workspacePath: String) -> [String] {
            arguments.map { argument in
                switch argument {
                case .literal(let value):
                    return value
                case .appPath:
                    return appPath
                case .targetPath:
                    return workspacePath
                }
            }
        }

        func environmentEditorWords(_ variable: String) -> [String]? {
            guard let value = environment.environmentValue(forKey: variable) else { return nil }
            let words = value.split(whereSeparator: \.isWhitespace).map(String.init)
            return words.isEmpty ? nil : words
        }
    }
}
