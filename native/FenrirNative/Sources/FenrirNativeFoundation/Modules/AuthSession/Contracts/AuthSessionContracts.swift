import Foundation
import FenrirNativeShared

public extension AuthSession {
    struct SessionID: FenrirID, ExpressibleByStringLiteral {
        public let rawValue: String

        public init(rawValue: String) {
            self.rawValue = rawValue
        }

        public init(stringLiteral value: String) {
            self.init(rawValue: value)
        }
    }

    enum Role: String, Codable, Equatable, Sendable {
        case owner
        case client
        case operatorRole = "operator"
        case viewer
    }

    enum SessionMethod: String, Codable, Equatable, Sendable {
        case localDesktopBootstrap
        case remotePairing
        case bearer
    }

    enum AuthPolicyMethod: String, Codable, Equatable, Sendable {
        case localDesktopBootstrap
        case remotePairing
        case bearerRefresh
        case webSocketToken
    }

    struct EndpointScope: Codable, Hashable, Sendable {
        public let endpointID: String
        public let profileID: ProfileID?

        public init(endpointID: String, profileID: ProfileID? = nil) {
            self.endpointID = endpointID
            self.profileID = profileID
        }
    }

    struct ClientMetadata: Codable, Equatable, Sendable {
        public let clientName: String
        public let deviceName: String
        public let appVersion: String?

        public init(clientName: String, deviceName: String, appVersion: String? = nil) {
            self.clientName = clientName
            self.deviceName = deviceName
            self.appVersion = appVersion
        }
    }

    struct NativeAuthSession: Codable, Equatable, Sendable {
        public let endpointScope: EndpointScope
        public let sessionID: SessionID
        public let subject: String
        public let role: Role
        public let sessionMethod: SessionMethod
        public let issuedAt: FenrirTimestamp?
        public let expiresAt: FenrirTimestamp?
        public let credentialReference: String?

        public init(
            endpointScope: EndpointScope,
            sessionID: SessionID,
            subject: String,
            role: Role,
            sessionMethod: SessionMethod = .bearer,
            issuedAt: FenrirTimestamp? = nil,
            expiresAt: FenrirTimestamp? = nil,
            credentialReference: String? = nil
        ) {
            self.endpointScope = endpointScope
            self.sessionID = sessionID
            self.subject = subject
            self.role = role
            self.sessionMethod = sessionMethod
            self.issuedAt = issuedAt
            self.expiresAt = expiresAt
            self.credentialReference = credentialReference
        }

        public func withCredentialReference(_ credentialReference: String?) -> NativeAuthSession {
            NativeAuthSession(
                endpointScope: endpointScope,
                sessionID: sessionID,
                subject: subject,
                role: role,
                sessionMethod: sessionMethod,
                issuedAt: issuedAt,
                expiresAt: expiresAt,
                credentialReference: credentialReference
            )
        }
    }

    struct NativeBearerSession: Equatable, Sendable {
        private let verifiedSession: NativeAuthSession
        private let verifiedBearerToken: String

        public var session: NativeAuthSession {
            verifiedSession
        }

        var bearerToken: String {
            verifiedBearerToken
        }

        init(
            verifiedSession: NativeAuthSession,
            verifiedBearerToken: String
        ) {
            self.verifiedSession = verifiedSession
            self.verifiedBearerToken = verifiedBearerToken
        }

        static func verified(
            session: NativeAuthSession,
            bearerToken: String
        ) -> Result<NativeBearerSession, AuthSessionError> {
            guard !bearerToken.isEmpty else {
                return .failure(.bearerSessionMissing)
            }

            return .success(NativeBearerSession(
                verifiedSession: session,
                verifiedBearerToken: bearerToken
            ))
        }
    }

    struct WebSocketToken: Equatable, Sendable {
        public let endpointScope: EndpointScope
        public let sessionID: SessionID
        public let token: String
        public let expiresAt: FenrirTimestamp

        public init(endpointScope: EndpointScope, sessionID: SessionID, token: String, expiresAt: FenrirTimestamp) {
            self.endpointScope = endpointScope
            self.sessionID = sessionID
            self.token = token
            self.expiresAt = expiresAt
        }
    }

    struct NativeAuthPolicy: Codable, Equatable, Sendable {
        public let endpointScope: EndpointScope
        public let supportedMethods: [AuthPolicyMethod]
        public let requiresPairing: Bool
        public let supportsLocalBootstrap: Bool
        public let serverIdentity: String?

