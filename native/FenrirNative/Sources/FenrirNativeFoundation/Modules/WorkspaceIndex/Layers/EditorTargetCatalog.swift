import Foundation
import FenrirNativeShared

public extension WorkspaceIndex {
    /// Static catalogue of openable targets for a workspace path (D-045).
    /// Ordered for menu display: editors, Xcode, Finder, terminals, git
    /// clients, then `$EDITOR`. Detection state is resolved separately by
    /// `EditorTargetResolver`; this list never touches the filesystem.
    enum EditorTargetCatalog {
        public static let environmentEditorVariable = "EDITOR"

        public static var defaultToolboxScriptsDirectory: String {
            (NSHomeDirectory() as NSString).appendingPathComponent("Library/Application Support/JetBrains/Toolbox/scripts")
        }

        public static let all: [EditorTarget] =
            editors + [xcode, finder] + terminals + gitClients + [environmentEditor]

        public static func target(withID id: EditorTargetID) -> EditorTarget? {
            all.first { $0.id == id }
        }

        // MARK: Editors

        public static let editors: [EditorTarget] = [
            application("vscode", "VS Code", .editor, bundleIdentifiers: ["com.microsoft.VSCode"]),
            application("vscode-insiders", "VS Code Insiders", .editor, bundleIdentifiers: ["com.microsoft.VSCodeInsiders"]),
            application("vscodium", "VSCodium", .editor, bundleIdentifiers: ["com.vscodium"]),
            application("cursor", "Cursor", .editor, bundleIdentifiers: ["com.todesktop.230313mzl4w4u92"]),
            application("windsurf", "Windsurf", .editor, bundleIdentifiers: ["com.exafunction.windsurf"]),
            EditorTarget(
                id: "zed",
                displayName: "Zed",
                kind: .editor,
                detection: EditorTargetDetection(bundleIdentifiers: ["dev.zed.Zed"]),
                launchPlans: [
                    .process(executable: .appRelativePath("Contents/MacOS/cli"), arguments: [.targetPath]),
                    .application(arguments: [.targetPath]),
                ]
            ),
            jetBrains("intellij", "IntelliJ IDEA", bundleIdentifier: "com.jetbrains.intellij", applicationName: "IntelliJ IDEA", toolboxScript: "idea"),
            jetBrains("webstorm", "WebStorm", bundleIdentifier: "com.jetbrains.WebStorm", applicationName: "WebStorm", toolboxScript: "webstorm"),
            jetBrains("pycharm", "PyCharm", bundleIdentifier: "com.jetbrains.pycharm", applicationName: "PyCharm", toolboxScript: "pycharm"),
            jetBrains("goland", "GoLand", bundleIdentifier: "com.jetbrains.goland", applicationName: "GoLand", toolboxScript: "goland"),
            jetBrains("rustrover", "RustRover", bundleIdentifier: "com.jetbrains.rustrover", applicationName: "RustRover", toolboxScript: "rustrover"),
            jetBrains("clion", "CLion", bundleIdentifier: "com.jetbrains.CLion", applicationName: "CLion", toolboxScript: "clion"),
        ]

        public static let xcode = application("xcode", "Xcode", .editor, bundleIdentifiers: ["com.apple.dt.Xcode"])

        // MARK: Terminals

        public static let terminals: [EditorTarget] = [
            application("ghostty", "Ghostty", .terminal, bundleIdentifiers: ["com.mitchellh.ghostty"]),
            application("kitty", "kitty", .terminal, bundleIdentifiers: ["net.kovidgoyal.kitty"]),
            application("alacritty", "Alacritty", .terminal, bundleIdentifiers: ["org.alacritty"]),
            application("wezterm", "WezTerm", .terminal, bundleIdentifiers: ["com.github.wez.wezterm"]),
            application("warp", "Warp", .terminal, bundleIdentifiers: ["dev.warp.Warp-Stable"]),
            application("terminal", "Terminal", .terminal, bundleIdentifiers: ["com.apple.Terminal"]),
            application("iterm2", "iTerm2", .terminal, bundleIdentifiers: ["com.googlecode.iterm2"]),
        ]

        // MARK: Git clients

        public static let gitClients: [EditorTarget] = [
            application("fork", "Fork", .gitClient, bundleIdentifiers: ["com.DanPristupov.Fork"]),
            application("gitkraken", "GitKraken", .gitClient, bundleIdentifiers: ["com.axosoft.gitkraken"]),
            application("sourcetree", "Sourcetree", .gitClient, bundleIdentifiers: ["com.torusknot.SourceTreeNotMAS"]),
            application("tower", "Tower", .gitClient, bundleIdentifiers: ["com.fournova.Tower3", "com.fournova.Tower2"]),
        ]

        // MARK: Finder

        public static let finder = EditorTarget(
            id: "finder",
            displayName: "Finder",
            kind: .finder,
            detection: EditorTargetDetection(bundleIdentifiers: ["com.apple.finder"], isAlwaysInstalled: true),
            launchPlans: [.application(arguments: [.targetPath])]
        )

        // MARK: $EDITOR

        /// Marker target: resolves the command from the `EDITOR` environment
        /// variable but never launches it here. The shell agent must route
        /// the resolved command into a real tmux pane (D-019).
        public static let environmentEditor = EditorTarget(
            id: "editor",
            displayName: "$EDITOR",
            kind: .environmentEditor,
            detection: EditorTargetDetection(environmentVariable: environmentEditorVariable),
            launchPlans: [.environmentEditor]
        )

        // MARK: Builders

        private static func application(
            _ id: EditorTargetID,
            _ displayName: String,
            _ kind: EditorTargetKind,
            bundleIdentifiers: [String]
        ) -> EditorTarget {
            EditorTarget(
                id: id,
                displayName: displayName,
                kind: kind,
                detection: EditorTargetDetection(bundleIdentifiers: bundleIdentifiers),
                launchPlans: [.application(arguments: [.targetPath])]
            )
        }

        private static func jetBrains(
            _ id: EditorTargetID,
            _ displayName: String,
            bundleIdentifier: String,
            applicationName: String,
            toolboxScript: String
        ) -> EditorTarget {
            EditorTarget(
                id: id,
                displayName: displayName,
                kind: .editor,
                detection: EditorTargetDetection(
                    bundleIdentifiers: [bundleIdentifier],
                    applicationPaths: ["/Applications/\(applicationName).app"],
                    toolboxScriptNames: [toolboxScript]
                ),
                launchPlans: [
                    .process(executable: .toolboxScript(toolboxScript), arguments: [.targetPath]),
                    .application(arguments: [.targetPath]),
                ]
            )
        }
    }
}
