import Foundation
import FenrirNativeShared

public extension AuthSession {
    struct DiscoverAuthPolicy: FenrirAction {
        public typealias Failure = AuthSessionError

        let policyDiscoverer: any AuthPolicyDiscovering
        let clock: any AuthSessionClock
        let events: (any AuthSessionEventPublishing)?

        init(
            policyDiscoverer: any AuthPolicyDiscovering,
            clock: any AuthSessionClock,
            events: (any AuthSessionEventPublishing)? = nil
        ) {
            self.policyDiscoverer = policyDiscoverer
            self.clock = clock
            self.events = events
        }

        public func run(_ input: DiscoverAuthPolicyInput) async -> Result<DiscoverAuthPolicyResult, AuthSessionError> {
            let policy: NativeAuthPolicy
            do {
                policy = try await policyDiscoverer.discoverAuthPolicy(input)
            } catch let error as AuthSessionError {
                return .failure(error)
            } catch {
                return .failure(.policyUnavailable)
            }

            guard policy.supportedMethods.contains(.bearerRefresh) || policy.supportedMethods.contains(.localDesktopBootstrap) || policy.supportedMethods.contains(.remotePairing) else {
                return .failure(.policyUnsupported)
            }

            let timestamp = clock.now()
            await events?.publish(AuthSession.envelope(input.requestID, "AuthPolicyDiscovered", timestamp, .authPolicyDiscovered(input.endpointScope)))
            return .success(DiscoverAuthPolicyResult(requestID: input.requestID, policy: policy, timestamp: timestamp))
        }
    }

    struct BootstrapLocalAuthSession: FenrirAction {
        public typealias Failure = AuthSessionError

        let exchanger: any AuthBootstrapExchanging
        let secureStorage: any AuthSecureStorage
        let sessionStore: any AuthSessionStore
        let metadataProvider: any AuthClientMetadataProviding
        let clock: any AuthSessionClock
        let events: (any AuthSessionEventPublishing)?

        init(
            exchanger: any AuthBootstrapExchanging,
            secureStorage: any AuthSecureStorage,
            sessionStore: any AuthSessionStore,
            metadataProvider: any AuthClientMetadataProviding,
            clock: any AuthSessionClock,
            events: (any AuthSessionEventPublishing)? = nil
        ) {
            self.exchanger = exchanger
            self.secureStorage = secureStorage
            self.sessionStore = sessionStore
            self.metadataProvider = metadataProvider
            self.clock = clock
            self.events = events
        }

        public func run(_ input: BootstrapLocalAuthSessionInput) async -> Result<BootstrapLocalAuthSessionResult, AuthSessionError> {
            guard let credential = input.bootstrapCredential, !credential.isEmpty else {
                return .failure(.bootstrapCredentialMissing)
            }

            let metadata: ClientMetadata
            if let clientMetadata = input.clientMetadata {
                metadata = clientMetadata
            } else {
                metadata = await metadataProvider.clientMetadata()
            }
            let material: BearerSessionMaterial
            do {
                material = try await exchanger.exchangeLocalBootstrap(input, clientMetadata: metadata)
            } catch let error as AuthSessionError {
                return .failure(error)
            } catch {
                return .failure(.bootstrapCredentialRejected)
            }

            let persisted = await AuthSession.persist(material, scope: input.endpointScope, secureStorage: secureStorage, sessionStore: sessionStore)
            switch persisted {
            case .failure(let error):
                return .failure(error)
            case .success(let bearer):
                let timestamp = clock.now()
                await events?.publish(AuthSession.envelope(input.requestID, "LocalAuthSessionBootstrapped", timestamp, .localAuthSessionBootstrapped(bearer.session.sessionID)))
                return .success(BootstrapLocalAuthSessionResult(
                    requestID: input.requestID,
                    bearerSession: bearer,
                    session: bearer.session,
                    timestamp: timestamp
                ))
            }
        }
    }

    struct PairRemoteAuthSession: FenrirAction {
        public typealias Failure = AuthSessionError

        let exchanger: any AuthPairingExchanging
        let secureStorage: any AuthSecureStorage
        let sessionStore: any AuthSessionStore
        let metadataProvider: any AuthClientMetadataProviding
        let clock: any AuthSessionClock
        let events: (any AuthSessionEventPublishing)?

