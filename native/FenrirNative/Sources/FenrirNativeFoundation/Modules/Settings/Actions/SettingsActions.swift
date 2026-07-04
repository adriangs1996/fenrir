import Foundation
import FenrirNativeShared

public extension Settings {
    struct DescribeSettingsModule: FenrirAction {
        public typealias Failure = SettingsError

        public let clock: any SettingsClock

        public init(clock: any SettingsClock) {
            self.clock = clock
        }

        public func run(_ input: DescribeSettingsModuleInput) async -> Result<DescribeSettingsModuleResult, SettingsError> {
            let timestamp = clock.now()
            return .success(DescribeSettingsModuleResult(
                requestID: input.requestID,
                summary: ModuleSummary(registeredAt: timestamp),
                timestamp: timestamp
            ))
        }
    }

    struct ReadSettings: FenrirAction {
        public typealias Failure = SettingsError

        public let clock: any SettingsClock
        public let persistence: any LocalSettingsPersistence

        public init(clock: any SettingsClock, persistence: any LocalSettingsPersistence) {
            self.clock = clock
            self.persistence = persistence
        }

        public func run(_ input: ReadSettingsInput) async -> Result<ReadSettingsResult, SettingsError> {
            let timestamp = clock.now()

            do {
                guard let data = try await persistence.loadSettingsData() else {
                    return .success(ReadSettingsResult(
                        requestID: input.requestID,
                        configuration: .defaults,
                        usedDefaults: true,
                        timestamp: timestamp
                    ))
                }

                let configuration = try Settings.decodeConfiguration(from: data)
                return .success(ReadSettingsResult(
                    requestID: input.requestID,
                    configuration: configuration,
                    usedDefaults: false,
                    timestamp: timestamp
                ))
            } catch let error as SettingsError {
                return .failure(error)
            } catch {
                return .failure(.persistenceFailed(String(describing: error)))
            }
        }
    }

    struct ValidateSettings: FenrirAction {
        public typealias Failure = SettingsError

        public let clock: any SettingsClock

        public init(clock: any SettingsClock) {
            self.clock = clock
        }

        public func run(_ input: ValidateSettingsInput) async -> Result<ValidateSettingsResult, SettingsError> {
            .success(ValidateSettingsResult(
                requestID: input.requestID,
                validation: input.configuration.validatedForLocalPersistence(),
                timestamp: clock.now()
            ))
        }
    }

    struct UpdateSettings: FenrirAction {
        public typealias Failure = SettingsError

        public let clock: any SettingsClock
        public let persistence: any LocalSettingsPersistence

        public init(clock: any SettingsClock, persistence: any LocalSettingsPersistence) {
            self.clock = clock
            self.persistence = persistence
        }

        public func run(_ input: UpdateSettingsInput) async -> Result<UpdateSettingsResult, SettingsError> {
            do {
                let configuration = try await Settings.persistConfiguration(input.configuration, to: persistence)
                return .success(UpdateSettingsResult(
                    requestID: input.requestID,
                    configuration: configuration,
                    timestamp: clock.now()
                ))
            } catch let error as SettingsError {
                return .failure(error)
            } catch {
                return .failure(.persistenceFailed(String(describing: error)))
            }
        }
    }

    /// Typed accessor for the D-045 run-script split button: the merged
    /// script list and primary run script for one workspace.
    struct ReadWorkspaceScripts: FenrirAction {
        public typealias Failure = SettingsError

        public let clock: any SettingsClock
        public let persistence: any LocalSettingsPersistence

        public init(clock: any SettingsClock, persistence: any LocalSettingsPersistence) {
            self.clock = clock
            self.persistence = persistence
        }

        public func run(_ input: ReadWorkspaceScriptsInput) async -> Result<ReadWorkspaceScriptsResult, SettingsError> {
            let timestamp = clock.now()

            do {
                let configuration = try await Settings.loadConfiguration(from: persistence)
                return .success(ReadWorkspaceScriptsResult(
                    requestID: input.requestID,
                    scripts: configuration.runScripts.scripts(forRepositoryPath: input.repositoryPath),
                    primaryRunScript: configuration.runScripts.primaryRunScript(forRepositoryPath: input.repositoryPath),
                    timestamp: timestamp
                ))
            } catch let error as SettingsError {
                return .failure(error)
            } catch {
                return .failure(.persistenceFailed(String(describing: error)))
            }
        }
    }

    /// Replaces the script list for one scope (repository or global) and
    /// persists the result. Global scripts are forced to `.custom` kind
    /// before persistence (forged-kind protection).
    struct UpdateScripts: FenrirAction {
        public typealias Failure = SettingsError

        public let clock: any SettingsClock
        public let persistence: any LocalSettingsPersistence

        public init(clock: any SettingsClock, persistence: any LocalSettingsPersistence) {
            self.clock = clock
            self.persistence = persistence
        }

        public func run(_ input: UpdateScriptsInput) async -> Result<UpdateScriptsResult, SettingsError> {
            do {
                let current = try await Settings.loadConfiguration(from: persistence)
                let updated = current.replacingRunScripts(
                    current.runScripts.replacingScripts(input.scripts, scope: input.scope)
                )
                let configuration = try await Settings.persistConfiguration(updated, to: persistence)
                return .success(UpdateScriptsResult(
                    requestID: input.requestID,
                    configuration: configuration,
                    timestamp: clock.now()
                ))
            } catch let error as SettingsError {
                return .failure(error)
            } catch {
                return .failure(.persistenceFailed(String(describing: error)))
            }
        }
    }

    /// Typed accessor for the D-045 open-in-editor split button: the resolved
    /// editor id for one workspace (repository override, then global default).
    struct ReadEditorTarget: FenrirAction {
        public typealias Failure = SettingsError

