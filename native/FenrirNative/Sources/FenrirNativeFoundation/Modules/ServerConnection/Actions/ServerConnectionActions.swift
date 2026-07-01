import Foundation
import FenrirNativeShared
import AuthSession

public extension ServerConnection {
    struct ResolveServerEndpoint: FenrirAction {
        public typealias Failure = ServerConnectionError

        let resolver: any ServerEndpointResolving
        let clock: any ServerConnectionClock
        let events: (any ServerConnectionEventPublishing)?

        init(
            resolver: any ServerEndpointResolving,
            clock: any ServerConnectionClock,
            events: (any ServerConnectionEventPublishing)? = nil
        ) {
            self.resolver = resolver
            self.clock = clock
            self.events = events
        }

        public func run(_ input: ResolveServerEndpointInput) async -> Result<ResolveServerEndpointResult, ServerConnectionError> {
            do {
                let endpoint = try await resolver.resolveEndpoint(input)
                let timestamp = clock.now()
                await events?.publish(ServerConnection.envelope(input.requestID, "ServerEndpointResolved", timestamp, .serverEndpointResolved(endpoint)))
                return .success(ResolveServerEndpointResult(requestID: input.requestID, endpoint: endpoint, timestamp: timestamp))
            } catch {
                return .failure(ServerConnection.map(error, fallback: .endpointUnavailable))
            }
        }
    }

    struct OpenServerSession: FenrirAction {
        public typealias Failure = ServerConnectionError

        let authProvider: any ServerAuthSessionProviding
        let transport: any ServerTransportOpening
        let store: any ServerConnectionStore
        let clock: any ServerConnectionClock
        let events: (any ServerConnectionEventPublishing)?

        init(
            authProvider: any ServerAuthSessionProviding,
            transport: any ServerTransportOpening,
            store: any ServerConnectionStore,
            clock: any ServerConnectionClock,
            events: (any ServerConnectionEventPublishing)? = nil
        ) {
            self.authProvider = authProvider
            self.transport = transport
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: OpenServerSessionInput) async -> Result<OpenServerSessionResult, ServerConnectionError> {
            if input.endpoint.requiresBootstrap {
                return .failure(.bootstrapRequired)
            }

            let authContext: AuthContext
            do {
                authContext = try await authProvider.authContext(endpoint: input.endpoint)
            } catch {
                return .failure(ServerConnection.map(error, fallback: .authUnavailable))
            }

            guard authContext.actor.endpointScope == input.endpoint.authEndpointScope else {
                return .failure(.authRejected)
            }

            let opened: OpenedTransportSession
            do {
                opened = try await transport.openTransportSession(
                    endpoint: input.endpoint,
                    authContext: authContext,
                    clientProtocolVersion: input.clientProtocolVersion,
                    generation: 0
                )
            } catch {
                return .failure(ServerConnection.map(error, fallback: .sessionOpenFailed))
            }

            guard ServerConnection.supportsNativeTerminal(opened.capabilities, clientProtocolVersion: input.clientProtocolVersion) else {
                return .failure(.capabilityMismatch)
            }

            let timestamp = clock.now()
            let session = Session(
                sessionID: opened.sessionID,
                endpoint: input.endpoint,
                actor: authContext.actor,
                authSessionID: authContext.authSessionID,
                capabilities: opened.capabilities,
                status: .connected,
                openedAt: timestamp,
                lastHeartbeatAt: timestamp,
                reconnectGeneration: 0
            )

            do {
                try await store.saveSession(session)
                try await store.saveTransportStats(opened.transportStats, sessionID: session.sessionID)
            } catch {
                return .failure(ServerConnection.map(error, fallback: .sessionOpenFailed))
            }

            await events?.publish(ServerConnection.envelope(input.requestID, "ServerSessionOpened", timestamp, .serverSessionOpened(session.sessionID)))
            return .success(OpenServerSessionResult(requestID: input.requestID, session: session, timestamp: timestamp))
        }
    }

