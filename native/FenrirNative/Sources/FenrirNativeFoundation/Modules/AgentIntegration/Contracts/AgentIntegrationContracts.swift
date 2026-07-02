import Foundation
import FenrirNativeShared

public extension AgentIntegration {
    enum AgentIntegrationError: Error, Codable, Equatable, Sendable {
        case unavailable
        case unsupportedAgent(AgentCLIIdentifier)
        case malformedPresence(String)
        case staleIntegration(expected: IntegrationVersion, actual: IntegrationVersion?)
        case configConflict(String)
    }

    enum AgentCLIIdentifier: String, Codable, Equatable, Hashable, CaseIterable, Sendable {
        case claudeCode
        case codex
        case cursor
        case openCode
        case custom
        case future
    }

    struct AgentDescriptor: Codable, Equatable, Sendable {
        public let id: AgentCLIIdentifier
        public let displayName: String
        public let executableNames: [String]
        public let supportsHooks: Bool
        public let supportsSkills: Bool
        public let supportsMCP: Bool

        public init(
            id: AgentCLIIdentifier,
            displayName: String,
            executableNames: [String],
            supportsHooks: Bool,
            supportsSkills: Bool,
            supportsMCP: Bool
        ) {
            self.id = id
            self.displayName = displayName
            self.executableNames = executableNames
            self.supportsHooks = supportsHooks
            self.supportsSkills = supportsSkills
            self.supportsMCP = supportsMCP
        }
    }

    static let supportedAgentDescriptors: [AgentDescriptor] = [
        AgentDescriptor(id: .claudeCode, displayName: "Claude Code", executableNames: ["claude"], supportsHooks: true, supportsSkills: true, supportsMCP: true),
        AgentDescriptor(id: .codex, displayName: "Codex", executableNames: ["codex"], supportsHooks: true, supportsSkills: true, supportsMCP: true),
        AgentDescriptor(id: .cursor, displayName: "Cursor", executableNames: ["cursor"], supportsHooks: true, supportsSkills: true, supportsMCP: true),
        AgentDescriptor(id: .openCode, displayName: "OpenCode", executableNames: ["opencode"], supportsHooks: true, supportsSkills: true, supportsMCP: true),
        AgentDescriptor(id: .custom, displayName: "Custom Agent", executableNames: [], supportsHooks: false, supportsSkills: false, supportsMCP: false),
        AgentDescriptor(id: .future, displayName: "Future Adapter", executableNames: [], supportsHooks: false, supportsSkills: false, supportsMCP: false)
    ]

    struct IntegrationVersion: Codable, Equatable, Comparable, Sendable, ExpressibleByStringLiteral {
        public let rawValue: String

        public init(_ rawValue: String) {
            self.rawValue = rawValue
        }

        public init(stringLiteral value: String) {
            self.init(value)
        }

        public static func < (lhs: IntegrationVersion, rhs: IntegrationVersion) -> Bool {
            lhs.rawValue.localizedStandardCompare(rhs.rawValue) == .orderedAscending
        }
    }

    enum IntegrationState: String, Codable, Equatable, Sendable {
        case notInstalled
        case installed
        case outdated
        case conflicted
        case unsupported
    }

    struct ManagedConfigOwnership: Codable, Equatable, Sendable {
        public static let owner = "fenrir"
        public static let markerNamespace = "fenrir-agent-integration"

        public let owner: String
        public let version: IntegrationVersion
        public let blockID: String

        public init(owner: String = Self.owner, version: IntegrationVersion, blockID: String) {
            self.owner = owner
            self.version = version
            self.blockID = blockID
        }
    }

    struct AgentIntegrationStatus: Codable, Equatable, Sendable {
        public let agent: AgentDescriptor
        public let state: IntegrationState
        public let installedVersion: IntegrationVersion?
        public let expectedVersion: IntegrationVersion
        public let ownership: ManagedConfigOwnership?
        public let detectedExecutablePath: String?

        public init(
            agent: AgentDescriptor,
            state: IntegrationState,
            installedVersion: IntegrationVersion? = nil,
            expectedVersion: IntegrationVersion,
            ownership: ManagedConfigOwnership? = nil,
            detectedExecutablePath: String? = nil
        ) {
            self.agent = agent
            self.state = state
            self.installedVersion = installedVersion
            self.expectedVersion = expectedVersion
            self.ownership = ownership
            self.detectedExecutablePath = detectedExecutablePath
        }
    }

    enum ProvisioningChange: String, Codable, Equatable, Sendable {
        case unchanged
        case installed
        case updated
        case removed
    }

    struct AgentProvisioningRequest: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let agentID: AgentCLIIdentifier
        public let workspaceID: WorkspaceID?
        public let targetVersion: IntegrationVersion
        public let source: ActionSource

