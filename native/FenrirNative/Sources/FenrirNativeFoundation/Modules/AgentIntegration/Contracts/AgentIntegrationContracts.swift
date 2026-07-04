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

    // MARK: - D-044 agent session resume

    /// Allowlisted shape for agent-native session identifiers
    /// (`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`). Session ids originate in-band
    /// (hook payloads forwarded over the reserved OSC channel), so they MUST
    /// be validated against this strict allowlist before any interpolation
    /// into a resume command or a pane-metadata RPC (D-044). The first
    /// character must be alphanumeric: a leading `-` would let a
    /// pane-controlled id reach the agent CLI as an option token (e.g.
    /// `claude --resume --dangerous-flag`) — argument injection.
    static let agentSessionIDPattern = "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"

    static func isValidAgentSessionID(_ raw: String) -> Bool {
        guard !raw.isEmpty, raw.count <= 128 else {
            return false
        }
        guard let first = raw.unicodeScalars.first, isAlphanumericScalar(first) else {
            return false
        }
        return raw.unicodeScalars.allSatisfy { scalar in
            switch scalar {
            case "A"..."Z", "a"..."z", "0"..."9", ".", "_", "-":
                return true
            default:
                return false
            }
        }
    }

    private static func isAlphanumericScalar(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar {
        case "A"..."Z", "a"..."z", "0"..."9":
            return true
        default:
            return false
        }
    }

    /// Per-adapter resume command descriptor (D-044). Resume commands come
    /// EXCLUSIVELY from this table — hook payloads and pane content never
    /// supply command strings; the only in-band datum is the session id,
    /// validated against `agentSessionIDPattern` before interpolation.
    struct AgentResumeDescriptor: Codable, Equatable, Sendable {
        public let agentID: AgentCLIIdentifier
        /// Fixed command tokens the validated session id is appended to,
        /// e.g. `["claude", "--resume"]` -> `claude --resume <id>`.
        public let commandPrefix: [String]

        public init(agentID: AgentCLIIdentifier, commandPrefix: [String]) {
            self.agentID = agentID
            self.commandPrefix = commandPrefix
        }

        /// Interpolates a validated session id into the descriptor's command.
        /// Returns nil for session ids outside the strict allowlist — the id
        /// never reaches the shell in that case.
        public func command(sessionID: String) -> String? {
            guard AgentIntegration.isValidAgentSessionID(sessionID) else {
                return nil
            }
            return (commandPrefix + [sessionID]).joined(separator: " ")
        }
    }

    /// Resume command table mirroring each agent CLI's documented resume
    /// invocation (reference ergonomics: cmux agent-hooks resume table).
    /// Adapters without a descriptor simply show a dead pane (D-044).
    static let agentResumeDescriptors: [AgentResumeDescriptor] = [
        AgentResumeDescriptor(agentID: .claudeCode, commandPrefix: ["claude", "--resume"]),
        AgentResumeDescriptor(agentID: .codex, commandPrefix: ["codex", "resume"]),
        AgentResumeDescriptor(agentID: .openCode, commandPrefix: ["opencode", "--session"]),
        AgentResumeDescriptor(agentID: .cursor, commandPrefix: ["cursor-agent", "--resume"])
    ]

    static func resumeDescriptor(for agentID: AgentCLIIdentifier) -> AgentResumeDescriptor? {
        agentResumeDescriptors.first { $0.agentID == agentID }
    }

    /// Builds the validated resume command for an agent session, or nil when
    /// the adapter has no resume descriptor or the session id fails the
    /// allowlist. This is the ONLY sanctioned path from a recorded session id
    /// to a runnable command string.
    static func resumeCommand(agentID: AgentCLIIdentifier, sessionID: String) -> String? {
        resumeDescriptor(for: agentID)?.command(sessionID: sessionID)
    }

    /// A recorded, potentially resumable agent session derived from presence
    /// records (D-044). `paneAlive` distinguishes sessions whose pane process
    /// is still in the grid (no resume affordance) from dead ones.
    struct AgentResumableSessionSnapshot: Codable, Equatable, Sendable {
        public let agentID: AgentCLIIdentifier
        public let sessionID: String
        public let provenance: AgentPresenceProvenance
        public let updatedAt: FenrirTimestamp
        public let paneAlive: Bool

        public init(
            agentID: AgentCLIIdentifier,
            sessionID: String,
            provenance: AgentPresenceProvenance,
            updatedAt: FenrirTimestamp,
            paneAlive: Bool
        ) {
            self.agentID = agentID
            self.sessionID = sessionID
            self.provenance = provenance
            self.updatedAt = updatedAt
            self.paneAlive = paneAlive
        }
    }

    /// Derives resumable-session snapshots from presence records: only
    /// records carrying a valid session id for an adapter with a resume
    /// descriptor qualify; one snapshot per (agent, session) keeping the
    /// most recent record. Pure so the sidebar, palette, and diagnostics
    /// smoke share the exact same derivation.
    static func resumableAgentSessions(
        records: [AgentPresenceRecord],
        livePaneIDs: Set<PaneID>
    ) -> [AgentResumableSessionSnapshot] {
        var latest: [String: AgentPresenceRecord] = [:]
        for record in records {
            guard let sessionID = record.sessionID,
                  isValidAgentSessionID(sessionID),
                  resumeDescriptor(for: record.agentID) != nil
            else {
                continue
            }
            let key = "\(record.agentID.rawValue)\u{1F}\(sessionID)"
            if let existing = latest[key], existing.updatedAt >= record.updatedAt {
                continue
            }
            latest[key] = record
        }
        return latest.values
            .map { record in
                AgentResumableSessionSnapshot(
                    agentID: record.agentID,
                    sessionID: record.sessionID ?? "",
                    provenance: record.provenance,
                    updatedAt: record.updatedAt,
                    paneAlive: livePaneIDs.contains(record.provenance.paneID)
                )
            }
            .sorted { lhs, rhs in
                if lhs.updatedAt != rhs.updatedAt {
                    return lhs.updatedAt > rhs.updatedAt
                }
                if lhs.agentID.rawValue != rhs.agentID.rawValue {
                    return lhs.agentID.rawValue < rhs.agentID.rawValue
                }
                return lhs.sessionID < rhs.sessionID
            }
    }

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

    struct AgentIntegrationViewCommand: Codable, Equatable, Sendable {
        public enum Kind: Codable, Equatable, Sendable {
            case refresh
            case repair(agentID: AgentCLIIdentifier)
            case remove(agentID: AgentCLIIdentifier)
        }

        public let requestID: RequestID
        public let source: ActionSource
        public let kind: Kind

        public init(requestID: RequestID = .generated(), source: ActionSource, kind: Kind) {
            self.requestID = requestID
            self.source = source
            self.kind = kind
        }
    }

    struct AgentIntegrationPanelState: Codable, Equatable, Sendable {
        public let statuses: [AgentIntegrationStatus]
        public let lastProvisioningResult: AgentProvisioningResult?
        public let lastErrorMessage: String?
        public let timestamp: FenrirTimestamp

        public init(
            statuses: [AgentIntegrationStatus],
            lastProvisioningResult: AgentProvisioningResult? = nil,
            lastErrorMessage: String? = nil,
            timestamp: FenrirTimestamp
        ) {
            self.statuses = statuses
            self.lastProvisioningResult = lastProvisioningResult
            self.lastErrorMessage = lastErrorMessage
            self.timestamp = timestamp
        }

        public var degradedStatuses: [AgentIntegrationStatus] {
            statuses.filter { status in
                switch status.state {
                case .installed:
                    return false
                case .notInstalled:
                    return status.detectedExecutablePath != nil
                case .outdated, .conflicted, .unsupported:
                    return true
                }
            }
        }

        public var shouldPresentFirstRunPrompt: Bool {
            !degradedStatuses.isEmpty
        }

        public var summaryText: String {
            let degradedCount = degradedStatuses.count
            if degradedCount == 0 {
                return "\(statuses.count) agents checked, all integrations current"
            }
            return "\(statuses.count) agents checked, \(degradedCount) need attention"
        }

        public var rowTexts: [String] {
            statuses.map { status in
                let agentName = status.agent.displayName
                switch status.state {
                case .installed:
                    return "\(agentName): installed \(status.installedVersion?.rawValue ?? status.expectedVersion.rawValue)"
                case .notInstalled:
                    if let detectedExecutablePath = status.detectedExecutablePath {
                        return "\(agentName): detected at \(detectedExecutablePath), integration not installed"
                    }
                    return "\(agentName): not installed"
                case .outdated:
                    return "\(agentName): outdated \(status.installedVersion?.rawValue ?? "unknown") -> \(status.expectedVersion.rawValue)"
                case .conflicted:
                    return "\(agentName): conflicted"
                case .unsupported:
                    return "\(agentName): unsupported"
                }
            }
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
        /// Agent-native session id carried by session-start presence events
        /// (D-044). Validated against `agentSessionIDPattern` at parse time;
        /// metadata only (D-038) — never a command string.
        public let sessionID: String?
        public let emittedAt: FenrirTimestamp?
        public let ingestedAt: FenrirTimestamp

        public init(agentID: AgentCLIIdentifier, state: AgentPresenceState, provenance: AgentPresenceProvenance, sequence: Int? = nil, sessionID: String? = nil, emittedAt: FenrirTimestamp? = nil, ingestedAt: FenrirTimestamp) {
            self.agentID = agentID
            self.state = state
            self.provenance = provenance
            self.sequence = sequence
            self.sessionID = sessionID
            self.emittedAt = emittedAt
            self.ingestedAt = ingestedAt
        }
    }

    struct AgentPresenceRecord: Codable, Equatable, Sendable {
        public let agentID: AgentCLIIdentifier
        public let state: AgentPresenceState
        public let provenance: AgentPresenceProvenance
        public let sequence: Int?
        /// Last known agent-native session id for this pane (D-044). Sticky
        /// across state changes: presence events without a session id retain
        /// the previously recorded one (see `InMemoryAgentPresenceStore`).
        public let sessionID: String?
        public let updatedAt: FenrirTimestamp

        public init(event: AgentPresenceEvent) {
            self.init(
                agentID: event.agentID,
                state: event.state,
                provenance: event.provenance,
                sequence: event.sequence,
                sessionID: event.sessionID,
                updatedAt: event.ingestedAt
            )
        }

        public init(
            agentID: AgentCLIIdentifier,
            state: AgentPresenceState,
            provenance: AgentPresenceProvenance,
            sequence: Int? = nil,
            sessionID: String? = nil,
            updatedAt: FenrirTimestamp
        ) {
            self.agentID = agentID
            self.state = state
            self.provenance = provenance
            self.sequence = sequence
            self.sessionID = sessionID
            self.updatedAt = updatedAt
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