    struct CloseServerSession: FenrirAction {
        public typealias Failure = ServerConnectionError

        let transport: any ServerTransportOpening
        let store: any ServerConnectionStore
        let clock: any ServerConnectionClock
        let events: (any ServerConnectionEventPublishing)?

        init(
            transport: any ServerTransportOpening,
            store: any ServerConnectionStore,
            clock: any ServerConnectionClock,
            events: (any ServerConnectionEventPublishing)? = nil
        ) {
            self.transport = transport
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: CloseServerSessionInput) async -> Result<CloseServerSessionResult, ServerConnectionError> {
            guard let session = await ServerConnection.loadSession(input.sessionID, store: store) else {
                return .failure(.sessionClosed)
            }

            do {
                try await transport.closeTransportSession(sessionID: session.sessionID, generation: session.reconnectGeneration)
                try await store.saveSession(session.withStatus(.closed))
                try await store.deleteSession(sessionID: session.sessionID)
            } catch {
                return .failure(ServerConnection.map(error, fallback: .transportDisposed))
            }

            let timestamp = clock.now()
            await events?.publish(ServerConnection.envelope(input.requestID, "ServerSessionClosed", timestamp, .serverSessionClosed(session.sessionID)))
            return .success(CloseServerSessionResult(requestID: input.requestID, sessionID: session.sessionID, timestamp: timestamp))
        }
    }

    struct RefreshServerSession: FenrirAction {
        public typealias Failure = ServerConnectionError

        let authProvider: any ServerAuthSessionProviding
        let transport: any ServerTransportOpening
        let store: any ServerConnectionStore
        let clock: any ServerConnectionClock
        let events: (any ServerConnectionEventPublishing)?

        init(
            authProvider: any ServerAuthSessionProviding,
            transport: any ServerTransportOpening,
            store: any ServerConnectionStore,
            clock: any ServerConnectionClock,
            events: (any ServerConnectionEventPublishing)? = nil
        ) {
            self.authProvider = authProvider
            self.transport = transport
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: RefreshServerSessionInput) async -> Result<RefreshServerSessionResult, ServerConnectionError> {
            guard let current = await ServerConnection.loadSession(input.sessionID, store: store), current.status != .closed else {
                return .failure(.sessionClosed)
            }

            let startedAt = clock.now()
            await events?.publish(ServerConnection.envelope(input.requestID, "ServerSessionRefreshStarted", startedAt, .serverSessionRefreshStarted(current.sessionID)))

            let authContext: AuthContext
            do {
                authContext = try await authProvider.refreshAuthContext(endpoint: current.endpoint, currentAuthSessionID: current.authSessionID)
            } catch {
                return .failure(ServerConnection.map(error, fallback: .sessionRefreshFailed))
            }

            guard authContext.actor.endpointScope == current.endpoint.authEndpointScope else {
                return .failure(.authRejected)
            }

            let generation: UInt64
            do {
                generation = try await store.nextReconnectGeneration(sessionID: current.sessionID)
            } catch {
                return .failure(ServerConnection.map(error, fallback: .sessionRefreshFailed))
            }

            do {
                let opened = try await transport.openTransportSession(
                    endpoint: current.endpoint,
                    authContext: authContext,
                    clientProtocolVersion: current.capabilities.protocolVersion,
                    generation: generation
                )
                guard ServerConnection.supportsNativeTerminal(opened.capabilities, clientProtocolVersion: current.capabilities.protocolVersion) else {
                    return .failure(.capabilityMismatch)
                }

                let timestamp = clock.now()
                let refreshed = Session(
                    sessionID: current.sessionID,
                    endpoint: current.endpoint,
                    actor: authContext.actor,
                    authSessionID: authContext.authSessionID,
                    capabilities: opened.capabilities,
                    status: .connected,
                    openedAt: current.openedAt,
                    lastHeartbeatAt: timestamp,
                    reconnectGeneration: generation
                )
                try await store.saveSession(refreshed)
                try await store.saveTransportStats(opened.transportStats, sessionID: refreshed.sessionID)
                await events?.publish(ServerConnection.envelope(input.requestID, "ServerSessionRefreshed", timestamp, .serverSessionRefreshed(refreshed.sessionID)))
                return .success(RefreshServerSessionResult(requestID: input.requestID, session: refreshed, timestamp: timestamp))
            } catch {
                return .failure(ServerConnection.map(error, fallback: .sessionRefreshFailed))
            }
        }
    }

