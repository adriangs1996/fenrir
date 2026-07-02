import Foundation

public extension AuthSession {
    actor InMemoryAuthSecureStorage: AuthSecureStorage {
        private var credentials: [EndpointScope: StoredBearerCredential]

        public init(credentials: [EndpointScope: StoredBearerCredential] = [:]) {
            self.credentials = credentials
        }

        public func readBearerCredential(scope: EndpointScope) async throws -> StoredBearerCredential? {
            credentials[scope]
        }

        public func writeBearerCredential(scope: EndpointScope, bearerToken: String) async throws -> String {
            guard !bearerToken.isEmpty else {
                throw AuthSessionError.secureStorageWriteFailed
            }

            let reference = Self.reference(for: scope)
            credentials[scope] = StoredBearerCredential(
                endpointScope: scope,
                reference: reference,
                bearerToken: bearerToken
            )
            return reference
        }

        public func deleteBearerCredential(scope: EndpointScope) async throws {
            credentials.removeValue(forKey: scope)
        }

        private static func reference(for scope: EndpointScope) -> String {
            let profile = scope.profileID?.rawValue ?? "default"
            return "memory-keychain://auth-session/\(scope.endpointID)/\(profile)"
        }
    }
}
