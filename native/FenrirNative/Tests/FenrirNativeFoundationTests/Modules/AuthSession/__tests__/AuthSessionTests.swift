import Foundation
import Testing
import FenrirNativeShared
@testable import AuthSession

@Suite("AuthSession actions")
struct AuthSessionTests {
    @Test("BuildAuthenticatedActor requires verified bearer session identity")
    func buildActorUsesBearerSession() async throws {
        let session = AuthSession.NativeAuthSession(
            endpointScope: AuthSession.EndpointScope(endpointID: "local"),
            sessionID: "session-a",
            subject: "user",
            role: .owner
        )
        let bearer = try AuthSession.NativeBearerSession.verified(
            session: session,
            bearerToken: "secret"
        ).get()
        let action = AuthSession.BuildAuthenticatedActor(clock: FixedClock())

        let result = try await action.run(
            AuthSession.BuildAuthenticatedActorInput(
                requestID: "req",
                bearerSession: bearer
            )
        ).get()

        #expect(result.actor.sessionID == bearer.session.sessionID)
        #expect(result.actor.subject == bearer.session.subject)
        #expect(result.actor.endpointScope == bearer.session.endpointScope)
    }

    @Test("BuildAuthenticatedActor rejects explicit session id mismatches")
    func buildActorRejectsExpectedSessionMismatch() async throws {
        let bearer = try AuthSession.NativeBearerSession.verified(
            session: authSession(),
            bearerToken: "secret"
        ).get()
        let action = AuthSession.BuildAuthenticatedActor(clock: FixedClock())

        let result = await action.run(
            AuthSession.BuildAuthenticatedActorInput(
                requestID: "req",
                bearerSession: bearer,
                expectedSessionID: "different-session"
            )
        )

        #expect(result == .failure(.actorSessionMismatch))
    }

    @Test("BuildAuthenticatedActor rejects explicit endpoint scope mismatches")
    func buildActorRejectsExpectedEndpointScopeMismatch() async throws {
        let bearer = try AuthSession.NativeBearerSession.verified(
            session: authSession(endpointScope: remoteScope()),
            bearerToken: "secret"
        ).get()
        let action = AuthSession.BuildAuthenticatedActor(clock: FixedClock())

        let result = await action.run(
            AuthSession.BuildAuthenticatedActorInput(
                requestID: "req",
                bearerSession: bearer,
                expectedEndpointScope: scope()
            )
        )

        #expect(result == .failure(.protocolMismatch))
    }

    @Test("NativeBearerSession verification rejects missing bearer token material")
    func bearerVerificationRejectsMissingBearerToken() async throws {
        let session = AuthSession.NativeAuthSession(
            endpointScope: AuthSession.EndpointScope(endpointID: "local"),
            sessionID: "session-a",
            subject: "user",
            role: .owner
        )

        let result = AuthSession.NativeBearerSession.verified(
            session: session,
            bearerToken: ""
        )

        #expect(result == .failure(.bearerSessionMissing))
    }

    @Test("BuildAuthenticatedActor rejects expired verified bearer sessions")
    func buildActorRejectsExpiredBearerSession() async throws {
        let session = AuthSession.NativeAuthSession(
            endpointScope: AuthSession.EndpointScope(endpointID: "local"),
            sessionID: "session-a",
            subject: "user",
            role: .owner,
            expiresAt: FenrirTimestamp(Date(timeIntervalSince1970: 1))
        )
        let bearer = try AuthSession.NativeBearerSession.verified(
            session: session,
            bearerToken: "secret"
        ).get()
        let action = AuthSession.BuildAuthenticatedActor(clock: FixedClock())

        let result = await action.run(
            AuthSession.BuildAuthenticatedActorInput(
                requestID: "req",
                bearerSession: bearer
            )
        )

        #expect(result == .failure(.bearerSessionExpired))
    }

    @Test("Ordinary auth session snapshots do not encode bearer token material")
    func sessionSnapshotExcludesBearerToken() throws {
        let session = AuthSession.NativeAuthSession(
            endpointScope: AuthSession.EndpointScope(endpointID: "local"),
            sessionID: "session-a",
            subject: "user",
            role: .owner,
            credentialReference: "keychain://fenrir/session-a"
        )

        let data = try JSONEncoder().encode(session)
        let json = String(decoding: data, as: UTF8.self)

        #expect(json.contains("credentialReference"))
        #expect(!json.contains("bearer-secret"))
        #expect(!json.contains("bearerToken"))
        #expect(!json.contains("\"token\""))
    }

