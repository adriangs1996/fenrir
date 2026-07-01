import Foundation
import FenrirNativeShared
import AuthSession

public extension ServerConnection {
    struct SessionID: FenrirID, ExpressibleByStringLiteral {
        public let rawValue: String

        public init(rawValue: String) {
            self.rawValue = rawValue
        }

        public init(stringLiteral value: String) {
            self.init(rawValue: value)
        }
    }

    struct ProtocolVersion: Codable, Equatable, Sendable {
        public let rawValue: String

        public init(_ rawValue: String) {
            self.rawValue = rawValue
        }
    }

    enum EndpointKind: String, Codable, Equatable, Sendable {
        case local
        case remote
        case profile
    }

    enum EndpointTransport: Codable, Equatable, Sendable {
        case webSocketURL(String)
        case unixDomainSocket(path: String)
    }

    struct Endpoint: Codable, Equatable, Sendable {
        public let endpointID: String
        public let kind: EndpointKind
        public let transport: EndpointTransport
        public let profileID: ProfileID?
        public let httpBaseURL: String?
        public let displayName: String
        public let expectedServerIdentity: String?
        public let requiresBootstrap: Bool

        public init(
            endpointID: String? = nil,
            kind: EndpointKind,
            transport: EndpointTransport,
            profileID: ProfileID? = nil,
            httpBaseURL: String? = nil,
            displayName: String,
            expectedServerIdentity: String? = nil,
            requiresBootstrap: Bool = false
        ) {
            self.endpointID = endpointID ?? ServerConnection.Endpoint.defaultEndpointID(kind: kind, transport: transport, profileID: profileID)
            self.kind = kind
            self.transport = transport
            self.profileID = profileID
            self.httpBaseURL = httpBaseURL
            self.displayName = displayName
            self.expectedServerIdentity = expectedServerIdentity
            self.requiresBootstrap = requiresBootstrap
        }

        public var authEndpointScope: AuthSession.EndpointScope {
            AuthSession.EndpointScope(endpointID: endpointID, profileID: profileID)
        }

        private static func defaultEndpointID(kind: EndpointKind, transport: EndpointTransport, profileID: ProfileID?) -> String {
            if let profileID {
                return "profile:\(profileID.rawValue)"
            }

            switch (kind, transport) {
            case (.local, .unixDomainSocket(let path)):
                return "local:\(path)"
            case (_, .webSocketURL(let url)):
                return "\(kind.rawValue):\(url)"
            case (_, .unixDomainSocket(let path)):
                return "\(kind.rawValue):\(path)"
            }
        }
    }

    struct Capabilities: Codable, Equatable, Sendable {
        public let protocolVersion: ProtocolVersion
        public let supportsTmuxKernel: Bool
        public let supportsPaneStreams: Bool
        public let supportsAuthenticatedActors: Bool

        public init(
            protocolVersion: ProtocolVersion,
            supportsTmuxKernel: Bool,
            supportsPaneStreams: Bool,
            supportsAuthenticatedActors: Bool
        ) {
            self.protocolVersion = protocolVersion
            self.supportsTmuxKernel = supportsTmuxKernel
            self.supportsPaneStreams = supportsPaneStreams
            self.supportsAuthenticatedActors = supportsAuthenticatedActors
        }
    }

    enum ConnectionStatus: String, Codable, Equatable, Sendable {
        case disconnected
        case connecting
        case connected
        case degraded
        case reconnecting
        case closed
    }

    enum StreamStatus: String, Codable, Equatable, Sendable {
        case opening
        case open
        case resubscribing
        case closed
        case disconnected
    }

    enum RequestRetryPolicy: String, Codable, Equatable, Sendable {
        case failFast
        case retryOnceAfterReconnect
    }

    enum StreamResubscribePolicy: String, Codable, Equatable, Sendable {
        case never
        case afterReconnect
    }

    struct ReconnectPolicy: Codable, Equatable, Sendable {
        public let maxAttempts: Int
        public let resubscribeStreams: Bool
        public let refreshAuthBeforeReconnect: Bool