    struct ReconnectServerSession: FenrirAction {
        public typealias Failure = ServerConnectionError

        let authProvider: any ServerAuthSessionProviding
        let transport: any ServerTransportOpening
        let streams: any ServerStreamOpening
        let store: any ServerConnectionStore
        let clock: any ServerConnectionClock
        let events: (any ServerConnectionEventPublishing)?

        init(
            authProvider: any ServerAuthSessionProviding,
            transport: any ServerTransportOpening,
            streams: any ServerStreamOpening,
            store: any ServerConnectionStore,
            clock: any ServerConnectionClock,
            events: (any ServerConnectionEventPublishing)? = nil
        ) {
            self.authProvider = authProvider
            self.transport = transport
            self.streams = streams
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: ReconnectServerSessionInput) async -> Result<ReconnectServerSessionResult, ServerConnectionError> {
            guard input.policy.maxAttempts > 0 else {
                return .failure(.sessionReconnectFailed)
            }
            guard let current = await ServerConnection.loadSession(input.sessionID, store: store), current.status != .closed else {
                return .failure(.sessionClosed)
            }

            let generation: UInt64
            do {
                generation = try await store.nextReconnectGeneration(sessionID: current.sessionID)
            } catch {
                return .failure(ServerConnection.map(error, fallback: .sessionReconnectFailed))
            }

            let startedAt = clock.now()
            await events?.publish(ServerConnection.envelope(input.requestID, "ServerSessionReconnectStarted", startedAt, .serverSessionReconnectStarted(current.sessionID, generation)))

            let authContext: AuthContext
            do {
                if input.policy.refreshAuthBeforeReconnect {
                    authContext = try await authProvider.refreshAuthContext(endpoint: current.endpoint, currentAuthSessionID: current.authSessionID)
                } else {
                    authContext = AuthContext(authSessionID: current.authSessionID, actor: current.actor)
                }
            } catch {
                await events?.publish(ServerConnection.envelope(input.requestID, "ServerSessionReconnectFailed", clock.now(), .serverSessionReconnectFailed(current.sessionID, generation)))
                return .failure(ServerConnection.map(error, fallback: .sessionReconnectFailed))
            }

            guard authContext.actor.endpointScope == current.endpoint.authEndpointScope else {
                return .failure(.authRejected)
            }

            do {
                let opened = try await ServerConnection.openTransportWithRetry(
                    transport: transport,
                    endpoint: current.endpoint,
                    authContext: authContext,
                    clientProtocolVersion: current.capabilities.protocolVersion,
                    generation: generation,
                    maxAttempts: input.policy.maxAttempts
                )
                let timestamp = clock.now()
                let reconnected = Session(
                    sessionID: current.sessionID,
                    endpoint: current.endpoint,
                    actor: authContext.actor,
                    authSessionID: authContext.authSessionID,
                    capabilities: opened.capabilities,
                    status: .connected,
                    openedAt: current.openedAt,
                    lastHeartbeatAt: timestamp,
                    reconnectGeneration: generation
                )

                let resubscribed = try await ServerConnection.prepareResubscribedStreams(
                    session: reconnected,
                    shouldResubscribe: input.policy.resubscribeStreams,
                    streams: streams,
                    store: store,
                )

                try await store.commitReconnect(ReconnectCommit(
                    session: reconnected,
                    transportStats: opened.transportStats,
                    streams: resubscribed
                ))
                for stream in resubscribed {
                    await events?.publish(ServerConnection.envelope(
                        input.requestID,
                        "ServerStreamResubscribed",
                        timestamp,
                        .serverStreamResubscribed(stream.streamID, reconnected.reconnectGeneration)
                    ))
                }

                await events?.publish(ServerConnection.envelope(input.requestID, "ServerSessionReconnected", timestamp, .serverSessionReconnected(reconnected.sessionID, generation)))
                return .success(ReconnectServerSessionResult(
                    requestID: input.requestID,
                    session: reconnected,
                    resubscribedStreams: resubscribed,
                    timestamp: timestamp
                ))
            } catch {
                await events?.publish(ServerConnection.envelope(input.requestID, "ServerSessionReconnectFailed", clock.now(), .serverSessionReconnectFailed(current.sessionID, generation)))
                return .failure(.sessionReconnectFailed)
            }
        }
    }