    @Test("BootstrapLocalAuthSession persists bearer material behind credential reference")
    func bootstrapPersistsBearerMaterial() async throws {
        let secureStorage = TestAuthSecureStorage()
        let sessionStore = TestAuthSessionStore()
        let action = AuthSession.BootstrapLocalAuthSession(
            exchanger: BootstrapExchanger(material: .init(session: authSession(sessionMethod: .localDesktopBootstrap), bearerToken: "bearer-secret")),
            secureStorage: secureStorage,
            sessionStore: sessionStore,
            metadataProvider: metadataProvider(),
            clock: FixedClock()
        )

        let result = try await action.run(
            AuthSession.BootstrapLocalAuthSessionInput(
                requestID: "bootstrap",
                endpointScope: scope(),
                httpBaseURL: "http://localhost:3000",
                bootstrapCredential: "desktop-bootstrap",
                source: .test
            )
        ).get()

        #expect(result.session.credentialReference == "test-keychain://auth-session/local/default")
        #expect(result.bearerSession.bearerToken == "bearer-secret")
        #expect(try await secureStorage.readBearerCredential(scope: scope())?.bearerToken == "bearer-secret")
        #expect(try await sessionStore.loadSession(scope: scope())?.credentialReference == result.session.credentialReference)
    }

    @Test("BootstrapLocalAuthSession rejects missing bootstrap credential")
    func bootstrapRejectsMissingCredential() async {
        let action = AuthSession.BootstrapLocalAuthSession(
            exchanger: BootstrapExchanger(material: .init(session: authSession(), bearerToken: "bearer-secret")),
            secureStorage: TestAuthSecureStorage(),
            sessionStore: TestAuthSessionStore(),
            metadataProvider: metadataProvider(),
            clock: FixedClock()
        )

        let result = await action.run(
            AuthSession.BootstrapLocalAuthSessionInput(
                requestID: "bootstrap",
                endpointScope: scope(),
                httpBaseURL: "http://localhost:3000",
                bootstrapCredential: "",
                source: .test
            )
        )

        #expect(result == .failure(.bootstrapCredentialMissing))
    }

    @Test("BootstrapLocalAuthSession rejects bearer material for a different endpoint scope")
    func bootstrapRejectsEndpointScopeMismatch() async {
        let action = AuthSession.BootstrapLocalAuthSession(
            exchanger: BootstrapExchanger(material: .init(session: authSession(endpointScope: remoteScope()), bearerToken: "bearer-secret")),
            secureStorage: TestAuthSecureStorage(),
            sessionStore: TestAuthSessionStore(),
            metadataProvider: metadataProvider(),
            clock: FixedClock()
        )

        let result = await action.run(
            AuthSession.BootstrapLocalAuthSessionInput(
                requestID: "bootstrap",
                endpointScope: scope(),
                httpBaseURL: "http://localhost:3000",
                bootstrapCredential: "desktop-bootstrap",
                source: .test
            )
        )

        #expect(result == .failure(.protocolMismatch))
    }

    @Test("PairRemoteAuthSession rejects bearer material for a different endpoint scope")
    func pairRejectsEndpointScopeMismatch() async {
        let action = AuthSession.PairRemoteAuthSession(
            exchanger: PairingExchanger(material: .init(session: authSession(endpointScope: scope()), bearerToken: "bearer-secret")),
            secureStorage: TestAuthSecureStorage(),
            sessionStore: TestAuthSessionStore(),
            metadataProvider: metadataProvider(),
            clock: FixedClock()
        )

        let result = await action.run(
            AuthSession.PairRemoteAuthSessionInput(
                requestID: "pair",
                endpointScope: remoteScope(),
                httpBaseURL: "https://remote.example",
                pairingCredential: "one-time-pairing",
                source: .test
            )
        )

        #expect(result == .failure(.protocolMismatch))
    }

    @Test("LoadAuthSession verifies stored bearer token with server fetcher")
    func loadVerifiesStoredBearer() async throws {
        let secureStorage = TestAuthSecureStorage()
        let sessionStore = TestAuthSessionStore()
        _ = try await secureStorage.writeBearerCredential(scope: scope(), bearerToken: "stored-secret")
        let fetcher = SessionFetcher(session: authSession())
        let action = AuthSession.LoadAuthSession(
            fetcher: fetcher,
            secureStorage: secureStorage,
            sessionStore: sessionStore,
            clock: FixedClock()
        )

        let result = try await action.run(
            AuthSession.LoadAuthSessionInput(
                requestID: "load",
                endpointScope: scope(),
                httpBaseURL: "http://localhost:3000",
                source: .test
            )
        ).get()

        #expect(result.session.sessionID == "session-a")
        #expect(result.bearerSession.bearerToken == "stored-secret")
        #expect(await fetcher.lastBearerToken() == "stored-secret")
    }

