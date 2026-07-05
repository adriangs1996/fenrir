import Foundation
import Testing
import FenrirNativeShared
import AuthSession
@testable import ServerConnection

@Suite("NativeURLSessionServerRPCTransport bearer acquisition and persistence")
struct NativeServerRPCTransportBearerTests {
    private static let httpBaseURL = URL(string: "http://remote.example:31337")!
    private static let webSocketURL = URL(string: "ws://remote.example:31337/ws")!
    private static let scope = AuthSession.EndpointScope(endpointID: "remote:ws://remote.example:31337/ws")

    /// `<base64url({"sid":"session-123"})>.<signature>` — shaped like a server
    /// session token so the transport treats it as a direct bearer.
    private static let directBearerToken = "eyJzaWQiOiJzZXNzaW9uLTEyMyJ9.signature"

    private actor FakeNetwork: ServerConnection.NativeServerRPCNetworking {
        private(set) var exchangedCredentials: [String] = []
        private(set) var unaryBearerTokens: [String] = []
        var rejectedBearerTokens: Set<String> = []
        private let issuedToken: String
        private let exchangeDelayNanoseconds: UInt64

        init(
            issuedToken: String = "issued.eyJzaWQiOiJzZXNzaW9uLWZyZXNoIn0.token",
            exchangeDelayNanoseconds: UInt64 = 0
        ) {
            self.issuedToken = issuedToken
            self.exchangeDelayNanoseconds = exchangeDelayNanoseconds
        }

        func setRejectedBearerTokens(_ tokens: Set<String>) {
            rejectedBearerTokens = tokens
        }

        func exchangeBearerSession(httpBaseURL: URL, credential: String) async throws -> ServerConnection.NativeBearerSession {
            exchangedCredentials.append(credential)
            if exchangeDelayNanoseconds > 0 {
                try await Task.sleep(nanoseconds: exchangeDelayNanoseconds)
            }
            return ServerConnection.NativeBearerSession(
                token: issuedToken,
                authSessionID: ServerConnection.NativeServerRPCWire.authSessionID(fromBearerToken: issuedToken)
            )
        }

        func sendUnaryNativeRPC(
            httpBaseURL: URL,
            bearerToken: String,
            requestID: RequestID,
            request: ServerConnection.RequestEnvelope
        ) async throws -> String {
            unaryBearerTokens.append(bearerToken)
            if rejectedBearerTokens.contains(bearerToken) {
                throw ServerConnection.ServerConnectionError.authRejected
            }
            return #"{"accepted":true}"#
        }

        func streamNativeRPC(
            httpBaseURL: URL,
            bearerToken: String,
            requestID: RequestID,
            request: ServerConnection.RequestEnvelope
        ) async -> AsyncThrowingStream<Data, Error> {
            AsyncThrowingStream { continuation in
                continuation.finish()
            }
        }
    }