        public let clock: any SettingsClock
        public let persistence: any LocalSettingsPersistence

        public init(clock: any SettingsClock, persistence: any LocalSettingsPersistence) {
            self.clock = clock
            self.persistence = persistence
        }

        public func run(_ input: ReadEditorTargetInput) async -> Result<ReadEditorTargetResult, SettingsError> {
            let timestamp = clock.now()

            do {
                let configuration = try await Settings.loadConfiguration(from: persistence)
                return .success(ReadEditorTargetResult(
                    requestID: input.requestID,
                    editorID: configuration.editorTarget.editorID(forRepositoryPath: input.repositoryPath),
                    preference: configuration.editorTarget,
                    timestamp: timestamp
                ))
            } catch let error as SettingsError {
                return .failure(error)
            } catch {
                return .failure(.persistenceFailed(String(describing: error)))
            }
        }
    }

    /// Applies one editor-target change (global default or per-repository
    /// override) and persists the result.
    struct UpdateEditorTarget: FenrirAction {
        public typealias Failure = SettingsError

        public let clock: any SettingsClock
        public let persistence: any LocalSettingsPersistence

        public init(clock: any SettingsClock, persistence: any LocalSettingsPersistence) {
            self.clock = clock
            self.persistence = persistence
        }

        public func run(_ input: UpdateEditorTargetInput) async -> Result<UpdateEditorTargetResult, SettingsError> {
            do {
                let current = try await Settings.loadConfiguration(from: persistence)
                let updated = current.replacingEditorTarget(
                    current.editorTarget.applying(input.change)
                )
                let configuration = try await Settings.persistConfiguration(updated, to: persistence)
                return .success(UpdateEditorTargetResult(
                    requestID: input.requestID,
                    configuration: configuration,
                    timestamp: clock.now()
                ))
            } catch let error as SettingsError {
                return .failure(error)
            } catch {
                return .failure(.persistenceFailed(String(describing: error)))
            }
        }
    }

    struct ObserveSettings: FenrirAction {
        public typealias Failure = SettingsError

        public let clock: any SettingsClock
        public let persistence: any LocalSettingsPersistence

        public init(clock: any SettingsClock, persistence: any LocalSettingsPersistence) {
            self.clock = clock
            self.persistence = persistence
        }

        public func run(_ input: ObserveSettingsInput) async -> Result<ObserveSettingsResult, SettingsError> {
            let timestamp = clock.now()

            do {
                let current = try await Settings.loadConfiguration(from: persistence)
                let source = persistence.observeSettingsData()
                let events = AsyncStream<EventEnvelope<Event>> { continuation in
                    let task = Task {
                        for await update in source {
                            let event: Event

                            switch update {
                            case let .success(data):
                                do {
                                    event = .settingsChanged(try Settings.configuration(from: data))
                                } catch let error as SettingsError {
                                    event = .settingsObservationFailed(error)
                                } catch {
                                    event = .settingsObservationFailed(.decodingFailed(String(describing: error)))
                                }
                            case let .failure(error):
                                event = .settingsObservationFailed(.persistenceFailed(error.message))
                            }

                            continuation.yield(EventEnvelope(
                                eventID: .generated(),
                                eventKind: "settings.updated",
                                timestamp: clock.now(),
                                event: event
                            ))
                        }

                        continuation.finish()
                    }

                    continuation.onTermination = { _ in task.cancel() }
                }

                return .success(ObserveSettingsResult(
                    requestID: input.requestID,
                    current: current,
                    events: events,
                    timestamp: timestamp
                ))
            } catch let error as SettingsError {
                return .failure(error)
            } catch {
                return .failure(.persistenceFailed(String(describing: error)))
            }
        }
    }
}

extension Settings {
    static func loadConfiguration(from persistence: any LocalSettingsPersistence) async throws -> NativeSettingsConfiguration {
        try await configuration(from: persistence.loadSettingsData())
    }

    /// Shared validate → normalize → encode → save path used by every
    /// settings-mutating action; returns the normalized configuration that
    /// was persisted.
    static func persistConfiguration(
        _ configuration: NativeSettingsConfiguration,
        to persistence: any LocalSettingsPersistence
    ) async throws -> NativeSettingsConfiguration {
        let validation = configuration.validatedForLocalPersistence()
        guard validation.isValid else {
            throw SettingsError.validationFailed(validation.issues)
        }

        let data = try encodeConfiguration(validation.configuration)
        try await persistence.saveSettingsData(data)
        return validation.configuration
    }

    static func configuration(from data: Data?) throws -> NativeSettingsConfiguration {
        guard let data else {
            return .defaults
        }

        return try decodeConfiguration(from: data)
    }

    static func decodeConfiguration(from data: Data) throws -> NativeSettingsConfiguration {
        do {
            let document = try settingsJSONDecoder.decode(StoredSettingsDocument.self, from: data)
            let configuration = document.defaultedConfiguration
            let validation = configuration.validatedForLocalPersistence()

            guard validation.isValid else {
                throw SettingsError.validationFailed(validation.issues)
            }

            return validation.configuration
        } catch let error as SettingsError {
            throw error
        } catch {
            throw SettingsError.malformedConfig(String(describing: error))
        }
    }

    static func encodeConfiguration(_ configuration: NativeSettingsConfiguration) throws -> Data {
        do {
            return try settingsJSONEncoder.encode(StoredSettingsDocument(configuration: configuration))
        } catch {
            throw SettingsError.encodingFailed(String(describing: error))
        }
    }

    private static var settingsJSONDecoder: JSONDecoder {
        JSONDecoder()
    }

    private static var settingsJSONEncoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return encoder
    }
}
