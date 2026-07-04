import Foundation
import FenrirNativeShared

public extension WorkspaceIndex {
    /// Stable identifier for an openable target. Persisted by callers (for
    /// example Settings default-editor preferences); this module never reads
    /// Settings itself — the chosen default id always comes from the caller.
    struct EditorTargetID: FenrirID, ExpressibleByStringLiteral {
        public let rawValue: String

        public init(rawValue: String) {
            self.rawValue = rawValue
        }

        public init(stringLiteral value: String) {
            self.init(rawValue: value)
        }
    }

    enum EditorTargetKind: String, Codable, Equatable, Sendable, CaseIterable {
        case editor
        case terminal
        case gitClient
        case finder
        case environmentEditor
    }

    /// Typed launch argument, resolved against the concrete app URL and the
    /// workspace path at open time.
    enum EditorLaunchArgument: Codable, Equatable, Sendable {
        case literal(String)
        case appPath
        case targetPath
    }

    /// Executable source for process-based launches.
    enum EditorProcessExecutable: Codable, Equatable, Sendable {
        case path(String)
        case appRelativePath(String)
        case toolboxScript(String)
    }

    /// One way a target can be opened. Targets carry an ordered list of
    /// plans; the resolver picks the first viable one.
    ///
    /// `environmentEditor` is a marker case: `$EDITOR` is a terminal program
    /// and must run inside a real tmux pane (D-019 — no client-local fake
    /// panes). The shell-integration agent must route the resolved
    /// `EnvironmentEditorCommand` to a server-owned pane; this module never
    /// spawns it.
    enum EditorTargetLaunchPlan: Codable, Equatable, Sendable {
        case application(arguments: [EditorLaunchArgument])
        case process(executable: EditorProcessExecutable, arguments: [EditorLaunchArgument])
        case environmentEditor
    }

    /// Declarative installation probes for a target. A target counts as
    /// installed when any probe succeeds.
    struct EditorTargetDetection: Codable, Equatable, Sendable {
        public let bundleIdentifiers: [String]
        public let applicationPaths: [String]
        public let toolboxScriptNames: [String]
        public let environmentVariable: String?
        public let isAlwaysInstalled: Bool

        public init(
            bundleIdentifiers: [String] = [],
            applicationPaths: [String] = [],
            toolboxScriptNames: [String] = [],
            environmentVariable: String? = nil,
            isAlwaysInstalled: Bool = false
        ) {
            self.bundleIdentifiers = bundleIdentifiers
            self.applicationPaths = applicationPaths
            self.toolboxScriptNames = toolboxScriptNames
            self.environmentVariable = environmentVariable
            self.isAlwaysInstalled = isAlwaysInstalled
        }
    }

    /// Catalogue entry describing an openable target for a workspace path.
    struct EditorTarget: Codable, Equatable, Identifiable, Sendable {
        public let id: EditorTargetID
        public let displayName: String
        public let kind: EditorTargetKind
        public let detection: EditorTargetDetection
        public let launchPlans: [EditorTargetLaunchPlan]

        public init(
            id: EditorTargetID,
            displayName: String,
            kind: EditorTargetKind,
            detection: EditorTargetDetection,
            launchPlans: [EditorTargetLaunchPlan]
        ) {
            self.id = id
            self.displayName = displayName
            self.kind = kind
            self.detection = detection
            self.launchPlans = launchPlans
        }
    }

    /// Fully resolved `$EDITOR` invocation. Never launched by this module —
    /// the shell agent must execute it inside a real tmux pane.
    struct EnvironmentEditorCommand: Codable, Equatable, Sendable {
        public let executable: String
        public let arguments: [String]

        public init(executable: String, arguments: [String]) {
            self.executable = executable
            self.arguments = arguments
        }
    }

    /// A launch plan resolved against the installed filesystem: concrete app
    /// URL / executable path plus fully materialized argument strings.
    enum ResolvedEditorLaunch: Codable, Equatable, Sendable {
        case application(applicationURL: URL, arguments: [String])
        case process(executablePath: String, arguments: [String])
        case terminalPaneCommand(EnvironmentEditorCommand)
    }

    /// What actually happened when opening a workspace in a target.
    enum EditorOpenDisposition: Codable, Equatable, Sendable {
        case opened
        /// Marker for `$EDITOR`: the caller (shell agent) must route this
        /// command into a real tmux pane; nothing was launched locally.
        case routeToTerminalPane(EnvironmentEditorCommand)
    }

    enum EditorTargetError: String, Error, Codable, Equatable, Sendable {
        case unknownTarget = "EditorTargetUnknown"
        case targetNotInstalled = "EditorTargetNotInstalled"
        case invalidWorkspacePath = "EditorTargetInvalidWorkspacePath"
        case launchPlanUnavailable = "EditorTargetLaunchPlanUnavailable"
        case launchFailed = "EditorTargetLaunchFailed"
    }

    struct OpenWorkspaceInEditorInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let targetID: EditorTargetID
        public let workspacePath: String
        public let source: ActionSource

        public init(requestID: RequestID, targetID: EditorTargetID, workspacePath: String, source: ActionSource) {
            self.requestID = requestID
            self.targetID = targetID
            self.workspacePath = workspacePath
            self.source = source
        }
    }

    struct OpenWorkspaceInEditorResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let targetID: EditorTargetID
        public let disposition: EditorOpenDisposition
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, targetID: EditorTargetID, disposition: EditorOpenDisposition, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.targetID = targetID
            self.disposition = disposition
            self.timestamp = timestamp
        }
    }
}
