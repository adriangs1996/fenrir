import Foundation
import Testing
import FenrirNativeShared
import AuthSession
@testable import ServerConnection

@Suite("ServerConnection live-boundary layers")
struct ServerConnectionLayerTests {
    @Test("NativeServerRPCWire builds native RPC HTTP bodies without leaking transport details")
    func wireBuildsHTTPBody() throws {
        let request = ServerConnection.RequestEnvelope(
            method: "tmux.workspace.ensure",
            payload: #"""
            {"workspaceId":"workspace-a","actor":{"sessionId":"old-session","subject":"native"}}
            """#
        )

        let rewritten = ServerConnection.NativeServerRPCWire.request(
            request,
            rewritingActorSessionID: AuthSession.SessionID(rawValue: "auth-session")
        )
        let body = try ServerConnection.NativeServerRPCWire.httpRequestBody(
            requestID: "native-rpc",
            request: rewritten
        )
        let root = try #require(JSONSerialization.jsonObject(with: body, options: []) as? [String: Any])
        let payload = try #require(root["payload"] as? [String: Any])
        let actor = try #require(payload["actor"] as? [String: Any])

        #expect(root["method"] as? String == "tmux.workspace.ensure")
        #expect(root["requestId"] as? String == "native-rpc")
        #expect(actor["sessionId"] as? String == "auth-session")
        #expect(actor["subject"] as? String == "native")
        #expect(rewritten.method == request.method)
        #expect(rewritten.timeoutMilliseconds == request.timeoutMilliseconds)
        #expect(rewritten.retryPolicy == request.retryPolicy)
    }

    @Test("NativeServerRPCWire extracts bearer session ids from JWT-like tokens")
    func wireExtractsBearerSessionID() {
        let token = "header.eyJzaWQiOiJzZXNzaW9uLTEyMyJ9.signature"

        #expect(ServerConnection.NativeServerRPCWire.authSessionID(fromBearerToken: token) == "session-123")
        #expect(ServerConnection.NativeServerRPCWire.authSessionID(fromBearerToken: "not-a-token") == nil)
    }

    @Test("NativeServerRPCWire parses successful and rejected unary RPC responses")
    func wireParsesUnaryResponses() throws {
        let success = Data(#"""
        {"ok":true,"payload":{"status":"ready"}}
        """#.utf8)
        let rejected = Data(#"""
        {"ok":false,"error":{"code":"ServerAuthRejected"}}
        """#.utf8)

        #expect(try ServerConnection.NativeServerRPCWire.parseUnaryHTTPResponse(success) == #"{"status":"ready"}"#)
        #expect(throws: ServerConnection.ServerConnectionError.authRejected) {
            _ = try ServerConnection.NativeServerRPCWire.parseUnaryHTTPResponse(rejected)
        }
    }

    @Test("InMemoryServerConnectionStore supports session, streams, stats, and supervisor state")
    func memoryStoreSupportsConnectionState() async throws {
        let endpoint = ServerConnection.Endpoint(
            endpointID: "local-main",
            kind: .local,
            transport: .webSocketURL("ws://127.0.0.1:4155/fenrir"),
            httpBaseURL: "http://127.0.0.1:4155",
            displayName: "Local Fenrir"
        )
        let session = ServerConnection.Session(
            sessionID: "session-0",
            endpoint: endpoint,
            actor: AuthSession.AuthenticatedActor(
                endpointScope: endpoint.authEndpointScope,
                sessionID: "auth-session",
                subject: "native",
                role: .owner
            ),
            authSessionID: "auth-session",
            capabilities: ServerConnection.Capabilities(
                protocolVersion: ServerConnection.ProtocolVersion("native-terminal/1"),
                supportsTmuxKernel: true,
                supportsPaneStreams: true,
                supportsAuthenticatedActors: true
            ),
            status: .connected,
            openedAt: FenrirTimestamp(Date(timeIntervalSince1970: 1)),
            lastHeartbeatAt: FenrirTimestamp(Date(timeIntervalSince1970: 1)),
            reconnectGeneration: 0
        )
        let store = ServerConnection.InMemoryServerConnectionStore(session: session)

        try await store.incrementActiveRequestCount(sessionID: "session-0")
        try await store.saveStream(ServerConnection.StreamHandle(
            streamID: "stream-b",
            method: "tmux.pane.subscribeStream",
            payload: "{}",
            status: .open,
            openedGeneration: 0
        ), sessionID: "session-0")
        try await store.saveStream(ServerConnection.StreamHandle(
            streamID: "stream-a",
            method: "tmux.workspace.subscribe",
            payload: "{}",
            status: .open,
            openedGeneration: 0
        ), sessionID: "session-0")
        try await store.saveTransportStats(ServerConnection.TransportStats(bytesSent: 3, bytesReceived: 5, backpressureEvents: 1), sessionID: "session-0")
        try await store.saveLocalServerSupervisorState(ServerConnection.LocalServerSupervisorState(
            mode: .remote(endpoint),
            status: .remote,
            ownership: .remote,
            endpoint: endpoint,
            updatedAt: FenrirTimestamp(Date(timeIntervalSince1970: 2))
        ))

        #expect(try await store.activeRequestCount(sessionID: "session-0") == 1)
        #expect(try await store.loadStreams(sessionID: "session-0").map { $0.streamID } == ["stream-a", "stream-b"])
        #expect(try await store.transportStats(sessionID: "session-0").bytesReceived == 5)
        #expect(try await store.nextReconnectGeneration(sessionID: "session-0") == 1)
        #expect(try await store.loadLocalServerSupervisorState()?.ownership == .remote)

        try await store.deleteSession(sessionID: "session-0")
        #expect(try await store.loadSession(sessionID: nil) == nil)
    }

    @Test("NativeServerRequestSender rejects unsupported endpoints before transport")
    func nativeServerRequestSenderRejectsUnsupportedEndpointBeforeTransport() async {
        let transport = RecordingLayerRPCTransport()
        let endpoint = ServerConnection.Endpoint(
            endpointID: "local-socket",
            kind: .local,
            transport: .unixDomainSocket(path: "/tmp/fenrir.sock"),
            httpBaseURL: "http://127.0.0.1:31337",
            displayName: "Local Socket Fenrir"
        )
        let sender = ServerConnection.NativeServerRequestSender(
            transport: transport,
            bootstrapCredential: "desktop-bootstrap-token"
        )

        do {
            _ = try await sender.sendServerRequest(
                session: layerSession(endpoint: endpoint),
                requestID: "native-rpc-unsupported",
                request: ServerConnection.RequestEnvelope(method: "server.getConfig", payload: "{}")
            )
            Issue.record("Expected unsupported endpoint to fail before transport call")
        } catch let error as ServerConnection.ServerConnectionError {
            #expect(error == .endpointUnsupported)
        } catch {
            Issue.record("Unexpected error: \(error)")
        }

        #expect(await transport.methods.isEmpty)
    }

    @Test("NativeServerRequestSender invokes failure hook once for transport failures")
    func nativeServerRequestSenderInvokesFailureHookOnce() async {
        let endpoint = layerEndpoint()
        let transport = RecordingLayerRPCTransport(failure: ServerConnection.ServerConnectionError.transportUnavailable)
        let recorder = LayerRPCFailureRecorder()
        let sender = ServerConnection.NativeServerRequestSender(
            transport: transport,
            bootstrapCredential: "desktop-bootstrap-token",
            onTransportFailure: { session, requestID, request, error in
                await recorder.record(session: session, requestID: requestID, request: request, error: error)
            }
        )

        do {
            _ = try await sender.sendServerRequest(
                session: layerSession(endpoint: endpoint),
                requestID: "native-rpc-failed",
                request: ServerConnection.RequestEnvelope(method: "tmux.workspace.ensure", payload: "{}")
            )
            Issue.record("Expected transport failure")
        } catch let error as ServerConnection.ServerConnectionError {
            #expect(error == .transportUnavailable)
        } catch {
            Issue.record("Unexpected error: \(error)")
        }

        #expect(await transport.methods == ["tmux.workspace.ensure"])
        #expect(await recorder.requestIDs() == ["native-rpc-failed"])
        #expect(await recorder.methods() == ["tmux.workspace.ensure"])
    }

}

private func layerEndpoint() -> ServerConnection.Endpoint {
    ServerConnection.LocalServerSpec(
        httpBaseURL: "http://127.0.0.1:31337",
        webSocketURL: "ws://127.0.0.1:31337/ws"
    ).endpoint
}

private func layerSession(endpoint: ServerConnection.Endpoint) -> ServerConnection.Session {
    ServerConnection.Session(
        sessionID: "native-app-local",
        endpoint: endpoint,
        actor: AuthSession.AuthenticatedActor(
            endpointScope: endpoint.authEndpointScope,
            sessionID: "auth-session",
            subject: "native-client",
            role: .owner
        ),
        authSessionID: "auth-session",
        capabilities: ServerConnection.Capabilities(
            protocolVersion: ServerConnection.ProtocolVersion("native-terminal/1"),
            supportsTmuxKernel: true,
            supportsPaneStreams: true,
            supportsAuthenticatedActors: true
        ),
        status: .connected,
        openedAt: FenrirTimestamp(Date(timeIntervalSince1970: 1)),
        reconnectGeneration: 0
    )
}

private actor RecordingLayerRPCTransport: ServerConnection.NativeServerRPCTransporting {
    private(set) var methods: [String] = []
    private let failure: Error?

    init(failure: Error? = nil) {
        self.failure = failure
    }

    func sendAuthenticatedRPC(
        httpBaseURL: URL,
        webSocketURL: URL,
        bootstrapCredential: String,
        session: ServerConnection.Session,
        requestID: RequestID,
        request: ServerConnection.RequestEnvelope
    ) async throws -> ServerConnection.ResponseEnvelope {
        methods.append(request.method)
        if let failure {
            throw failure
        }
        return ServerConnection.ResponseEnvelope(
            method: request.method,
            payload: #"{"ok":true}"#,
            generation: session.reconnectGeneration
        )
    }

    func streamAuthenticatedRPC(
        httpBaseURL: URL,
        webSocketURL: URL,
        bootstrapCredential: String,
        session: ServerConnection.Session,
        requestID: RequestID,
        request: ServerConnection.RequestEnvelope
    ) async -> AsyncThrowingStream<Data, Error> {
        AsyncThrowingStream { continuation in
            continuation.finish()
        }
    }
}

private actor LayerRPCFailureRecorder {
    private var observedRequestIDs: [RequestID] = []
    private var observedMethods: [String] = []

    func record(
        session: ServerConnection.Session,
        requestID: RequestID,
        request: ServerConnection.RequestEnvelope,
        error: Error
    ) {
        _ = session
        _ = error
        observedRequestIDs.append(requestID)
        observedMethods.append(request.method)
    }

    func requestIDs() -> [RequestID] {
        observedRequestIDs
    }

    func methods() -> [String] {
        observedMethods
    }
}

