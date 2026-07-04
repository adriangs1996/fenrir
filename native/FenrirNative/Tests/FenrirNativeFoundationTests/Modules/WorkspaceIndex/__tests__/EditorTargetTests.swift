import Foundation
import Testing
import FenrirNativeShared
@testable import WorkspaceIndex

@Suite("EditorTarget catalogue")
struct EditorTargetTests {
    private static let toolboxDirectory = "/fake-home/Library/Application Support/JetBrains/Toolbox/scripts"

    @Test("Catalogue covers every required target kind and id")
    func catalogCoversRequiredTargets() {
        let ids = Set(WorkspaceIndex.EditorTargetCatalog.all.map(\.id.rawValue))
        let required: Set<String> = [
            "vscode", "vscode-insiders", "vscodium", "cursor", "windsurf", "zed", "xcode",
            "intellij", "webstorm", "pycharm", "goland", "rustrover", "clion",
            "ghostty", "kitty", "alacritty", "wezterm", "warp", "terminal", "iterm2",
            "fork", "gitkraken", "sourcetree", "tower",
            "finder", "editor",
        ]
        #expect(required.subtracting(ids).isEmpty)
        #expect(ids.count == WorkspaceIndex.EditorTargetCatalog.all.count)
        #expect(WorkspaceIndex.EditorTargetCatalog.target(withID: "finder")?.kind == .finder)
        #expect(WorkspaceIndex.EditorTargetCatalog.target(withID: "editor")?.kind == .environmentEditor)
        #expect(WorkspaceIndex.EditorTargetCatalog.target(withID: "ghostty")?.kind == .terminal)
        #expect(WorkspaceIndex.EditorTargetCatalog.target(withID: "fork")?.kind == .gitClient)
    }

    @Test("Resolver filters the catalogue to installed targets against a fake filesystem")
    func detectionFiltersToInstalledTargets() {
        let resolver = resolver(
            installedApps: [
                "com.microsoft.VSCode": "/Applications/Visual Studio Code.app",
                "com.mitchellh.ghostty": "/Applications/Ghostty.app",
            ],
            existingPaths: [
                "/Applications/RustRover.app",
                "\(Self.toolboxDirectory)/webstorm",
            ],
            environment: ["EDITOR": "nvim"]
        )

        let installed = Set(resolver.installedTargets().map(\.id.rawValue))

        #expect(installed == ["vscode", "ghostty", "rustrover", "webstorm", "finder", "editor"])
    }

    @Test("$EDITOR is not offered when the environment variable is unset or blank")
    func environmentEditorRequiresEnvironmentValue() {
        let unset = resolver(environment: [:])
        let blank = resolver(environment: ["EDITOR": "   "])

        #expect(!unset.installedTargets().map(\.id.rawValue).contains("editor"))
        #expect(!blank.installedTargets().map(\.id.rawValue).contains("editor"))
    }