        public init(
            endpointScope: EndpointScope,
            supportedMethods: [AuthPolicyMethod],
            requiresPairing: Bool,
            supportsLocalBootstrap: Bool,
            serverIdentity: String? = nil
        ) {
            self.endpointScope = endpointScope
            self.supportedMethods = supportedMethods
            self.requiresPairing = requiresPairing
            self.supportsLocalBootstrap = supportsLocalBootstrap
            self.serverIdentity = serverIdentity
        }
    }

    struct NativeAuthSessionSummary: Codable, Equatable, Sendable {
        public let endpointScope: EndpointScope
        public let sessionID: SessionID
        public let subject: String
        public let role: Role
        public let expiresAt: FenrirTimestamp?

        public init(
            endpointScope: EndpointScope,
            sessionID: SessionID,
            subject: String,
            role: Role,
            expiresAt: FenrirTimestamp? = nil
        ) {
            self.endpointScope = endpointScope
            self.sessionID = sessionID
            self.subject = subject
            self.role = role
            self.expiresAt = expiresAt
        }

        public init(session: NativeAuthSession) {
            self.init(
                endpointScope: session.endpointScope,
                sessionID: session.sessionID,
                subject: session.subject,
                role: session.role,
                expiresAt: session.expiresAt
            )
        }
    }

    struct NativeAuthSessionState: Codable, Equatable, Sendable {
        public let endpointScope: EndpointScope
        public let currentSession: NativeAuthSession?
        public let lastVerifiedAt: FenrirTimestamp?

        public init(
            endpointScope: EndpointScope,
            currentSession: NativeAuthSession?,
            lastVerifiedAt: FenrirTimestamp? = nil
        ) {
            self.endpointScope = endpointScope
            self.currentSession = currentSession
            self.lastVerifiedAt = lastVerifiedAt
        }
    }

    struct AuthenticatedActor: Codable, Equatable, Sendable {
        public let endpointScope: EndpointScope
        public let sessionID: SessionID
        public let subject: String
        public let role: Role

        public init(endpointScope: EndpointScope, sessionID: SessionID, subject: String, role: Role) {
            self.endpointScope = endpointScope
            self.sessionID = sessionID
            self.subject = subject
            self.role = role
        }
    }

    enum AuthSessionError: String, Error, Codable, Equatable, Sendable {
        case policyUnavailable = "AuthPolicyUnavailable"
        case policyUnsupported = "AuthPolicyUnsupported"
        case bootstrapCredentialMissing = "AuthBootstrapCredentialMissing"
        case bootstrapCredentialRejected = "AuthBootstrapCredentialRejected"
        case pairingCredentialMissing = "AuthPairingCredentialMissing"
        case pairingCredentialRejected = "AuthPairingCredentialRejected"
        case bearerSessionMissing = "AuthBearerSessionMissing"
        case bearerSessionRejected = "AuthBearerSessionRejected"
        case bearerSessionExpired = "AuthBearerSessionExpired"
        case sessionRefreshFailed = "AuthSessionRefreshFailed"
        case webSocketTokenIssueFailed = "AuthWebSocketTokenIssueFailed"
        case actorSessionMismatch = "AuthActorSessionMismatch"
        case roleInsufficient = "AuthRoleInsufficient"
        case sessionRevocationFailed = "AuthSessionRevocationFailed"
        case secureStorageReadFailed = "AuthSecureStorageReadFailed"
        case secureStorageWriteFailed = "AuthSecureStorageWriteFailed"
        case secureStorageDeleteFailed = "AuthSecureStorageDeleteFailed"
        case serverUnavailable = "AuthServerUnavailable"
        case protocolMismatch = "AuthProtocolMismatch"
    }

    struct BuildAuthenticatedActorInput: Equatable, Sendable {
        public let requestID: RequestID
        public let bearerSession: NativeBearerSession
        public let expectedEndpointScope: EndpointScope?
        public let expectedSessionID: SessionID?

        public init(
            requestID: RequestID,
            bearerSession: NativeBearerSession,
            expectedEndpointScope: EndpointScope? = nil,
            expectedSessionID: SessionID? = nil
        ) {
            self.requestID = requestID
            self.bearerSession = bearerSession
            self.expectedEndpointScope = expectedEndpointScope
            self.expectedSessionID = expectedSessionID
        }
    }

    struct BuildAuthenticatedActorResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let actor: AuthenticatedActor
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, actor: AuthenticatedActor, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.actor = actor
            self.timestamp = timestamp
        }
    }

    enum Event: Codable, Equatable, Sendable {
        case authPolicyDiscovered(EndpointScope)
        case localAuthSessionBootstrapped(SessionID)
        case remoteAuthSessionPaired(SessionID)
        case authSessionLoaded(SessionID)
        case authSessionRefreshStarted(SessionID)
        case authSessionRefreshed(SessionID)
        case authSessionExpired(SessionID)
        case authenticatedActorBuilt(SessionID)
        case webSocketTokenIssued(SessionID)
        case authSessionRevoked(SessionID)
        case authSessionCleared(EndpointScope)
        case authSecureStorageFailed(EndpointScope)
    }

    struct DiscoverAuthPolicyInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let endpointScope: EndpointScope
        public let httpBaseURL: String
        public let source: ActionSource

        public init(requestID: RequestID, endpointScope: EndpointScope, httpBaseURL: String, source: ActionSource) {
            self.requestID = requestID
            self.endpointScope = endpointScope
            self.httpBaseURL = httpBaseURL
            self.source = source
        }
    }

    struct DiscoverAuthPolicyResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let policy: NativeAuthPolicy
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, policy: NativeAuthPolicy, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.policy = policy
            self.timestamp = timestamp
        }
    }

    struct BootstrapLocalAuthSessionInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let endpointScope: EndpointScope
        public let httpBaseURL: String
        public let bootstrapCredential: String?
        public let clientMetadata: ClientMetadata?
        public let source: ActionSource

        public init(
            requestID: RequestID,
            endpointScope: EndpointScope,
            httpBaseURL: String,
            bootstrapCredential: String?,
            clientMetadata: ClientMetadata? = nil,
            source: ActionSource
        ) {
            self.requestID = requestID
            self.endpointScope = endpointScope
            self.httpBaseURL = httpBaseURL
            self.bootstrapCredential = bootstrapCredential
            self.clientMetadata = clientMetadata
            self.source = source
        }
    }

    struct BootstrapLocalAuthSessionResult: Equatable, Sendable {
        public let requestID: RequestID
        public let bearerSession: NativeBearerSession
        public let session: NativeAuthSession
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, bearerSession: NativeBearerSession, session: NativeAuthSession, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.bearerSession = bearerSession
            self.session = session
            self.timestamp = timestamp
        }
    }

    struct PairRemoteAuthSessionInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let endpointScope: EndpointScope
        public let httpBaseURL: String
        public let pairingCredential: String?
        public let clientMetadata: ClientMetadata?
        public let source: ActionSource

        public init(
            requestID: RequestID,
            endpointScope: EndpointScope,
            httpBaseURL: String,
            pairingCredential: String?,
            clientMetadata: ClientMetadata? = nil,
            source: ActionSource
        ) {
            self.requestID = requestID
            self.endpointScope = endpointScope
            self.httpBaseURL = httpBaseURL
            self.pairingCredential = pairingCredential
            self.clientMetadata = clientMetadata
            self.source = source
        }
    }

    struct PairRemoteAuthSessionResult: Equatable, Sendable {
        public let requestID: RequestID
        public let bearerSession: NativeBearerSession
        public let session: NativeAuthSession
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, bearerSession: NativeBearerSession, session: NativeAuthSession, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.bearerSession = bearerSession
            self.session = session
            self.timestamp = timestamp
        }
    }

    struct LoadAuthSessionInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let endpointScope: EndpointScope
        public let httpBaseURL: String
        public let source: ActionSource

        public init(requestID: RequestID, endpointScope: EndpointScope, httpBaseURL: String, source: ActionSource) {
            self.requestID = requestID
            self.endpointScope = endpointScope
            self.httpBaseURL = httpBaseURL
            self.source = source
        }
    }

    struct LoadAuthSessionResult: Equatable, Sendable {
        public let requestID: RequestID
        public let bearerSession: NativeBearerSession
        public let session: NativeAuthSession
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, bearerSession: NativeBearerSession, session: NativeAuthSession, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.bearerSession = bearerSession
            self.session = session
            self.timestamp = timestamp
        }
    }

    struct RefreshAuthSessionInput: Equatable, Sendable {
        public let requestID: RequestID
        public let endpointScope: EndpointScope
        public let httpBaseURL: String
        public let bearerSession: NativeBearerSession?
        public let source: ActionSource

        public init(
            requestID: RequestID,
            endpointScope: EndpointScope,
            httpBaseURL: String,
            bearerSession: NativeBearerSession? = nil,
            source: ActionSource
        ) {
            self.requestID = requestID
            self.endpointScope = endpointScope
            self.httpBaseURL = httpBaseURL
            self.bearerSession = bearerSession
            self.source = source
        }
    }

    struct RefreshAuthSessionResult: Equatable, Sendable {
        public let requestID: RequestID
        public let bearerSession: NativeBearerSession
        public let session: NativeAuthSession
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, bearerSession: NativeBearerSession, session: NativeAuthSession, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.bearerSession = bearerSession
            self.session = session
            self.timestamp = timestamp
        }
    }

    struct IssueWebSocketTokenInput: Equatable, Sendable {
        public let requestID: RequestID
        public let endpointScope: EndpointScope
        public let httpBaseURL: String
        public let bearerSession: NativeBearerSession?
        public let requestedTTLSeconds: Int?
        public let source: ActionSource

        public init(
            requestID: RequestID,
            endpointScope: EndpointScope,
            httpBaseURL: String,
            bearerSession: NativeBearerSession? = nil,
            requestedTTLSeconds: Int? = nil,
            source: ActionSource
        ) {
            self.requestID = requestID
            self.endpointScope = endpointScope
            self.httpBaseURL = httpBaseURL
            self.bearerSession = bearerSession
            self.requestedTTLSeconds = requestedTTLSeconds
            self.source = source
        }
    }

    struct IssueWebSocketTokenResult: Equatable, Sendable {
        public let requestID: RequestID
        public let token: WebSocketToken
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, token: WebSocketToken, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.token = token
            self.timestamp = timestamp
        }
    }

    struct ListAuthSessionsInput: Equatable, Sendable {
        public let requestID: RequestID
        public let endpointScope: EndpointScope
        public let httpBaseURL: String
        public let bearerSession: NativeBearerSession
        public let source: ActionSource

        public init(
            requestID: RequestID,
            endpointScope: EndpointScope,
            httpBaseURL: String,
            bearerSession: NativeBearerSession,
            source: ActionSource
        ) {
            self.requestID = requestID
            self.endpointScope = endpointScope
            self.httpBaseURL = httpBaseURL
            self.bearerSession = bearerSession
            self.source = source
        }
    }

    struct ListAuthSessionsResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let sessions: [NativeAuthSessionSummary]
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, sessions: [NativeAuthSessionSummary], timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.sessions = sessions
            self.timestamp = timestamp
        }
    }

    struct RevokeAuthSessionInput: Equatable, Sendable {
        public let requestID: RequestID
        public let endpointScope: EndpointScope
        public let httpBaseURL: String
        public let currentBearerSession: NativeBearerSession
        public let targetSessionID: SessionID
        public let source: ActionSource

        public init(
            requestID: RequestID,
            endpointScope: EndpointScope,
            httpBaseURL: String,
            currentBearerSession: NativeBearerSession,
            targetSessionID: SessionID,
            source: ActionSource
        ) {
            self.requestID = requestID
            self.endpointScope = endpointScope
            self.httpBaseURL = httpBaseURL
            self.currentBearerSession = currentBearerSession
            self.targetSessionID = targetSessionID
            self.source = source
        }
    }

    struct RevokeAuthSessionResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let revokedSessionID: SessionID
        public let didClearLocalSession: Bool
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, revokedSessionID: SessionID, didClearLocalSession: Bool, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.revokedSessionID = revokedSessionID
            self.didClearLocalSession = didClearLocalSession
            self.timestamp = timestamp
        }
    }

    struct ClearAuthSessionInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let endpointScope: EndpointScope
        public let source: ActionSource

        public init(requestID: RequestID, endpointScope: EndpointScope, source: ActionSource) {
            self.requestID = requestID
            self.endpointScope = endpointScope
            self.source = source
        }
    }

    struct ClearAuthSessionResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let endpointScope: EndpointScope
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, endpointScope: EndpointScope, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.endpointScope = endpointScope
            self.timestamp = timestamp
        }
    }
}