    @Test("LoadAuthSession rejects verified server session for a different endpoint scope")
    func loadRejectsEndpointScopeMismatch() async throws {
        let secureStorage = TestAuthSecureStorage()
        let sessionStore = TestAuthSessionStore()
        _ = try await secureStorage.writeBearerCredential(scope: scope(), bearerToken: "stored-secret")
        let action = AuthSession.LoadAuthSession(
            fetcher: SessionFetcher(session: authSession(endpointScope: remoteScope())),
            secureStorage: secureStorage,
            sessionStore: sessionStore,
            clock: FixedClock()
        )

        let result = await action.run(
            AuthSession.LoadAuthSessionInput(
                requestID: "load",
                endpointScope: scope(),
                httpBaseURL: "http://localhost:3000",
                source: .test
            )
        )

        #expect(result == .failure(.protocolMismatch))
    }

    @Test("RefreshAuthSession rejects caller bearer session for a different endpoint scope")
    func refreshRejectsExplicitBearerEndpointScopeMismatch() async throws {
        let bearer = try AuthSession.NativeBearerSession.verified(
            session: authSession(endpointScope: remoteScope()),
            bearerToken: "secret"
        ).get()
        let action = AuthSession.RefreshAuthSession(
            fetcher: SessionFetcher(session: authSession(endpointScope: scope())),
            secureStorage: TestAuthSecureStorage(),
            sessionStore: TestAuthSessionStore(),
            clock: FixedClock()
        )

        let result = await action.run(
            AuthSession.RefreshAuthSessionInput(
                requestID: "refresh",
                endpointScope: scope(),
                httpBaseURL: "http://localhost:3000",
                bearerSession: bearer,
                source: .test
            )
        )

        #expect(result == .failure(.protocolMismatch))
    }

    @Test("RefreshAuthSession rejects refreshed bearer material for a different endpoint scope")
    func refreshRejectsReturnedBearerEndpointScopeMismatch() async throws {
        let bearer = try AuthSession.NativeBearerSession.verified(
            session: authSession(),
            bearerToken: "secret"
        ).get()
        let action = AuthSession.RefreshAuthSession(
            fetcher: SessionFetcher(session: authSession(endpointScope: remoteScope())),
            secureStorage: TestAuthSecureStorage(),
            sessionStore: TestAuthSessionStore(),
            clock: FixedClock()
        )

        let result = await action.run(
            AuthSession.RefreshAuthSessionInput(
                requestID: "refresh",
                endpointScope: scope(),
                httpBaseURL: "http://localhost:3000",
                bearerSession: bearer,
                source: .test
            )
        )

        #expect(result == .failure(.protocolMismatch))
    }

    @Test("IssueWebSocketToken rejects token session id mismatch")
    func webSocketTokenRejectsSessionMismatch() async throws {
        let bearer = try AuthSession.NativeBearerSession.verified(
            session: authSession(),
            bearerToken: "secret"
        ).get()
        let action = AuthSession.IssueWebSocketToken(
            issuer: TokenIssuer(token: AuthSession.WebSocketToken(
                endpointScope: scope(),
                sessionID: "different-session",
                token: "ws-secret",
                expiresAt: FixedClock().timestamp
            )),
            secureStorage: TestAuthSecureStorage(),
            sessionStore: TestAuthSessionStore(),
            clock: FixedClock()
        )

        let result = await action.run(
            AuthSession.IssueWebSocketTokenInput(
                requestID: "ws",
                endpointScope: scope(),
                httpBaseURL: "http://localhost:3000",
                bearerSession: bearer,
                source: .test
            )
        )

        #expect(result == .failure(.actorSessionMismatch))
    }

