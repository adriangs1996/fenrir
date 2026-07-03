import Foundation
import FenrirNativeShared
import AuthSession

public extension ServerConnection {
    struct NativeWebSocketToken: Codable, Equatable, Sendable {
        public let token: String

        public init(token: String) {
            self.token = token
        }
    }

    protocol NativeWebSocketRPCAuthenticating: Sendable {
        func exchangeBearerSession(httpBaseURL: URL, credential: String) async throws -> NativeBearerSession
        func issueWebSocketToken(httpBaseURL: URL, bearerToken: String) async throws -> NativeWebSocketToken
    }

    protocol NativeWebSocketRPCConnecting: Sendable {
        func connect(webSocketURL: URL, webSocketToken: NativeWebSocketToken) async throws -> any NativeWebSocketRPCSessioning
    }

    protocol NativeWebSocketRPCSessioning: Sendable {
        func sendText(_ text: String) async throws
        func receiveText() async throws -> String
        func close() async
    }

    actor NativeWebSocketRPCRequestIDGenerator {
        private var nextID: UInt64

        public init(start: UInt64 = 1) {
            nextID = max(1, start)
        }

        public func next() -> UInt64 {
            defer { nextID += 1 }
            return nextID
        }
    }

    enum NativeWebSocketRPCDecodedMessage: Equatable, Sendable {
        case response(id: UInt64, payload: String)
        case failure(id: UInt64, error: ServerConnectionError)
        case chunk(id: UInt64, payloads: [String])
        case pong
        case defect(ServerConnectionError)
        case ignored
    }

    enum NativeWebSocketRPCWire {
        public static func requestFrame(id: UInt64, request: RequestEnvelope) throws -> String {
            let params = try jsonValue(from: request.payload)
            let frame: [String: Any] = [
                "headers": [Any](),
                "id": NSNumber(value: id),
                "jsonrpc": "2.0",
                "method": request.method,
                "params": params,
            ]
            return try jsonString(from: frame)
        }

        public static func decode(text: String) throws -> NativeWebSocketRPCDecodedMessage {
            let rootValue = try jsonValue(from: text)
            guard let root = rootValue as? [String: Any] else {
                throw ServerConnectionError.protocolMismatch
            }

            if isPong(root) {
                return .pong
            }
            if isIgnorableEffectControlMessage(root) {
                return .ignored
            }
            if let defect = root["defect"] ?? root["defects"] {
                return .defect(errorFromJSONRPCError(defect))
            }

            guard let id = requestID(from: root["id"]) else {
                return .ignored
            }

            if root["chunk"] as? Bool == true {
                guard let result = root["result"] else {
                    throw ServerConnectionError.protocolMismatch
                }
                let values = (result as? [Any]) ?? [result]
                return .chunk(id: id, payloads: try values.map { try jsonString(from: $0) })
            }

            if let error = root["error"] {
                return .failure(id: id, error: errorFromJSONRPCError(error))
            }

            guard root.keys.contains("result") else {
                return .ignored
            }
            return .response(id: id, payload: try jsonString(from: root["result"] ?? NSNull()))
        }

        public static func requestID(from value: Any?) -> UInt64? {
            if let number = value as? NSNumber {
                if CFGetTypeID(number) == CFBooleanGetTypeID() {
                    return nil
                }
                let doubleValue = number.doubleValue
                guard doubleValue.isFinite,
                      doubleValue >= 0,
                      doubleValue.rounded(.towardZero) == doubleValue
                else {
                    return nil
                }
                return UInt64(doubleValue)
            }
            if value is Bool {
                return nil
            }
            if let string = value as? String {
                return UInt64(string)
            }
            return nil
        }

        public static func errorFromJSONRPCError(_ value: Any?) -> ServerConnectionError {
            if let error = NativeServerRPCWire.serverConnectionError(from: value) {
                return error
            }

            let text = flattenedErrorText(value).lowercased()
            if text.contains("serverauthrejected") ||
                text.contains("unauthorized") ||
                text.contains("authentication") ||
                text.contains("forbidden") ||
                text.contains("401") ||
                text.contains("403")
            {
                return .authRejected
            }
            if text.contains("timeout") || text.contains("timed out") {
                return .requestTimedOut
            }
            if text.contains("protocol") {
                return .protocolMismatch
            }
            return .requestRejected
        }