    @Test("Application targets open via the app URL with the workspace path argument")
    func applicationTargetsOpenWithWorkspacePath() async throws {
        let launcher = LaunchRecorder()
        let action = openAction(
            launcher: launcher,
            installedApps: [
                "com.microsoft.VSCode": "/Applications/Visual Studio Code.app",
                "com.apple.finder": "/System/Library/CoreServices/Finder.app",
            ],
            existingPaths: ["/repo/demo"]
        )

        let vscode = try await action.run(input(target: "vscode")).get()
        let finder = try await action.run(input(target: "finder")).get()

        #expect(vscode.disposition == .opened)
        #expect(finder.disposition == .opened)
        #expect(await launcher.launches == [
            .application(URL(fileURLWithPath: "/Applications/Visual Studio Code.app"), ["/repo/demo"]),
            .application(URL(fileURLWithPath: "/System/Library/CoreServices/Finder.app"), ["/repo/demo"]),
        ])
    }

    @Test("Zed prefers its bundled CLI process and falls back to app open")
    func zedPrefersBundledCLI() async throws {
        let cliPath = "/Applications/Zed.app/Contents/MacOS/cli"
        let withCLI = LaunchRecorder()
        let withoutCLI = LaunchRecorder()
        let cliAction = openAction(
            launcher: withCLI,
            installedApps: ["dev.zed.Zed": "/Applications/Zed.app"],
            existingPaths: ["/repo/demo", cliPath]
        )
        let fallbackAction = openAction(
            launcher: withoutCLI,
            installedApps: ["dev.zed.Zed": "/Applications/Zed.app"],
            existingPaths: ["/repo/demo"]
        )

        _ = try await cliAction.run(input(target: "zed")).get()
        _ = try await fallbackAction.run(input(target: "zed")).get()

        #expect(await withCLI.launches == [.process(cliPath, ["/repo/demo"])])
        #expect(await withoutCLI.launches == [.application(URL(fileURLWithPath: "/Applications/Zed.app"), ["/repo/demo"])])
    }

    @Test("JetBrains targets launch through Toolbox scripts when present")
    func jetBrainsUsesToolboxScript() async throws {
        let launcher = LaunchRecorder()
        let action = openAction(
            launcher: launcher,
            existingPaths: ["/repo/demo", "\(Self.toolboxDirectory)/goland"]
        )

        let result = try await action.run(input(target: "goland")).get()

        #expect(result.disposition == .opened)
        #expect(await launcher.launches == [.process("\(Self.toolboxDirectory)/goland", ["/repo/demo"])])
    }

    @Test("JetBrains targets fall back to the /Applications bundle without Toolbox")
    func jetBrainsFallsBackToApplicationBundle() async throws {
        let launcher = LaunchRecorder()
        let action = openAction(
            launcher: launcher,
            existingPaths: ["/repo/demo", "/Applications/CLion.app"]
        )

        _ = try await action.run(input(target: "clion")).get()

        #expect(await launcher.launches == [.application(URL(fileURLWithPath: "/Applications/CLion.app"), ["/repo/demo"])])
    }

    @Test("$EDITOR returns a route-to-pane marker and never launches locally")
    func environmentEditorReturnsPaneMarker() async throws {
        let launcher = LaunchRecorder()
        let action = openAction(
            launcher: launcher,
            existingPaths: ["/repo/demo"],
            environment: ["EDITOR": "nvim -u NONE"]
        )

        let result = try await action.run(input(target: "editor")).get()

        #expect(result.disposition == .routeToTerminalPane(WorkspaceIndex.EnvironmentEditorCommand(
            executable: "nvim",
            arguments: ["-u", "NONE", "/repo/demo"]
        )))
        #expect(await launcher.launches.isEmpty)
    }

    @Test("Unknown target ids are rejected")
    func unknownTargetIsRejected() async {
        let action = openAction(launcher: LaunchRecorder(), existingPaths: ["/repo/demo"])

        let result = await action.run(input(target: "sublime-text"))

        #expect(result == .failure(WorkspaceIndex.EditorTargetError.unknownTarget))
    }

    @Test("Targets that are not installed fail closed")
    func uninstalledTargetFailsClosed() async {
        let action = openAction(launcher: LaunchRecorder(), existingPaths: ["/repo/demo"])

        let result = await action.run(input(target: "cursor"))

        #expect(result == .failure(WorkspaceIndex.EditorTargetError.targetNotInstalled))
    }

    @Test("Missing workspace paths are rejected before any launch")
    func missingWorkspacePathIsRejected() async {
        let launcher = LaunchRecorder()
        let action = openAction(
            launcher: launcher,
            installedApps: ["com.microsoft.VSCode": "/Applications/Visual Studio Code.app"]
        )

        let missing = await action.run(input(target: "vscode", path: "/repo/missing"))
        let empty = await action.run(input(target: "vscode", path: ""))

        #expect(missing == .failure(WorkspaceIndex.EditorTargetError.invalidWorkspacePath))
        #expect(empty == .failure(WorkspaceIndex.EditorTargetError.invalidWorkspacePath))
        #expect(await launcher.launches.isEmpty)
    }

    @Test("Launcher failures map to launchFailed")
    func launcherFailureMapsToLaunchFailed() async {
        let action = openAction(
            launcher: FailingLauncher(),
            installedApps: ["com.microsoft.VSCode": "/Applications/Visual Studio Code.app"],
            existingPaths: ["/repo/demo"]
        )

        let result = await action.run(input(target: "vscode"))

        #expect(result == .failure(WorkspaceIndex.EditorTargetError.launchFailed))
    }

    // MARK: Helpers

    private func resolver(
        installedApps: [String: String] = [:],
        existingPaths: Set<String> = [],
        environment: [String: String] = [:]
    ) -> WorkspaceIndex.EditorTargetResolver {
        WorkspaceIndex.EditorTargetResolver(
            applicationLocator: FakeApplicationLocator(installedApps: installedApps),
            fileChecker: FakeFileChecker(existingPaths: existingPaths),
            environment: FakeEnvironment(values: environment),
            toolboxScriptsDirectory: Self.toolboxDirectory
        )
    }

    private func openAction(
        launcher: any WorkspaceIndex.EditorTargetLaunching,
        installedApps: [String: String] = [:],
        existingPaths: Set<String> = [],
        environment: [String: String] = [:]
    ) -> WorkspaceIndex.OpenWorkspaceInEditor {
        WorkspaceIndex.OpenWorkspaceInEditor(
            resolver: resolver(installedApps: installedApps, existingPaths: existingPaths, environment: environment),
            launcher: launcher,
            clock: EditorFixedClock()
        )
    }

    private func input(target: WorkspaceIndex.EditorTargetID, path: String = "/repo/demo") -> WorkspaceIndex.OpenWorkspaceInEditorInput {
        WorkspaceIndex.OpenWorkspaceInEditorInput(requestID: RequestID(rawValue: "open-\(target.rawValue)"), targetID: target, workspacePath: path, source: .test)
    }
}

