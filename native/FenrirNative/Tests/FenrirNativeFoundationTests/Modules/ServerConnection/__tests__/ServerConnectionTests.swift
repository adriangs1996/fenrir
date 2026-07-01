import Foundation
import Testing
import FenrirNativeShared
import AuthSession
@testable import ServerConnection

@Suite("ServerConnection actions")
struct ServerConnectionTests {
    @Test("ResolveServerEndpoint preserves local and remote endpoint identity")
    func resolveEndpointPreservesIdentity() async throws {
        let local = localEndpoint()
        let remote = remoteEndpoint()
        let resolver = EndpointResolver(endpoints: [
            "local": local,
            "remote": remote
        ])
        let events = ServerEvents()
        let action = ServerConnection.ResolveServerEndpoint(
            resolver: resolver,
            clock: FixedClock(),
            events: events
        )

        let localResult = try await action.run(
            ServerConnection.ResolveServerEndpointInput(
                requestID: "resolve-local",
                launchIntent: .endpoint(local)
            )
        ).get()
        let remoteResult = try await action.run(
            ServerConnection.ResolveServerEndpointInput(
                requestID: "resolve-remote",
                launchIntent: .profile("remote-profile")
            )
        ).get()

        #expect(localResult.endpoint.kind == .local)
        #expect(localResult.endpoint.endpointID == "local-main")
        #expect(localResult.endpoint.authEndpointScope == AuthSession.EndpointScope(endpointID: "local-main"))
        #expect(remoteResult.endpoint.kind == .remote)
        #expect(remoteResult.endpoint.endpointID == "remote-main")
        #expect(remoteResult.endpoint.authEndpointScope == AuthSession.EndpointScope(endpointID: "remote-main", profileID: "remote-profile"))
        #expect(await events.count(kind: "ServerEndpointResolved") == 2)
    }

    @Test("OpenServerSession maps rejected auth to stable auth error")
    func openMapsAuthFailure() async {
        let action = ServerConnection.OpenServerSession(
            authProvider: AuthProvider(result: .failure(AuthSession.AuthSessionError.bearerSessionRejected)),
            transport: TransportOpener(),
            store: ConnectionStore(),
            clock: FixedClock()
        )

        let result = await action.run(
            ServerConnection.OpenServerSessionInput(
                requestID: "open",
                endpoint: remoteEndpoint()
            )
        )

        #expect(result == .failure(.authRejected))
    }

    @Test("OpenServerSession rejects actor endpoint mismatches before transport open")
    func openRejectsActorEndpointMismatch() async {
        let transport = TransportOpener()
        let action = ServerConnection.OpenServerSession(
            authProvider: AuthProvider(result: .success(authContext(endpointScope: localEndpoint().authEndpointScope))),
            transport: transport,
            store: ConnectionStore(),
            clock: FixedClock()
        )

        let result = await action.run(
            ServerConnection.OpenServerSessionInput(
                requestID: "open",
                endpoint: remoteEndpoint()
            )
        )

        #expect(result == .failure(.authRejected))
        #expect(await transport.openCount() == 0)
    }

    @Test("Reconnect increments generation and resubscribes active streams deterministically")
    func reconnectResubscribesStreams() async throws {
        let endpoint = remoteEndpoint()
        let store = ConnectionStore()
        let transport = TransportOpener(sessionPrefix: "session")
        let streams = StreamOpener()
        let auth = AuthProvider(result: .success(authContext(endpointScope: endpoint.authEndpointScope)))
        let open = ServerConnection.OpenServerSession(
            authProvider: auth,
            transport: transport,
            store: store,
            clock: FixedClock()
        )
        let session = try await open.run(
            ServerConnection.OpenServerSessionInput(
                requestID: "open",
                endpoint: endpoint
            )
        ).get().session

        let openStream = ServerConnection.OpenServerStream(
            streams: streams,
            store: store,
            clock: FixedClock()
        )
        _ = try await openStream.run(
            ServerConnection.OpenServerStreamInput(
                requestID: "stream",
                sessionID: session.sessionID,
                streamID: "pane-stream",
                method: "tmux.pane.subscribe",
                payload: "{}"
            )
        ).get()

        let reconnect = ServerConnection.ReconnectServerSession(
            authProvider: auth,
            transport: transport,
            streams: streams,
            store: store,
            clock: FixedClock()
        )
        let result = try await reconnect.run(
            ServerConnection.ReconnectServerSessionInput(
                requestID: "reconnect",
                sessionID: session.sessionID
            )
        ).get()

        #expect(result.session.reconnectGeneration == 1)
        #expect(result.resubscribedStreams.map(\.streamID) == ["pane-stream"])
        #expect(result.resubscribedStreams.first?.openedGeneration == 1)
        #expect(await streams.openedGenerations(for: "pane-stream") == [0, 1])
    }

