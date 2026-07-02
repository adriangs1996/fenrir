import Foundation
import FenrirNativeShared

public extension Settings {
    protocol SettingsClock: Sendable {
        func now() -> FenrirTimestamp
    }

    struct SettingsPersistenceFailure: Error, Codable, Equatable, Sendable {
        public let message: String

        public init(message: String) {
            self.message = message
        }
    }

    protocol LocalSettingsPersistence: Sendable {
        func loadSettingsData() async throws -> Data?
        func saveSettingsData(_ data: Data) async throws
        func observeSettingsData() -> AsyncStream<Result<Data?, SettingsPersistenceFailure>>
    }

    static func localFileSettingsPersistence(settingsFileURL: URL) -> any LocalSettingsPersistence {
        LocalFileSettingsPersistence(settingsFileURL: settingsFileURL)
    }

    static func applicationSupportSettingsPersistence(
        applicationSupportDirectoryName: String = "FenrirNative"
    ) throws -> any LocalSettingsPersistence {
        let root = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: false
        )
        let settingsFileURL = root
            .appendingPathComponent(applicationSupportDirectoryName, isDirectory: true)
            .appendingPathComponent("settings.json", isDirectory: false)

        return localFileSettingsPersistence(settingsFileURL: settingsFileURL)
    }
}
