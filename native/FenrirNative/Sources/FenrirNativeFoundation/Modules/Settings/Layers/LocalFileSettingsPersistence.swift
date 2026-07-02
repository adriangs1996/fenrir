import Foundation
import FenrirNativeShared

extension Settings {
    actor LocalFileSettingsPersistence: LocalSettingsPersistence {
        private let settingsFileURL: URL
        private let observerStore = LocalSettingsObserverStore()

        init(settingsFileURL: URL) {
            self.settingsFileURL = settingsFileURL
        }

        func loadSettingsData() async throws -> Data? {
            do {
                guard FileManager.default.fileExists(atPath: settingsFileURL.path) else {
                    return nil
                }

                return try Data(contentsOf: settingsFileURL)
            } catch {
                throw SettingsPersistenceFailure(message: String(describing: error))
            }
        }

        func saveSettingsData(_ data: Data) async throws {
            do {
                let directoryURL = settingsFileURL.deletingLastPathComponent()
                try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
                try data.write(to: settingsFileURL, options: [.atomic])
                observerStore.publish(.success(data))
            } catch {
                let failure = SettingsPersistenceFailure(message: String(describing: error))
                observerStore.publish(.failure(failure))
                throw failure
            }
        }

        nonisolated func observeSettingsData() -> AsyncStream<Result<Data?, SettingsPersistenceFailure>> {
            let observerStore = self.observerStore
            return AsyncStream { continuation in
                let observerID = UUID()
                observerStore.add(id: observerID, continuation: continuation)
                continuation.onTermination = { _ in
                    observerStore.remove(id: observerID)
                }
            }
        }
    }

    final class LocalSettingsObserverStore: @unchecked Sendable {
        private let lock = NSLock()
        private var observers: [UUID: AsyncStream<Result<Data?, SettingsPersistenceFailure>>.Continuation] = [:]

        func add(id: UUID, continuation: AsyncStream<Result<Data?, SettingsPersistenceFailure>>.Continuation) {
            lock.withLock {
                observers[id] = continuation
            }
        }

        func remove(id: UUID) {
            let observer = lock.withLock {
                observers.removeValue(forKey: id)
            }
            observer?.finish()
        }

        func publish(_ update: Result<Data?, SettingsPersistenceFailure>) {
            let activeObservers = lock.withLock {
                Array(observers.values)
            }
            for observer in activeObservers {
                observer.yield(update)
            }
        }
    }
}