    struct QueryServerCapabilities: FenrirAction {
        public typealias Failure = ServerConnectionError

        let capabilityQuery: any ServerCapabilityQuerying
        let store: any ServerConnectionStore
        let clock: any ServerConnectionClock
        let events: (any ServerConnectionEventPublishing)?

        init(
            capabilityQuery: any ServerCapabilityQuerying,
            store: any ServerConnectionStore,
            clock: any ServerConnectionClock,
            events: (any ServerConnectionEventPublishing)? = nil
        ) {
            self.capabilityQuery = capabilityQuery
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: QueryServerCapabilitiesInput) async -> Result<QueryServerCapabilitiesResult, ServerConnectionError> {
            guard let session = await ServerConnection.loadConnectedSession(input.sessionID, store: store) else {
                return .failure(.sessionClosed)
            }

            do {
                let capabilities = try await capabilityQuery.queryCapabilities(session: session)
                guard ServerConnection.supportsNativeTerminal(capabilities, clientProtocolVersion: session.capabilities.protocolVersion) else {
                    return .failure(.capabilityMismatch)
                }
                let timestamp = clock.now()
                await events?.publish(ServerConnection.envelope(input.requestID, "ServerCapabilitiesNegotiated", timestamp, .serverCapabilitiesNegotiated(session.sessionID)))
                return .success(QueryServerCapabilitiesResult(requestID: input.requestID, capabilities: capabilities, timestamp: timestamp))
            } catch {
                return .failure(ServerConnection.map(error, fallback: .capabilityMismatch))
            }
        }
    }

    struct SendServerRequest: FenrirAction {
        public typealias Failure = ServerConnectionError

        let sender: any ServerRequestSending
        let store: any ServerConnectionStore
        let clock: any ServerConnectionClock
        let events: (any ServerConnectionEventPublishing)?

        init(
            sender: any ServerRequestSending,
            store: any ServerConnectionStore,
            clock: any ServerConnectionClock,
            events: (any ServerConnectionEventPublishing)? = nil
        ) {
            self.sender = sender
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: SendServerRequestInput) async -> Result<SendServerRequestResult, ServerConnectionError> {
            guard let session = await ServerConnection.loadConnectedSession(input.sessionID, store: store) else {
                return .failure(.sessionClosed)
            }

            do {
                try await store.incrementActiveRequestCount(sessionID: session.sessionID)
                await events?.publish(ServerConnection.envelope(input.requestID, "ServerRequestStarted", clock.now(), .serverRequestStarted(input.requestID)))
                let response = try await sender.sendServerRequest(session: session, requestID: input.requestID, request: input.request)
                try await store.decrementActiveRequestCount(sessionID: session.sessionID)
                let timestamp = clock.now()
                await events?.publish(ServerConnection.envelope(input.requestID, "ServerRequestCompleted", timestamp, .serverRequestCompleted(input.requestID)))
                return .success(SendServerRequestResult(requestID: input.requestID, response: response, timestamp: timestamp))
            } catch {
                try? await store.decrementActiveRequestCount(sessionID: session.sessionID)
                await events?.publish(ServerConnection.envelope(input.requestID, "ServerRequestFailed", clock.now(), .serverRequestFailed(input.requestID)))
                return .failure(ServerConnection.map(error, fallback: .requestRejected))
            }
        }
    }

