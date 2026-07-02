import Foundation
import Security

public extension AuthSession {
    actor KeychainAuthSecureStorage: AuthSecureStorage {
        private let service: String
        private let accessGroup: String?
        private let encoder: JSONEncoder
        private let decoder: JSONDecoder

        public init(
            service: String = "com.fenrir.native.auth-session",
            accessGroup: String? = nil,
            encoder: JSONEncoder = JSONEncoder(),
            decoder: JSONDecoder = JSONDecoder()
        ) {
            self.service = service
            self.accessGroup = accessGroup
            self.encoder = encoder
            self.decoder = decoder
        }

        public func readBearerCredential(scope: EndpointScope) async throws -> StoredBearerCredential? {
            let account = Self.account(for: scope)
            var query = baseQuery(account: account)
            query[kSecReturnData as String] = kCFBooleanTrue
            query[kSecMatchLimit as String] = kSecMatchLimitOne

            var result: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &result)
            if status == errSecItemNotFound {
                return nil
            }
            guard status == errSecSuccess, let data = result as? Data else {
                throw AuthSessionError.secureStorageReadFailed
            }

            let token: String
            if let payload = try? decoder.decode(KeychainBearerCredentialPayload.self, from: data) {
                guard payload.endpointID == scope.endpointID,
                      payload.profileID == scope.profileID?.rawValue,
                      !payload.bearerToken.isEmpty
                else {
                    throw AuthSessionError.secureStorageReadFailed
                }
                token = payload.bearerToken
            } else if let legacyToken = String(data: data, encoding: .utf8), !legacyToken.isEmpty {
                token = legacyToken
            } else {
                throw AuthSessionError.secureStorageReadFailed
            }

            return StoredBearerCredential(
                endpointScope: scope,
                reference: Self.reference(service: service, account: account),
                bearerToken: token
            )
        }

        public func writeBearerCredential(scope: EndpointScope, bearerToken: String) async throws -> String {
            guard !bearerToken.isEmpty else {
                throw AuthSessionError.secureStorageWriteFailed
            }

            let account = Self.account(for: scope)
            let payload = KeychainBearerCredentialPayload(
                endpointID: scope.endpointID,
                profileID: scope.profileID?.rawValue,
                bearerToken: bearerToken
            )

            let data: Data
            do {
                data = try encoder.encode(payload)
            } catch {
                throw AuthSessionError.secureStorageWriteFailed
            }

            var addQuery = baseQuery(account: account)
            addQuery[kSecValueData as String] = data
            addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

            let status = SecItemAdd(addQuery as CFDictionary, nil)
            if status == errSecSuccess {
                return Self.reference(service: service, account: account)
            }
            guard status == errSecDuplicateItem else {
                throw AuthSessionError.secureStorageWriteFailed
            }

            let updateStatus = SecItemUpdate(
                baseQuery(account: account) as CFDictionary,
                [kSecValueData as String: data] as CFDictionary
            )
            guard updateStatus == errSecSuccess else {
                throw AuthSessionError.secureStorageWriteFailed
            }
            return Self.reference(service: service, account: account)
        }

        public func deleteBearerCredential(scope: EndpointScope) async throws {
            let status = SecItemDelete(baseQuery(account: Self.account(for: scope)) as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else {
                throw AuthSessionError.secureStorageDeleteFailed
            }
        }

        private func baseQuery(account: String) -> [String: Any] {
            var query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: account
            ]
            if let accessGroup {
                query[kSecAttrAccessGroup as String] = accessGroup
            }
            return query
        }

        private static func account(for scope: EndpointScope) -> String {
            let profile = scope.profileID?.rawValue ?? "default"
            return "\(scope.endpointID)#\(profile)"
        }

        private static func reference(service: String, account: String) -> String {
            "keychain://\(service)/\(account)"
        }
    }
}

private struct KeychainBearerCredentialPayload: Codable {
    let version: Int
    let endpointID: String
    let profileID: String?
    let bearerToken: String

    init(endpointID: String, profileID: String?, bearerToken: String) {
        self.version = 1
        self.endpointID = endpointID
        self.profileID = profileID
        self.bearerToken = bearerToken
    }
}
