import Foundation
import FenrirNativeShared
import AuthSession

public extension ServerConnection {
    struct NativeBearerSession: Equatable, Sendable {
        public let token: String
        public let authSessionID: AuthSession.SessionID?

        public init(token: String, authSessionID: AuthSession.SessionID? = nil) {
            self.token = token
            self.authSessionID = authSessionID
        }
    }

    enum NativeServerRPCWire {
        private struct BearerClaims: Decodable {
            let sid: String?
        }

        public static func authSessionID(fromBearerToken token: String) -> AuthSession.SessionID? {
            let parts = token.split(separator: ".")
            let payloadPart: Substring?
            if parts.count == 2 {
                payloadPart = parts.first
            } else {
                payloadPart = parts.dropFirst().first
            }
            guard let payload = payloadPart,
                  let data = base64URLDecodedData(String(payload)),
                  let claims = try? JSONDecoder().decode(BearerClaims.self, from: data),
                  let sid = claims.sid,
                  !sid.isEmpty
            else {
                return nil
            }
            return AuthSession.SessionID(rawValue: sid)
        }

        public static func request(
            _ request: RequestEnvelope,
            rewritingActorSessionID authSessionID: AuthSession.SessionID?
        ) -> RequestEnvelope {
            guard let authSessionID,
                  let payloadData = request.payload.data(using: .utf8),
                  let payload = try? JSONSerialization.jsonObject(with: payloadData, options: [])
            else {
                return request
            }
            let rewritten = rewriteActorSessionIDs(in: payload, authSessionID: authSessionID.rawValue)
            guard JSONSerialization.isValidJSONObject(rewritten),
                  let data = try? JSONSerialization.data(withJSONObject: rewritten, options: [])
            else {
                return request
            }
            return RequestEnvelope(
                method: request.method,
                payload: String(decoding: data, as: UTF8.self),
                timeoutMilliseconds: request.timeoutMilliseconds,
                retryPolicy: request.retryPolicy
            )
        }

        public static func httpRequestBody(requestID: RequestID, request: RequestEnvelope) throws -> Data {
            let payloadData = Data(request.payload.utf8)
            let payload = try JSONSerialization.jsonObject(with: payloadData, options: [])
            let body: [String: Any] = [
                "method": request.method,
                "requestId": requestID.rawValue,
                "payload": payload,
            ]
            return try JSONSerialization.data(withJSONObject: body, options: [])
        }

        public static func parseUnaryHTTPResponse(_ data: Data) throws -> String {
            guard let root = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any] else {
                throw ServerConnectionError.protocolMismatch
            }
            guard root["ok"] as? Bool == true else {
                throw serverConnectionError(from: root["error"]) ?? ServerConnectionError.requestRejected
            }
            let value = root["payload"] ?? [:]
            guard JSONSerialization.isValidJSONObject(value) else {
                throw ServerConnectionError.protocolMismatch
            }
            let payload = try JSONSerialization.data(withJSONObject: value, options: [])
            return String(decoding: payload, as: UTF8.self)
        }

        public static func streamEventData(fromNDJSONLine line: String) -> Data? {
            guard !line.isEmpty else {
                return nil
            }
            return Data(line.utf8)
        }

        public static func serverConnectionError(from value: Any?) -> ServerConnectionError? {
            if let string = value as? String {
                return ServerConnectionError(rawValue: string)
            }
            guard let dictionary = value as? [String: Any] else {
                return nil
            }
            for key in ["code", "name", "tag", "_tag", "error"] {
                if let string = dictionary[key] as? String,
                   let error = ServerConnectionError(rawValue: string)
                {
                    return error
                }
            }
            return nil
        }

        private static func base64URLDecodedData(_ value: String) -> Data? {
            var base64 = value
                .replacingOccurrences(of: "-", with: "+")
                .replacingOccurrences(of: "_", with: "/")
            let padding = (4 - base64.count % 4) % 4
            if padding > 0 {
                base64.append(String(repeating: "=", count: padding))
            }
            return Data(base64Encoded: base64)
        }

        private static func rewriteActorSessionIDs(in value: Any, authSessionID: String) -> Any {
            if var dictionary = value as? [String: Any] {
                if dictionary["subject"] is String, dictionary["sessionId"] is String {
                    dictionary["sessionId"] = authSessionID
                }
                for (key, child) in dictionary {
                    dictionary[key] = rewriteActorSessionIDs(in: child, authSessionID: authSessionID)
                }
                return dictionary
            }
            if let array = value as? [Any] {
                return array.map { rewriteActorSessionIDs(in: $0, authSessionID: authSessionID) }
            }
            return value
        }
    }
}
