import Foundation
import FenrirNativeShared

public extension AgentIntegration {
    protocol AgentIntegrationClock: Sendable {
        func now() -> FenrirTimestamp
    }

    protocol AgentIntegrationDetecting: Sendable {
        func detectAgentIntegrations() async throws -> [AgentIntegrationStatus]
        func integrationStatus(for agentID: AgentCLIIdentifier) async throws -> AgentIntegrationStatus
    }

    protocol AgentProviderInstallTargetResolving: Sendable {
        func resolveAgentProviderInstallTargets() async throws -> [AgentProviderInstallTarget]
        func resolveAgentProviderInstallTarget(for agentID: AgentCLIIdentifier) async throws -> AgentProviderInstallTarget
    }

    protocol AgentIntegrationInstalling: Sendable {
        func installAgentIntegration(_ request: AgentProvisioningRequest) async throws -> AgentProvisioningResult
        func updateAgentIntegration(_ request: AgentProvisioningRequest) async throws -> AgentProvisioningResult
        func removeAgentIntegration(_ request: AgentProvisioningRequest) async throws -> AgentProvisioningResult
    }

    protocol AgentMCPProvisioning: Sendable {
        func provisionAgentMCP(_ request: AgentMCPProvisioningRequest) async throws -> AgentMCPProvisioningResult
    }

    protocol AgentPresenceStoring: Sendable {
        func upsertPresence(_ event: AgentPresenceEvent) async throws
        func listPresence(workspaceID: WorkspaceID?) async throws -> [AgentPresenceRecord]
    }

    protocol AgentIntegrationEventSinking: Sendable {
        func emit(_ event: EventEnvelope<Event>) async
    }

    protocol AgentIntegrationPreferences: Sendable {
        func preferredTargetVersion(for agentID: AgentCLIIdentifier) async -> IntegrationVersion
    }

    static func providerAgentInstallTargetResolver(homeDirectoryPath: String = "~") -> any AgentProviderInstallTargetResolving {
        ProviderAgentInstallTargetResolver(homeDirectoryPath: homeDirectoryPath)
    }

    static func providerStructuredAgentIntegrationProvisioner(
        configStore: any AgentIntegrationConfigFileStoring,
        clock: any AgentIntegrationClock,
        homeDirectoryPath: String = "~",
        integrationVersion: IntegrationVersion = "1.0.0"
    ) -> ProviderStructuredAgentIntegrationProvisioner {
        ProviderStructuredAgentIntegrationProvisioner(
            targetResolver: ProviderAgentInstallTargetResolver(homeDirectoryPath: homeDirectoryPath),
            configStore: configStore,
            clock: clock,
            integrationVersion: integrationVersion
        )
    }

    static func pathAgentIntegrationDetector(
        pathEnvironment: String = ProcessInfo.processInfo.environment["PATH"] ?? "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
        expectedVersion: IntegrationVersion = "1.0.0"
    ) -> any AgentIntegrationDetecting {
        PathAgentIntegrationDetector(pathEnvironment: pathEnvironment, expectedVersion: expectedVersion)
    }

    enum Event: Codable, Equatable, Sendable {
        case integrationsDetected([AgentCLIIdentifier])
        case integrationProvisioned(AgentCLIIdentifier, ProvisioningChange)
        case mcpProvisioned(AgentCLIIdentifier, WorkspaceID, ProvisioningChange)
        case presenceIngested(AgentPresenceRecord)
        case malformedPresenceDropped(reason: String, provenance: AgentPresenceProvenance)
    }
}