    struct OpenServerStream: FenrirAction {
        public typealias Failure = ServerConnectionError

        let streams: any ServerStreamOpening
        let store: any ServerConnectionStore
        let clock: any ServerConnectionClock
        let events: (any ServerConnectionEventPublishing)?

        init(
            streams: any ServerStreamOpening,
            store: any ServerConnectionStore,
            clock: any ServerConnectionClock,
            events: (any ServerConnectionEventPublishing)? = nil
        ) {
            self.streams = streams
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: OpenServerStreamInput) async -> Result<OpenServerStreamResult, ServerConnectionError> {
            guard let session = await ServerConnection.loadConnectedSession(input.sessionID, store: store) else {
                return .failure(.sessionClosed)
            }

            let handle = StreamHandle(
                streamID: input.streamID,
                method: input.method,
                payload: input.payload,
                status: .opening,
                openedGeneration: session.reconnectGeneration,
                resubscribePolicy: input.resubscribePolicy
            )

            do {
                let opened = try await streams.openServerStream(session: session, stream: handle).withStatus(.open, generation: session.reconnectGeneration)
                try await store.saveStream(opened, sessionID: session.sessionID)
                let timestamp = clock.now()
                await events?.publish(ServerConnection.envelope(input.requestID, "ServerStreamOpened", timestamp, .serverStreamOpened(opened.streamID)))
                return .success(OpenServerStreamResult(requestID: input.requestID, stream: opened, timestamp: timestamp))
            } catch {
                return .failure(ServerConnection.map(error, fallback: .streamOpenFailed))
            }
        }
    }

    struct CloseServerStream: FenrirAction {
        public typealias Failure = ServerConnectionError

        let streams: any ServerStreamOpening
        let store: any ServerConnectionStore
        let clock: any ServerConnectionClock
        let events: (any ServerConnectionEventPublishing)?

        init(
            streams: any ServerStreamOpening,
            store: any ServerConnectionStore,
            clock: any ServerConnectionClock,
            events: (any ServerConnectionEventPublishing)? = nil
        ) {
            self.streams = streams
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: CloseServerStreamInput) async -> Result<CloseServerStreamResult, ServerConnectionError> {
            guard let session = await ServerConnection.loadSession(input.sessionID, store: store), session.status != .closed else {
                return .failure(.sessionClosed)
            }

            do {
                try await streams.closeServerStream(session: session, streamID: input.streamID)
                try await store.deleteStream(streamID: input.streamID, sessionID: session.sessionID)
                let timestamp = clock.now()
                await events?.publish(ServerConnection.envelope(input.requestID, "ServerStreamClosed", timestamp, .serverStreamClosed(input.streamID)))
                return .success(CloseServerStreamResult(requestID: input.requestID, streamID: input.streamID, timestamp: timestamp))
            } catch {
                return .failure(ServerConnection.map(error, fallback: .streamDisconnected))
            }
        }
    }

    struct GetServerConnectionHealth: FenrirAction {
        public typealias Failure = ServerConnectionError

        let store: any ServerConnectionStore
        let clock: any ServerConnectionClock

        init(store: any ServerConnectionStore, clock: any ServerConnectionClock) {
            self.store = store
            self.clock = clock
        }