        public static func jsonString(from value: Any) throws -> String {
            let options: JSONSerialization.WritingOptions = [.fragmentsAllowed, .sortedKeys]
            let data = try JSONSerialization.data(withJSONObject: value, options: options)
            return String(decoding: data, as: UTF8.self)
        }

        private static func jsonValue(from text: String) throws -> Any {
            try JSONSerialization.jsonObject(
                with: Data(text.utf8),
                options: [.fragmentsAllowed]
            )
        }

        private static func isPong(_ root: [String: Any]) -> Bool {
            stringFields(in: root).contains("@effect/rpc/Pong")
        }

        private static func isIgnorableEffectControlMessage(_ root: [String: Any]) -> Bool {
            let fields = stringFields(in: root)
            return fields.contains("@effect/rpc/Ping") || fields.contains("@effect/rpc/Interrupt")
        }

        private static func stringFields(in dictionary: [String: Any]) -> Set<String> {
            Set(dictionary.compactMap { _, value in value as? String })
        }

        private static func flattenedErrorText(_ value: Any?) -> String {
            guard let value else {
                return ""
            }
            if let string = value as? String {
                return string
            }
            if let number = value as? NSNumber {
                return number.stringValue
            }
            if let dictionary = value as? [String: Any] {
                return dictionary
                    .map { key, child in "\(key) \(flattenedErrorText(child))" }
                    .joined(separator: " ")
            }
            if let array = value as? [Any] {
                return array.map(flattenedErrorText).joined(separator: " ")
            }
            return String(describing: value)
        }
    }