private struct EditorFixedClock: WorkspaceIndex.WorkspaceIndexClock {
    func now() -> FenrirTimestamp {
        FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_000))
    }
}

private struct FakeApplicationLocator: WorkspaceIndex.EditorApplicationLocating {
    let installedApps: [String: String]

    func applicationURL(forBundleIdentifier bundleIdentifier: String) -> URL? {
        installedApps[bundleIdentifier].map { URL(fileURLWithPath: $0) }
    }
}

private struct FakeFileChecker: WorkspaceIndex.EditorFileChecking {
    let existingPaths: Set<String>

    func fileExists(atPath path: String) -> Bool {
        existingPaths.contains(path)
    }
}

private struct FakeEnvironment: WorkspaceIndex.EditorEnvironmentReading {
    let values: [String: String]

    func environmentValue(forKey key: String) -> String? {
        values[key]
    }
}

private actor LaunchRecorder: WorkspaceIndex.EditorTargetLaunching {
    enum Launch: Equatable {
        case application(URL, [String])
        case process(String, [String])
    }

    private(set) var launches: [Launch] = []

    func openApplication(at applicationURL: URL, arguments: [String]) async throws {
        launches.append(.application(applicationURL, arguments))
    }

    func launchProcess(executablePath: String, arguments: [String]) async throws {
        launches.append(.process(executablePath, arguments))
    }
}

private struct FailingLauncher: WorkspaceIndex.EditorTargetLaunching {
    struct LaunchRefused: Error {}

    func openApplication(at applicationURL: URL, arguments: [String]) async throws {
        throw LaunchRefused()
    }

    func launchProcess(executablePath: String, arguments: [String]) async throws {
        throw LaunchRefused()
    }
}
