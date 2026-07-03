import Foundation
import Testing
import FenrirNativeShared
import AuthSession
@testable import ServerConnection

@Suite("ServerConnection WebSocket RPC transport")
struct NativeWebSocketServerRPCTransportTests {
    @Test("wire encodes Effect JSON-RPC request frames with numeric ids and JSON params")
    func wireEncodesRequestFrame() throws {
        let request = ServerConnection.RequestEnvelope(
            method: "server.getConfig",
            payload: #"{"probe":"yes"}"#
        )

        let frame = try ServerConnection.NativeWebSocketRPCWire.requestFrame(id: 7, request: request)
        let root = try jsonObject(frame)
        let params = try #require(root["params"] as? [String: Any])

        #expect(root["jsonrpc"] as? String == "2.0")
        #expect(root["method"] as? String == "server.getConfig")
        #expect((root["id"] as? NSNumber)?.uint64Value == 7)
        #expect(params["probe"] as? String == "yes")
        #expect(root["headers"] is [Any])
    }

    @Test("transport sends unary RPC over websocket with rewritten actor session")
    func transportSendsUnaryRPC() async throws {
        let socket = ScriptedWebSocketRPCSession(receives: [
            #"{"jsonrpc":"2.0","id":1,"result":{"status":"ready"}}"#,
        ])
        let authenticator = RecordingWebSocketAuthenticator()
        let connector = RecordingWebSocketConnector(session: socket)
        let transport = ServerConnection.NativeWebSocketServerRPCTransport(
            authenticator: authenticator,
            connector: connector,
            requestIDs: ServerConnection.NativeWebSocketRPCRequestIDGenerator()
        )
        let session = webSocketSession()
        let request = ServerConnection.RequestEnvelope(
            method: "tmux.workspace.ensure",
            payload: #"{"actor":{"sessionId":"old-session","subject":"native-client"}}"#
        )

        let response = try await transport.sendAuthenticatedRPC(
            httpBaseURL: URL(string: "http://127.0.0.1:31337")!,
            webSocketURL: URL(string: "ws://127.0.0.1:31337/ws")!,
            bootstrapCredential: "desktop-bootstrap-token",
            session: session,
            requestID: "native-rpc-unary",
            request: request
        )

        let sentTexts = await socket.sentTexts()
        let sentRoot = try jsonObject(try #require(sentTexts.first))
        let params = try #require(sentRoot["params"] as? [String: Any])
        let actor = try #require(params["actor"] as? [String: Any])

        #expect(response.method == "tmux.workspace.ensure")
        #expect(response.payload == #"{"status":"ready"}"#)
        #expect(response.generation == 0)
        #expect((sentRoot["id"] as? NSNumber)?.uint64Value == 1)
        #expect(sentRoot["method"] as? String == "tmux.workspace.ensure")
        #expect(actor["sessionId"] as? String == "auth-session-ws")
        #expect(actor["subject"] as? String == "native-client")
        #expect(await authenticator.exchangeCount() == 1)
        #expect(await authenticator.issueTokenCount() == 1)
        #expect(await connector.tokens() == ["ws-token"])
        #expect(await socket.isClosed())
    }

    @Test("transport streams each websocket chunk element as JSON event bytes")
    func transportStreamsChunks() async throws {
        let socket = ScriptedWebSocketRPCSession(receives: [
            #"{"jsonrpc":"2.0","chunk":true,"id":1,"result":[{"seq":1},{"seq":2}]}"#,
            #"{"jsonrpc":"2.0","id":1,"result":null}"#,
        ])
        let authenticator = RecordingWebSocketAuthenticator()
        let connector = RecordingWebSocketConnector(session: socket)
        let transport = ServerConnection.NativeWebSocketServerRPCTransport(
            authenticator: authenticator,
            connector: connector,
            requestIDs: ServerConnection.NativeWebSocketRPCRequestIDGenerator()
        )

        let stream = await transport.streamAuthenticatedRPC(
            httpBaseURL: URL(string: "http://127.0.0.1:31337")!,
            webSocketURL: URL(string: "ws://127.0.0.1:31337/ws")!,
            bootstrapCredential: "desktop-bootstrap-token",
            session: webSocketSession(),
            requestID: "native-rpc-stream",
            request: ServerConnection.RequestEnvelope(method: "tmux.pane.subscribeStream", payload: #"{"paneId":"pane-a"}"#)
        )

        var iterator = stream.makeAsyncIterator()
        let first = try await iterator.next()
        let second = try await iterator.next()
        let end = try await iterator.next()

        #expect(String(decoding: try #require(first), as: UTF8.self) == #"{"seq":1}"#)
        #expect(String(decoding: try #require(second), as: UTF8.self) == #"{"seq":2}"#)
        #expect(end == nil)
        #expect((try jsonObject(try #require(await socket.sentTexts().first))["id"] as? NSNumber)?.uint64Value == 1)
        #expect(await socket.isClosed())
    }

    @Test("wire maps auth-shaped JSON-RPC errors to authRejected")
    func wireMapsAuthFailure() throws {
        let decoded = try ServerConnection.NativeWebSocketRPCWire.decode(text: #"{"jsonrpc":"2.0","id":3,"error":{"_tag":"ServerAuthRejected","message":"Unauthorized"}}"#)

        switch decoded {
        case .failure(let id, let error):
            #expect(id == 3)
            #expect(error == .authRejected)
        default:
            Issue.record("Expected auth failure, got \(decoded)")
        }
    }
}

private actor RecordingWebSocketAuthenticator: ServerConnection.NativeWebSocketRPCAuthenticating {
    private var exchanges = 0
    private var tokenIssues = 0

    func exchangeBearerSession(httpBaseURL: URL, credential: String) async throws -> ServerConnection.NativeBearerSession {
        exchanges += 1
        #expect(httpBaseURL.absoluteString == "http://127.0.0.1:31337")
        #expect(credential == "desktop-bootstrap-token")
        return ServerConnection.NativeBearerSession(
            token: "bearer-token",
            authSessionID: "auth-session-ws"
        )
    }

    func issueWebSocketToken(httpBaseURL: URL, bearerToken: String) async throws -> ServerConnection.NativeWebSocketToken {
        tokenIssues += 1
        #expect(httpBaseURL.absoluteString == "http://127.0.0.1:31337")
        #expect(bearerToken == "bearer-token")
        return ServerConnection.NativeWebSocketToken(token: "ws-token")
    }

    func exchangeCount() -> Int {
        exchanges
    }

    func issueTokenCount() -> Int {
        tokenIssues
    }
}

private actor RecordingWebSocketConnector: ServerConnection.NativeWebSocketRPCConnecting {
    private let session: ScriptedWebSocketRPCSession
    private var recordedTokens: [String] = []
    private var recordedURLs: [String] = []

    init(session: ScriptedWebSocketRPCSession) {
        self.session = session
    }

    func connect(
        webSocketURL: URL,
        webSocketToken: ServerConnection.NativeWebSocketToken
    ) async throws -> any ServerConnection.NativeWebSocketRPCSessioning {
        recordedTokens.append(webSocketToken.token)
        recordedURLs.append(webSocketURL.absoluteString)
        return session
    }

    func tokens() -> [String] {
        recordedTokens
    }

    func urls() -> [String] {
        recordedURLs
    }
}

private actor ScriptedWebSocketRPCSession: ServerConnection.NativeWebSocketRPCSessioning {
    private var receives: [String]
    private var sent: [String] = []
    private var closed = false

    init(receives: [String]) {
        self.receives = receives
    }

    func sendText(_ text: String) async throws {
        sent.append(text)
    }

    func receiveText() async throws -> String {
        guard !receives.isEmpty else {
            throw ServerConnection.ServerConnectionError.transportDisposed
        }
        return receives.removeFirst()
    }

    func close() async {
        closed = true
    }

    func sentTexts() -> [String] {
        sent
    }

    func isClosed() -> Bool {
        closed
    }
}

private func webSocketSession() -> ServerConnection.Session {
    let endpoint = ServerConnection.LocalServerSpec(
        httpBaseURL: "http://127.0.0.1:31337",
        webSocketURL: "ws://127.0.0.1:31337/ws"
    ).endpoint
    return ServerConnection.Session(
        sessionID: "native-app-local",
        endpoint: endpoint,
        actor: AuthSession.AuthenticatedActor(
            endpointScope: endpoint.authEndpointScope,
            sessionID: "auth-session-ws",
            subject: "native-client",
            role: .owner
        ),
        authSessionID: "auth-session-ws",
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

private func jsonObject(_ text: String) throws -> [String: Any] {
    try #require(JSONSerialization.jsonObject(with: Data(text.utf8), options: []) as? [String: Any])
}