    @Test("IssueWebSocketToken rejects caller bearer session for a different endpoint scope")
    func webSocketTokenRejectsExplicitBearerEndpointScopeMismatch() async throws {
        let bearer = try AuthSession.NativeBearerSession.verified(
            session: authSession(endpointScope: remoteScope()),
            bearerToken: "secret"
        ).get()
        let action = AuthSession.IssueWebSocketToken(
            issuer: TokenIssuer(token: AuthSession.WebSocketToken(
                endpointScope: scope(),
                sessionID: "session-a",
                token: "ws-secret",
                expiresAt: FixedClock().timestamp
            )),
            secureStorage: TestAuthSecureStorage(),
            sessionStore: TestAuthSessionStore(),
            clock: FixedClock()
        )

        let result = await action.run(
            AuthSession.IssueWebSocketTokenInput(
                requestID: "ws",
                endpointScope: scope(),
                httpBaseURL: "http://localhost:3000",
                bearerSession: bearer,
                source: .test
            )
        )

        #expect(result == .failure(.protocolMismatch))
    }

    @Test("IssueWebSocketToken rejects issued token for a different endpoint scope")
    func webSocketTokenRejectsIssuedTokenEndpointScopeMismatch() async throws {
        let bearer = try AuthSession.NativeBearerSession.verified(
            session: authSession(),
            bearerToken: "secret"
        ).get()
        let action = AuthSession.IssueWebSocketToken(
            issuer: TokenIssuer(token: AuthSession.WebSocketToken(
                endpointScope: remoteScope(),
                sessionID: "session-a",
                token: "ws-secret",
                expiresAt: FixedClock().timestamp
            )),
            secureStorage: TestAuthSecureStorage(),
            sessionStore: TestAuthSessionStore(),
            clock: FixedClock()
        )

        let result = await action.run(
            AuthSession.IssueWebSocketTokenInput(
                requestID: "ws",
                endpointScope: scope(),
                httpBaseURL: "http://localhost:3000",
                bearerSession: bearer,
                source: .test
            )
        )

        #expect(result == .failure(.protocolMismatch))
    }

    @Test("IssueWebSocketToken rejects stored bearer credentials for a different endpoint scope")
    func webSocketTokenRejectsStoredBearerEndpointScopeMismatch() async throws {
        let secureStorage = MismatchedReadAuthSecureStorage(
            credential: AuthSession.StoredBearerCredential(
                endpointScope: remoteScope(),
                reference: "test-keychain://auth-session/remote/profile-a",
                bearerToken: "remote-secret"
            )
        )
        let sessionStore = TestAuthSessionStore()
        try await sessionStore.saveSession(authSession(endpointScope: remoteScope()))
        let action = AuthSession.IssueWebSocketToken(
            issuer: TokenIssuer(token: AuthSession.WebSocketToken(
                endpointScope: scope(),
                sessionID: "session-a",
                token: "ws-secret",
                expiresAt: FixedClock().timestamp
            )),
            secureStorage: secureStorage,
            sessionStore: sessionStore,
            clock: FixedClock()
        )

        let result = await action.run(
            AuthSession.IssueWebSocketTokenInput(
                requestID: "ws",
                endpointScope: scope(),
                httpBaseURL: "http://localhost:3000",
                source: .test
            )
        )

        #expect(result == .failure(.protocolMismatch))
    }

    @Test("ListAuthSessions requires owner role")
    func listRequiresOwnerRole() async throws {
        let bearer = try AuthSession.NativeBearerSession.verified(
            session: authSession(role: .client),
            bearerToken: "secret"
        ).get()
        let action = AuthSession.ListAuthSessions(revoker: SessionRevoker(), clock: FixedClock())

        let result = await action.run(
            AuthSession.ListAuthSessionsInput(
                requestID: "list",
                endpointScope: scope(),
                httpBaseURL: "http://localhost:3000",
                bearerSession: bearer,
                source: .test
            )
        )

        #expect(result == .failure(.roleInsufficient))
    }

    @Test("ListAuthSessions rejects bearer sessions for a different endpoint scope")
    func listRejectsEndpointScopeMismatch() async throws {
        let bearer = try AuthSession.NativeBearerSession.verified(
            session: authSession(endpointScope: remoteScope()),
            bearerToken: "secret"
        ).get()
        let action = AuthSession.ListAuthSessions(revoker: SessionRevoker(), clock: FixedClock())

        let result = await action.run(
            AuthSession.ListAuthSessionsInput(
                requestID: "list",
                endpointScope: scope(),
                httpBaseURL: "http://localhost:3000",
                bearerSession: bearer,
                source: .test
            )
        )

        #expect(result == .failure(.protocolMismatch))
    }