        init(
            exchanger: any AuthPairingExchanging,
            secureStorage: any AuthSecureStorage,
            sessionStore: any AuthSessionStore,
            metadataProvider: any AuthClientMetadataProviding,
            clock: any AuthSessionClock,
            events: (any AuthSessionEventPublishing)? = nil
        ) {
            self.exchanger = exchanger
            self.secureStorage = secureStorage
            self.sessionStore = sessionStore
            self.metadataProvider = metadataProvider
            self.clock = clock
            self.events = events
        }

        public func run(_ input: PairRemoteAuthSessionInput) async -> Result<PairRemoteAuthSessionResult, AuthSessionError> {
            guard let credential = input.pairingCredential, !credential.isEmpty else {
                return .failure(.pairingCredentialMissing)
            }

            let metadata: ClientMetadata
            if let clientMetadata = input.clientMetadata {
                metadata = clientMetadata
            } else {
                metadata = await metadataProvider.clientMetadata()
            }
            let material: BearerSessionMaterial
            do {
                material = try await exchanger.exchangeRemotePairing(input, clientMetadata: metadata)
            } catch let error as AuthSessionError {
                return .failure(error)
            } catch {
                return .failure(.pairingCredentialRejected)
            }

            let persisted = await AuthSession.persist(material, scope: input.endpointScope, secureStorage: secureStorage, sessionStore: sessionStore)
            switch persisted {
            case .failure(let error):
                return .failure(error)
            case .success(let bearer):
                let timestamp = clock.now()
                await events?.publish(AuthSession.envelope(input.requestID, "RemoteAuthSessionPaired", timestamp, .remoteAuthSessionPaired(bearer.session.sessionID)))
                return .success(PairRemoteAuthSessionResult(
                    requestID: input.requestID,
                    bearerSession: bearer,
                    session: bearer.session,
                    timestamp: timestamp
                ))
            }
        }
    }

    struct LoadAuthSession: FenrirAction {
        public typealias Failure = AuthSessionError

        let fetcher: any AuthSessionFetching
        let secureStorage: any AuthSecureStorage
        let sessionStore: any AuthSessionStore
        let clock: any AuthSessionClock
        let events: (any AuthSessionEventPublishing)?

        init(
            fetcher: any AuthSessionFetching,
            secureStorage: any AuthSecureStorage,
            sessionStore: any AuthSessionStore,
            clock: any AuthSessionClock,
            events: (any AuthSessionEventPublishing)? = nil
        ) {
            self.fetcher = fetcher
            self.secureStorage = secureStorage
            self.sessionStore = sessionStore
            self.clock = clock
            self.events = events
        }

        public func run(_ input: LoadAuthSessionInput) async -> Result<LoadAuthSessionResult, AuthSessionError> {
            let loaded = await AuthSession.loadVerifiedSession(
                requestID: input.requestID,
                httpBaseURL: input.httpBaseURL,
                endpointScope: input.endpointScope,
                fetcher: fetcher,
                secureStorage: secureStorage,
                sessionStore: sessionStore,
                clock: clock,
                events: events
            )

            switch loaded {
            case .failure(let error):
                return .failure(error)
            case .success(let bearer):
                let timestamp = clock.now()
                await events?.publish(AuthSession.envelope(input.requestID, "AuthSessionLoaded", timestamp, .authSessionLoaded(bearer.session.sessionID)))
                return .success(LoadAuthSessionResult(requestID: input.requestID, bearerSession: bearer, session: bearer.session, timestamp: timestamp))
            }
        }
    }

    struct RefreshAuthSession: FenrirAction {
        public typealias Failure = AuthSessionError

        let fetcher: any AuthSessionFetching
        let secureStorage: any AuthSecureStorage
        let sessionStore: any AuthSessionStore
        let clock: any AuthSessionClock
        let events: (any AuthSessionEventPublishing)?

        init(
            fetcher: any AuthSessionFetching,
            secureStorage: any AuthSecureStorage,
            sessionStore: any AuthSessionStore,
            clock: any AuthSessionClock,
            events: (any AuthSessionEventPublishing)? = nil
        ) {
            self.fetcher = fetcher
            self.secureStorage = secureStorage
            self.sessionStore = sessionStore
            self.clock = clock
            self.events = events
        }

