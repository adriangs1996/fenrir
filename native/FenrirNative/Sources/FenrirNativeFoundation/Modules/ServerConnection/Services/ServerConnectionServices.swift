import Foundation
import FenrirNativeShared
import AuthSession

public extension ServerConnection {
    struct AuthContext: Equatable, Sendable {
        public let authSessionID: AuthSession.SessionID
        public let actor: AuthSession.AuthenticatedActor

        public init(authSessionID: AuthSession.SessionID, actor: AuthSession.AuthenticatedActor) {
            self.authSessionID = authSessionID
            self.actor = actor
        }
    }

    struct OpenedTransportSession: Equatable, Sendable {
        public let sessionID: SessionID
        public let capabilities: Capabilities
        public let transportStats: TransportStats

        public init(sessionID: SessionID, capabilities: Capabilities, transportStats: TransportStats = TransportStats()) {
            self.sessionID = sessionID
            self.capabilities = capabilities
            self.transportStats = transportStats
        }
    }

    struct ReconnectCommit: Equatable, Sendable {
        public let session: Session
        public let transportStats: TransportStats
        public let streams: [StreamHandle]

        public init(session: Session, transportStats: TransportStats, streams: [StreamHandle]) {
            self.session = session
            self.transportStats = transportStats
            self.streams = streams
        }
    }

    protocol ServerConnectionClock: Sendable {
        func now() -> FenrirTimestamp
    }

    protocol ServerReconnectDelaying: Sendable {
        func delayBeforeReconnectAttempt(milliseconds: Int) async
    }

    struct ImmediateReconnectDelayer: ServerReconnectDelaying {
        public init() {}

        public func delayBeforeReconnectAttempt(milliseconds: Int) async {}
    }

    protocol ServerEndpointResolving: Sendable {
        func resolveEndpoint(_ input: ResolveServerEndpointInput) async throws -> Endpoint
    }

    protocol LocalServerDiscovering: Sendable {
        func discoverLocalServer(_ spec: LocalServerSpec) async throws -> LocalServerDiscovery
    }

    protocol LocalServerSpawning: Sendable {
        func spawnLocalServer(_ spec: LocalServerSpec, restartCount: Int) async throws -> LocalServerProcessSnapshot
    }

    protocol LocalServerReadinessChecking: Sendable {
        func waitForLocalServerReadiness(
            _ candidate: LocalServerReadinessCandidate,
            timeoutMilliseconds: Int
        ) async throws -> Endpoint
    }

    protocol LocalServerProcessManaging: Sendable {
        func shutdownLocalServer(processID: LocalServerProcessID) async throws
    }

    protocol LocalServerForeignTerminating: Sendable {
        func terminateUnmanagedLocalServer(endpoint: Endpoint) async throws
    }

    protocol LocalServerSupervisorStateStore: Sendable {
        func loadLocalServerSupervisorState() async throws -> LocalServerSupervisorState?
        func saveLocalServerSupervisorState(_ state: LocalServerSupervisorState) async throws
        func clearLocalServerSupervisorState() async throws
    }

    protocol ServerAuthSessionProviding: Sendable {
        func authContext(endpoint: Endpoint) async throws -> AuthContext
        func refreshAuthContext(endpoint: Endpoint, currentAuthSessionID: AuthSession.SessionID) async throws -> AuthContext
    }

    protocol ServerTransportOpening: Sendable {
        func openTransportSession(
            endpoint: Endpoint,
            authContext: AuthContext,
            clientProtocolVersion: ProtocolVersion,
            generation: UInt64
        ) async throws -> OpenedTransportSession

        func closeTransportSession(sessionID: SessionID, generation: UInt64) async throws
    }

    protocol ServerCapabilityQuerying: Sendable {
        func queryCapabilities(session: Session) async throws -> Capabilities
    }

    protocol ServerRequestSending: Sendable {
        func sendServerRequest(session: Session, requestID: RequestID, request: RequestEnvelope) async throws -> ResponseEnvelope
    }

    protocol ServerStreamOpening: Sendable {
        func openServerStream(session: Session, stream: StreamHandle) async throws -> StreamHandle
        func closeServerStream(session: Session, streamID: StreamID) async throws
    }

    protocol ServerConnectionStore: Sendable {
        func loadSession(sessionID: SessionID?) async throws -> Session?
        func saveSession(_ session: Session) async throws
        func deleteSession(sessionID: SessionID) async throws
        func nextReconnectGeneration(sessionID: SessionID) async throws -> UInt64
        func activeRequestCount(sessionID: SessionID) async throws -> Int
        func incrementActiveRequestCount(sessionID: SessionID) async throws
        func decrementActiveRequestCount(sessionID: SessionID) async throws
        func loadStreams(sessionID: SessionID) async throws -> [StreamHandle]
        func saveStream(_ stream: StreamHandle, sessionID: SessionID) async throws
        func deleteStream(streamID: StreamID, sessionID: SessionID) async throws
        func transportStats(sessionID: SessionID) async throws -> TransportStats
        func saveTransportStats(_ stats: TransportStats, sessionID: SessionID) async throws
        func commitReconnect(_ commit: ReconnectCommit) async throws
    }

    protocol ServerConnectionEventPublishing: Sendable {
        func publish(_ event: EventEnvelope<Event>) async
    }
}