    @Test("RevokeAuthSession clears local storage when revoking current session")
    func revokeCurrentClearsLocalSession() async throws {
        let secureStorage = TestAuthSecureStorage()
        let sessionStore = TestAuthSessionStore()
        _ = try await secureStorage.writeBearerCredential(scope: scope(), bearerToken: "secret")
        try await sessionStore.saveSession(authSession().withCredentialReference("ref"))
        let bearer = try AuthSession.NativeBearerSession.verified(session: authSession(), bearerToken: "secret").get()
        let action = AuthSession.RevokeAuthSession(
            revoker: SessionRevoker(),
            secureStorage: secureStorage,
            sessionStore: sessionStore,
            clock: FixedClock()
        )

        let result = try await action.run(
            AuthSession.RevokeAuthSessionInput(
                requestID: "revoke",
                endpointScope: scope(),
                httpBaseURL: "http://localhost:3000",
                currentBearerSession: bearer,
                targetSessionID: "session-a",
                source: .test
            )
        ).get()

        #expect(result.didClearLocalSession)
        #expect(try await secureStorage.readBearerCredential(scope: scope()) == nil)
        #expect(try await sessionStore.loadSession(scope: scope()) == nil)
    }

    @Test("RevokeAuthSession rejects current bearer sessions for a different endpoint scope")
    func revokeRejectsEndpointScopeMismatch() async throws {
        let bearer = try AuthSession.NativeBearerSession.verified(
            session: authSession(endpointScope: remoteScope()),
            bearerToken: "secret"
        ).get()
        let action = AuthSession.RevokeAuthSession(
            revoker: SessionRevoker(),
            secureStorage: TestAuthSecureStorage(),
            sessionStore: TestAuthSessionStore(),
            clock: FixedClock()
        )

        let result = await action.run(
            AuthSession.RevokeAuthSessionInput(
                requestID: "revoke",
                endpointScope: scope(),
                httpBaseURL: "http://localhost:3000",
                currentBearerSession: bearer,
                targetSessionID: "session-a",
                source: .test
            )
        )

        #expect(result == .failure(.protocolMismatch))
    }

    @Test("ClearAuthSession deletes local secret and non-secret state")
    func clearDeletesLocalSession() async throws {
        let secureStorage = TestAuthSecureStorage()
        let sessionStore = TestAuthSessionStore()
        _ = try await secureStorage.writeBearerCredential(scope: scope(), bearerToken: "secret")
        try await sessionStore.saveSession(authSession().withCredentialReference("ref"))
        let action = AuthSession.ClearAuthSession(
            secureStorage: secureStorage,
            sessionStore: sessionStore,
            clock: FixedClock()
        )

        _ = try await action.run(AuthSession.ClearAuthSessionInput(
            requestID: "clear",
            endpointScope: scope(),
            source: .test
        )).get()

        #expect(try await secureStorage.readBearerCredential(scope: scope()) == nil)
        #expect(try await sessionStore.loadSession(scope: scope()) == nil)
    }
}

private func scope() -> AuthSession.EndpointScope {
    AuthSession.EndpointScope(endpointID: "local")
}

private func remoteScope() -> AuthSession.EndpointScope {
    AuthSession.EndpointScope(endpointID: "remote", profileID: "profile-a")
}

private func authSession(
    endpointScope: AuthSession.EndpointScope = scope(),
    role: AuthSession.Role = .owner,
    sessionMethod: AuthSession.SessionMethod = .bearer
) -> AuthSession.NativeAuthSession {
    AuthSession.NativeAuthSession(
        endpointScope: endpointScope,
        sessionID: "session-a",
        subject: "user",
        role: role,
        sessionMethod: sessionMethod
    )
}

private func metadataProvider() -> TestAuthClientMetadataProvider {
    TestAuthClientMetadataProvider(metadata: AuthSession.ClientMetadata(
        clientName: "Fenrir Native Tests",
        deviceName: "test-device"
    ))
}

private actor TestAuthSecureStorage: AuthSession.AuthSecureStorage {
    private var credentials: [AuthSession.EndpointScope: AuthSession.StoredBearerCredential] = [:]

    func readBearerCredential(
        scope: AuthSession.EndpointScope
    ) async throws -> AuthSession.StoredBearerCredential? {
        credentials[scope]
    }

    func writeBearerCredential(
        scope: AuthSession.EndpointScope,
        bearerToken: String
    ) async throws -> String {
        guard !bearerToken.isEmpty else {
            throw AuthSession.AuthSessionError.secureStorageWriteFailed
        }

        let profile = scope.profileID?.rawValue ?? "default"
        let reference = "test-keychain://auth-session/\(scope.endpointID)/\(profile)"
        credentials[scope] = AuthSession.StoredBearerCredential(
            endpointScope: scope,
            reference: reference,
            bearerToken: bearerToken
        )
        return reference
    }

    func deleteBearerCredential(scope: AuthSession.EndpointScope) async throws {
        credentials.removeValue(forKey: scope)
    }
}