        public func run(_ input: GetServerConnectionHealthInput) async -> Result<GetServerConnectionHealthResult, ServerConnectionError> {
            let timestamp = clock.now()
            do {
                guard let session = try await store.loadSession(sessionID: input.sessionID) else {
                    let health = Health(
                        status: .disconnected,
                        lastHeartbeatAt: nil,
                        activeRequestCount: 0,
                        activeStreamCount: 0,
                        reconnectGeneration: 0
                    )
                    return .success(GetServerConnectionHealthResult(requestID: input.requestID, health: health, timestamp: timestamp))
                }

                let requests = try await store.activeRequestCount(sessionID: session.sessionID)
                let streams = try await store.loadStreams(sessionID: session.sessionID)
                let stats = try await store.transportStats(sessionID: session.sessionID)
                let health = Health(
                    sessionID: session.sessionID,
                    endpoint: session.endpoint,
                    status: session.status,
                    lastHeartbeatAt: session.lastHeartbeatAt,
                    activeRequestCount: requests,
                    activeStreamCount: streams.filter { $0.status != .closed }.count,
                    reconnectGeneration: session.reconnectGeneration,
                    transportStats: stats
                )
                return .success(GetServerConnectionHealthResult(requestID: input.requestID, health: health, timestamp: timestamp))
            } catch {
                return .failure(ServerConnection.map(error, fallback: .transportUnavailable))
            }
        }
    }
}

private extension ServerConnection {
    static func envelope(
        _ requestID: RequestID,
        _ eventKind: String,
        _ timestamp: FenrirTimestamp,
        _ event: Event
    ) -> EventEnvelope<Event> {
        EventEnvelope(eventID: requestID, eventKind: eventKind, timestamp: timestamp, event: event)
    }

    static func supportsNativeTerminal(_ capabilities: Capabilities, clientProtocolVersion: ProtocolVersion) -> Bool {
        capabilities.protocolVersion == clientProtocolVersion &&
            capabilities.supportsTmuxKernel &&
            capabilities.supportsPaneStreams &&
            capabilities.supportsAuthenticatedActors
    }

    static func loadSession(_ sessionID: SessionID, store: any ServerConnectionStore) async -> Session? {
        do {
            return try await store.loadSession(sessionID: sessionID)
        } catch {
            return nil
        }
    }

    static func loadConnectedSession(_ sessionID: SessionID, store: any ServerConnectionStore) async -> Session? {
        guard let session = await loadSession(sessionID, store: store) else {
            return nil
        }
        guard session.status == .connected || session.status == .degraded else {
            return nil
        }
        return session
    }

    static func openTransportWithRetry(
        transport: any ServerTransportOpening,
        endpoint: Endpoint,
        authContext: AuthContext,
        clientProtocolVersion: ProtocolVersion,
        generation: UInt64,
        maxAttempts: Int
    ) async throws -> OpenedTransportSession {
        var lastError: Error?
        for _ in 0..<maxAttempts {
            do {
                return try await transport.openTransportSession(
                    endpoint: endpoint,
                    authContext: authContext,
                    clientProtocolVersion: clientProtocolVersion,
                    generation: generation
                )
            } catch {
                lastError = error
            }
        }
        throw lastError ?? ServerConnectionError.sessionReconnectFailed
    }

    static func prepareResubscribedStreams(
        session: Session,
        shouldResubscribe: Bool,
        streams: any ServerStreamOpening,
        store: any ServerConnectionStore
    ) async throws -> [StreamHandle] {
        guard shouldResubscribe else {
            return []
        }

        let activeStreams = try await store.loadStreams(sessionID: session.sessionID)
            .filter { $0.status == .open && $0.resubscribePolicy == .afterReconnect }

        var resubscribed: [StreamHandle] = []
        for stream in activeStreams {
            let pending = stream.withStatus(.resubscribing, generation: session.reconnectGeneration)
            let reopened = try await streams.openServerStream(session: session, stream: pending).withStatus(.open, generation: session.reconnectGeneration)
            resubscribed.append(reopened)
        }
        return resubscribed
    }

    static func map(_ error: Error, fallback: ServerConnectionError) -> ServerConnectionError {
        if let error = error as? ServerConnectionError {
            return error
        }
        if let error = error as? AuthSession.AuthSessionError {
            switch error {
            case .bearerSessionExpired, .bearerSessionRejected, .actorSessionMismatch, .protocolMismatch:
                return .authRejected
            case .serverUnavailable:
                return .transportUnavailable
            default:
                return .authUnavailable
            }
        }
        return fallback
    }
}