        public init(
            maxAttempts: Int = 1,
            resubscribeStreams: Bool = true,
            refreshAuthBeforeReconnect: Bool = false
        ) {
            self.maxAttempts = maxAttempts
            self.resubscribeStreams = resubscribeStreams
            self.refreshAuthBeforeReconnect = refreshAuthBeforeReconnect
        }
    }

    struct Session: Codable, Equatable, Sendable {
        public let sessionID: SessionID
        public let endpoint: Endpoint
        public let actor: AuthSession.AuthenticatedActor
        public let authSessionID: AuthSession.SessionID
        public let capabilities: Capabilities
        public let status: ConnectionStatus
        public let openedAt: FenrirTimestamp
        public let lastHeartbeatAt: FenrirTimestamp?
        public let reconnectGeneration: UInt64

        public init(
            sessionID: SessionID,
            endpoint: Endpoint,
            actor: AuthSession.AuthenticatedActor,
            authSessionID: AuthSession.SessionID,
            capabilities: Capabilities,
            status: ConnectionStatus,
            openedAt: FenrirTimestamp,
            lastHeartbeatAt: FenrirTimestamp? = nil,
            reconnectGeneration: UInt64
        ) {
            self.sessionID = sessionID
            self.endpoint = endpoint
            self.actor = actor
            self.authSessionID = authSessionID
            self.capabilities = capabilities
            self.status = status
            self.openedAt = openedAt
            self.lastHeartbeatAt = lastHeartbeatAt
            self.reconnectGeneration = reconnectGeneration
        }

        public func withStatus(_ status: ConnectionStatus, heartbeatAt: FenrirTimestamp? = nil, generation: UInt64? = nil) -> Session {
            Session(
                sessionID: sessionID,
                endpoint: endpoint,
                actor: actor,
                authSessionID: authSessionID,
                capabilities: capabilities,
                status: status,
                openedAt: openedAt,
                lastHeartbeatAt: heartbeatAt ?? lastHeartbeatAt,
                reconnectGeneration: generation ?? reconnectGeneration
            )
        }
    }

    struct Health: Codable, Equatable, Sendable {
        public let sessionID: SessionID?
        public let endpoint: Endpoint?
        public let status: ConnectionStatus
        public let lastHeartbeatAt: FenrirTimestamp?
        public let activeRequestCount: Int
        public let activeStreamCount: Int
        public let reconnectGeneration: UInt64
        public let transportStats: TransportStats

        public init(
            sessionID: SessionID? = nil,
            endpoint: Endpoint? = nil,
            status: ConnectionStatus,
            lastHeartbeatAt: FenrirTimestamp?,
            activeRequestCount: Int,
            activeStreamCount: Int,
            reconnectGeneration: UInt64,
            transportStats: TransportStats = TransportStats()
        ) {
            self.sessionID = sessionID
            self.endpoint = endpoint
            self.status = status
            self.lastHeartbeatAt = lastHeartbeatAt
            self.activeRequestCount = activeRequestCount
            self.activeStreamCount = activeStreamCount
            self.reconnectGeneration = reconnectGeneration
            self.transportStats = transportStats
        }
    }

    struct TransportStats: Codable, Equatable, Sendable {
        public let bytesSent: UInt64
        public let bytesReceived: UInt64
        public let backpressureEvents: UInt64

        public init(bytesSent: UInt64 = 0, bytesReceived: UInt64 = 0, backpressureEvents: UInt64 = 0) {
            self.bytesSent = bytesSent
            self.bytesReceived = bytesReceived
            self.backpressureEvents = backpressureEvents
        }
    }

    struct RequestEnvelope: Codable, Equatable, Sendable {
        public let method: String
        public let payload: String
        public let timeoutMilliseconds: Int
        public let retryPolicy: RequestRetryPolicy

        public init(
            method: String,
            payload: String,
            timeoutMilliseconds: Int = 30_000,
            retryPolicy: RequestRetryPolicy = .failFast
        ) {
            self.method = method
            self.payload = payload
            self.timeoutMilliseconds = timeoutMilliseconds
            self.retryPolicy = retryPolicy
        }
    }

