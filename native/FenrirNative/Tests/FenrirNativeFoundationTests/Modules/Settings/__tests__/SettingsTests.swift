import Foundation
import Testing
import FenrirNativeShared
@testable import Settings

@Suite("Settings module registration")
struct SettingsTests {
    @Test("DescribeSettingsModule exposes the Settings target")
    func describeModule() async throws {
        let action = Settings.DescribeSettingsModule(clock: FixedClock())

        let result = try await action.run(.init(requestID: "settings", source: .test)).get()

        #expect(result.summary.moduleName == "Settings")
        #expect(result.requestID == "settings")
    }

    @Test("Native theme identifiers include desktop custom registry themes")
    func nativeThemeIdentifiersIncludeDesktopRegistryThemes() throws {
        let decoder = JSONDecoder()

        let pierreDarkSoft = try decoder.decode(
            Settings.ThemeID.self,
            from: Data(#""pierre-dark-soft""#.utf8)
        )
        let kanagawaDragon = try decoder.decode(
            Settings.ThemeID.self,
            from: Data(#""kanagawa-dragon""#.utf8)
        )

        #expect(pierreDarkSoft == .pierreDarkSoft)
        #expect(kanagawaDragon == .kanagawaDragon)
        #expect(pierreDarkSoft.rawValue == "pierre-dark-soft")
        #expect(kanagawaDragon.rawValue == "kanagawa-dragon")
    }

    @Test("ReadSettings returns defaults when no local settings have been persisted")
    func readDefaults() async throws {
        let persistence = FakeSettingsPersistence()
        let action = Settings.ReadSettings(clock: FixedClock(), persistence: persistence)

        let result = try await action.run(.init(requestID: "settings.read", source: .test)).get()

        #expect(result.configuration == .defaults)
        #expect(result.persistenceBoundary == .nativeLocalOnly)
        #expect(result.usedDefaults)
    }

    @Test("ReadSettings maps persistence load errors")
    func readPersistenceError() async throws {
        let persistence = FakeSettingsPersistence(loadFailure: Settings.SettingsPersistenceFailure(message: "permission denied"))
        let action = Settings.ReadSettings(clock: FixedClock(), persistence: persistence)

        let result = await action.run(.init(requestID: "settings.read", source: .test))

        guard case let .failure(error) = result,
              case let .persistenceFailed(message) = error
        else {
            Issue.record("Expected persistence failure")
            return
        }

        #expect(message.contains("permission denied"))
    }

    @Test("ReadSettings rejects malformed persisted configuration")
    func readMalformedConfiguration() async throws {
        let persistence = FakeSettingsPersistence(initialData: Data("{".utf8))
        let action = Settings.ReadSettings(clock: FixedClock(), persistence: persistence)

        let result = await action.run(.init(requestID: "settings.read", source: .test))

        guard case let .failure(error) = result,
              case .malformedConfig = error
        else {
            Issue.record("Expected malformed config failure")
            return
        }
    }

    @Test("Defaulting rejects malformed local settings documents before persistence")
    func defaultingRejectsMalformedDocuments() throws {
        #expect(throws: Settings.SettingsError.self) {
            _ = try Settings.decodeConfiguration(from: Data("{".utf8))
        }
    }

    @Test("Defaulting rejects unsupported future schema versions")
    func defaultingRejectsUnsupportedFutureSchemaVersions() throws {
        let data = Data("""
        {
          "schemaVersion": 999,
          "appMode": "developer"
        }
        """.utf8)

        do {
            _ = try Settings.decodeConfiguration(from: data)
            Issue.record("Expected future schema validation failure")
        } catch let error as Settings.SettingsError {
            guard case let .validationFailed(issues) = error else {
                Issue.record("Expected validation failure")
                return
            }

            #expect(issues.map(\.code).contains(.unsupportedSchemaVersion))
        }
    }

    @Test("ReadSettings migrates partial older documents to current defaults")
    func readMigratedDefaults() async throws {
        let data = Data("""
        {
          "schemaVersion": 0,
          "appMode": "developer"
        }
        """.utf8)
        let persistence = FakeSettingsPersistence(initialData: data)
        let action = Settings.ReadSettings(clock: FixedClock(), persistence: persistence)

        let result = try await action.run(.init(requestID: "settings.read", source: .test)).get()

        #expect(result.configuration.schemaVersion == Settings.currentSchemaVersion)
        #expect(result.configuration.appMode == .developer)
        #expect(result.configuration.serverConnection == Settings.NativeSettingsConfiguration.defaults.serverConnection)
        #expect(result.configuration.workspaceUI == Settings.NativeSettingsConfiguration.defaults.workspaceUI)
        #expect(result.configuration.appearance == Settings.NativeSettingsConfiguration.defaults.appearance)
    }

    @Test("Defaulting migrates older local documents without service dependencies")
    func defaultingMigratesOlderDocuments() throws {
        let data = Data("""
        {
          "schemaVersion": 0,
          "appMode": "developer"
        }
        """.utf8)

        let configuration = try Settings.decodeConfiguration(from: data)

        #expect(configuration.schemaVersion == Settings.currentSchemaVersion)
        #expect(configuration.appMode == .developer)
        #expect(configuration.serverConnection == Settings.NativeSettingsConfiguration.defaults.serverConnection)
        #expect(configuration.workspaceUI == Settings.NativeSettingsConfiguration.defaults.workspaceUI)
        #expect(configuration.appearance == Settings.NativeSettingsConfiguration.defaults.appearance)
    }

    @Test("Defaulting migrates partial nested local settings documents")
    func defaultingMigratesPartialNestedDocuments() throws {
        let data = Data("""
        {
          "schemaVersion": 0,
          "serverConnection": {
            "startupMode": "connectToLocal",
            "localServer": {
              "port": 4000
            }
          },
          "workspaceUI": {
            "showSidebarByDefault": false
          },
          "appearance": {
            "themeID": "kanagawa"
          },
          "keybindingImport": {
            "conflictPolicy": "preferTmux"
          },
          "diagnostics": {
            "detailLevel": "verboseLocal"
          }
        }
        """.utf8)

        let configuration = try Settings.decodeConfiguration(from: data)

        #expect(configuration.schemaVersion == Settings.currentSchemaVersion)
        #expect(configuration.serverConnection.startupMode == .connectToLocal)
        #expect(configuration.serverConnection.localServer.host == "127.0.0.1")
        #expect(configuration.serverConnection.localServer.port == 4000)
        #expect(configuration.serverConnection.localServer.autoBootstrap)
        #expect(configuration.serverConnection.reconnectBackoffMilliseconds == 500)
        #expect(!configuration.workspaceUI.showSidebarByDefault)
        #expect(configuration.workspaceUI.restoreLastWorkspaceOnLaunch)
        #expect(configuration.appearance.themeID == .kanagawa)
        #expect(configuration.keybindingImport.importTmuxKeybindings)
        #expect(configuration.keybindingImport.conflictPolicy == .preferTmux)
        #expect(configuration.diagnostics.detailLevel == .verboseLocal)
        #expect(configuration.diagnostics.persistLocalLogs)
        #expect(!configuration.diagnostics.includeTerminalScrollbackInReports)
    }

    @Test("ValidateSettings reports invalid local and remote connection defaults")
    func validateMalformedConfiguration() async throws {
        let invalid = Settings.NativeSettingsConfiguration(
            serverConnection: .init(
                localServer: .init(host: " ", port: 70_000),
                defaultRemoteProfileID: "missing",
                remoteProfiles: [
                    .init(id: "remote", displayName: "", endpointURL: "not a url"),
                    .init(id: "remote", displayName: "Duplicate", endpointURL: "https://example.com")
                ],
                reconnectBackoffMilliseconds: -1
            )
        )
        let action = Settings.ValidateSettings(clock: FixedClock())

        let result = try await action.run(.init(
            requestID: "settings.validate",
            source: .test,
            configuration: invalid
        )).get()

        let codes = Set(result.validation.issues.map(\.code))
        #expect(result.persistenceBoundary == .nativeLocalOnly)
        #expect(codes.contains(.emptyLocalHost))
        #expect(codes.contains(.invalidLocalPort))
        #expect(codes.contains(.invalidReconnectBackoff))
        #expect(codes.contains(.emptyRemoteProfileName))
        #expect(codes.contains(.invalidRemoteProfileURL))
        #expect(codes.contains(.duplicateRemoteProfileID))
        #expect(codes.contains(.missingDefaultRemoteProfile))
    }

    @Test("Validation is pure and normalizes schema version for local persistence")
    func validationNormalizesSchemaVersion() throws {
        let configuration = Settings.NativeSettingsConfiguration(schemaVersion: 0)

        let validation = configuration.validatedForLocalPersistence()

        #expect(validation.isValid)
        #expect(validation.configuration.schemaVersion == Settings.currentSchemaVersion)
    }

    @Test("UpdateSettings validates before persistence")
    func updateRejectsInvalidConfiguration() async throws {
        let persistence = FakeSettingsPersistence()
        let invalid = Settings.NativeSettingsConfiguration(
            serverConnection: .init(localServer: .init(host: "localhost", port: 0))
        )
        let action = Settings.UpdateSettings(clock: FixedClock(), persistence: persistence)

        let result = await action.run(.init(
            requestID: "settings.update",
            source: .test,
            configuration: invalid
        ))

        guard case let .failure(error) = result,
              case let .validationFailed(issues) = error
        else {
            Issue.record("Expected validation failure")
            return
        }

        #expect(issues.map(\.code).contains(.invalidLocalPort))
        #expect(persistence.savedData == nil)
    }

    @Test("UpdateSettings maps persistence save errors")
    func updatePersistenceError() async throws {
        let persistence = FakeSettingsPersistence(saveFailure: Settings.SettingsPersistenceFailure(message: "disk full"))
        let action = Settings.UpdateSettings(clock: FixedClock(), persistence: persistence)

        let result = await action.run(.init(
            requestID: "settings.update",
            source: .test,
            configuration: .defaults
        ))

        guard case let .failure(error) = result,
              case let .persistenceFailed(message) = error
        else {
            Issue.record("Expected persistence failure")
            return
        }

        #expect(message.contains("disk full"))
    }

    @Test("Live file persistence treats missing settings file as defaults")
    func liveFilePersistenceMissingFileUsesDefaults() async throws {
        let fixture = try TemporarySettingsFile()
        let persistence = Settings.localFileSettingsPersistence(settingsFileURL: fixture.settingsFileURL)
        let action = Settings.ReadSettings(clock: FixedClock(), persistence: persistence)

        let result = try await action.run(.init(requestID: "settings.live.read", source: .test)).get()

        #expect(result.configuration == .defaults)
        #expect(result.usedDefaults)
    }

    @Test("Live file persistence surfaces corrupt settings files")
    func liveFilePersistenceSurfacesCorruptFiles() async throws {
        let fixture = try TemporarySettingsFile()
        try Data("{".utf8).write(to: fixture.settingsFileURL, options: [.atomic])
        let persistence = Settings.localFileSettingsPersistence(settingsFileURL: fixture.settingsFileURL)
        let action = Settings.ReadSettings(clock: FixedClock(), persistence: persistence)

        let result = await action.run(.init(requestID: "settings.live.read", source: .test))

        guard case let .failure(error) = result,
              case .malformedConfig = error
        else {
            Issue.record("Expected malformed config failure")
            return
        }
    }

    @Test("Live file persistence writes deterministic local settings without secret fields")
    func liveFilePersistenceWritesDeterministicLocalSettingsOnly() async throws {
        let fixture = try TemporarySettingsFile()
        let persistence = Settings.localFileSettingsPersistence(settingsFileURL: fixture.settingsFileURL)
        let configuration = Settings.NativeSettingsConfiguration(
            appMode: .developer,
            serverConnection: .init(
                startupMode: .connectToRemoteProfile,
                defaultRemoteProfileID: "remote",
                remoteProfiles: [
                    .init(id: "remote", displayName: "Remote", endpointURL: "https://fenrir.example")
                ]
            ),
            appearance: .init(themeID: .tokyoNightMoon)
        )
        let firstData = try Settings.encodeConfiguration(configuration)
        let secondData = try Settings.encodeConfiguration(configuration)

        try await persistence.saveSettingsData(firstData)
        let persisted = try #require(try await persistence.loadSettingsData())
        let persistedText = String(decoding: persisted, as: UTF8.self)

        #expect(firstData == secondData)
        #expect(persisted == firstData)
        #expect(persistedText.contains("\"appMode\":\"developer\""))
        #expect(persistedText.contains("\"endpointURL\":\"https://fenrir.example\""))
        #expect(persistedText.contains("\"themeID\":\"tokyonight-moon\""))
        #expect(!persistedText.contains("bearerToken"))
        #expect(!persistedText.contains("pairingSecret"))
        #expect(!persistedText.contains("apiKey"))
        #expect(!persistedText.contains("actorCredential"))
        #expect(!persistedText.contains("sessionCredential"))
    }

    @Test("Live file persistence serializes concurrent saves and publishes ordered changes")
    func liveFilePersistencePublishesConcurrentSavesInOrder() async throws {
        let fixture = try TemporarySettingsFile()
        let persistence = Settings.localFileSettingsPersistence(settingsFileURL: fixture.settingsFileURL)
        let stream = persistence.observeSettingsData()
        let observed = Task {
            var values: [String] = []
            for await update in stream {
                guard case let .success(data) = update,
                      let data
                else {
                    continue
                }

                values.append(String(decoding: data, as: UTF8.self))
                if values.count == 3 {
                    return values
                }
            }

            return values
        }

        async let first: Void = persistence.saveSettingsData(Data("first".utf8))
        async let second: Void = persistence.saveSettingsData(Data("second".utf8))
        async let third: Void = persistence.saveSettingsData(Data("third".utf8))
        _ = try await (first, second, third)

        let values = await observed.value
        let persisted = try #require(try await persistence.loadSettingsData())

        #expect(Set(values) == ["first", "second", "third"])
        #expect(values.count == 3)
        #expect(String(decoding: persisted, as: UTF8.self) == values.last)
    }

    @Test("Settings persistence boundary keeps secrets outside Settings")
    func settingsPersistenceBoundaryExcludesSecrets() async throws {
        let boundary = Settings.SettingsPersistenceBoundary.nativeLocalOnly

        #expect(boundary.localDomains == [
            .appMode,
            .serverConnectionDefaults,
            .workspaceUIPreferences,
            .appearancePreferences,
            .keybindingImportPreferences,
            .diagnosticsPolicy
        ])
        #expect(boundary.secretMaterialOwners == [.authSession, .keychain])
        #expect(boundary.secretMaterialKinds.contains(.bearerToken))
        #expect(boundary.secretMaterialKinds.contains(.pairingSecret))
        #expect(boundary.secretMaterialKinds.contains(.apiKey))
        #expect(boundary.secretMaterialKinds.contains(.actorCredential))
        #expect(boundary.secretMaterialKinds.contains(.sessionCredential))
    }

    @Test("ObserveSettings emits decoded settings changes without exposing layers")
    func observeSettingsChanges() async throws {
        let stream = AsyncStream<Result<Data?, Settings.SettingsPersistenceFailure>> { continuation in
            let configuration = Settings.NativeSettingsConfiguration(appMode: .developer)
            let data = try? JSONEncoder().encode(configuration)
            continuation.yield(.success(data))
            continuation.finish()
        }
        let persistence = FakeSettingsPersistence(observationStream: stream)
        let action = Settings.ObserveSettings(clock: FixedClock(), persistence: persistence)

        let result = try await action.run(.init(requestID: "settings.observe", source: .test)).get()
        #expect(result.persistenceBoundary == .nativeLocalOnly)

        for await event in result.events {
            guard case let .settingsChanged(configuration) = event.event else {
                Issue.record("Expected settings changed event")
                return
            }

            #expect(configuration.appMode == .developer)
            return
        }

        Issue.record("Expected one settings observation event")
    }

    @Test("ObserveSettings emits persistence failures")
    func observeSettingsPersistenceFailures() async throws {
        let stream = AsyncStream<Result<Data?, Settings.SettingsPersistenceFailure>> { continuation in
            continuation.yield(.failure(.init(message: "watch unavailable")))
            continuation.finish()
        }
        let persistence = FakeSettingsPersistence(observationStream: stream)
        let action = Settings.ObserveSettings(clock: FixedClock(), persistence: persistence)

        let result = try await action.run(.init(requestID: "settings.observe", source: .test)).get()

        for await event in result.events {
            guard case let .settingsObservationFailed(error) = event.event,
                  case let .persistenceFailed(message) = error
            else {
                Issue.record("Expected observation persistence failure")
                return
            }

            #expect(message == "watch unavailable")
            return
        }

        Issue.record("Expected one settings observation failure event")
    }
}