        public func run(_ input: RefreshAuthSessionInput) async -> Result<RefreshAuthSessionResult, AuthSessionError> {
            let current: NativeBearerSession
            if let bearerSession = input.bearerSession {
                guard AuthSession.isScoped(bearerSession.session, to: input.endpointScope) else {
                    return .failure(.protocolMismatch)
                }
                current = bearerSession
            } else {
                switch await AuthSession.loadBearerOnly(scope: input.endpointScope, secureStorage: secureStorage, sessionStore: sessionStore) {
                case .failure(let error):
                    return .failure(error)
                case .success(let bearer):
                    current = bearer
                }
            }

            let timestamp = clock.now()
            if AuthSession.isExpired(current.session, at: timestamp) {
                return .failure(.bearerSessionExpired)
            }

            await events?.publish(AuthSession.envelope(input.requestID, "AuthSessionRefreshStarted", timestamp, .authSessionRefreshStarted(current.session.sessionID)))

            let material: BearerSessionMaterial
            do {
                material = try await fetcher.refreshAuthSession(
                    httpBaseURL: input.httpBaseURL,
                    bearerToken: current.bearerToken,
                    endpointScope: input.endpointScope
                )
            } catch let error as AuthSessionError {
                return .failure(error)
            } catch {
                return .failure(.sessionRefreshFailed)
            }

            switch await AuthSession.persist(material, scope: input.endpointScope, secureStorage: secureStorage, sessionStore: sessionStore) {
            case .failure(let error):
                return .failure(error)
            case .success(let bearer):
                let refreshedAt = clock.now()
                await events?.publish(AuthSession.envelope(input.requestID, "AuthSessionRefreshed", refreshedAt, .authSessionRefreshed(bearer.session.sessionID)))
                return .success(RefreshAuthSessionResult(requestID: input.requestID, bearerSession: bearer, session: bearer.session, timestamp: refreshedAt))
            }
        }
    }

    struct IssueWebSocketToken: FenrirAction {
        public typealias Failure = AuthSessionError

        let issuer: any AuthWebSocketTokenIssuing
        let secureStorage: any AuthSecureStorage
        let sessionStore: any AuthSessionStore
        let clock: any AuthSessionClock
        let events: (any AuthSessionEventPublishing)?

        init(
            issuer: any AuthWebSocketTokenIssuing,
            secureStorage: any AuthSecureStorage,
            sessionStore: any AuthSessionStore,
            clock: any AuthSessionClock,
            events: (any AuthSessionEventPublishing)? = nil
        ) {
            self.issuer = issuer
            self.secureStorage = secureStorage
            self.sessionStore = sessionStore
            self.clock = clock
            self.events = events
        }

        public func run(_ input: IssueWebSocketTokenInput) async -> Result<IssueWebSocketTokenResult, AuthSessionError> {
            let bearer: NativeBearerSession
            if let bearerSession = input.bearerSession {
                guard AuthSession.isScoped(bearerSession.session, to: input.endpointScope) else {
                    return .failure(.protocolMismatch)
                }
                bearer = bearerSession
            } else {
                switch await AuthSession.loadBearerOnly(scope: input.endpointScope, secureStorage: secureStorage, sessionStore: sessionStore) {
                case .failure(let error):
                    return .failure(error)
                case .success(let loaded):
                    bearer = loaded
                }
            }

            let timestamp = clock.now()
            if AuthSession.isExpired(bearer.session, at: timestamp) {
                return .failure(.bearerSessionExpired)
            }

            let token: WebSocketToken
            do {
                token = try await issuer.issueWebSocketToken(
                    httpBaseURL: input.httpBaseURL,
                    bearerSession: bearer,
                    requestedTTLSeconds: input.requestedTTLSeconds
                )
            } catch let error as AuthSessionError {
                return .failure(error)
            } catch {
                return .failure(.webSocketTokenIssueFailed)
            }

            guard token.sessionID == bearer.session.sessionID else {
                return .failure(.actorSessionMismatch)
            }
            guard token.endpointScope == input.endpointScope else {
                return .failure(.protocolMismatch)
            }

            await events?.publish(AuthSession.envelope(input.requestID, "WebSocketTokenIssued", timestamp, .webSocketTokenIssued(token.sessionID)))
            return .success(IssueWebSocketTokenResult(requestID: input.requestID, token: token, timestamp: timestamp))
        }
    }