    @Test("Reconnect retries transport open up to policy max attempts")
    func reconnectRetriesTransportOpen() async throws {
        let endpoint = remoteEndpoint()
        let store = ConnectionStore()
        let transport = TransportOpener(sessionPrefix: "session")
        let auth = AuthProvider(result: .success(authContext(endpointScope: endpoint.authEndpointScope)))
        let session = try await ServerConnection.OpenServerSession(
            authProvider: auth,
            transport: transport,
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.OpenServerSessionInput(
                requestID: "open",
                endpoint: endpoint
            )
        ).get().session

        await transport.failNextOpenAttempts(2)

        let result = try await ServerConnection.ReconnectServerSession(
            authProvider: auth,
            transport: transport,
            streams: StreamOpener(),
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.ReconnectServerSessionInput(
                requestID: "reconnect",
                sessionID: session.sessionID,
                policy: ServerConnection.ReconnectPolicy(maxAttempts: 3)
            )
        ).get()

        #expect(result.session.reconnectGeneration == 1)
        #expect(await transport.openCount() == 4)
    }

    @Test("Reconnect failure during stream resubscribe leaves persisted state unchanged")
    func reconnectResubscribeFailureDoesNotPartiallyCommit() async throws {
        let endpoint = remoteEndpoint()
        let store = ConnectionStore()
        let transport = TransportOpener(sessionPrefix: "session")
        let streams = StreamOpener(failingStreamID: "pane-stream")
        let events = ServerEvents()
        let auth = AuthProvider(result: .success(authContext(endpointScope: endpoint.authEndpointScope)))
        let session = try await ServerConnection.OpenServerSession(
            authProvider: auth,
            transport: transport,
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.OpenServerSessionInput(
                requestID: "open",
                endpoint: endpoint
            )
        ).get().session

        try await store.saveStream(
            ServerConnection.StreamHandle(
                streamID: "pane-stream",
                method: "tmux.pane.subscribe",
                payload: "{}",
                status: .open,
                openedGeneration: 0
            ),
            sessionID: session.sessionID
        )

        let result = await ServerConnection.ReconnectServerSession(
            authProvider: auth,
            transport: transport,
            streams: streams,
            store: store,
            clock: FixedClock(),
            events: events
        ).run(
            ServerConnection.ReconnectServerSessionInput(
                requestID: "reconnect",
                sessionID: session.sessionID
            )
        )

        let persistedSession = try await store.loadSession(sessionID: session.sessionID)
        let persistedStreams = try await store.loadStreams(sessionID: session.sessionID)
        #expect(result == .failure(.sessionReconnectFailed))
        #expect(persistedSession?.reconnectGeneration == 0)
        #expect(persistedSession?.status == .connected)
        #expect(persistedStreams.first?.status == .open)
        #expect(persistedStreams.first?.openedGeneration == 0)
        #expect(await events.count(kind: "ServerStreamResubscribed") == 0)
        #expect(await events.count(kind: "ServerSessionReconnected") == 0)
    }

    @Test("Reconnect commit failure leaves persisted state unchanged and publishes no success events")
    func reconnectCommitFailureDoesNotPartiallyCommit() async throws {
        let endpoint = remoteEndpoint()
        let store = ConnectionStore()
        let transport = TransportOpener(sessionPrefix: "session")
        let streams = StreamOpener()
        let events = ServerEvents()
        let auth = AuthProvider(result: .success(authContext(endpointScope: endpoint.authEndpointScope)))
        let session = try await ServerConnection.OpenServerSession(
            authProvider: auth,
            transport: transport,
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.OpenServerSessionInput(
                requestID: "open",
                endpoint: endpoint
            )
        ).get().session

        try await store.saveStream(
            ServerConnection.StreamHandle(
                streamID: "pane-stream",
                method: "tmux.pane.subscribe",
                payload: "{}",
                status: .open,
                openedGeneration: 0
            ),
            sessionID: session.sessionID
        )
        await store.failNextReconnectCommit()

        let result = await ServerConnection.ReconnectServerSession(
            authProvider: auth,
            transport: transport,
            streams: streams,
            store: store,
            clock: FixedClock(),
            events: events
        ).run(
            ServerConnection.ReconnectServerSessionInput(
                requestID: "reconnect",
                sessionID: session.sessionID
            )
        )

        let persistedSession = try await store.loadSession(sessionID: session.sessionID)
        let persistedStreams = try await store.loadStreams(sessionID: session.sessionID)
        #expect(result == .failure(.sessionReconnectFailed))
        #expect(persistedSession?.reconnectGeneration == 0)
        #expect(persistedStreams.first?.status == .open)
        #expect(persistedStreams.first?.openedGeneration == 0)
        #expect(await events.count(kind: "ServerStreamResubscribed") == 0)
        #expect(await events.count(kind: "ServerSessionReconnected") == 0)
    }

