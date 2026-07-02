import Foundation
import FenrirNativeShared

public extension Diagnostics {
    struct DescribeDiagnosticsModule: FenrirAction {
        public typealias Failure = DiagnosticsError

        public let clock: any DiagnosticsClock

        public init(clock: any DiagnosticsClock) {
            self.clock = clock
        }

        public func run(_ input: DescribeDiagnosticsModuleInput) async -> Result<DescribeDiagnosticsModuleResult, DiagnosticsError> {
            let timestamp = clock.now()
            return .success(DescribeDiagnosticsModuleResult(
                requestID: input.requestID,
                summary: ModuleSummary(registeredAt: timestamp),
                timestamp: timestamp
            ))
        }
    }

    struct RecordDiagnosticEvent: FenrirAction {
        public typealias Failure = DiagnosticsError

        public let clock: any DiagnosticsClock
        public let store: any DiagnosticsStore
        public let redactor: any DiagnosticsRedactor

        public init(clock: any DiagnosticsClock, store: any DiagnosticsStore, redactor: any DiagnosticsRedactor) {
            self.clock = clock
            self.store = store
            self.redactor = redactor
        }

        public func run(_ input: RecordDiagnosticEventInput) async -> Result<RecordDiagnosticEventResult, DiagnosticsError> {
            let timestamp = clock.now()
            guard Diagnostics.shouldRecord(input.event, policy: input.policy) else {
                return .success(RecordDiagnosticEventResult(
                    requestID: input.requestID,
                    recorded: false,
                    event: nil,
                    timestamp: timestamp
                ))
            }

            let safeEvent = redactor.safeEvent(from: input.event, policy: input.policy)
            do {
                try await store.record(safeEvent)
                return .success(RecordDiagnosticEventResult(
                    requestID: input.requestID,
                    recorded: true,
                    event: safeEvent,
                    timestamp: timestamp
                ))
            } catch let error as DiagnosticsError {
                return .failure(error)
            } catch {
                return .failure(.storeFailure(String(describing: error)))
            }
        }
    }

    struct BuildDiagnosticsReport: FenrirAction {
        public typealias Failure = DiagnosticsError

        public let clock: any DiagnosticsClock
        public let store: any DiagnosticsStore

        public init(clock: any DiagnosticsClock, store: any DiagnosticsStore) {
            self.clock = clock
            self.store = store
        }

        public func run(_ input: BuildDiagnosticsReportInput) async -> Result<BuildDiagnosticsReportResult, DiagnosticsError> {
            let timestamp = clock.now()
            guard input.policy.detailLevel != .off else {
                return .success(BuildDiagnosticsReportResult(
                    requestID: input.requestID,
                    report: DiagnosticsReport(
                        generatedAt: timestamp,
                        policy: input.policy,
                        events: [],
                        categoryCounts: [:],
                        redactionNotice: "Diagnostics are disabled."
                    ),
                    timestamp: timestamp
                ))
            }

            do {
                let events = Diagnostics.eventsForReport(
                    try await store.list(workspaceID: input.workspaceID),
                    policy: input.policy
                )
                let report = DiagnosticsReport(
                    generatedAt: timestamp,
                    policy: input.policy,
                    events: events,
                    categoryCounts: Diagnostics.categoryCounts(events),
                    redactionNotice: input.policy.includeTerminalContent
                        ? "Sensitive metadata is redacted; terminal content may be included by explicit policy."
                        : "Sensitive metadata and terminal content are redacted."
                )
                return .success(BuildDiagnosticsReportResult(
                    requestID: input.requestID,
                    report: report,
                    timestamp: timestamp
                ))
            } catch let error as DiagnosticsError {
                return .failure(error)
            } catch {
                return .failure(.storeFailure(String(describing: error)))
            }
        }
    }

    static func eventsForReport(_ events: [SafeDiagnosticEvent], policy: DiagnosticsPolicy) -> [SafeDiagnosticEvent] {
        guard !policy.includeTerminalContent else {
            return events
        }

        return events.map { event in
            guard event.terminalContentSummary != nil else {
                return event
            }

            return SafeDiagnosticEvent(
                id: event.id,
                workspaceID: event.workspaceID,
                category: event.category,
                severity: event.severity,
                title: event.title,
                message: event.message,
                metadata: event.metadata,
                terminalContentSummary: "[redacted terminal content]",
                occurredAt: event.occurredAt
            )
        }
    }

    static func shouldRecord(_ event: DiagnosticEvent, policy: DiagnosticsPolicy) -> Bool {
        guard policy.persistLocalLogs else {
            return false
        }

        switch policy.detailLevel {
        case .off:
            return false
        case .errorsOnly:
            return event.severity >= .warning
        case .verboseLocal:
            return true
        }
    }

    static func categoryCounts(_ events: [SafeDiagnosticEvent]) -> [DiagnosticCategory: Int] {
        events.reduce(into: [:]) { counts, event in
            counts[event.category, default: 0] += 1
        }
    }
}