    actor NativeWebSocketServerRPCTransport: NativeServerRPCTransporting {
        private struct CachedBearerSession: Sendable {
            let httpBaseURL: String
            let bootstrapCredential: String
            let bearerSession: NativeBearerSession
        }

        private let authenticator: any NativeWebSocketRPCAuthenticating
        private let connector: any NativeWebSocketRPCConnecting
        private let requestIDs: NativeWebSocketRPCRequestIDGenerator
        private var cachedBearerSession: CachedBearerSession?
        private var pendingBearerSession: (httpBaseURL: String, bootstrapCredential: String, task: Task<NativeBearerSession, Error>)?

        public init(
            authenticator: any NativeWebSocketRPCAuthenticating = NativeURLSessionWebSocketRPCAuthenticator(),
            connector: any NativeWebSocketRPCConnecting = NativeURLSessionWebSocketRPCConnector(),
            requestIDs: NativeWebSocketRPCRequestIDGenerator = NativeWebSocketRPCRequestIDGenerator()
        ) {
            self.authenticator = authenticator
            self.connector = connector
            self.requestIDs = requestIDs
        }

        public func sendAuthenticatedRPC(
            httpBaseURL: URL,
            webSocketURL: URL,
            bootstrapCredential: String,
            session: Session,
            requestID: RequestID,
            request: RequestEnvelope
        ) async throws -> ResponseEnvelope {
            _ = requestID
            return try await withRequestTimeout(milliseconds: request.timeoutMilliseconds) {
                let (bearer, socket) = try await self.openSocket(
                    httpBaseURL: httpBaseURL,
                    webSocketURL: webSocketURL,
                    bootstrapCredential: bootstrapCredential
                )
                do {
                    let rpcID = await self.requestIDs.next()
                    let authenticatedRequest = NativeServerRPCWire.request(
                        request,
                        rewritingActorSessionID: bearer.authSessionID
                    )
                    let frame = try NativeWebSocketRPCWire.requestFrame(id: rpcID, request: authenticatedRequest)
                    try await socket.sendText(frame)

                    while true {
                        let decoded = try NativeWebSocketRPCWire.decode(text: try await socket.receiveText())
                        switch decoded {
                        case .response(let id, let payload) where id == rpcID:
                            await socket.close()
                            return ResponseEnvelope(
                                method: request.method,
                                payload: payload,
                                generation: session.reconnectGeneration
                            )
                        case .failure(let id, let error) where id == rpcID:
                            await socket.close()
                            throw error
                        case .defect(let error):
                            await socket.close()
                            throw error
                        default:
                            continue
                        }
                    }
                } catch {
                    await socket.close()
                    throw error
                }
            }
        }

        public func streamAuthenticatedRPC(
            httpBaseURL: URL,
            webSocketURL: URL,
            bootstrapCredential: String,
            session: Session,
            requestID: RequestID,
            request: RequestEnvelope
        ) async -> AsyncThrowingStream<Data, Error> {
            _ = session
            _ = requestID
            return AsyncThrowingStream { continuation in
                let task = Task {
                    do {
                        let (bearer, socket) = try await self.openSocket(
                            httpBaseURL: httpBaseURL,
                            webSocketURL: webSocketURL,
                            bootstrapCredential: bootstrapCredential
                        )
                        do {
                            let rpcID = await self.requestIDs.next()
                            let authenticatedRequest = NativeServerRPCWire.request(
                                request,
                                rewritingActorSessionID: bearer.authSessionID
                            )
                            let frame = try NativeWebSocketRPCWire.requestFrame(id: rpcID, request: authenticatedRequest)
                            try await socket.sendText(frame)

                            while !Task.isCancelled {
                                let decoded = try NativeWebSocketRPCWire.decode(text: try await socket.receiveText())
                                switch decoded {
                                case .chunk(let id, let payloads) where id == rpcID:
                                    for payload in payloads {
                                        continuation.yield(Data(payload.utf8))
                                    }
                                case .response(let id, _) where id == rpcID:
                                    await socket.close()
                                    continuation.finish()
                                    return
                                case .failure(let id, let error) where id == rpcID:
                                    await socket.close()
                                    continuation.finish(throwing: error)
                                    return
                                case .defect(let error):
                                    await socket.close()
                                    continuation.finish(throwing: error)
                                    return
                                default:
                                    continue
                                }
                            }
                            await socket.close()
                            continuation.finish(throwing: ServerConnectionError.transportDisposed)
                        } catch {
                            await socket.close()
                            continuation.finish(throwing: error)
                        }
                    } catch {
                        continuation.finish(throwing: error)
                    }
                }
                continuation.onTermination = { _ in task.cancel() }
            }
        }

        private func openSocket(
            httpBaseURL: URL,
            webSocketURL: URL,
            bootstrapCredential: String
        ) async throws -> (NativeBearerSession, any NativeWebSocketRPCSessioning) {
            let bearer = try await reusableBearerSession(
                httpBaseURL: httpBaseURL,
                bootstrapCredential: bootstrapCredential
            )
            let webSocketToken = try await authenticator.issueWebSocketToken(
                httpBaseURL: httpBaseURL,
                bearerToken: bearer.token
            )
            let socket = try await connector.connect(
                webSocketURL: webSocketURL,
                webSocketToken: webSocketToken
            )
            return (bearer, socket)
        }

        private func reusableBearerSession(httpBaseURL: URL, bootstrapCredential: String) async throws -> NativeBearerSession {
            let httpBaseURLString = httpBaseURL.absoluteString
            if let cachedBearerSession,
               cachedBearerSession.httpBaseURL == httpBaseURLString,
               cachedBearerSession.bootstrapCredential == bootstrapCredential
            {
                return cachedBearerSession.bearerSession
            }

            if let pendingBearerSession,
               pendingBearerSession.httpBaseURL == httpBaseURLString,
               pendingBearerSession.bootstrapCredential == bootstrapCredential
            {
                return try await pendingBearerSession.task.value
            }

            let authenticator = authenticator
            let task = Task {
                try await authenticator.exchangeBearerSession(httpBaseURL: httpBaseURL, credential: bootstrapCredential)
            }
            pendingBearerSession = (
                httpBaseURL: httpBaseURLString,
                bootstrapCredential: bootstrapCredential,
                task: task
            )

            let bearerSession: NativeBearerSession
            do {
                bearerSession = try await task.value
            } catch {
                if pendingBearerSession?.httpBaseURL == httpBaseURLString,
                   pendingBearerSession?.bootstrapCredential == bootstrapCredential
                {
                    pendingBearerSession = nil
                }
                throw error
            }

            cachedBearerSession = CachedBearerSession(
                httpBaseURL: httpBaseURLString,
                bootstrapCredential: bootstrapCredential,
                bearerSession: bearerSession
            )
            if pendingBearerSession?.httpBaseURL == httpBaseURLString,
               pendingBearerSession?.bootstrapCredential == bootstrapCredential
            {
                pendingBearerSession = nil
            }
            return bearerSession
        }

        private func withRequestTimeout<T: Sendable>(
            milliseconds: Int,
            operation: @escaping @Sendable () async throws -> T
        ) async throws -> T {
            try await withThrowingTaskGroup(of: T.self) { group in
                group.addTask {
                    try await operation()
                }
                group.addTask {
                    let delay = UInt64(max(milliseconds, 1)) * 1_000_000
                    try await Task.sleep(nanoseconds: delay)
                    throw ServerConnectionError.requestTimedOut
                }

                guard let result = try await group.next() else {
                    group.cancelAll()
                    throw ServerConnectionError.requestRejected
                }
                group.cancelAll()
                return result
            }
        }
    }