    struct ResponseEnvelope: Codable, Equatable, Sendable {
        public let method: String
        public let payload: String
        public let generation: UInt64

        public init(method: String, payload: String, generation: UInt64) {
            self.method = method
            self.payload = payload
            self.generation = generation
        }
    }

    struct StreamID: FenrirID, ExpressibleByStringLiteral {
        public let rawValue: String

        public init(rawValue: String) {
            self.rawValue = rawValue
        }

        public init(stringLiteral value: String) {
            self.init(rawValue: value)
        }
    }

    struct StreamHandle: Codable, Equatable, Sendable {
        public let streamID: StreamID
        public let method: String
        public let payload: String
        public let status: StreamStatus
        public let openedGeneration: UInt64
        public let resubscribePolicy: StreamResubscribePolicy

        public init(
            streamID: StreamID,
            method: String,
            payload: String,
            status: StreamStatus,
            openedGeneration: UInt64,
            resubscribePolicy: StreamResubscribePolicy = .afterReconnect
        ) {
            self.streamID = streamID
            self.method = method
            self.payload = payload
            self.status = status
            self.openedGeneration = openedGeneration
            self.resubscribePolicy = resubscribePolicy
        }

        public func withStatus(_ status: StreamStatus, generation: UInt64? = nil) -> StreamHandle {
            StreamHandle(
                streamID: streamID,
                method: method,
                payload: payload,
                status: status,
                openedGeneration: generation ?? openedGeneration,
                resubscribePolicy: resubscribePolicy
            )
        }
    }

    enum ServerConnectionError: String, Error, Codable, Equatable, Sendable {
        case endpointUnavailable = "ServerEndpointUnavailable"
        case endpointUnsupported = "ServerEndpointUnsupported"
        case bootstrapRequired = "ServerBootstrapRequired"
        case authUnavailable = "ServerAuthUnavailable"
        case authRejected = "ServerAuthRejected"
        case sessionOpenFailed = "ServerSessionOpenFailed"
        case sessionClosed = "ServerSessionClosed"
        case sessionRefreshFailed = "ServerSessionRefreshFailed"
        case sessionReconnectFailed = "ServerSessionReconnectFailed"
        case capabilityMismatch = "ServerCapabilityMismatch"
        case protocolMismatch = "ServerProtocolMismatch"
        case requestTimedOut = "ServerRequestTimedOut"
        case requestRejected = "ServerRequestRejected"
        case streamOpenFailed = "ServerStreamOpenFailed"
        case streamDisconnected = "ServerStreamDisconnected"
        case streamResubscribeFailed = "ServerStreamResubscribeFailed"
        case transportBackpressure = "ServerTransportBackpressure"
        case transportUnavailable = "ServerTransportUnavailable"
        case transportDisposed = "ServerTransportDisposed"
    }

    enum LaunchEndpointIntent: Codable, Equatable, Sendable {
        case endpoint(Endpoint)
        case profile(ProfileID)
        case none
    }

    struct ResolveServerEndpointInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let launchIntent: LaunchEndpointIntent
        public let workspaceID: WorkspaceID?