    struct BuildAuthenticatedActor: FenrirAction {
        public typealias Failure = AuthSessionError

        let clock: any AuthSessionClock
        let events: (any AuthSessionEventPublishing)?

        init(clock: any AuthSessionClock, events: (any AuthSessionEventPublishing)? = nil) {
            self.clock = clock
            self.events = events
        }

        public func run(_ input: BuildAuthenticatedActorInput) async -> Result<BuildAuthenticatedActorResult, AuthSessionError> {
            let timestamp = clock.now()
            if let expiresAt = input.bearerSession.session.expiresAt, expiresAt <= timestamp {
                return .failure(.bearerSessionExpired)
            }
            if let expectedSessionID = input.expectedSessionID, expectedSessionID != input.bearerSession.session.sessionID {
                return .failure(.actorSessionMismatch)
            }
            if let expectedEndpointScope = input.expectedEndpointScope, expectedEndpointScope != input.bearerSession.session.endpointScope {
                return .failure(.protocolMismatch)
            }

            let actor = AuthenticatedActor(
                endpointScope: input.bearerSession.session.endpointScope,
                sessionID: input.bearerSession.session.sessionID,
                subject: input.bearerSession.session.subject,
                role: input.bearerSession.session.role
            )
            await events?.publish(
                EventEnvelope(
                    eventID: input.requestID,
                    eventKind: "AuthenticatedActorBuilt",
                    timestamp: timestamp,
                    event: .authenticatedActorBuilt(actor.sessionID)
                )
            )
            return .success(BuildAuthenticatedActorResult(
                requestID: input.requestID,
                actor: actor,
                timestamp: timestamp
            ))
        }
    }

    struct ListAuthSessions: FenrirAction {
        public typealias Failure = AuthSessionError

        let revoker: any AuthSessionRevoking
        let clock: any AuthSessionClock

        init(revoker: any AuthSessionRevoking, clock: any AuthSessionClock) {
            self.revoker = revoker
            self.clock = clock
        }

        public func run(_ input: ListAuthSessionsInput) async -> Result<ListAuthSessionsResult, AuthSessionError> {
            guard AuthSession.isScoped(input.bearerSession.session, to: input.endpointScope) else {
                return .failure(.protocolMismatch)
            }
            guard input.bearerSession.session.role == .owner else {
                return .failure(.roleInsufficient)
            }
            if AuthSession.isExpired(input.bearerSession.session, at: clock.now()) {
                return .failure(.bearerSessionExpired)
            }

            do {
                let sessions = try await revoker.listAuthSessions(
                    httpBaseURL: input.httpBaseURL,
                    bearerSession: input.bearerSession
                )
                return .success(ListAuthSessionsResult(requestID: input.requestID, sessions: sessions, timestamp: clock.now()))
            } catch let error as AuthSessionError {
                return .failure(error)
            } catch {
                return .failure(.sessionRevocationFailed)
            }
        }
    }

    struct RevokeAuthSession: FenrirAction {
        public typealias Failure = AuthSessionError

        let revoker: any AuthSessionRevoking
        let secureStorage: any AuthSecureStorage
        let sessionStore: any AuthSessionStore
        let clock: any AuthSessionClock
        let events: (any AuthSessionEventPublishing)?

        init(
            revoker: any AuthSessionRevoking,
            secureStorage: any AuthSecureStorage,
            sessionStore: any AuthSessionStore,
            clock: any AuthSessionClock,
            events: (any AuthSessionEventPublishing)? = nil
        ) {
            self.revoker = revoker
            self.secureStorage = secureStorage
            self.sessionStore = sessionStore
            self.clock = clock
            self.events = events
        }

