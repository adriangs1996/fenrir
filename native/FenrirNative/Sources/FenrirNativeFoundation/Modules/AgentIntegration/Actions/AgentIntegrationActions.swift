import Foundation
import FenrirNativeShared

public extension AgentIntegration {
    struct DetectAgentIntegrations: FenrirAction {
        public typealias Failure = AgentIntegrationError

        let detector: any AgentIntegrationDetecting
        let clock: any AgentIntegrationClock
        let events: (any AgentIntegrationEventSinking)?

        public init(detector: any AgentIntegrationDetecting, clock: any AgentIntegrationClock, events: (any AgentIntegrationEventSinking)? = nil) {
            self.detector = detector
            self.clock = clock
            self.events = events
        }

        public func run(_ input: DetectAgentIntegrationsInput) async -> Result<DetectAgentIntegrationsResult, AgentIntegrationError> {
            do {
                let statuses = try await detector.detectAgentIntegrations()
                let timestamp = clock.now()
                await events?.emit(envelope(input.requestID, "AgentIntegrationsDetected", timestamp, .integrationsDetected(statuses.map(\.agent.id))))
                return .success(DetectAgentIntegrationsResult(requestID: input.requestID, statuses: statuses, timestamp: timestamp))
            } catch let error as AgentIntegrationError {
                return .failure(error)
            } catch {
                return .failure(.unavailable)
            }
        }
    }

    struct GetAgentIntegrationStatus: FenrirAction {
        public typealias Failure = AgentIntegrationError

        let detector: any AgentIntegrationDetecting
        let clock: any AgentIntegrationClock

        public init(detector: any AgentIntegrationDetecting, clock: any AgentIntegrationClock) {
            self.detector = detector
            self.clock = clock
        }

        public func run(_ input: GetAgentIntegrationStatusInput) async -> Result<GetAgentIntegrationStatusResult, AgentIntegrationError> {
            do {
                let status = try await detector.integrationStatus(for: input.agentID)
                return .success(GetAgentIntegrationStatusResult(requestID: input.requestID, status: status, timestamp: clock.now()))
            } catch let error as AgentIntegrationError {
                return .failure(error)
            } catch {
                return .failure(.unavailable)
            }
        }
    }

    struct InstallAgentIntegration: FenrirAction {
        public typealias Failure = AgentIntegrationError

        let installer: any AgentIntegrationInstalling

        public init(installer: any AgentIntegrationInstalling) {
            self.installer = installer
        }

        public func run(_ input: AgentProvisioningRequest) async -> Result<AgentProvisioningResult, AgentIntegrationError> {
            await provision(input) { try await installer.installAgentIntegration($0) }
        }
    }

    struct UpdateAgentIntegration: FenrirAction {
        public typealias Failure = AgentIntegrationError

        let installer: any AgentIntegrationInstalling

        public init(installer: any AgentIntegrationInstalling) {
            self.installer = installer
        }

        public func run(_ input: AgentProvisioningRequest) async -> Result<AgentProvisioningResult, AgentIntegrationError> {
            await provision(input) { try await installer.updateAgentIntegration($0) }
        }
    }

    struct RemoveAgentIntegration: FenrirAction {
        public typealias Failure = AgentIntegrationError

        let installer: any AgentIntegrationInstalling

        public init(installer: any AgentIntegrationInstalling) {
            self.installer = installer
        }

        public func run(_ input: AgentProvisioningRequest) async -> Result<AgentProvisioningResult, AgentIntegrationError> {
            await provision(input) { try await installer.removeAgentIntegration($0) }
        }
    }

    struct ProvisionAgentMCP: FenrirAction {
        public typealias Failure = AgentIntegrationError

        let provisioner: any AgentMCPProvisioning

        public init(provisioner: any AgentMCPProvisioning) {
            self.provisioner = provisioner
        }

        public func run(_ input: AgentMCPProvisioningRequest) async -> Result<AgentMCPProvisioningResult, AgentIntegrationError> {
            do {
                return .success(try await provisioner.provisionAgentMCP(input))
            } catch let error as AgentIntegrationError {
                return .failure(error)
            } catch {
                return .failure(.unavailable)
            }
        }
    }

    struct ResolveAgentProviderInstallTargets: FenrirAction {
        public typealias Failure = AgentIntegrationError

        let resolver: any AgentProviderInstallTargetResolving
        let clock: any AgentIntegrationClock

        public init(resolver: any AgentProviderInstallTargetResolving, clock: any AgentIntegrationClock) {
            self.resolver = resolver
            self.clock = clock
        }

        public func run(_ input: ResolveAgentProviderInstallTargetsInput) async -> Result<ResolveAgentProviderInstallTargetsResult, AgentIntegrationError> {
            do {
                let targets: [AgentProviderInstallTarget]
                if let agentID = input.agentID {
                    targets = [try await resolver.resolveAgentProviderInstallTarget(for: agentID)]
                } else {
                    targets = try await resolver.resolveAgentProviderInstallTargets()
                }
                return .success(ResolveAgentProviderInstallTargetsResult(requestID: input.requestID, targets: targets, timestamp: clock.now()))
            } catch let error as AgentIntegrationError {
                return .failure(error)
            } catch {
                return .failure(.unavailable)
            }
        }
    }

    struct IngestAgentPresenceSignal: FenrirAction {
        public typealias Failure = AgentIntegrationError