    @Test("Reconnect can refresh auth before transport open")
    func reconnectRefreshesAuthWhenPolicyRequiresIt() async throws {
        let endpoint = remoteEndpoint()
        let store = ConnectionStore()
        let transport = TransportOpener(sessionPrefix: "session")
        let auth = RefreshingAuthProvider(
            initial: authContext(endpointScope: endpoint.authEndpointScope, authSessionID: "initial-auth"),
            refreshed: authContext(endpointScope: endpoint.authEndpointScope, authSessionID: "refreshed-auth")
        )
        let session = try await ServerConnection.OpenServerSession(
            authProvider: auth,
            transport: transport,
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.OpenServerSessionInput(
                requestID: "open",
                endpoint: endpoint
            )
        ).get().session

        let result = try await ServerConnection.ReconnectServerSession(
            authProvider: auth,
            transport: transport,
            streams: StreamOpener(),
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.ReconnectServerSessionInput(
                requestID: "reconnect",
                sessionID: session.sessionID,
                policy: ServerConnection.ReconnectPolicy(refreshAuthBeforeReconnect: true)
            )
        ).get()

        #expect(result.session.authSessionID == "refreshed-auth")
        #expect(await auth.refreshCount() == 1)
    }

    @Test("RefreshServerSession refreshes auth and advances generation")
    func refreshServerSessionRefreshesAuth() async throws {
        let endpoint = remoteEndpoint()
        let store = ConnectionStore()
        let transport = TransportOpener(sessionPrefix: "session")
        let auth = RefreshingAuthProvider(
            initial: authContext(endpointScope: endpoint.authEndpointScope, authSessionID: "initial-auth"),
            refreshed: authContext(endpointScope: endpoint.authEndpointScope, authSessionID: "refreshed-auth")
        )
        let session = try await ServerConnection.OpenServerSession(
            authProvider: auth,
            transport: transport,
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.OpenServerSessionInput(
                requestID: "open",
                endpoint: endpoint
            )
        ).get().session

        let result = try await ServerConnection.RefreshServerSession(
            authProvider: auth,
            transport: transport,
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.RefreshServerSessionInput(
                requestID: "refresh",
                sessionID: session.sessionID
            )
        ).get()

        #expect(result.session.authSessionID == "refreshed-auth")
        #expect(result.session.reconnectGeneration == 1)
        #expect(await auth.refreshCount() == 1)
    }

    @Test("GetServerConnectionHealth reports active requests and streams")
    func healthReportsActiveState() async throws {
        let endpoint = localEndpoint()
        let store = ConnectionStore()
        let auth = AuthProvider(result: .success(authContext(endpointScope: endpoint.authEndpointScope)))
        let session = try await ServerConnection.OpenServerSession(
            authProvider: auth,
            transport: TransportOpener(),
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.OpenServerSessionInput(
                requestID: "open",
                endpoint: endpoint
            )
        ).get().session

        try await store.incrementActiveRequestCount(sessionID: session.sessionID)
        try await store.saveStream(
            ServerConnection.StreamHandle(
                streamID: "stream",
                method: "events",
                payload: "{}",
                status: .open,
                openedGeneration: 0
            ),
            sessionID: session.sessionID
        )

        let result = try await ServerConnection.GetServerConnectionHealth(
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.GetServerConnectionHealthInput(
                requestID: "health",
                sessionID: session.sessionID
            )
        ).get()

        #expect(result.health.status == .connected)
        #expect(result.health.activeRequestCount == 1)
        #expect(result.health.activeStreamCount == 1)
        #expect(result.health.endpoint?.endpointID == "local-main")
    }
}

private func localEndpoint() -> ServerConnection.Endpoint {
    ServerConnection.Endpoint(
        endpointID: "local-main",
        kind: .local,
        transport: .unixDomainSocket(path: "/tmp/fenrir.sock"),
        httpBaseURL: "http://localhost:3000",
        displayName: "Local Fenrir"
    )
}

