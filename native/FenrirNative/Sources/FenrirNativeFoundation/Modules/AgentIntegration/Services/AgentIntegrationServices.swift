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

    enum Event: Codable, Equatable, Sendable {
        case integrationsDetected([AgentCLIIdentifier])
        case integrationProvisioned(AgentCLIIdentifier, ProvisioningChange)
        case mcpProvisioned(AgentCLIIdentifier, WorkspaceID, ProvisioningChange)
        case presenceIngested(AgentPresenceRecord)
        case malformedPresenceDropped(reason: String, provenance: AgentPresenceProvenance)
    }
}
