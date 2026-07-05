import Foundation
import FenrirNativeShared

public extension Settings {
    static let currentSchemaVersion = 4

    enum SettingsError: Error, Codable, Equatable, Sendable {
        case unavailable
        case malformedConfig(String)
        case validationFailed([SettingsValidationIssue])
        case persistenceFailed(String)
        case encodingFailed(String)
        case decodingFailed(String)
    }

    struct ModuleSummary: Codable, Equatable, Sendable {
        public let moduleName: String
        public let registeredAt: FenrirTimestamp

        public init(moduleName: String = "Settings", registeredAt: FenrirTimestamp) {
            self.moduleName = moduleName
            self.registeredAt = registeredAt
        }
    }

    struct DescribeSettingsModuleInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let source: ActionSource

        public init(requestID: RequestID, source: ActionSource) {
            self.requestID = requestID
            self.source = source
        }
    }

    struct DescribeSettingsModuleResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let summary: ModuleSummary
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, summary: ModuleSummary, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.summary = summary
            self.timestamp = timestamp
        }
    }

    enum AppMode: String, Codable, Equatable, Sendable {
        case standard
        case developer
    }

    enum ThemeID: String, Codable, Equatable, Sendable {
        case fenrirDark = "fenrir-dark"
        case pierreDark = "pierre-dark"
        case pierreDarkSoft = "pierre-dark-soft"
        case catppuccinMocha = "catppuccin-mocha"
        case rosePine = "rose-pine"
        case kanagawa
        case kanagawaDragon = "kanagawa-dragon"
        case tokyoNightMoon = "tokyonight-moon"
        case nord
    }

    enum ServerStartupMode: String, Codable, Equatable, Sendable {
        case autoStartLocal
        case connectToLocal
        case connectToRemoteProfile
    }

    enum WorkspaceTabPlacement: String, Codable, Equatable, Sendable {
        case top
        case hidden
    }

    enum KeybindingConflictPolicy: String, Codable, Equatable, Sendable {
        case preferFenrir
        case preferTmux
        case reportOnly
    }

    enum UnsupportedKeybindingPolicy: String, Codable, Equatable, Sendable {
        case collectDiagnostics
        case ignore
    }

    enum DiagnosticsDetailLevel: String, Codable, Equatable, Sendable {
        case off
        case errorsOnly
        case verboseLocal
    }

    enum LocalSettingsDomain: String, Codable, Equatable, Sendable {
        case appMode
        case serverConnectionDefaults
        case workspaceUIPreferences
        case appearancePreferences
        case keybindingImportPreferences
        case diagnosticsPolicy
        case runScriptPreferences
        case editorTargetPreferences
    }

    enum SecretStorageOwner: String, Codable, Equatable, Sendable {
        case authSession
        case keychain
    }

    enum SecretMaterialKind: String, Codable, Equatable, Sendable {
        case bearerToken
        case pairingSecret
        case apiKey
        case actorCredential
        case sessionCredential
    }

    struct SettingsPersistenceBoundary: Codable, Equatable, Sendable {
        public let localDomains: [LocalSettingsDomain]
        public let secretMaterialOwners: [SecretStorageOwner]
        public let secretMaterialKinds: [SecretMaterialKind]

        public init(
            localDomains: [LocalSettingsDomain] = [
                .appMode,
                .serverConnectionDefaults,
                .workspaceUIPreferences,
                .appearancePreferences,
                .keybindingImportPreferences,
                .diagnosticsPolicy,
                .runScriptPreferences,
                .editorTargetPreferences
            ],
            secretMaterialOwners: [SecretStorageOwner] = [.authSession, .keychain],
            secretMaterialKinds: [SecretMaterialKind] = [
                .bearerToken,
                .pairingSecret,
                .apiKey,
                .actorCredential,
                .sessionCredential
            ]
        ) {
            self.localDomains = localDomains
            self.secretMaterialOwners = secretMaterialOwners
            self.secretMaterialKinds = secretMaterialKinds
        }

        public static let nativeLocalOnly = SettingsPersistenceBoundary()
    }

    struct LocalServerDefaults: Codable, Equatable, Sendable {
        public let host: String
        public let port: Int
        public let autoBootstrap: Bool

        public init(host: String = "127.0.0.1", port: Int = 31337, autoBootstrap: Bool = true) {
            self.host = host
            self.port = port
            self.autoBootstrap = autoBootstrap
        }
    }

    struct RemoteServerProfile: Codable, Equatable, Sendable {
        public let id: ProfileID
        public let displayName: String
        public let endpointURL: String

        public init(id: ProfileID, displayName: String, endpointURL: String) {
            self.id = id
            self.displayName = displayName
            self.endpointURL = endpointURL
        }
    }

    struct ServerConnectionDefaults: Codable, Equatable, Sendable {
        public let startupMode: ServerStartupMode
        public let localServer: LocalServerDefaults
        public let defaultRemoteProfileID: ProfileID?
        public let remoteProfiles: [RemoteServerProfile]
        public let reconnectBackoffMilliseconds: Int

        public init(
            startupMode: ServerStartupMode = .autoStartLocal,
            localServer: LocalServerDefaults = LocalServerDefaults(),
            defaultRemoteProfileID: ProfileID? = nil,
            remoteProfiles: [RemoteServerProfile] = [],
            reconnectBackoffMilliseconds: Int = 500
        ) {
            self.startupMode = startupMode
            self.localServer = localServer
            self.defaultRemoteProfileID = defaultRemoteProfileID
            self.remoteProfiles = remoteProfiles
            self.reconnectBackoffMilliseconds = reconnectBackoffMilliseconds
        }
    }

    struct WorkspaceUIPreferences: Codable, Equatable, Sendable {
        public let showSidebarByDefault: Bool
        public let restoreLastWorkspaceOnLaunch: Bool
        public let tabPlacement: WorkspaceTabPlacement
        public let confirmDestructiveWorkspaceActions: Bool

        public init(
            showSidebarByDefault: Bool = true,
            restoreLastWorkspaceOnLaunch: Bool = true,
            tabPlacement: WorkspaceTabPlacement = .top,
            confirmDestructiveWorkspaceActions: Bool = true
        ) {
            self.showSidebarByDefault = showSidebarByDefault
            self.restoreLastWorkspaceOnLaunch = restoreLastWorkspaceOnLaunch
            self.tabPlacement = tabPlacement
            self.confirmDestructiveWorkspaceActions = confirmDestructiveWorkspaceActions
        }
    }

    struct AppearancePreferences: Codable, Equatable, Sendable {
        public let themeID: ThemeID

        public init(themeID: ThemeID = .catppuccinMocha) {
            self.themeID = themeID
        }
    }

    struct KeybindingImportPreferences: Codable, Equatable, Sendable {
        public let importTmuxKeybindings: Bool
        public let conflictPolicy: KeybindingConflictPolicy
        public let unsupportedPolicy: UnsupportedKeybindingPolicy

        public init(
            importTmuxKeybindings: Bool = true,
            conflictPolicy: KeybindingConflictPolicy = .preferFenrir,
            unsupportedPolicy: UnsupportedKeybindingPolicy = .collectDiagnostics
        ) {
            self.importTmuxKeybindings = importTmuxKeybindings
            self.conflictPolicy = conflictPolicy
            self.unsupportedPolicy = unsupportedPolicy
        }
    }

    struct DiagnosticsPolicy: Codable, Equatable, Sendable {
        public let detailLevel: DiagnosticsDetailLevel
        public let persistLocalLogs: Bool
        public let includeTerminalScrollbackInReports: Bool

        public init(
            detailLevel: DiagnosticsDetailLevel = .errorsOnly,
            persistLocalLogs: Bool = true,
            includeTerminalScrollbackInReports: Bool = false
        ) {
            self.detailLevel = detailLevel
            self.persistLocalLogs = persistLocalLogs
            self.includeTerminalScrollbackInReports = includeTerminalScrollbackInReports
        }
    }

    struct ScriptID: FenrirID, ExpressibleByStringLiteral {
        public let rawValue: String

        public init(rawValue: String) {
            self.rawValue = rawValue
        }

        public init(stringLiteral value: String) {
            self.init(rawValue: value)
        }

        public static func generated() -> ScriptID {
            ScriptID(rawValue: UUID().uuidString)
        }
    }

    enum ScriptKind: String, Codable, Equatable, Hashable, Sendable, CaseIterable {
        case run
        case test
        case lint
        case format
        case custom

        public var defaultName: String {
            switch self {
            case .run: return "Run"
            case .test: return "Test"
            case .lint: return "Lint"
            case .format: return "Format"
            case .custom: return "Custom"
            }
        }
    }

    enum ScriptScope: Codable, Equatable, Hashable, Sendable {
        case global
        case repository(canonicalPath: String)
    }

    /// A user-configured shell script runnable from the titlebar split button,
    /// palette, or keybinding (D-045). Scripts execute as server-owned tmux
    /// panes; Settings only persists the definitions.
    struct ScriptDefinition: Codable, Equatable, Hashable, Sendable, Identifiable {
        public let id: ScriptID
        public let kind: ScriptKind
        public let name: String
        public let command: String
        /// Optional working-directory override relative to workspace resolution;
        /// nil runs in the workspace root.
        public let workingDirectoryOverride: String?

        /// Display name for chrome labels: predefined kinds show their kind
        /// name so future renames propagate; custom kinds show the user name.
        public var displayName: String {
            kind == .custom ? name : kind.defaultName
        }

        public init(
            id: ScriptID = .generated(),
            kind: ScriptKind,
            name: String? = nil,
            command: String,
            workingDirectoryOverride: String? = nil
        ) {
            self.id = id
            self.kind = kind
            self.name = name ?? kind.defaultName
            self.command = command
            self.workingDirectoryOverride = workingDirectoryOverride
        }

        private enum CodingKeys: String, CodingKey {
            case id
            case kind
            case name
            case command
            case workingDirectoryOverride
        }

        /// The optional override uses `try?` so a malformed value drops just
        /// the override instead of the whole script entry.
        public init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try container.decode(ScriptID.self, forKey: .id)
            kind = try container.decode(ScriptKind.self, forKey: .kind)
            name = try container.decode(String.self, forKey: .name)
            command = try container.decode(String.self, forKey: .command)
            workingDirectoryOverride = (try? container.decodeIfPresent(String.self, forKey: .workingDirectoryOverride)) ?? nil
        }

        /// Forged-kind protection: global-scope scripts are rewritten to
        /// `.custom` so a forged `"kind": "run"` cannot claim the primary Run
        /// slot. Intentionally one-way.
        public func forcedToCustomKind() -> ScriptDefinition {
            ScriptDefinition(
                id: id,
                kind: .custom,
                name: name.isEmpty ? ScriptKind.custom.defaultName : name,
                command: command,
                workingDirectoryOverride: workingDirectoryOverride
            )
        }
    }

    /// Run-script preferences (D-045): repository-level scripts keyed by the
    /// workspace canonical path, plus global scripts shared across every
    /// repository. Global scripts are always `.custom` kind.
    struct ScriptPreferences: Codable, Equatable, Sendable {
        public let globalScripts: [ScriptDefinition]
        public let repositoryScripts: [String: [ScriptDefinition]]

        public init(
            globalScripts: [ScriptDefinition] = [],
            repositoryScripts: [String: [ScriptDefinition]] = [:]
        ) {
            self.globalScripts = globalScripts
            self.repositoryScripts = repositoryScripts
        }

        /// Repository scripts followed by globals; deduplicated by id with
        /// repository precedence, and globals forced to `.custom` kind.
        public func scripts(forRepositoryPath canonicalPath: String) -> [ScriptDefinition] {
            Settings.mergedScripts(
                repository: repositoryScripts[canonicalPath] ?? [],
                global: globalScripts
            )
        }

        /// The first `.run`-kind script for the workspace — the split button's
        /// primary action. Only repository scripts can occupy this slot.
        public func primaryRunScript(forRepositoryPath canonicalPath: String) -> ScriptDefinition? {
            scripts(forRepositoryPath: canonicalPath).first { $0.kind == .run }
        }

        public func replacingScripts(_ scripts: [ScriptDefinition], scope: ScriptScope) -> ScriptPreferences {
            switch scope {
            case .global:
                return ScriptPreferences(
                    globalScripts: scripts.map { $0.forcedToCustomKind() },
                    repositoryScripts: repositoryScripts
                )
            case let .repository(canonicalPath):
                var repositoryScripts = self.repositoryScripts
                if scripts.isEmpty {
                    repositoryScripts[canonicalPath] = nil
                } else {
                    repositoryScripts[canonicalPath] = scripts
                }
                return ScriptPreferences(
                    globalScripts: globalScripts,
                    repositoryScripts: repositoryScripts
                )
            }
        }

        /// Normalization applied on every load and persist: global scripts can
        /// never carry a predefined kind (forged-kind protection).
        public func normalizedForPersistence() -> ScriptPreferences {
            ScriptPreferences(
                globalScripts: globalScripts.map { $0.forcedToCustomKind() },
                repositoryScripts: repositoryScripts
            )
        }
    }

    /// Merge rule (D-045): repository first then global, deduplicated by id
    /// with repository precedence; global entries are forced to `.custom`.
    static func mergedScripts(
        repository: [ScriptDefinition],
        global: [ScriptDefinition]
    ) -> [ScriptDefinition] {
        var seenIDs = Set<ScriptID>()
        var merged: [ScriptDefinition] = []

        for script in repository where seenIDs.insert(script.id).inserted {
            merged.append(script)
        }

        for script in global where seenIDs.insert(script.id).inserted {
            merged.append(script.forcedToCustomKind())
        }

        return merged
    }

    /// Open-in-editor preferences (D-045): Settings persists only chosen
    /// editor ids; the editor-target catalogue itself is not settings.
    struct EditorTargetPreference: Codable, Equatable, Sendable {
        public let defaultEditorID: String?
        /// Per-repository overrides keyed by workspace canonical path.
        public let repositoryOverrides: [String: String]

        public init(
            defaultEditorID: String? = nil,
            repositoryOverrides: [String: String] = [:]
        ) {
            self.defaultEditorID = defaultEditorID
            self.repositoryOverrides = repositoryOverrides
        }

        /// Repository override wins over the global default; nil path resolves
        /// the global default only.
        public func editorID(forRepositoryPath canonicalPath: String?) -> String? {
            if let canonicalPath, let override = repositoryOverrides[canonicalPath] {
                return override
            }

            return defaultEditorID
        }

        public func applying(_ change: EditorTargetChange) -> EditorTargetPreference {
            switch change {
            case let .setDefaultEditor(editorID):
                return EditorTargetPreference(
                    defaultEditorID: editorID,
                    repositoryOverrides: repositoryOverrides
                )
            case let .setRepositoryOverride(canonicalPath, editorID):
                var repositoryOverrides = self.repositoryOverrides
                repositoryOverrides[canonicalPath] = editorID
                return EditorTargetPreference(
                    defaultEditorID: defaultEditorID,
                    repositoryOverrides: repositoryOverrides
                )
            }
        }
    }

    enum EditorTargetChange: Codable, Equatable, Sendable {
        case setDefaultEditor(editorID: String?)
        /// nil editorID clears the override so the global default applies again.
        case setRepositoryOverride(canonicalPath: String, editorID: String?)
    }

    struct NativeSettingsConfiguration: Codable, Equatable, Sendable {
        public let schemaVersion: Int
        public let appMode: AppMode
        public let serverConnection: ServerConnectionDefaults
        public let workspaceUI: WorkspaceUIPreferences
        public let appearance: AppearancePreferences
        public let keybindingImport: KeybindingImportPreferences
        public let diagnostics: DiagnosticsPolicy
        public let runScripts: ScriptPreferences
        public let editorTarget: EditorTargetPreference

        public init(
            schemaVersion: Int = Settings.currentSchemaVersion,
            appMode: AppMode = .standard,
            serverConnection: ServerConnectionDefaults = ServerConnectionDefaults(),
            workspaceUI: WorkspaceUIPreferences = WorkspaceUIPreferences(),
            appearance: AppearancePreferences = AppearancePreferences(),
            keybindingImport: KeybindingImportPreferences = KeybindingImportPreferences(),
            diagnostics: DiagnosticsPolicy = DiagnosticsPolicy(),
            runScripts: ScriptPreferences = ScriptPreferences(),
            editorTarget: EditorTargetPreference = EditorTargetPreference()
        ) {
            self.schemaVersion = schemaVersion
            self.appMode = appMode
            self.serverConnection = serverConnection
            self.workspaceUI = workspaceUI
            self.appearance = appearance
            self.keybindingImport = keybindingImport
            self.diagnostics = diagnostics
            self.runScripts = runScripts
            self.editorTarget = editorTarget
        }

        public static let defaults = NativeSettingsConfiguration()

        public func replacingRunScripts(_ runScripts: ScriptPreferences) -> NativeSettingsConfiguration {
            NativeSettingsConfiguration(
                schemaVersion: schemaVersion,
                appMode: appMode,
                serverConnection: serverConnection,
                workspaceUI: workspaceUI,
                appearance: appearance,
                keybindingImport: keybindingImport,
                diagnostics: diagnostics,
                runScripts: runScripts,
                editorTarget: editorTarget
            )
        }

        public func replacingEditorTarget(_ editorTarget: EditorTargetPreference) -> NativeSettingsConfiguration {
            NativeSettingsConfiguration(
                schemaVersion: schemaVersion,
                appMode: appMode,
                serverConnection: serverConnection,
                workspaceUI: workspaceUI,
                appearance: appearance,
                keybindingImport: keybindingImport,
                diagnostics: diagnostics,
                runScripts: runScripts,
                editorTarget: editorTarget
            )
        }
    }

    enum SettingsIssueCode: String, Codable, Equatable, Sendable {
        case unsupportedSchemaVersion
        case emptyLocalHost
        case invalidLocalPort
        case invalidReconnectBackoff
        case emptyRemoteProfileName
        case invalidRemoteProfileURL
        case duplicateRemoteProfileID
        case missingDefaultRemoteProfile
    }

    struct SettingsValidationIssue: Codable, Equatable, Sendable {
        public let code: SettingsIssueCode
        public let path: String
        public let message: String

        public init(code: SettingsIssueCode, path: String, message: String) {
            self.code = code
            self.path = path
            self.message = message
        }
    }

    struct SettingsValidationResult: Codable, Equatable, Sendable {
        public let configuration: NativeSettingsConfiguration
        public let issues: [SettingsValidationIssue]

        public init(configuration: NativeSettingsConfiguration, issues: [SettingsValidationIssue]) {
            self.configuration = configuration
            self.issues = issues
        }

        public var isValid: Bool {
            issues.isEmpty
        }
    }

    struct ReadSettingsInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let source: ActionSource

        public init(requestID: RequestID, source: ActionSource) {
            self.requestID = requestID
            self.source = source
        }
    }

    struct ReadSettingsResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let configuration: NativeSettingsConfiguration
        public let persistenceBoundary: SettingsPersistenceBoundary
        public let usedDefaults: Bool
        public let timestamp: FenrirTimestamp

        public init(
            requestID: RequestID,
            configuration: NativeSettingsConfiguration,
            persistenceBoundary: SettingsPersistenceBoundary = .nativeLocalOnly,
            usedDefaults: Bool,
            timestamp: FenrirTimestamp
        ) {
            self.requestID = requestID
            self.configuration = configuration
            self.persistenceBoundary = persistenceBoundary
            self.usedDefaults = usedDefaults
            self.timestamp = timestamp
        }
    }

    struct ValidateSettingsInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let source: ActionSource
        public let configuration: NativeSettingsConfiguration

        public init(requestID: RequestID, source: ActionSource, configuration: NativeSettingsConfiguration) {
            self.requestID = requestID
            self.source = source
            self.configuration = configuration
        }
    }

    struct ValidateSettingsResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let validation: SettingsValidationResult
        public let persistenceBoundary: SettingsPersistenceBoundary
        public let timestamp: FenrirTimestamp

        public init(
            requestID: RequestID,
            validation: SettingsValidationResult,
            persistenceBoundary: SettingsPersistenceBoundary = .nativeLocalOnly,
            timestamp: FenrirTimestamp
        ) {
            self.requestID = requestID
            self.validation = validation
            self.persistenceBoundary = persistenceBoundary
            self.timestamp = timestamp
        }
    }

    struct UpdateSettingsInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let source: ActionSource
        public let configuration: NativeSettingsConfiguration

        public init(requestID: RequestID, source: ActionSource, configuration: NativeSettingsConfiguration) {
            self.requestID = requestID
            self.source = source
            self.configuration = configuration
        }
    }

    struct UpdateSettingsResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let configuration: NativeSettingsConfiguration
        public let persistenceBoundary: SettingsPersistenceBoundary
        public let timestamp: FenrirTimestamp

        public init(
            requestID: RequestID,
            configuration: NativeSettingsConfiguration,
            persistenceBoundary: SettingsPersistenceBoundary = .nativeLocalOnly,
            timestamp: FenrirTimestamp
        ) {
            self.requestID = requestID
            self.configuration = configuration
            self.persistenceBoundary = persistenceBoundary
            self.timestamp = timestamp
        }
    }

    struct ReadWorkspaceScriptsInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let source: ActionSource
        /// Workspace canonical path used as the repository-scope key.
        public let repositoryPath: String

        public init(requestID: RequestID, source: ActionSource, repositoryPath: String) {
            self.requestID = requestID
            self.source = source
            self.repositoryPath = repositoryPath
        }
    }

    struct ReadWorkspaceScriptsResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        /// Merged view for the workspace: repository scripts first, then
        /// globals (forced to `.custom`), deduplicated by id with repository
        /// precedence.
        public let scripts: [ScriptDefinition]
        /// The split button's primary action; nil when the repository defines
        /// no `.run`-kind script.
        public let primaryRunScript: ScriptDefinition?
        public let timestamp: FenrirTimestamp

        public init(
            requestID: RequestID,
            scripts: [ScriptDefinition],
            primaryRunScript: ScriptDefinition?,
            timestamp: FenrirTimestamp
        ) {
            self.requestID = requestID
            self.scripts = scripts
            self.primaryRunScript = primaryRunScript
            self.timestamp = timestamp
        }
    }

    struct UpdateScriptsInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let source: ActionSource
        public let scope: ScriptScope
        /// Full replacement list for the scope; an empty list clears it.
        public let scripts: [ScriptDefinition]

        public init(
            requestID: RequestID,
            source: ActionSource,
            scope: ScriptScope,
            scripts: [ScriptDefinition]
        ) {
            self.requestID = requestID
            self.source = source
            self.scope = scope
            self.scripts = scripts
        }
    }

    struct UpdateScriptsResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let configuration: NativeSettingsConfiguration
        public let persistenceBoundary: SettingsPersistenceBoundary
        public let timestamp: FenrirTimestamp

        public init(
            requestID: RequestID,
            configuration: NativeSettingsConfiguration,
            persistenceBoundary: SettingsPersistenceBoundary = .nativeLocalOnly,
            timestamp: FenrirTimestamp
        ) {
            self.requestID = requestID
            self.configuration = configuration
            self.persistenceBoundary = persistenceBoundary
            self.timestamp = timestamp
        }
    }

    struct ReadEditorTargetInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let source: ActionSource
        /// Workspace canonical path; nil resolves the global default only.
        public let repositoryPath: String?

        public init(requestID: RequestID, source: ActionSource, repositoryPath: String?) {
            self.requestID = requestID
            self.source = source
            self.repositoryPath = repositoryPath
        }
    }

    struct ReadEditorTargetResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        /// Resolved id: repository override first, then the global default.
        /// The editor catalogue itself is not settings-owned.
        public let editorID: String?
        public let preference: EditorTargetPreference
        public let timestamp: FenrirTimestamp

        public init(
            requestID: RequestID,
            editorID: String?,
            preference: EditorTargetPreference,
            timestamp: FenrirTimestamp
        ) {
            self.requestID = requestID
            self.editorID = editorID
            self.preference = preference
            self.timestamp = timestamp
        }
    }

    struct UpdateEditorTargetInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let source: ActionSource
        public let change: EditorTargetChange

        public init(requestID: RequestID, source: ActionSource, change: EditorTargetChange) {
            self.requestID = requestID
            self.source = source
            self.change = change
        }
    }

    struct UpdateEditorTargetResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let configuration: NativeSettingsConfiguration
        public let persistenceBoundary: SettingsPersistenceBoundary
        public let timestamp: FenrirTimestamp

        public init(
            requestID: RequestID,
            configuration: NativeSettingsConfiguration,
            persistenceBoundary: SettingsPersistenceBoundary = .nativeLocalOnly,
            timestamp: FenrirTimestamp
        ) {
            self.requestID = requestID
            self.configuration = configuration
            self.persistenceBoundary = persistenceBoundary
            self.timestamp = timestamp
        }
    }

    struct ObserveSettingsInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let source: ActionSource

        public init(requestID: RequestID, source: ActionSource) {
            self.requestID = requestID
            self.source = source
        }
    }

    struct ObserveSettingsResult: Sendable {
        public let requestID: RequestID
        public let current: NativeSettingsConfiguration
        public let persistenceBoundary: SettingsPersistenceBoundary
        public let events: AsyncStream<EventEnvelope<Event>>
        public let timestamp: FenrirTimestamp

        public init(
            requestID: RequestID,
            current: NativeSettingsConfiguration,
            persistenceBoundary: SettingsPersistenceBoundary = .nativeLocalOnly,
            events: AsyncStream<EventEnvelope<Event>>,
            timestamp: FenrirTimestamp
        ) {
            self.requestID = requestID
            self.current = current
            self.persistenceBoundary = persistenceBoundary
            self.events = events
            self.timestamp = timestamp
        }
    }

    enum Event: Codable, Equatable, Sendable {
        case moduleRegistered(String)
        case settingsChanged(NativeSettingsConfiguration)
        case settingsObservationFailed(SettingsError)
    }
}