private func remoteEndpoint() -> ServerConnection.Endpoint {
    ServerConnection.Endpoint(
        endpointID: "remote-main",
        kind: .remote,
        transport: .webSocketURL("wss://remote.example/fenrir"),
        profileID: "remote-profile",
        httpBaseURL: "https://remote.example",
        displayName: "Remote Fenrir",
        expectedServerIdentity: "remote-server"
    )
}

private func capabilities() -> ServerConnection.Capabilities {
    ServerConnection.Capabilities(
        protocolVersion: ServerConnection.ProtocolVersion("native-terminal/1"),
        supportsTmuxKernel: true,
        supportsPaneStreams: true,
        supportsAuthenticatedActors: true
    )
}

private func authContext(
    endpointScope: AuthSession.EndpointScope,
    authSessionID: AuthSession.SessionID = "auth-session"
) -> ServerConnection.AuthContext {
    ServerConnection.AuthContext(
        authSessionID: authSessionID,
        actor: AuthSession.AuthenticatedActor(
            endpointScope: endpointScope,
            sessionID: authSessionID,
            subject: "native-client",
            role: .owner
        )
    )
}

private struct EndpointResolver: ServerConnection.ServerEndpointResolving {
    let endpoints: [String: ServerConnection.Endpoint]

    func resolveEndpoint(_ input: ServerConnection.ResolveServerEndpointInput) async throws -> ServerConnection.Endpoint {
        switch input.launchIntent {
        case .endpoint(let endpoint):
            return endpoint
        case .profile(let profileID):
            guard let endpoint = endpoints[profileID.rawValue.replacing("remote-profile", with: "remote")] else {
                throw ServerConnection.ServerConnectionError.endpointUnavailable
            }
            return endpoint
        case .none:
            guard let endpoint = endpoints["local"] else {
                throw ServerConnection.ServerConnectionError.endpointUnavailable
            }
            return endpoint
        }
    }
}

private struct AuthProvider: ServerConnection.ServerAuthSessionProviding {
    let result: Result<ServerConnection.AuthContext, Error>

    func authContext(endpoint: ServerConnection.Endpoint) async throws -> ServerConnection.AuthContext {
        try result.get()
    }

    func refreshAuthContext(
        endpoint: ServerConnection.Endpoint,
        currentAuthSessionID: AuthSession.SessionID
    ) async throws -> ServerConnection.AuthContext {
        try result.get()
    }
}

private actor RefreshingAuthProvider: ServerConnection.ServerAuthSessionProviding {
    let initial: ServerConnection.AuthContext
    let refreshed: ServerConnection.AuthContext
    private var refreshes = 0

    init(initial: ServerConnection.AuthContext, refreshed: ServerConnection.AuthContext) {
        self.initial = initial
        self.refreshed = refreshed
    }

    func authContext(endpoint: ServerConnection.Endpoint) async throws -> ServerConnection.AuthContext {
        initial
    }

    func refreshAuthContext(
        endpoint: ServerConnection.Endpoint,
        currentAuthSessionID: AuthSession.SessionID
    ) async throws -> ServerConnection.AuthContext {
        refreshes += 1
        return refreshed
    }

    func refreshCount() -> Int {
        refreshes
    }
}

private actor TransportOpener: ServerConnection.ServerTransportOpening {
    let sessionPrefix: String
    private var opens = 0
    private var failingOpenAttempts = 0

    init(sessionPrefix: String = "session") {
        self.sessionPrefix = sessionPrefix
    }

    func openTransportSession(
        endpoint: ServerConnection.Endpoint,
        authContext: ServerConnection.AuthContext,
        clientProtocolVersion: ServerConnection.ProtocolVersion,
        generation: UInt64
    ) async throws -> ServerConnection.OpenedTransportSession {
        opens += 1
        if failingOpenAttempts > 0 {
            failingOpenAttempts -= 1
            throw ServerConnection.ServerConnectionError.transportUnavailable
        }
        return ServerConnection.OpenedTransportSession(
            sessionID: ServerConnection.SessionID(rawValue: "\(sessionPrefix)-\(generation)"),
            capabilities: capabilities()
        )
    }

    func closeTransportSession(sessionID: ServerConnection.SessionID, generation: UInt64) async throws {}

    func openCount() -> Int {
        opens
    }

    func failNextOpenAttempts(_ count: Int) {
        failingOpenAttempts = count
    }
}

