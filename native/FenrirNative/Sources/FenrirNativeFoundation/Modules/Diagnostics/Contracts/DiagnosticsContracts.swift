import Foundation
import FenrirNativeShared
import Settings

public extension Diagnostics {
    enum DiagnosticsError: Error, Codable, Equatable, Sendable {
        case unavailable
        case disabled
        case storeFailure(String)
    }

    struct DiagnosticEventID: FenrirID, ExpressibleByStringLiteral {
        public let rawValue: String

        public init(rawValue: String) {
            self.rawValue = rawValue
        }

        public init(stringLiteral value: String) {
            self.init(rawValue: value)
        }

        public static func generated() -> DiagnosticEventID {
            DiagnosticEventID(rawValue: UUID().uuidString)
        }
    }

    struct ModuleSummary: Codable, Equatable, Sendable {
        public let moduleName: String
        public let registeredAt: FenrirTimestamp

        public init(moduleName: String = "Diagnostics", registeredAt: FenrirTimestamp) {
            self.moduleName = moduleName
            self.registeredAt = registeredAt
        }
    }

    struct DescribeDiagnosticsModuleInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let source: ActionSource

        public init(requestID: RequestID, source: ActionSource) {
            self.requestID = requestID
            self.source = source
        }
    }

    struct DescribeDiagnosticsModuleResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let summary: ModuleSummary
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, summary: ModuleSummary, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.summary = summary
            self.timestamp = timestamp
        }
    }

    enum DiagnosticCategory: String, Codable, Equatable, Hashable, CaseIterable, Sendable {
        case serverConnection
        case tmuxKernel
        case workflow
        case keybinding
        case nativeRuntime
        case terminalViewport
        case nativeShell
    }

    enum DiagnosticSeverity: String, Codable, Equatable, Comparable, Sendable {
        case debug
        case info
        case warning
        case error

        public static func < (lhs: DiagnosticSeverity, rhs: DiagnosticSeverity) -> Bool {
            lhs.rank < rhs.rank
        }

        var rank: Int {
            switch self {
            case .debug: 0
            case .info: 1
            case .warning: 2
            case .error: 3
            }
        }
    }

    enum DiagnosticPrivacy: String, Codable, Equatable, Sendable {
        case publicMetadata
        case sensitiveMetadata
        case terminalContent
    }

    struct DiagnosticsPolicy: Codable, Equatable, Sendable {
        public let detailLevel: Settings.DiagnosticsDetailLevel
        public let persistLocalLogs: Bool
        public let includeTerminalContent: Bool

        public init(
            detailLevel: Settings.DiagnosticsDetailLevel = .errorsOnly,
            persistLocalLogs: Bool = true,
            includeTerminalContent: Bool = false
        ) {
            self.detailLevel = detailLevel
            self.persistLocalLogs = persistLocalLogs
            self.includeTerminalContent = includeTerminalContent
        }

        public init(settings: Settings.DiagnosticsPolicy) {
            self.init(
                detailLevel: settings.detailLevel,
                persistLocalLogs: settings.persistLocalLogs,
                includeTerminalContent: settings.includeTerminalScrollbackInReports
            )
        }

        public static let defaults = DiagnosticsPolicy()
    }

    struct DiagnosticEvent: Codable, Equatable, Sendable {
        public let id: DiagnosticEventID
        public let workspaceID: WorkspaceID?
        public let category: DiagnosticCategory
        public let severity: DiagnosticSeverity
        public let title: String
        public let message: String
        public let metadata: [String: String]
        public let terminalContent: String?
        public let occurredAt: FenrirTimestamp

        public init(
            id: DiagnosticEventID = .generated(),
            workspaceID: WorkspaceID? = nil,
            category: DiagnosticCategory,
            severity: DiagnosticSeverity,
            title: String,
            message: String,
            metadata: [String: String] = [:],
            terminalContent: String? = nil,
            occurredAt: FenrirTimestamp
        ) {
            self.id = id
            self.workspaceID = workspaceID
            self.category = category
            self.severity = severity
            self.title = title
            self.message = message
            self.metadata = metadata
            self.terminalContent = terminalContent
            self.occurredAt = occurredAt
        }
    }

    struct SafeDiagnosticEvent: Codable, Equatable, Sendable {
        public let id: DiagnosticEventID
        public let workspaceID: WorkspaceID?
        public let category: DiagnosticCategory
        public let severity: DiagnosticSeverity
        public let title: String
        public let message: String
        public let metadata: [String: String]
        public let terminalContentSummary: String?
        public let occurredAt: FenrirTimestamp

        public init(
            id: DiagnosticEventID,
            workspaceID: WorkspaceID?,
            category: DiagnosticCategory,
            severity: DiagnosticSeverity,
            title: String,
            message: String,
            metadata: [String: String],
            terminalContentSummary: String?,
            occurredAt: FenrirTimestamp
        ) {
            self.id = id
            self.workspaceID = workspaceID
            self.category = category
            self.severity = severity
            self.title = title
            self.message = message
            self.metadata = metadata
            self.terminalContentSummary = terminalContentSummary
            self.occurredAt = occurredAt
        }
    }

    struct DiagnosticsReport: Codable, Equatable, Sendable {
        public let generatedAt: FenrirTimestamp
        public let policy: DiagnosticsPolicy
        public let events: [SafeDiagnosticEvent]
        public let categoryCounts: [DiagnosticCategory: Int]
        public let redactionNotice: String

        public init(
            generatedAt: FenrirTimestamp,
            policy: DiagnosticsPolicy,
            events: [SafeDiagnosticEvent],
            categoryCounts: [DiagnosticCategory: Int],
            redactionNotice: String
        ) {
            self.generatedAt = generatedAt
            self.policy = policy
            self.events = events
            self.categoryCounts = categoryCounts
            self.redactionNotice = redactionNotice
        }
    }

    struct RecordDiagnosticEventInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let event: DiagnosticEvent
        public let policy: DiagnosticsPolicy
        public let source: ActionSource

        public init(
            requestID: RequestID,
            event: DiagnosticEvent,
            policy: DiagnosticsPolicy = .defaults,
            source: ActionSource
        ) {
            self.requestID = requestID
            self.event = event
            self.policy = policy
            self.source = source
        }
    }

    struct RecordDiagnosticEventResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let recorded: Bool
        public let event: SafeDiagnosticEvent?
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, recorded: Bool, event: SafeDiagnosticEvent?, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.recorded = recorded
            self.event = event
            self.timestamp = timestamp
        }
    }

    struct BuildDiagnosticsReportInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID?
        public let policy: DiagnosticsPolicy
        public let source: ActionSource

        public init(
            requestID: RequestID,
            workspaceID: WorkspaceID? = nil,
            policy: DiagnosticsPolicy = .defaults,
            source: ActionSource
        ) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.policy = policy
            self.source = source
        }
    }

    struct BuildDiagnosticsReportResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let report: DiagnosticsReport
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, report: DiagnosticsReport, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.report = report
            self.timestamp = timestamp
        }
    }
}