        public func run(_ input: RevokeAuthSessionInput) async -> Result<RevokeAuthSessionResult, AuthSessionError> {
            guard AuthSession.isScoped(input.currentBearerSession.session, to: input.endpointScope) else {
                return .failure(.protocolMismatch)
            }
            guard input.currentBearerSession.session.role == .owner else {
                return .failure(.roleInsufficient)
            }
            if AuthSession.isExpired(input.currentBearerSession.session, at: clock.now()) {
                return .failure(.bearerSessionExpired)
            }

            do {
                try await revoker.revokeAuthSession(
                    httpBaseURL: input.httpBaseURL,
                    bearerSession: input.currentBearerSession,
                    targetSessionID: input.targetSessionID
                )
            } catch let error as AuthSessionError {
                return .failure(error)
            } catch {
                return .failure(.sessionRevocationFailed)
            }

            var didClearLocalSession = false
            if input.targetSessionID == input.currentBearerSession.session.sessionID {
                switch await AuthSession.clearLocalSession(scope: input.currentBearerSession.session.endpointScope, secureStorage: secureStorage, sessionStore: sessionStore) {
                case .failure(let error):
                    return .failure(error)
                case .success:
                    didClearLocalSession = true
                }
            }

            let timestamp = clock.now()
            await events?.publish(AuthSession.envelope(input.requestID, "AuthSessionRevoked", timestamp, .authSessionRevoked(input.targetSessionID)))
            return .success(RevokeAuthSessionResult(
                requestID: input.requestID,
                revokedSessionID: input.targetSessionID,
                didClearLocalSession: didClearLocalSession,
                timestamp: timestamp
            ))
        }
    }

    struct ClearAuthSession: FenrirAction {
        public typealias Failure = AuthSessionError

        let secureStorage: any AuthSecureStorage
        let sessionStore: any AuthSessionStore
        let clock: any AuthSessionClock
        let events: (any AuthSessionEventPublishing)?

        init(
            secureStorage: any AuthSecureStorage,
            sessionStore: any AuthSessionStore,
            clock: any AuthSessionClock,
            events: (any AuthSessionEventPublishing)? = nil
        ) {
            self.secureStorage = secureStorage
            self.sessionStore = sessionStore
            self.clock = clock
            self.events = events
        }

        public func run(_ input: ClearAuthSessionInput) async -> Result<ClearAuthSessionResult, AuthSessionError> {
            switch await AuthSession.clearLocalSession(scope: input.endpointScope, secureStorage: secureStorage, sessionStore: sessionStore) {
            case .failure(let error):
                return .failure(error)
            case .success:
                let timestamp = clock.now()
                await events?.publish(AuthSession.envelope(input.requestID, "AuthSessionCleared", timestamp, .authSessionCleared(input.endpointScope)))
                return .success(ClearAuthSessionResult(requestID: input.requestID, endpointScope: input.endpointScope, timestamp: timestamp))
            }
        }
    }
}

private extension AuthSession {
    static func envelope(
        _ requestID: RequestID,
        _ eventKind: String,
        _ timestamp: FenrirTimestamp,
        _ event: Event
    ) -> EventEnvelope<Event> {
        EventEnvelope(eventID: requestID, eventKind: eventKind, timestamp: timestamp, event: event)
    }

    static func isExpired(_ session: NativeAuthSession, at timestamp: FenrirTimestamp) -> Bool {
        guard let expiresAt = session.expiresAt else {
            return false
        }
        return expiresAt <= timestamp
    }

    static func isScoped(_ session: NativeAuthSession, to scope: EndpointScope) -> Bool {
        session.endpointScope == scope
    }

    static func persist(
        _ material: BearerSessionMaterial,
        scope: EndpointScope,
        secureStorage: any AuthSecureStorage,
        sessionStore: any AuthSessionStore
    ) async -> Result<NativeBearerSession, AuthSessionError> {
        guard isScoped(material.session, to: scope) else {
            return .failure(.protocolMismatch)
        }

        let reference: String
        do {
            reference = try await secureStorage.writeBearerCredential(scope: scope, bearerToken: material.bearerToken)
        } catch let error as AuthSessionError {
            return .failure(error)
        } catch {
            return .failure(.secureStorageWriteFailed)
        }

        let session = material.session.withCredentialReference(reference)
        do {
            try await sessionStore.saveSession(session)
        } catch let error as AuthSessionError {
            return .failure(error)
        } catch {
            return .failure(.secureStorageWriteFailed)
        }

        return NativeBearerSession.verified(session: session, bearerToken: material.bearerToken)
    }