        public init(
            requestID: RequestID,
            launchIntent: LaunchEndpointIntent,
            workspaceID: WorkspaceID? = nil
        ) {
            self.requestID = requestID
            self.launchIntent = launchIntent
            self.workspaceID = workspaceID
        }
    }

    struct ResolveServerEndpointResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let endpoint: Endpoint
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, endpoint: Endpoint, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.endpoint = endpoint
            self.timestamp = timestamp
        }
    }

    struct OpenServerSessionInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let endpoint: Endpoint
        public let clientProtocolVersion: ProtocolVersion

        public init(requestID: RequestID, endpoint: Endpoint, clientProtocolVersion: ProtocolVersion = ProtocolVersion("native-terminal/1")) {
            self.requestID = requestID
            self.endpoint = endpoint
            self.clientProtocolVersion = clientProtocolVersion
        }
    }

    struct OpenServerSessionResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let session: Session
        public let timestamp: FenrirTimestamp
    }

    struct CloseServerSessionInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let sessionID: SessionID

        public init(requestID: RequestID, sessionID: SessionID) {
            self.requestID = requestID
            self.sessionID = sessionID
        }
    }

    struct CloseServerSessionResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let sessionID: SessionID
        public let timestamp: FenrirTimestamp
    }

    struct RefreshServerSessionInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let sessionID: SessionID

        public init(requestID: RequestID, sessionID: SessionID) {
            self.requestID = requestID
            self.sessionID = sessionID
        }
    }

    struct RefreshServerSessionResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let session: Session
        public let timestamp: FenrirTimestamp
    }

    struct ReconnectServerSessionInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let sessionID: SessionID
        public let policy: ReconnectPolicy

        public init(requestID: RequestID, sessionID: SessionID, policy: ReconnectPolicy = ReconnectPolicy()) {
            self.requestID = requestID
            self.sessionID = sessionID
            self.policy = policy
        }
    }

    struct ReconnectServerSessionResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let session: Session
        public let resubscribedStreams: [StreamHandle]
        public let timestamp: FenrirTimestamp
    }

    struct QueryServerCapabilitiesInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let sessionID: SessionID

        public init(requestID: RequestID, sessionID: SessionID) {
            self.requestID = requestID
            self.sessionID = sessionID
        }
    }

    struct QueryServerCapabilitiesResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let capabilities: Capabilities
        public let timestamp: FenrirTimestamp
    }

    struct SendServerRequestInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let sessionID: SessionID
        public let request: RequestEnvelope

        public init(requestID: RequestID, sessionID: SessionID, request: RequestEnvelope) {
            self.requestID = requestID
            self.sessionID = sessionID
            self.request = request
        }
    }

    struct SendServerRequestResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let response: ResponseEnvelope
        public let timestamp: FenrirTimestamp
    }

    struct OpenServerStreamInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let sessionID: SessionID
        public let streamID: StreamID
        public let method: String
        public let payload: String
        public let resubscribePolicy: StreamResubscribePolicy

        public init(
            requestID: RequestID,
            sessionID: SessionID,
            streamID: StreamID,
            method: String,
            payload: String,
            resubscribePolicy: StreamResubscribePolicy = .afterReconnect
        ) {
            self.requestID = requestID
            self.sessionID = sessionID
            self.streamID = streamID
            self.method = method
            self.payload = payload
            self.resubscribePolicy = resubscribePolicy
        }
    }

    struct OpenServerStreamResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let stream: StreamHandle
        public let timestamp: FenrirTimestamp
    }

    struct CloseServerStreamInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let sessionID: SessionID
        public let streamID: StreamID

        public init(requestID: RequestID, sessionID: SessionID, streamID: StreamID) {
            self.requestID = requestID
            self.sessionID = sessionID
            self.streamID = streamID
        }
    }

    struct CloseServerStreamResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let streamID: StreamID
        public let timestamp: FenrirTimestamp
    }

    struct GetServerConnectionHealthInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let sessionID: SessionID?

        public init(requestID: RequestID, sessionID: SessionID? = nil) {
            self.requestID = requestID
            self.sessionID = sessionID
        }
    }

    struct GetServerConnectionHealthResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let health: Health
        public let timestamp: FenrirTimestamp
    }

    enum Event: Codable, Equatable, Sendable {
        case serverEndpointResolved(Endpoint)
        case serverSessionOpening(SessionID)
        case serverSessionOpened(SessionID)
        case serverSessionClosed(SessionID)
        case serverSessionRefreshStarted(SessionID)
        case serverSessionRefreshed(SessionID)
        case serverSessionReconnectStarted(SessionID, UInt64)
        case serverSessionReconnected(SessionID, UInt64)
        case serverSessionReconnectFailed(SessionID, UInt64)
        case serverCapabilitiesNegotiated(SessionID)
        case serverRequestStarted(RequestID)
        case serverRequestCompleted(RequestID)
        case serverRequestFailed(RequestID)
        case serverStreamOpened(StreamID)
        case serverStreamResubscribed(StreamID, UInt64)
        case serverStreamClosed(StreamID)
    }
}