        let store: any AgentPresenceStoring
        let clock: any AgentIntegrationClock
        let events: (any AgentIntegrationEventSinking)?

        public init(store: any AgentPresenceStoring, clock: any AgentIntegrationClock, events: (any AgentIntegrationEventSinking)? = nil) {
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: IngestAgentPresenceSignalInput) async -> Result<IngestAgentPresenceSignalResult, AgentIntegrationError> {
            let timestamp = clock.now()
            do {
                let event = try parsePresenceSignal(input.signal, ingestedAt: timestamp)
                try await store.upsertPresence(event)
                await events?.emit(envelope(input.requestID, "AgentPresenceIngested", timestamp, .presenceIngested(AgentPresenceRecord(event: event))))
                return .success(IngestAgentPresenceSignalResult(requestID: input.requestID, stored: true, event: event, timestamp: timestamp))
            } catch let error as AgentIntegrationError {
                await events?.emit(envelope(input.requestID, "AgentPresenceMalformedDropped", timestamp, .malformedPresenceDropped(reason: error.safeMessage, provenance: input.signal.provenance)))
                return .success(IngestAgentPresenceSignalResult(requestID: input.requestID, stored: false, event: nil, timestamp: timestamp))
            } catch {
                await events?.emit(envelope(input.requestID, "AgentPresenceMalformedDropped", timestamp, .malformedPresenceDropped(reason: "unavailable", provenance: input.signal.provenance)))
                return .success(IngestAgentPresenceSignalResult(requestID: input.requestID, stored: false, event: nil, timestamp: timestamp))
            }
        }
    }

    struct ListAgentPresence: FenrirAction {
        public typealias Failure = AgentIntegrationError

        let store: any AgentPresenceStoring
        let clock: any AgentIntegrationClock

        public init(store: any AgentPresenceStoring, clock: any AgentIntegrationClock) {
            self.store = store
            self.clock = clock
        }

        public func run(_ input: ListAgentPresenceInput) async -> Result<ListAgentPresenceResult, AgentIntegrationError> {
            do {
                return .success(ListAgentPresenceResult(requestID: input.requestID, records: try await store.listPresence(workspaceID: input.workspaceID), timestamp: clock.now()))
            } catch let error as AgentIntegrationError {
                return .failure(error)
            } catch {
                return .failure(.unavailable)
            }
        }
    }

    private static func provision(
        _ input: AgentProvisioningRequest,
        operation: (AgentProvisioningRequest) async throws -> AgentProvisioningResult
    ) async -> Result<AgentProvisioningResult, AgentIntegrationError> {
        do {
            return .success(try await operation(input))
        } catch let error as AgentIntegrationError {
            return .failure(error)
        } catch {
            return .failure(.unavailable)
        }
    }

    private static func parsePresenceSignal(_ signal: AgentPresenceSignal, ingestedAt: FenrirTimestamp) throws -> AgentPresenceEvent {
        guard signal.oscIdentifier == AgentPresenceSignal.oscIdentifier else {
            throw AgentIntegrationError.malformedPresence("unexpected-osc-identifier")
        }

        let payload: PresencePayload
        do {
            payload = try JSONDecoder().decode(PresencePayload.self, from: Data(signal.payload.utf8))
        } catch {
            throw AgentIntegrationError.malformedPresence("invalid-json")
        }

        guard payload.namespace == AgentPresenceSignal.namespace else {
            throw AgentIntegrationError.malformedPresence("invalid-namespace")
        }
        guard payload.agentID != .custom && payload.agentID != .future else {
            throw AgentIntegrationError.unsupportedAgent(payload.agentID)
        }
        if let workspaceID = payload.workspaceID, workspaceID != signal.provenance.workspaceID.rawValue {
            throw AgentIntegrationError.malformedPresence("workspace-mismatch")
        }
        if let paneID = payload.paneID, paneID != signal.provenance.paneID.rawValue {
            throw AgentIntegrationError.malformedPresence("pane-mismatch")
        }
        if let sequence = payload.sequence, sequence < 0 {
            throw AgentIntegrationError.malformedPresence("invalid-sequence")
        }

        let emittedAt: FenrirTimestamp?
        if let timestamp = payload.timestamp {
            guard let date = ISO8601DateFormatter().date(from: timestamp) else {
                throw AgentIntegrationError.malformedPresence("invalid-timestamp")
            }
            emittedAt = FenrirTimestamp(date)
        } else {
            emittedAt = nil
        }

        return AgentPresenceEvent(
            agentID: payload.agentID,
            state: payload.state,
            provenance: signal.provenance,
            sequence: payload.sequence,
            emittedAt: emittedAt,
            ingestedAt: ingestedAt
        )
    }

    private static func envelope(_ requestID: RequestID, _ kind: String, _ timestamp: FenrirTimestamp, _ event: Event) -> EventEnvelope<Event> {
        EventEnvelope(eventID: requestID, eventKind: kind, timestamp: timestamp, event: event)
    }
}

private extension AgentIntegration.AgentIntegrationError {
    var safeMessage: String {
        switch self {
        case .unavailable:
            return "unavailable"
        case let .unsupportedAgent(agentID):
            return "unsupported-agent:\(agentID.rawValue)"
        case let .malformedPresence(reason):
            return reason
        case .staleIntegration:
            return "stale-integration"
        case .configConflict:
            return "config-conflict"
        }
    }
}