private struct MismatchedReadAuthSecureStorage: AuthSession.AuthSecureStorage {
    let credential: AuthSession.StoredBearerCredential

    func readBearerCredential(
        scope: AuthSession.EndpointScope
    ) async throws -> AuthSession.StoredBearerCredential? {
        credential
    }

    func writeBearerCredential(
        scope: AuthSession.EndpointScope,
        bearerToken: String
    ) async throws -> String {
        credential.reference
    }

    func deleteBearerCredential(scope: AuthSession.EndpointScope) async throws {}
}

private actor TestAuthSessionStore: AuthSession.AuthSessionStore {
    private var sessions: [AuthSession.EndpointScope: AuthSession.NativeAuthSession] = [:]

    func loadSession(scope: AuthSession.EndpointScope) async throws -> AuthSession.NativeAuthSession? {
        sessions[scope]
    }

    func saveSession(_ session: AuthSession.NativeAuthSession) async throws {
        sessions[session.endpointScope] = session
    }

    func deleteSession(scope: AuthSession.EndpointScope) async throws {
        sessions.removeValue(forKey: scope)
    }
}

private struct TestAuthClientMetadataProvider: AuthSession.AuthClientMetadataProviding {
    let metadata: AuthSession.ClientMetadata

    func clientMetadata() async -> AuthSession.ClientMetadata {
        metadata
    }
}

private struct BootstrapExchanger: AuthSession.AuthBootstrapExchanging {
    let material: AuthSession.BearerSessionMaterial

    func exchangeLocalBootstrap(
        _ input: AuthSession.BootstrapLocalAuthSessionInput,
        clientMetadata: AuthSession.ClientMetadata
    ) async throws -> AuthSession.BearerSessionMaterial {
        material
    }
}

private struct PairingExchanger: AuthSession.AuthPairingExchanging {
    let material: AuthSession.BearerSessionMaterial

    func exchangeRemotePairing(
        _ input: AuthSession.PairRemoteAuthSessionInput,
        clientMetadata: AuthSession.ClientMetadata
    ) async throws -> AuthSession.BearerSessionMaterial {
        material
    }
}

private actor SessionFetcher: AuthSession.AuthSessionFetching {
    private let session: AuthSession.NativeAuthSession
    private var observedBearerToken: String?

    init(session: AuthSession.NativeAuthSession) {
        self.session = session
    }

    func fetchAuthSession(
        httpBaseURL: String,
        bearerToken: String,
        endpointScope: AuthSession.EndpointScope
    ) async throws -> AuthSession.NativeAuthSession {
        observedBearerToken = bearerToken
        return session
    }

    func refreshAuthSession(
        httpBaseURL: String,
        bearerToken: String,
        endpointScope: AuthSession.EndpointScope
    ) async throws -> AuthSession.BearerSessionMaterial {
        AuthSession.BearerSessionMaterial(session: session, bearerToken: bearerToken)
    }

    func lastBearerToken() -> String? {
        observedBearerToken
    }
}

private struct TokenIssuer: AuthSession.AuthWebSocketTokenIssuing {
    let token: AuthSession.WebSocketToken

    func issueWebSocketToken(
        httpBaseURL: String,
        bearerSession: AuthSession.NativeBearerSession,
        requestedTTLSeconds: Int?
    ) async throws -> AuthSession.WebSocketToken {
        token
    }
}

private actor SessionRevoker: AuthSession.AuthSessionRevoking {
    private(set) var revoked: [AuthSession.SessionID] = []

    func listAuthSessions(
        httpBaseURL: String,
        bearerSession: AuthSession.NativeBearerSession
    ) async throws -> [AuthSession.NativeAuthSessionSummary] {
        [AuthSession.NativeAuthSessionSummary(session: bearerSession.session)]
    }

    func revokeAuthSession(
        httpBaseURL: String,
        bearerSession: AuthSession.NativeBearerSession,
        targetSessionID: AuthSession.SessionID
    ) async throws {
        revoked.append(targetSessionID)
    }
}
