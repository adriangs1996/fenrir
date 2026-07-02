import Foundation
import FenrirNativeShared

public extension Settings {
    static let currentSchemaVersion = 1

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
        case keybindingImportPreferences
        case diagnosticsPolicy
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
                .keybindingImportPreferences,
                .diagnosticsPolicy
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

    struct NativeSettingsConfiguration: Codable, Equatable, Sendable {
        public let schemaVersion: Int
        public let appMode: AppMode
        public let serverConnection: ServerConnectionDefaults
        public let workspaceUI: WorkspaceUIPreferences
        public let keybindingImport: KeybindingImportPreferences
        public let diagnostics: DiagnosticsPolicy

        public init(
            schemaVersion: Int = Settings.currentSchemaVersion,
            appMode: AppMode = .standard,
            serverConnection: ServerConnectionDefaults = ServerConnectionDefaults(),
            workspaceUI: WorkspaceUIPreferences = WorkspaceUIPreferences(),
            keybindingImport: KeybindingImportPreferences = KeybindingImportPreferences(),
            diagnostics: DiagnosticsPolicy = DiagnosticsPolicy()
        ) {
            self.schemaVersion = schemaVersion
            self.appMode = appMode
            self.serverConnection = serverConnection
            self.workspaceUI = workspaceUI
            self.keybindingImport = keybindingImport
            self.diagnostics = diagnostics
        }

        public static let defaults = NativeSettingsConfiguration()
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
