import Foundation
import FenrirNativeShared

public extension AgentIntegration {
    enum AgentProviderConfigFormat: String, Codable, Equatable, Sendable {
        case jsonHooks
        case tomlHooks
        case markdownSkill
        case jsonMCP
        case tomlMCP
        case javascriptPlugin
        case unavailable
    }

    enum AgentProviderWriteStrategy: String, Codable, Equatable, Sendable {
        case ownedFile
        case sharedStructuredMerge
        case unavailable
    }

    struct AgentProviderFileTarget: Codable, Equatable, Sendable {
        public let artifact: ProvisioningArtifact
        public let path: String
        public let format: AgentProviderConfigFormat
        public let writeStrategy: AgentProviderWriteStrategy
        public let requiresProviderSpecificRenderer: Bool
        public let notes: [String]

        public init(
            artifact: ProvisioningArtifact,
            path: String,
            format: AgentProviderConfigFormat,
            writeStrategy: AgentProviderWriteStrategy,
            requiresProviderSpecificRenderer: Bool,
            notes: [String] = []
        ) {
            self.artifact = artifact
            self.path = path
            self.format = format
            self.writeStrategy = writeStrategy
            self.requiresProviderSpecificRenderer = requiresProviderSpecificRenderer
            self.notes = notes
        }
    }

    struct AgentProviderInstallTarget: Codable, Equatable, Sendable {
        public let agent: AgentDescriptor
        public let configurationDirectoryPath: String
        public let fileTargets: [AgentProviderFileTarget]
        public let notes: [String]

        public init(
            agent: AgentDescriptor,
            configurationDirectoryPath: String,
            fileTargets: [AgentProviderFileTarget],
            notes: [String] = []
        ) {
            self.agent = agent
            self.configurationDirectoryPath = configurationDirectoryPath
            self.fileTargets = fileTargets
            self.notes = notes
        }

        public var requiresProviderSpecificRenderer: Bool {
            fileTargets.contains { $0.requiresProviderSpecificRenderer }
        }

        public var supportsHooksOrSkills: Bool {
            fileTargets.contains { $0.artifact == .hooks || $0.artifact == .skills }
        }
    }

    struct ResolveAgentProviderInstallTargetsInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let agentID: AgentCLIIdentifier?
        public let source: ActionSource

        public init(requestID: RequestID, agentID: AgentCLIIdentifier? = nil, source: ActionSource) {
            self.requestID = requestID
            self.agentID = agentID
            self.source = source
        }
    }

    struct ResolveAgentProviderInstallTargetsResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let targets: [AgentProviderInstallTarget]
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, targets: [AgentProviderInstallTarget], timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.targets = targets
            self.timestamp = timestamp
        }
    }
}