        public init(requestID: RequestID, agentID: AgentCLIIdentifier, workspaceID: WorkspaceID? = nil, targetVersion: IntegrationVersion, source: ActionSource) {
            self.requestID = requestID
            self.agentID = agentID
            self.workspaceID = workspaceID
            self.targetVersion = targetVersion
            self.source = source
        }
    }

    struct AgentProvisioningResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let agentID: AgentCLIIdentifier
        public let change: ProvisioningChange
        public let status: AgentIntegrationStatus
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, agentID: AgentCLIIdentifier, change: ProvisioningChange, status: AgentIntegrationStatus, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.agentID = agentID
            self.change = change
            self.status = status
            self.timestamp = timestamp
        }
    }

    enum ProvisioningArtifact: String, Codable, Equatable, Hashable, Sendable {
        case hooks
        case skills
        case mcp
    }

    struct AgentMCPServerDescriptor: Codable, Equatable, Sendable {
        public let name: String
        public let command: String
        public let arguments: [String]
        public let environment: [String: String]

        public init(name: String, command: String, arguments: [String] = [], environment: [String: String] = [:]) {
            self.name = name
            self.command = command
            self.arguments = arguments
            self.environment = environment
        }
    }

    struct AgentMCPProvisioningRequest: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let agentID: AgentCLIIdentifier
        public let workspaceID: WorkspaceID
        public let servers: [AgentMCPServerDescriptor]
        public let source: ActionSource

        public init(requestID: RequestID, agentID: AgentCLIIdentifier, workspaceID: WorkspaceID, servers: [AgentMCPServerDescriptor], source: ActionSource) {
            self.requestID = requestID
            self.agentID = agentID
            self.workspaceID = workspaceID
            self.servers = servers
            self.source = source
        }
    }

    struct AgentMCPProvisioningResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let agentID: AgentCLIIdentifier
        public let workspaceID: WorkspaceID
        public let change: ProvisioningChange
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, agentID: AgentCLIIdentifier, workspaceID: WorkspaceID, change: ProvisioningChange, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.agentID = agentID
            self.workspaceID = workspaceID
            self.change = change
            self.timestamp = timestamp
        }
    }

    enum AgentPresenceState: String, Codable, Equatable, CaseIterable, Sendable {
        case sessionStarted
        case busy
        case awaitingInput
        case awaitingApproval
        case turnCompleted
        case failed
        case sessionEnded
    }

    enum AgentPresenceProvenanceKind: String, Codable, Equatable, Sendable {
        case terminalViewportForwardedOSC
    }

    struct AgentPresenceProvenance: Codable, Equatable, Hashable, Sendable {
        public let workspaceID: WorkspaceID
        public let tabID: FenrirWindowID?
        public let paneID: PaneID
        public let viewportID: ViewportID?
        public let kind: AgentPresenceProvenanceKind

        public init(
            workspaceID: WorkspaceID,
            tabID: FenrirWindowID? = nil,
            paneID: PaneID,
            viewportID: ViewportID? = nil,
            kind: AgentPresenceProvenanceKind = .terminalViewportForwardedOSC
        ) {
            self.workspaceID = workspaceID
            self.tabID = tabID
            self.paneID = paneID
            self.viewportID = viewportID
            self.kind = kind
        }
    }

    struct AgentPresenceSignal: Codable, Equatable, Sendable {
        public static let oscIdentifier = 8737
        public static let namespace = "com.fenrir.agent.presence.v1"

        public let oscIdentifier: Int
        public let payload: String
        public let provenance: AgentPresenceProvenance

        public init(oscIdentifier: Int = Self.oscIdentifier, payload: String, provenance: AgentPresenceProvenance) {
            self.oscIdentifier = oscIdentifier
            self.payload = payload
            self.provenance = provenance
        }
    }

    struct AgentPresenceEvent: Codable, Equatable, Sendable {
        public let agentID: AgentCLIIdentifier
        public let state: AgentPresenceState
        public let provenance: AgentPresenceProvenance
        public let sequence: Int?
        public let emittedAt: FenrirTimestamp?
        public let ingestedAt: FenrirTimestamp

        public init(agentID: AgentCLIIdentifier, state: AgentPresenceState, provenance: AgentPresenceProvenance, sequence: Int? = nil, emittedAt: FenrirTimestamp? = nil, ingestedAt: FenrirTimestamp) {
            self.agentID = agentID
            self.state = state
            self.provenance = provenance
            self.sequence = sequence
            self.emittedAt = emittedAt
            self.ingestedAt = ingestedAt
        }
    }

    struct AgentPresenceRecord: Codable, Equatable, Sendable {
        public let agentID: AgentCLIIdentifier
        public let state: AgentPresenceState
        public let provenance: AgentPresenceProvenance
        public let sequence: Int?
        public let updatedAt: FenrirTimestamp

        public init(event: AgentPresenceEvent) {
            self.agentID = event.agentID
            self.state = event.state
            self.provenance = event.provenance
            self.sequence = event.sequence
            self.updatedAt = event.ingestedAt
        }
    }

    struct IngestAgentPresenceSignalInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let signal: AgentPresenceSignal
        public let source: ActionSource

        public init(requestID: RequestID, signal: AgentPresenceSignal, source: ActionSource) {
            self.requestID = requestID
            self.signal = signal
            self.source = source
        }
    }

    struct IngestAgentPresenceSignalResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let stored: Bool
        public let event: AgentPresenceEvent?
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, stored: Bool, event: AgentPresenceEvent?, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.stored = stored
            self.event = event
            self.timestamp = timestamp
        }
    }

    struct ListAgentPresenceInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID?
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID? = nil, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.source = source
        }
    }

    struct ListAgentPresenceResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let records: [AgentPresenceRecord]
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, records: [AgentPresenceRecord], timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.records = records
            self.timestamp = timestamp
        }
    }

    struct DetectAgentIntegrationsInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let source: ActionSource

        public init(requestID: RequestID, source: ActionSource) {
            self.requestID = requestID
            self.source = source
        }
    }

    struct DetectAgentIntegrationsResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let statuses: [AgentIntegrationStatus]
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, statuses: [AgentIntegrationStatus], timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.statuses = statuses
            self.timestamp = timestamp
        }
    }

    struct GetAgentIntegrationStatusResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let status: AgentIntegrationStatus
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, status: AgentIntegrationStatus, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.status = status
            self.timestamp = timestamp
        }
    }

    struct GetAgentIntegrationStatusInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let agentID: AgentCLIIdentifier
        public let source: ActionSource

        public init(requestID: RequestID, agentID: AgentCLIIdentifier, source: ActionSource) {
            self.requestID = requestID
            self.agentID = agentID
            self.source = source
        }
    }
}
