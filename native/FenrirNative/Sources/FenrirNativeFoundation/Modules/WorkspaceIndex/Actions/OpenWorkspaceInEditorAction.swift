import Foundation
import FenrirNativeShared

public extension WorkspaceIndex {
    /// Opens a workspace path in a catalogued target (D-045). The chosen
    /// target id comes from the caller — this module never reads Settings.
    ///
    /// `$EDITOR` targets are never launched here: the action succeeds with
    /// `.routeToTerminalPane`, and the shell-integration agent must run the
    /// resolved command inside a real tmux pane (D-019).
    struct OpenWorkspaceInEditor: FenrirAction {
        public typealias Failure = EditorTargetError

        let resolver: EditorTargetResolver
        let launcher: any EditorTargetLaunching
        let clock: any WorkspaceIndexClock

        public init(resolver: EditorTargetResolver, launcher: any EditorTargetLaunching, clock: any WorkspaceIndexClock) {
            self.resolver = resolver
            self.launcher = launcher
            self.clock = clock
        }

        public func run(_ input: OpenWorkspaceInEditorInput) async -> Result<OpenWorkspaceInEditorResult, EditorTargetError> {
            guard let target = resolver.target(withID: input.targetID) else {
                return .failure(.unknownTarget)
            }
            guard resolver.workspacePathExists(input.workspacePath) else {
                return .failure(.invalidWorkspacePath)
            }
            guard resolver.isInstalled(target) else {
                return .failure(.targetNotInstalled)
            }
            switch resolver.resolveLaunch(for: target, workspacePath: input.workspacePath) {
            case .failure(let error):
                return .failure(error)
            case .success(.terminalPaneCommand(let command)):
                return .success(result(input, disposition: .routeToTerminalPane(command)))
            case .success(.application(let applicationURL, let arguments)):
                do {
                    try await launcher.openApplication(at: applicationURL, arguments: arguments)
                } catch {
                    return .failure(.launchFailed)
                }
                return .success(result(input, disposition: .opened))
            case .success(.process(let executablePath, let arguments)):
                do {
                    try await launcher.launchProcess(executablePath: executablePath, arguments: arguments)
                } catch {
                    return .failure(.launchFailed)
                }
                return .success(result(input, disposition: .opened))
            }
        }

        private func result(_ input: OpenWorkspaceInEditorInput, disposition: EditorOpenDisposition) -> OpenWorkspaceInEditorResult {
            OpenWorkspaceInEditorResult(
                requestID: input.requestID,
                targetID: input.targetID,
                disposition: disposition,
                timestamp: clock.now()
            )
        }
    }
}