private final class FakeSettingsPersistence: Settings.LocalSettingsPersistence, @unchecked Sendable {
    private let lock = NSLock()
    private var data: Data?
    private let loadFailure: Settings.SettingsPersistenceFailure?
    private let saveFailure: Settings.SettingsPersistenceFailure?
    private let observationStream: AsyncStream<Result<Data?, Settings.SettingsPersistenceFailure>>

    init(
        initialData: Data? = nil,
        loadFailure: Settings.SettingsPersistenceFailure? = nil,
        saveFailure: Settings.SettingsPersistenceFailure? = nil,
        observationStream: AsyncStream<Result<Data?, Settings.SettingsPersistenceFailure>> = AsyncStream { $0.finish() }
    ) {
        self.data = initialData
        self.loadFailure = loadFailure
        self.saveFailure = saveFailure
        self.observationStream = observationStream
    }

    var savedData: Data? {
        lock.withLock { data }
    }

    func loadSettingsData() async throws -> Data? {
        if let loadFailure {
            throw loadFailure
        }

        return lock.withLock { data }
    }

    func saveSettingsData(_ data: Data) async throws {
        if let saveFailure {
            throw saveFailure
        }

        lock.withLock {
            self.data = data
        }
    }

    func observeSettingsData() -> AsyncStream<Result<Data?, Settings.SettingsPersistenceFailure>> {
        observationStream
    }
}

private final class TemporarySettingsFile {
    let directoryURL: URL
    let settingsFileURL: URL

    init() throws {
        directoryURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("fenrir-settings-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        settingsFileURL = directoryURL.appendingPathComponent("settings.json", isDirectory: false)
    }

    deinit {
        try? FileManager.default.removeItem(at: directoryURL)
    }
}