    private static func makeSession() -> ServerConnection.Session {
        let endpoint = ServerConnection.Endpoint(
            kind: .remote,
            transport: .webSocketURL(webSocketURL.absoluteString),
            httpBaseURL: httpBaseURL.absoluteString,
            displayName: "Remote Fenrir",
            requiresBootstrap: true
        )
        return ServerConnection.Session(
            sessionID: "session-remote",
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
    }

    private static func send(
        _ transport: ServerConnection.NativeURLSessionServerRPCTransport,
        bootstrapCredential: String,
        requestID: RequestID = "request-1"
    ) async throws -> ServerConnection.ResponseEnvelope {
        try await transport.sendAuthenticatedRPC(
            httpBaseURL: httpBaseURL,
            webSocketURL: webSocketURL,
            bootstrapCredential: bootstrapCredential,
            session: makeSession(),
            requestID: requestID,
            request: ServerConnection.RequestEnvelope(method: "workspace.gitProbe", payload: "{}")
        )
    }

    @Test("A session-token credential is used directly without a bootstrap exchange")
    func directBearerCredentialSkipsExchange() async throws {
        let network = FakeNetwork()
        let transport = ServerConnection.NativeURLSessionServerRPCTransport(network: network)

        _ = try await Self.send(transport, bootstrapCredential: Self.directBearerToken)

        #expect(await network.exchangedCredentials.isEmpty)
        #expect(await network.unaryBearerTokens == [Self.directBearerToken])
    }

    @Test("A Keychain-stored bearer is preferred over exchanging the bootstrap credential")
    func storedBearerSkipsExchange() async throws {
        let network = FakeNetwork()
        let storage = AuthSession.InMemoryAuthSecureStorage()
        _ = try await storage.writeBearerCredential(scope: Self.scope, bearerToken: "stored.eyJzaWQiOiJzZXNzaW9uLXN0b3JlZCJ9.token")
        let transport = ServerConnection.NativeURLSessionServerRPCTransport(
            network: network,
            bearerTokenStore: AuthSession.SecureStorageBearerTokenStore(storage: storage),
            bearerTokenScope: Self.scope
        )

        _ = try await Self.send(transport, bootstrapCredential: "PAIRING12345")

        #expect(await network.exchangedCredentials.isEmpty)
        #expect(await network.unaryBearerTokens == ["stored.eyJzaWQiOiJzZXNzaW9uLXN0b3JlZCJ9.token"])
    }

    @Test("Exchanged bearers are persisted to the token store")
    func exchangePersistsBearer() async throws {
        let network = FakeNetwork()
        let storage = AuthSession.InMemoryAuthSecureStorage()
        let store = AuthSession.SecureStorageBearerTokenStore(storage: storage)
        let transport = ServerConnection.NativeURLSessionServerRPCTransport(
            network: network,
            bearerTokenStore: store,
            bearerTokenScope: Self.scope
        )

        _ = try await Self.send(transport, bootstrapCredential: "PAIRING12345")

        #expect(await network.exchangedCredentials == ["PAIRING12345"])
        #expect(await store.loadBearerToken(scope: Self.scope) == "issued.eyJzaWQiOiJzZXNzaW9uLWZyZXNoIn0.token")
    }

    @Test("A rejected stored bearer is discarded and the request retried after a fresh exchange")
    func rejectedStoredBearerRetriesWithFreshExchange() async throws {
        let staleToken = "stale.eyJzaWQiOiJzZXNzaW9uLXN0YWxlIn0.token"
        let network = FakeNetwork()
        await network.setRejectedBearerTokens([staleToken])
        let storage = AuthSession.InMemoryAuthSecureStorage()
        _ = try await storage.writeBearerCredential(scope: Self.scope, bearerToken: staleToken)
        let store = AuthSession.SecureStorageBearerTokenStore(storage: storage)
        let transport = ServerConnection.NativeURLSessionServerRPCTransport(
            network: network,
            bearerTokenStore: store,
            bearerTokenScope: Self.scope
        )

        let response = try await Self.send(transport, bootstrapCredential: "PAIRING12345")

        #expect(response.payload == #"{"accepted":true}"#)
        #expect(await network.unaryBearerTokens == [staleToken, "issued.eyJzaWQiOiJzZXNzaW9uLWZyZXNoIn0.token"])
        #expect(await network.exchangedCredentials == ["PAIRING12345"])
        #expect(await store.loadBearerToken(scope: Self.scope) == "issued.eyJzaWQiOiJzZXNzaW9uLWZyZXNoIn0.token")
    }

    /// One-shot pairing credentials tolerate exactly one exchange. The
    /// Keychain read suspends, so the acquisition must be single-flighted
    /// against actor reentrancy — concurrent first requests must not each
    /// exchange the credential.
    @Test("Concurrent first requests share a single bootstrap exchange")
    func concurrentRequestsExchangeOnce() async throws {
        let network = FakeNetwork(exchangeDelayNanoseconds: 20_000_000)
        let storage = AuthSession.InMemoryAuthSecureStorage()
        let transport = ServerConnection.NativeURLSessionServerRPCTransport(
            network: network,
            bearerTokenStore: AuthSession.SecureStorageBearerTokenStore(storage: storage),
            bearerTokenScope: Self.scope
        )

        try await withThrowingTaskGroup(of: Void.self) { group in
            for index in 0..<6 {
                group.addTask {
                    _ = try await Self.send(
                        transport,
                        bootstrapCredential: "PAIRING12345",
                        requestID: RequestID(rawValue: "request-\(index)")
                    )
                }
            }
            try await group.waitForAll()
        }

        #expect(await network.exchangedCredentials == ["PAIRING12345"])
        #expect(await network.unaryBearerTokens.count == 6)
    }

    @Test("A rejected direct bearer credential is not retried")
    func rejectedDirectBearerFailsFast() async {
        let network = FakeNetwork()
        await network.setRejectedBearerTokens([Self.directBearerToken])
        let transport = ServerConnection.NativeURLSessionServerRPCTransport(network: network)

        await #expect(throws: ServerConnection.ServerConnectionError.authRejected) {
            _ = try await Self.send(transport, bootstrapCredential: Self.directBearerToken)
        }
        #expect(await network.exchangedCredentials.isEmpty)
        #expect(await network.unaryBearerTokens == [Self.directBearerToken])
    }
}
