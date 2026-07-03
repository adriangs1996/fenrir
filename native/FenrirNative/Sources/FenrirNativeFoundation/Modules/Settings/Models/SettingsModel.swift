import Foundation
import FenrirNativeShared

extension Settings {
    struct SettingsState: Sendable {
        var loadedAt: FenrirTimestamp?
    }

    struct StoredSettingsDocument: Codable, Equatable, Sendable {
        let schemaVersion: Int?
        let appMode: AppMode?
        let serverConnection: StoredServerConnectionDefaults?
        let workspaceUI: StoredWorkspaceUIPreferences?
        let appearance: StoredAppearancePreferences?
        let keybindingImport: StoredKeybindingImportPreferences?
        let diagnostics: StoredDiagnosticsPolicy?

        init(
            schemaVersion: Int? = nil,
            appMode: AppMode? = nil,
            serverConnection: StoredServerConnectionDefaults? = nil,
            workspaceUI: StoredWorkspaceUIPreferences? = nil,
            appearance: StoredAppearancePreferences? = nil,
            keybindingImport: StoredKeybindingImportPreferences? = nil,
            diagnostics: StoredDiagnosticsPolicy? = nil
        ) {
            self.schemaVersion = schemaVersion
            self.appMode = appMode
            self.serverConnection = serverConnection
            self.workspaceUI = workspaceUI
            self.appearance = appearance
            self.keybindingImport = keybindingImport
            self.diagnostics = diagnostics
        }

        init(configuration: NativeSettingsConfiguration) {
            self.init(
                schemaVersion: configuration.schemaVersion,
                appMode: configuration.appMode,
                serverConnection: StoredServerConnectionDefaults(configuration: configuration.serverConnection),
                workspaceUI: StoredWorkspaceUIPreferences(configuration: configuration.workspaceUI),
                appearance: StoredAppearancePreferences(configuration: configuration.appearance),
                keybindingImport: StoredKeybindingImportPreferences(configuration: configuration.keybindingImport),
                diagnostics: StoredDiagnosticsPolicy(configuration: configuration.diagnostics)
            )
        }

        var defaultedConfiguration: NativeSettingsConfiguration {
            NativeSettingsConfiguration(
                schemaVersion: schemaVersion ?? Settings.currentSchemaVersion,
                appMode: appMode ?? NativeSettingsConfiguration.defaults.appMode,
                serverConnection: serverConnection?.defaultedConfiguration ?? NativeSettingsConfiguration.defaults.serverConnection,
                workspaceUI: workspaceUI?.defaultedConfiguration ?? NativeSettingsConfiguration.defaults.workspaceUI,
                appearance: appearance?.defaultedConfiguration ?? NativeSettingsConfiguration.defaults.appearance,
                keybindingImport: keybindingImport?.defaultedConfiguration ?? NativeSettingsConfiguration.defaults.keybindingImport,
                diagnostics: diagnostics?.defaultedConfiguration ?? NativeSettingsConfiguration.defaults.diagnostics
            )
        }
    }

    struct StoredLocalServerDefaults: Codable, Equatable, Sendable {
        let host: String?
        let port: Int?
        let autoBootstrap: Bool?

        init(host: String? = nil, port: Int? = nil, autoBootstrap: Bool? = nil) {
            self.host = host
            self.port = port
            self.autoBootstrap = autoBootstrap
        }

        init(configuration: LocalServerDefaults) {
            self.init(
                host: configuration.host,
                port: configuration.port,
                autoBootstrap: configuration.autoBootstrap
            )
        }

        var defaultedConfiguration: LocalServerDefaults {
            let defaults = NativeSettingsConfiguration.defaults.serverConnection.localServer
            return LocalServerDefaults(
                host: host ?? defaults.host,
                port: port ?? defaults.port,
                autoBootstrap: autoBootstrap ?? defaults.autoBootstrap
            )
        }
    }

    struct StoredServerConnectionDefaults: Codable, Equatable, Sendable {
        let startupMode: ServerStartupMode?
        let localServer: StoredLocalServerDefaults?
        let defaultRemoteProfileID: ProfileID?
        let remoteProfiles: [RemoteServerProfile]?
        let reconnectBackoffMilliseconds: Int?

        init(
            startupMode: ServerStartupMode? = nil,
            localServer: StoredLocalServerDefaults? = nil,
            defaultRemoteProfileID: ProfileID? = nil,
            remoteProfiles: [RemoteServerProfile]? = nil,
            reconnectBackoffMilliseconds: Int? = nil
        ) {
            self.startupMode = startupMode
            self.localServer = localServer
            self.defaultRemoteProfileID = defaultRemoteProfileID
            self.remoteProfiles = remoteProfiles
            self.reconnectBackoffMilliseconds = reconnectBackoffMilliseconds
        }

