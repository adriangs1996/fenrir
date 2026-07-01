import Foundation
import FenrirNativeShared

extension AuthSession {
    struct BearerSessionMaterial: Equatable, Sendable {
        let session: NativeAuthSession
        let bearerToken: String

        init(session: NativeAuthSession, bearerToken: String) {
            self.session = session
            self.bearerToken = bearerToken
        }
    }

    struct StoredBearerCredential: Equatable, Sendable {
        let endpointScope: EndpointScope
        let reference: String
        let bearerToken: String

        init(endpointScope: EndpointScope, reference: String, bearerToken: String) {
            self.endpointScope = endpointScope
            self.reference = reference
            self.bearerToken = bearerToken
        }
    }

    protocol AuthSessionClock: Sendable {
        func now() -> FenrirTimestamp
    }

    protocol AuthPolicyDiscovering: Sendable {
        func discoverAuthPolicy(_ input: DiscoverAuthPolicyInput) async throws -> NativeAuthPolicy
    }

    protocol AuthBootstrapExchanging: Sendable {
        func exchangeLocalBootstrap(
            _ input: BootstrapLocalAuthSessionInput,
            clientMetadata: ClientMetadata
        ) async throws -> BearerSessionMaterial
    }

    protocol AuthPairingExchanging: Sendable {
        func exchangeRemotePairing(
            _ input: PairRemoteAuthSessionInput,
            clientMetadata: ClientMetadata
        ) async throws -> BearerSessionMaterial
    }

    protocol AuthSessionFetching: Sendable {
        func fetchAuthSession(
            httpBaseURL: String,
            bearerToken: String,
            endpointScope: EndpointScope
        ) async throws -> NativeAuthSession

        func refreshAuthSession(
            httpBaseURL: String,
            bearerToken: String,
            endpointScope: EndpointScope
        ) async throws -> BearerSessionMaterial
    }

    protocol AuthWebSocketTokenIssuing: Sendable {
        func issueWebSocketToken(
            httpBaseURL: String,
            bearerSession: NativeBearerSession,
            requestedTTLSeconds: Int?
        ) async throws -> WebSocketToken
    }

    protocol AuthSessionRevoking: Sendable {
        func listAuthSessions(
            httpBaseURL: String,
            bearerSession: NativeBearerSession
        ) async throws -> [NativeAuthSessionSummary]

        func revokeAuthSession(
            httpBaseURL: String,
            bearerSession: NativeBearerSession,
            targetSessionID: SessionID
        ) async throws
    }

    protocol AuthSecureStorage: Sendable {
        func readBearerCredential(scope: EndpointScope) async throws -> StoredBearerCredential?
        func writeBearerCredential(scope: EndpointScope, bearerToken: String) async throws -> String
        func deleteBearerCredential(scope: EndpointScope) async throws
    }

    protocol AuthClientMetadataProviding: Sendable {
        func clientMetadata() async -> ClientMetadata
    }

    protocol AuthSessionStore: Sendable {
        func loadSession(scope: EndpointScope) async throws -> NativeAuthSession?
        func saveSession(_ session: NativeAuthSession) async throws
        func deleteSession(scope: EndpointScope) async throws
    }

    protocol AuthSessionEventPublishing: Sendable {
        func publish(_ event: EventEnvelope<Event>) async
    }
}
