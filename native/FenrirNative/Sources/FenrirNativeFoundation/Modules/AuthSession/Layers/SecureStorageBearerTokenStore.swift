import Foundation

public extension AuthSession {
    /// Narrow raw-token store for transport layers that must place the bearer
    /// on the wire (`Authorization: Bearer`). Raw token material stays inside
    /// the AuthSession module everywhere else; this protocol is the single
    /// sanctioned egress point and is scoped to one endpoint.
    protocol BearerTokenStoring: Sendable {
        func loadBearerToken(scope: EndpointScope) async -> String?
        func storeBearerToken(_ token: String, scope: EndpointScope) async
        func discardBearerToken(scope: EndpointScope) async
    }

    /// Best-effort adapter over an `AuthSecureStorage` (Keychain in the app,
    /// in-memory in tests). Storage failures degrade to "no stored token" so
    /// the caller falls back to its bootstrap credential path.
    struct SecureStorageBearerTokenStore: BearerTokenStoring {
        private let storage: any AuthSecureStorage

        public init(storage: any AuthSecureStorage) {
            self.storage = storage
        }

        public func loadBearerToken(scope: EndpointScope) async -> String? {
            guard let stored = try? await storage.readBearerCredential(scope: scope),
                  !stored.bearerToken.isEmpty
            else {
                return nil
            }
            return stored.bearerToken
        }

        public func storeBearerToken(_ token: String, scope: EndpointScope) async {
            _ = try? await storage.writeBearerCredential(scope: scope, bearerToken: token)
        }

        public func discardBearerToken(scope: EndpointScope) async {
            try? await storage.deleteBearerCredential(scope: scope)
        }
    }
}