    actor NativeURLSessionWebSocketRPCAuthenticator: NativeWebSocketRPCAuthenticating {
        private struct BearerBootstrapResponse: Decodable {
            let sessionToken: String
        }

        private struct WebSocketTokenResponse: Decodable {
            let token: String
        }

        private let urlSession: URLSession

        public init(urlSession: URLSession = .shared) {
            self.urlSession = urlSession
        }

        public func exchangeBearerSession(httpBaseURL: URL, credential: String) async throws -> NativeBearerSession {
            var request = URLRequest(url: httpBaseURL.appendingPathComponent("api/auth/bootstrap/bearer"))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["credential": credential], options: [])
            let response = try await decodeJSONResponse(BearerBootstrapResponse.self, request: request, authFailure: .authRejected)
            return NativeBearerSession(
                token: response.sessionToken,
                authSessionID: NativeServerRPCWire.authSessionID(fromBearerToken: response.sessionToken)
            )
        }

        public func issueWebSocketToken(httpBaseURL: URL, bearerToken: String) async throws -> NativeWebSocketToken {
            var request = URLRequest(url: httpBaseURL.appendingPathComponent("api/auth/ws-token"))
            request.httpMethod = "POST"
            request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "authorization")
            let response = try await decodeJSONResponse(WebSocketTokenResponse.self, request: request, authFailure: .authRejected)
            return NativeWebSocketToken(token: response.token)
        }

        private func decodeJSONResponse<T: Decodable>(
            _ type: T.Type,
            request: URLRequest,
            authFailure: ServerConnectionError
        ) async throws -> T {
            let (data, response) = try await urlSession.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw ServerConnectionError.transportUnavailable
            }
            guard (200..<300).contains(httpResponse.statusCode) else {
                let body = String(decoding: data.prefix(1000), as: UTF8.self)
                NSLog("Fenrir Native websocket auth request failed: status=\(httpResponse.statusCode) url=\(request.url?.absoluteString ?? "") body=\(body)")
                if httpResponse.statusCode == 401 || httpResponse.statusCode == 403 {
                    throw authFailure
                }
                throw ServerConnectionError.requestRejected
            }
            return try JSONDecoder().decode(type, from: data)
        }
    }

    struct NativeURLSessionWebSocketRPCConnector: NativeWebSocketRPCConnecting {
        private let urlSession: URLSession

        public init(urlSession: URLSession = .shared) {
            self.urlSession = urlSession
        }

        public func connect(webSocketURL: URL, webSocketToken: NativeWebSocketToken) async throws -> any NativeWebSocketRPCSessioning {
            guard var components = URLComponents(url: webSocketURL, resolvingAgainstBaseURL: false) else {
                throw ServerConnectionError.endpointUnavailable
            }
            var queryItems = components.queryItems ?? []
            queryItems.removeAll { $0.name == "wsToken" }
            queryItems.append(URLQueryItem(name: "wsToken", value: webSocketToken.token))
            components.queryItems = queryItems
            guard let authenticatedURL = components.url else {
                throw ServerConnectionError.endpointUnavailable
            }

            let task = urlSession.webSocketTask(with: authenticatedURL)
            task.resume()
            return NativeURLSessionWebSocketRPCSession(task: task)
        }
    }

    actor NativeURLSessionWebSocketRPCSession: NativeWebSocketRPCSessioning {
        private let task: URLSessionWebSocketTask

        public init(task: URLSessionWebSocketTask) {
            self.task = task
        }

        public func sendText(_ text: String) async throws {
            try await task.send(.string(text))
        }

        public func receiveText() async throws -> String {
            let message = try await task.receive()
            switch message {
            case .string(let text):
                return text
            case .data(let data):
                guard let text = String(data: data, encoding: .utf8) else {
                    throw ServerConnectionError.protocolMismatch
                }
                return text
            @unknown default:
                throw ServerConnectionError.protocolMismatch
            }
        }

        public func close() async {
            task.cancel(with: .goingAway, reason: nil)
        }
    }
}
