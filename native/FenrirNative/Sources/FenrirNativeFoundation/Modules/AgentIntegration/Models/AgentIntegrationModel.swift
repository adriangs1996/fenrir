import Foundation

public extension AgentIntegration {
    struct PresencePayload: Codable, Equatable, Sendable {
        public let namespace: String
        public let agentID: AgentCLIIdentifier
        public let state: AgentPresenceState
        public let workspaceID: String?
        public let paneID: String?
        public let sequence: Int?
        public let timestamp: String?

        public init(
            namespace: String,
            agentID: AgentCLIIdentifier,
            state: AgentPresenceState,
            workspaceID: String?,
            paneID: String?,
            sequence: Int?,
            timestamp: String?
        ) {
            self.namespace = namespace
            self.agentID = agentID
            self.state = state
            self.workspaceID = workspaceID
            self.paneID = paneID
            self.sequence = sequence
            self.timestamp = timestamp
        }
    }
}