        init(configuration: ServerConnectionDefaults) {
            self.init(
                startupMode: configuration.startupMode,
                localServer: StoredLocalServerDefaults(configuration: configuration.localServer),
                defaultRemoteProfileID: configuration.defaultRemoteProfileID,
                remoteProfiles: configuration.remoteProfiles,
                reconnectBackoffMilliseconds: configuration.reconnectBackoffMilliseconds
            )
        }

        var defaultedConfiguration: ServerConnectionDefaults {
            let defaults = NativeSettingsConfiguration.defaults.serverConnection
            return ServerConnectionDefaults(
                startupMode: startupMode ?? defaults.startupMode,
                localServer: localServer?.defaultedConfiguration ?? defaults.localServer,
                defaultRemoteProfileID: defaultRemoteProfileID ?? defaults.defaultRemoteProfileID,
                remoteProfiles: remoteProfiles ?? defaults.remoteProfiles,
                reconnectBackoffMilliseconds: reconnectBackoffMilliseconds ?? defaults.reconnectBackoffMilliseconds
            )
        }
    }

    struct StoredWorkspaceUIPreferences: Codable, Equatable, Sendable {
        let showSidebarByDefault: Bool?
        let restoreLastWorkspaceOnLaunch: Bool?
        let tabPlacement: WorkspaceTabPlacement?
        let confirmDestructiveWorkspaceActions: Bool?

        init(
            showSidebarByDefault: Bool? = nil,
            restoreLastWorkspaceOnLaunch: Bool? = nil,
            tabPlacement: WorkspaceTabPlacement? = nil,
            confirmDestructiveWorkspaceActions: Bool? = nil
        ) {
            self.showSidebarByDefault = showSidebarByDefault
            self.restoreLastWorkspaceOnLaunch = restoreLastWorkspaceOnLaunch
            self.tabPlacement = tabPlacement
            self.confirmDestructiveWorkspaceActions = confirmDestructiveWorkspaceActions
        }

        init(configuration: WorkspaceUIPreferences) {
            self.init(
                showSidebarByDefault: configuration.showSidebarByDefault,
                restoreLastWorkspaceOnLaunch: configuration.restoreLastWorkspaceOnLaunch,
                tabPlacement: configuration.tabPlacement,
                confirmDestructiveWorkspaceActions: configuration.confirmDestructiveWorkspaceActions
            )
        }

        var defaultedConfiguration: WorkspaceUIPreferences {
            let defaults = NativeSettingsConfiguration.defaults.workspaceUI
            return WorkspaceUIPreferences(
                showSidebarByDefault: showSidebarByDefault ?? defaults.showSidebarByDefault,
                restoreLastWorkspaceOnLaunch: restoreLastWorkspaceOnLaunch ?? defaults.restoreLastWorkspaceOnLaunch,
                tabPlacement: tabPlacement ?? defaults.tabPlacement,
                confirmDestructiveWorkspaceActions: confirmDestructiveWorkspaceActions ?? defaults.confirmDestructiveWorkspaceActions
            )
        }
    }

    struct StoredAppearancePreferences: Codable, Equatable, Sendable {
        let themeID: ThemeID?

        init(themeID: ThemeID? = nil) {
            self.themeID = themeID
        }

        init(configuration: AppearancePreferences) {
            self.init(themeID: configuration.themeID)
        }

        var defaultedConfiguration: AppearancePreferences {
            let defaults = NativeSettingsConfiguration.defaults.appearance
            return AppearancePreferences(themeID: themeID ?? defaults.themeID)
        }
    }

    struct StoredKeybindingImportPreferences: Codable, Equatable, Sendable {
        let importTmuxKeybindings: Bool?
        let conflictPolicy: KeybindingConflictPolicy?
        let unsupportedPolicy: UnsupportedKeybindingPolicy?

        init(
            importTmuxKeybindings: Bool? = nil,
            conflictPolicy: KeybindingConflictPolicy? = nil,
            unsupportedPolicy: UnsupportedKeybindingPolicy? = nil
        ) {
            self.importTmuxKeybindings = importTmuxKeybindings
            self.conflictPolicy = conflictPolicy
            self.unsupportedPolicy = unsupportedPolicy
        }

        init(configuration: KeybindingImportPreferences) {
            self.init(
                importTmuxKeybindings: configuration.importTmuxKeybindings,
                conflictPolicy: configuration.conflictPolicy,
                unsupportedPolicy: configuration.unsupportedPolicy
            )
        }

        var defaultedConfiguration: KeybindingImportPreferences {
            let defaults = NativeSettingsConfiguration.defaults.keybindingImport
            return KeybindingImportPreferences(
                importTmuxKeybindings: importTmuxKeybindings ?? defaults.importTmuxKeybindings,
                conflictPolicy: conflictPolicy ?? defaults.conflictPolicy,
                unsupportedPolicy: unsupportedPolicy ?? defaults.unsupportedPolicy
            )
        }
    }

