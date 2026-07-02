import Foundation
import FenrirNativeShared

public extension AgentIntegration {
    actor InMemoryAgentPresenceStore: AgentPresenceStoring {
        private var records: [AgentPresenceProvenance: AgentPresenceRecord]

        public init(initialRecords: [AgentPresenceRecord] = []) {
            self.records = Dictionary(uniqueKeysWithValues: initialRecords.map { ($0.provenance, $0) })
        }

        public func upsertPresence(_ event: AgentPresenceEvent) async throws {
            records[event.provenance] = AgentPresenceRecord(event: event)
        }

        public func listPresence(workspaceID: WorkspaceID?) async throws -> [AgentPresenceRecord] {
            records.values
                .filter { record in
                    workspaceID.map { $0 == record.provenance.workspaceID } ?? true
                }
                .sorted { lhs, rhs in
                    if lhs.provenance.workspaceID.rawValue != rhs.provenance.workspaceID.rawValue {
                        return lhs.provenance.workspaceID.rawValue < rhs.provenance.workspaceID.rawValue
                    }
                    return lhs.provenance.paneID.rawValue < rhs.provenance.paneID.rawValue
                }
        }
    }

    struct FixedAgentIntegrationClock: AgentIntegrationClock {
        public let timestamp: FenrirTimestamp

        public init(timestamp: FenrirTimestamp) {
            self.timestamp = timestamp
        }

        public func now() -> FenrirTimestamp {
            timestamp
        }
    }
}