private actor StreamOpener: ServerConnection.ServerStreamOpening {
    private var generationsByStreamID: [ServerConnection.StreamID: [UInt64]] = [:]
    private let failingStreamID: ServerConnection.StreamID?

    init(failingStreamID: ServerConnection.StreamID? = nil) {
        self.failingStreamID = failingStreamID
    }

    func openServerStream(
        session: ServerConnection.Session,
        stream: ServerConnection.StreamHandle
    ) async throws -> ServerConnection.StreamHandle {
        if stream.streamID == failingStreamID {
            throw ServerConnection.ServerConnectionError.streamResubscribeFailed
        }
        generationsByStreamID[stream.streamID, default: []].append(session.reconnectGeneration)
        return stream
    }

    func closeServerStream(
        session: ServerConnection.Session,
        streamID: ServerConnection.StreamID
    ) async throws {}

    func openedGenerations(for streamID: ServerConnection.StreamID) -> [UInt64] {
        generationsByStreamID[streamID] ?? []
    }
}

private actor ConnectionStore: ServerConnection.ServerConnectionStore {
    private var session: ServerConnection.Session?
    private var requests: [ServerConnection.SessionID: Int] = [:]
    private var streams: [ServerConnection.SessionID: [ServerConnection.StreamID: ServerConnection.StreamHandle]] = [:]
    private var stats: [ServerConnection.SessionID: ServerConnection.TransportStats] = [:]
    private var shouldFailNextReconnectCommit = false

    func loadSession(sessionID: ServerConnection.SessionID?) async throws -> ServerConnection.Session? {
        guard let stored = session else {
            return nil
        }
        guard let sessionID else {
            return stored
        }
        return stored.sessionID == sessionID ? stored : nil
    }

    func saveSession(_ session: ServerConnection.Session) async throws {
        self.session = session
    }

    func deleteSession(sessionID: ServerConnection.SessionID) async throws {
        if session?.sessionID == sessionID {
            session = nil
        }
        streams.removeValue(forKey: sessionID)
        requests.removeValue(forKey: sessionID)
    }

    func nextReconnectGeneration(sessionID: ServerConnection.SessionID) async throws -> UInt64 {
        guard let session, session.sessionID == sessionID else {
            throw ServerConnection.ServerConnectionError.sessionClosed
        }
        return session.reconnectGeneration + 1
    }

    func activeRequestCount(sessionID: ServerConnection.SessionID) async throws -> Int {
        requests[sessionID] ?? 0
    }

    func incrementActiveRequestCount(sessionID: ServerConnection.SessionID) async throws {
        requests[sessionID, default: 0] += 1
    }

    func decrementActiveRequestCount(sessionID: ServerConnection.SessionID) async throws {
        requests[sessionID] = max(0, (requests[sessionID] ?? 0) - 1)
    }

    func loadStreams(sessionID: ServerConnection.SessionID) async throws -> [ServerConnection.StreamHandle] {
        Array((streams[sessionID] ?? [:]).values)
    }

    func saveStream(_ stream: ServerConnection.StreamHandle, sessionID: ServerConnection.SessionID) async throws {
        streams[sessionID, default: [:]][stream.streamID] = stream
    }

    func deleteStream(streamID: ServerConnection.StreamID, sessionID: ServerConnection.SessionID) async throws {
        streams[sessionID]?[streamID] = nil
    }

    func transportStats(sessionID: ServerConnection.SessionID) async throws -> ServerConnection.TransportStats {
        stats[sessionID] ?? ServerConnection.TransportStats()
    }

    func saveTransportStats(_ stats: ServerConnection.TransportStats, sessionID: ServerConnection.SessionID) async throws {
        self.stats[sessionID] = stats
    }

    func commitReconnect(_ commit: ServerConnection.ReconnectCommit) async throws {
        if shouldFailNextReconnectCommit {
            shouldFailNextReconnectCommit = false
            throw ServerConnection.ServerConnectionError.transportUnavailable
        }

        session = commit.session
        stats[commit.session.sessionID] = commit.transportStats
        for stream in commit.streams {
            streams[commit.session.sessionID, default: [:]][stream.streamID] = stream
        }
    }

    func failNextReconnectCommit() {
        shouldFailNextReconnectCommit = true
    }
}

private actor ServerEvents: ServerConnection.ServerConnectionEventPublishing {
    private var events: [EventEnvelope<ServerConnection.Event>] = []

    func publish(_ event: EventEnvelope<ServerConnection.Event>) async {
        events.append(event)
    }

    func count(kind: String) -> Int {
        events.filter { $0.eventKind == kind }.count
    }
}
