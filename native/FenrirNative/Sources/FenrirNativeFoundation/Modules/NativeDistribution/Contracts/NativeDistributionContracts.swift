import Foundation
import FenrirNativeShared

public extension NativeDistribution {
    enum DistributionReadinessError: Error, Codable, Equatable, Sendable {
        case dependencyProbeFailed(String)
        case serverAssetProbeFailed(String)
    }

    enum StartupMode: String, Codable, Equatable, Sendable {
        case localDefault
        case existingLocalServer
        case remoteAttach
    }

    enum DependencyKind: String, Codable, Equatable, Sendable {
        case tmux
        case fenrirServerAsset
        case terminalRendererArtifact
        case neovim
    }

    enum DependencyStatus: String, Codable, Equatable, Sendable {
        case available
        case missing
        case unsupportedVersion
        case externalNotBundled
        case notRequired
    }

    enum StartupDiagnosticSeverity: String, Codable, Equatable, Sendable {
        case info
        case warning
        case error
    }

    struct ModuleSummary: Codable, Equatable, Sendable {
        public let moduleName: String
        public let registeredAt: FenrirTimestamp

        public init(moduleName: String = "NativeDistribution", registeredAt: FenrirTimestamp) {
            self.moduleName = moduleName
            self.registeredAt = registeredAt
        }
    }

    struct ToolProbeResult: Codable, Equatable, Sendable {
        public let executablePath: String?
        public let version: String?

        public init(executablePath: String?, version: String?) {
            self.executablePath = executablePath
            self.version = version
        }
    }

    struct ServerAssetProbeResult: Codable, Equatable, Sendable {
        public let assetPath: String?
        public let isExecutable: Bool
        public let version: String?

        public init(assetPath: String?, isExecutable: Bool, version: String? = nil) {
            self.assetPath = assetPath
            self.isExecutable = isExecutable
            self.version = version
        }
    }

    struct TerminalRendererArtifactProbeResult: Codable, Equatable, Sendable {
        public let artifactPath: String?
        public let resourcesPath: String?
        public let isLoadable: Bool
        public let version: String?

        public init(
            artifactPath: String?,
            resourcesPath: String? = nil,
            isLoadable: Bool,
            version: String? = nil
        ) {
            self.artifactPath = artifactPath
            self.resourcesPath = resourcesPath
            self.isLoadable = isLoadable
            self.version = version
        }
    }

    struct DependencyCheck: Codable, Equatable, Sendable {
        public let kind: DependencyKind
        public let status: DependencyStatus
        public let path: String?
        public let version: String?
        public let requiredVersion: String?
        public let message: String

        public init(
            kind: DependencyKind,
            status: DependencyStatus,
            path: String? = nil,
            version: String? = nil,
            requiredVersion: String? = nil,
            message: String
        ) {
            self.kind = kind
            self.status = status
            self.path = path
            self.version = version
            self.requiredVersion = requiredVersion
            self.message = message
        }
    }

    struct StartupDiagnostic: Codable, Equatable, Sendable {
        public let severity: StartupDiagnosticSeverity
        public let title: String
        public let message: String
        public let recoverySuggestion: String

        public init(
            severity: StartupDiagnosticSeverity,
            title: String,
            message: String,
            recoverySuggestion: String
        ) {
            self.severity = severity
            self.title = title
            self.message = message
            self.recoverySuggestion = recoverySuggestion
        }
    }

    struct StartupReadinessReport: Codable, Equatable, Sendable {
        public let mode: StartupMode
        public let canStart: Bool
        public let checks: [DependencyCheck]
        public let diagnostics: [StartupDiagnostic]
        public let generatedAt: FenrirTimestamp

        public init(
            mode: StartupMode,
            canStart: Bool,
            checks: [DependencyCheck],
            diagnostics: [StartupDiagnostic],
            generatedAt: FenrirTimestamp
        ) {
            self.mode = mode
            self.canStart = canStart
            self.checks = checks
            self.diagnostics = diagnostics
            self.generatedAt = generatedAt
        }
    }

    struct DescribeNativeDistributionModuleInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let source: ActionSource

        public init(requestID: RequestID, source: ActionSource) {
            self.requestID = requestID
            self.source = source
        }
    }

    struct DescribeNativeDistributionModuleResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let summary: ModuleSummary
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, summary: ModuleSummary, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.summary = summary
            self.timestamp = timestamp
        }
    }

    struct AssessStartupReadinessInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let mode: StartupMode
        public let minimumTmuxVersion: String
        public let source: ActionSource

        public init(
            requestID: RequestID,
            mode: StartupMode,
            minimumTmuxVersion: String = "3.2",
            source: ActionSource
        ) {
            self.requestID = requestID
            self.mode = mode
            self.minimumTmuxVersion = minimumTmuxVersion
            self.source = source
        }
    }

    struct AssessStartupReadinessResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let report: StartupReadinessReport
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, report: StartupReadinessReport, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.report = report
            self.timestamp = timestamp
        }
    }
}