    struct StoredDiagnosticsPolicy: Codable, Equatable, Sendable {
        let detailLevel: DiagnosticsDetailLevel?
        let persistLocalLogs: Bool?
        let includeTerminalScrollbackInReports: Bool?

        init(
            detailLevel: DiagnosticsDetailLevel? = nil,
            persistLocalLogs: Bool? = nil,
            includeTerminalScrollbackInReports: Bool? = nil
        ) {
            self.detailLevel = detailLevel
            self.persistLocalLogs = persistLocalLogs
            self.includeTerminalScrollbackInReports = includeTerminalScrollbackInReports
        }

        init(configuration: DiagnosticsPolicy) {
            self.init(
                detailLevel: configuration.detailLevel,
                persistLocalLogs: configuration.persistLocalLogs,
                includeTerminalScrollbackInReports: configuration.includeTerminalScrollbackInReports
            )
        }

        var defaultedConfiguration: DiagnosticsPolicy {
            let defaults = NativeSettingsConfiguration.defaults.diagnostics
            return DiagnosticsPolicy(
                detailLevel: detailLevel ?? defaults.detailLevel,
                persistLocalLogs: persistLocalLogs ?? defaults.persistLocalLogs,
                includeTerminalScrollbackInReports: includeTerminalScrollbackInReports ?? defaults.includeTerminalScrollbackInReports
            )
        }
    }
}

extension Settings.NativeSettingsConfiguration {
    func validatedForLocalPersistence() -> Settings.SettingsValidationResult {
        var issues: [Settings.SettingsValidationIssue] = []

        if schemaVersion > Settings.currentSchemaVersion {
            issues.append(Settings.SettingsValidationIssue(
                code: .unsupportedSchemaVersion,
                path: "schemaVersion",
                message: "Settings schema version \(schemaVersion) is newer than supported version \(Settings.currentSchemaVersion)."
            ))
        }

        if serverConnection.localServer.host.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            issues.append(Settings.SettingsValidationIssue(
                code: .emptyLocalHost,
                path: "serverConnection.localServer.host",
                message: "Local server host must not be empty."
            ))
        }

        if !(1...65_535).contains(serverConnection.localServer.port) {
            issues.append(Settings.SettingsValidationIssue(
                code: .invalidLocalPort,
                path: "serverConnection.localServer.port",
                message: "Local server port must be between 1 and 65535."
            ))
        }

        if serverConnection.reconnectBackoffMilliseconds < 0 {
            issues.append(Settings.SettingsValidationIssue(
                code: .invalidReconnectBackoff,
                path: "serverConnection.reconnectBackoffMilliseconds",
                message: "Reconnect backoff must not be negative."
            ))
        }

        var profileIDs = Set<ProfileID>()
        for profile in serverConnection.remoteProfiles {
            if profile.displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                issues.append(Settings.SettingsValidationIssue(
                    code: .emptyRemoteProfileName,
                    path: "serverConnection.remoteProfiles[\(profile.id.rawValue)].displayName",
                    message: "Remote profile display name must not be empty."
                ))
            }

            if URL(string: profile.endpointURL)?.scheme == nil {
                issues.append(Settings.SettingsValidationIssue(
                    code: .invalidRemoteProfileURL,
                    path: "serverConnection.remoteProfiles[\(profile.id.rawValue)].endpointURL",
                    message: "Remote profile endpoint must be an absolute URL."
                ))
            }

            if !profileIDs.insert(profile.id).inserted {
                issues.append(Settings.SettingsValidationIssue(
                    code: .duplicateRemoteProfileID,
                    path: "serverConnection.remoteProfiles",
                    message: "Remote profile IDs must be unique."
                ))
            }
        }

        if let defaultRemoteProfileID = serverConnection.defaultRemoteProfileID,
           !profileIDs.contains(defaultRemoteProfileID)
        {
            issues.append(Settings.SettingsValidationIssue(
                code: .missingDefaultRemoteProfile,
                path: "serverConnection.defaultRemoteProfileID",
                message: "Default remote profile must reference a configured remote profile."
            ))
        }

        return Settings.SettingsValidationResult(
            configuration: normalizedForLocalPersistence(),
            issues: issues
        )
    }

    private func normalizedForLocalPersistence() -> Settings.NativeSettingsConfiguration {
        Settings.NativeSettingsConfiguration(
            schemaVersion: Settings.currentSchemaVersion,
            appMode: appMode,
            serverConnection: serverConnection,
            workspaceUI: workspaceUI,
            appearance: appearance,
            keybindingImport: keybindingImport,
            diagnostics: diagnostics
        )
    }
}
