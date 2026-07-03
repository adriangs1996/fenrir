import Foundation
import FenrirNativeShared

public extension Diagnostics {
    static func localFileDiagnosticsStore(
        eventsFileURL: URL = defaultLocalDiagnosticsEventsFileURL(),
        maximumEvents: Int = 500
    ) -> any DiagnosticsStore {
        FileDiagnosticsStore(eventsFileURL: eventsFileURL, maximumEvents: maximumEvents)
    }

    static func defaultLocalDiagnosticsEventsFileURL() -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("Application Support", isDirectory: true)
            .appendingPathComponent("FenrirNative", isDirectory: true)
            .appendingPathComponent("Diagnostics", isDirectory: true)
            .appendingPathComponent("events.jsonl")
    }

    @discardableResult
    static func recordNativeCrashReport(
        exceptionName: String,
        reason: String?,
        callStackSymbols: [String],
        occurredAt: FenrirTimestamp = FenrirTimestamp(Date()),
        eventsFileURL: URL = defaultLocalDiagnosticsEventsFileURL(),
        maximumEvents: Int = 500
    ) -> Bool {
        let frames = callStackSymbols.prefix(32).joined(separator: "\n")
        var metadata = [
            "exceptionName": exceptionName,
            "frameCount": String(callStackSymbols.count)
        ]
        if let topFrame = callStackSymbols.first {
            metadata["topFrame"] = topFrame
        }
        if !frames.isEmpty {
            metadata["callStack"] = frames
        }

        let message: String
        if let reason, !reason.isEmpty {
            message = "Uncaught native exception: \(reason)"
        } else {
            message = "Uncaught native exception."
        }

        let event = DiagnosticEvent(
            category: .crashReport,
            severity: .error,
            title: "Native crash captured",
            message: message,
            metadata: metadata,
            occurredAt: occurredAt
        )
        let safeEvent = SupportBundleRedactor().safeEvent(from: event, policy: .defaults)

        do {
            try FileDiagnosticsStore.recordSynchronously(
                safeEvent,
                to: eventsFileURL,
                maximumEvents: maximumEvents
            )
            return true
        } catch {
            return false
        }
    }
}

extension Diagnostics {
    actor FileDiagnosticsStore: DiagnosticsStore {
        private let eventsFileURL: URL
        private let maximumEvents: Int

        init(eventsFileURL: URL, maximumEvents: Int) {
            self.eventsFileURL = eventsFileURL
            self.maximumEvents = max(1, maximumEvents)
        }

        func record(_ event: SafeDiagnosticEvent) async throws {
            do {
                try Self.recordSynchronously(
                    event,
                    to: eventsFileURL,
                    maximumEvents: maximumEvents
                )
            } catch {
                throw DiagnosticsError.storeFailure(String(describing: error))
            }
        }

        func list(workspaceID: WorkspaceID?) async throws -> [SafeDiagnosticEvent] {
            do {
                let events = try Self.readEvents(from: eventsFileURL)
                guard let workspaceID else {
                    return events
                }
                return events.filter { $0.workspaceID == nil || $0.workspaceID == workspaceID }
            } catch {
                throw DiagnosticsError.storeFailure(String(describing: error))
            }
        }

        fileprivate static func recordSynchronously(
            _ event: SafeDiagnosticEvent,
            to eventsFileURL: URL,
            maximumEvents: Int
        ) throws {
            let maximumEvents = max(1, maximumEvents)
            let fileManager = FileManager.default
            try fileManager.createDirectory(
                at: eventsFileURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )

            let line = try encodedLine(for: event)
            if fileManager.fileExists(atPath: eventsFileURL.path) {
                let handle = try FileHandle(forWritingTo: eventsFileURL)
                defer { try? handle.close() }
                try handle.seekToEnd()
                try handle.write(contentsOf: line)
            } else {
                try line.write(to: eventsFileURL, options: [.atomic])
            }

            try trimEvents(at: eventsFileURL, maximumEvents: maximumEvents)
        }

        private static func readEvents(from eventsFileURL: URL) throws -> [SafeDiagnosticEvent] {
            guard FileManager.default.fileExists(atPath: eventsFileURL.path) else {
                return []
            }

            let data = try Data(contentsOf: eventsFileURL)
            guard !data.isEmpty else {
                return []
            }

            let decoder = JSONDecoder()
            return String(decoding: data, as: UTF8.self)
                .split(separator: "\n", omittingEmptySubsequences: true)
                .compactMap { line in
                    try? decoder.decode(SafeDiagnosticEvent.self, from: Data(line.utf8))
                }
        }

        private static func trimEvents(at eventsFileURL: URL, maximumEvents: Int) throws {
            let events = try readEvents(from: eventsFileURL)
            guard events.count > maximumEvents else {
                return
            }

            var output = Data()
            for event in events.suffix(maximumEvents) {
                output.append(try encodedLine(for: event))
            }
            try output.write(to: eventsFileURL, options: [.atomic])
        }

        private static func encodedLine(for event: SafeDiagnosticEvent) throws -> Data {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
            var data = try encoder.encode(event)
            data.append(0x0A)
            return data
        }
    }
}