    static func loadBearerOnly(
        scope: EndpointScope,
        secureStorage: any AuthSecureStorage,
        sessionStore: any AuthSessionStore
    ) async -> Result<NativeBearerSession, AuthSessionError> {
        let credential: StoredBearerCredential?
        do {
            credential = try await secureStorage.readBearerCredential(scope: scope)
        } catch let error as AuthSessionError {
            return .failure(error)
        } catch {
            return .failure(.secureStorageReadFailed)
        }

        guard let credential else {
            return .failure(.bearerSessionMissing)
        }
        guard credential.endpointScope == scope else {
            return .failure(.protocolMismatch)
        }

        let session: NativeAuthSession?
        do {
            session = try await sessionStore.loadSession(scope: scope)
        } catch let error as AuthSessionError {
            return .failure(error)
        } catch {
            return .failure(.secureStorageReadFailed)
        }

        guard let session else {
            return .failure(.bearerSessionMissing)
        }

        guard isScoped(session, to: scope) else {
            return .failure(.protocolMismatch)
        }

        return NativeBearerSession.verified(
            session: session.withCredentialReference(credential.reference),
            bearerToken: credential.bearerToken
        )
    }

    static func loadVerifiedSession(
        requestID: RequestID,
        httpBaseURL: String,
        endpointScope: EndpointScope,
        fetcher: any AuthSessionFetching,
        secureStorage: any AuthSecureStorage,
        sessionStore: any AuthSessionStore,
        clock: any AuthSessionClock,
        events: (any AuthSessionEventPublishing)?
    ) async -> Result<NativeBearerSession, AuthSessionError> {
        let credential: StoredBearerCredential?
        do {
            credential = try await secureStorage.readBearerCredential(scope: endpointScope)
        } catch let error as AuthSessionError {
            return .failure(error)
        } catch {
            return .failure(.secureStorageReadFailed)
        }

        guard let credential else {
            return .failure(.bearerSessionMissing)
        }
        guard credential.endpointScope == endpointScope else {
            return .failure(.protocolMismatch)
        }

        let verified: NativeAuthSession
        do {
            verified = try await fetcher.fetchAuthSession(
                httpBaseURL: httpBaseURL,
                bearerToken: credential.bearerToken,
                endpointScope: endpointScope
            )
        } catch let error as AuthSessionError {
            if error == .bearerSessionExpired {
                await events?.publish(envelope(requestID, "AuthSessionExpired", clock.now(), .authSessionExpired(SessionID(rawValue: credential.reference))))
            }
            return .failure(error)
        } catch {
            return .failure(.bearerSessionRejected)
        }

        guard isScoped(verified, to: endpointScope) else {
            return .failure(.protocolMismatch)
        }

        if isExpired(verified, at: clock.now()) {
            await events?.publish(envelope(requestID, "AuthSessionExpired", clock.now(), .authSessionExpired(verified.sessionID)))
            return .failure(.bearerSessionExpired)
        }

        let session = verified.withCredentialReference(credential.reference)
        do {
            try await sessionStore.saveSession(session)
        } catch let error as AuthSessionError {
            return .failure(error)
        } catch {
            return .failure(.secureStorageWriteFailed)
        }

        return NativeBearerSession.verified(session: session, bearerToken: credential.bearerToken)
    }

    static func clearLocalSession(
        scope: EndpointScope,
        secureStorage: any AuthSecureStorage,
        sessionStore: any AuthSessionStore
    ) async -> Result<Void, AuthSessionError> {
        do {
            try await secureStorage.deleteBearerCredential(scope: scope)
        } catch let error as AuthSessionError {
            return .failure(error)
        } catch {
            return .failure(.secureStorageDeleteFailed)
        }

        do {
            try await sessionStore.deleteSession(scope: scope)
        } catch let error as AuthSessionError {
            return .failure(error)
        } catch {
            return .failure(.secureStorageDeleteFailed)
        }

        return .success(())
    }
}
