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
            let validation = input.configuration.validatedForLocalPersistence()
            guard validation.isValid else {
                return .failure(.validationFailed(validation.issues))
            }

            do {
                let data = try Settings.encodeConfiguration(validation.configuration)
                try await persistence.saveSettingsData(data)
                return .success(UpdateSettingsResult(
                    requestID: input.requestID,
                    configuration: validation.configuration,
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
