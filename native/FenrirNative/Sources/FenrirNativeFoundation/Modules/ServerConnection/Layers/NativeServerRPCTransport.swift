import Foundation
import FenrirNativeShared
import AuthSession

public extension ServerConnection {
    protocol NativeServerRPCTransporting: Sendable {
        func sendAuthenticatedRPC(
            httpBaseURL: URL,
            webSocketURL: URL,
            bootstrapCredential: String,
            session: Session,
            requestID: RequestID,
            request: RequestEnvelope
        ) async throws -> ResponseEnvelope

        func streamAuthenticatedRPC(
            httpBaseURL: URL,
            webSocketURL: URL,
            bootstrapCredential: String,
            session: Session,
            requestID: RequestID,
            request: RequestEnvelope
        ) async -> AsyncThrowingStream<Data, Error>
    }

    protocol NativeServerRPCNetworking: Sendable {
        func exchangeBearerSession(httpBaseURL: URL, credential: String) async throws -> NativeBearerSession
        func sendUnaryNativeRPC(
            httpBaseURL: URL,
            bearerToken: String,
            requestID: RequestID,
            request: RequestEnvelope
        ) async throws -> String
        func streamNativeRPC(
            httpBaseURL: URL,
            bearerToken: String,
            requestID: RequestID,
            request: RequestEnvelope
        ) async -> AsyncThrowingStream<Data, Error>
    }

    struct NativeServerRequestSender: ServerRequestSending {
        public typealias TransportFailureHandler = @Sendable (
            Session,
            RequestID,
            RequestEnvelope,
            Error
        ) async -> Void

        private let transport: any NativeServerRPCTransporting
        private let bootstrapCredential: String?
        private let onTransportFailure: TransportFailureHandler?

        public init(
            transport: any NativeServerRPCTransporting,
            bootstrapCredential: String?,
            onTransportFailure: TransportFailureHandler? = nil
        ) {
            self.transport = transport
            self.bootstrapCredential = bootstrapCredential
            self.onTransportFailure = onTransportFailure
        }

        public func sendServerRequest(
            session: Session,
            requestID: RequestID,
            request: RequestEnvelope
        ) async throws -> ResponseEnvelope {
            guard let httpBaseURL = session.endpoint.httpBaseURL.flatMap(URL.init(string:)) else {
                throw ServerConnectionError.endpointUnavailable
            }
            guard case .webSocketURL(let rawWebSocketURL) = session.endpoint.transport,
                  let webSocketURL = URL(string: rawWebSocketURL)
            else {
                throw ServerConnectionError.endpointUnsupported
            }
            guard let bootstrapCredential, !bootstrapCredential.isEmpty else {
                throw ServerConnectionError.bootstrapRequired
            }

            do {
                return try await transport.sendAuthenticatedRPC(
                    httpBaseURL: httpBaseURL,
                    webSocketURL: webSocketURL,
                    bootstrapCredential: bootstrapCredential,
                    session: session,
                    requestID: requestID,
                    request: request
                )
            } catch {
                await onTransportFailure?(session, requestID, request, error)
                throw error
            }
        }
    }

    actor NativeURLSessionServerRPCTransport: NativeServerRPCTransporting {
        private struct CachedBearerSession: Sendable {
            let httpBaseURL: String
            let bootstrapCredential: String
            let bearerSession: NativeBearerSession
        }

        private let network: any NativeServerRPCNetworking
        private var cachedBearerSession: CachedBearerSession?
        private var pendingBearerSession: (httpBaseURL: String, bootstrapCredential: String, task: Task<NativeBearerSession, Error>)?

        public init(network: any NativeServerRPCNetworking = NativeURLSessionServerRPCNetwork()) {
            self.network = network
        }

        public func sendAuthenticatedRPC(
            httpBaseURL: URL,
            webSocketURL: URL,
            bootstrapCredential: String,
            session: Session,
            requestID: RequestID,
            request: RequestEnvelope
        ) async throws -> ResponseEnvelope {
            let bearer = try await reusableBearerSession(
                httpBaseURL: httpBaseURL,
                bootstrapCredential: bootstrapCredential
            )
            _ = webSocketURL
            let authenticatedRequest = NativeServerRPCWire.request(
                request,
                rewritingActorSessionID: bearer.authSessionID
            )
            let responsePayload = try await network.sendUnaryNativeRPC(
                httpBaseURL: httpBaseURL,
                bearerToken: bearer.token,
                requestID: requestID,
                request: authenticatedRequest
            )
            return ResponseEnvelope(
                method: request.method,
                payload: responsePayload,
                generation: session.reconnectGeneration
            )
        }

        public func streamAuthenticatedRPC(
            httpBaseURL: URL,
            webSocketURL: URL,
            bootstrapCredential: String,
            session: Session,
            requestID: RequestID,
            request: RequestEnvelope
        ) async -> AsyncThrowingStream<Data, Error> {
            AsyncThrowingStream { continuation in
                let task = Task {
                    do {
                        let bearer = try await reusableBearerSession(
                            httpBaseURL: httpBaseURL,
                            bootstrapCredential: bootstrapCredential
                        )
                        _ = webSocketURL
                        let authenticatedRequest = NativeServerRPCWire.request(
                            request,
                            rewritingActorSessionID: bearer.authSessionID
                        )
                        let responseStream = await network.streamNativeRPC(
                            httpBaseURL: httpBaseURL,
                            bearerToken: bearer.token,
                            requestID: requestID,
                            request: authenticatedRequest
                        )
                        for try await data in responseStream {
                            continuation.yield(data)
                        }
                        continuation.finish()
                    } catch {
                        continuation.finish(throwing: error)
                    }
                }
                continuation.onTermination = { _ in task.cancel() }
            }
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

            let network = network
            let task = Task {
                try await network.exchangeBearerSession(httpBaseURL: httpBaseURL, credential: bootstrapCredential)
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
    }

    struct NativeURLSessionServerRPCNetwork: NativeServerRPCNetworking {
        private struct BearerBootstrapResponse: Decodable {
            let sessionToken: String
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
                NSLog("Fenrir Native server HTTP request failed: status=\(httpResponse.statusCode) url=\(request.url?.absoluteString ?? "") body=\(body)")
                if httpResponse.statusCode == 401 || httpResponse.statusCode == 403 {
                    throw authFailure
                }
                throw ServerConnectionError.requestRejected
            }
            return try JSONDecoder().decode(type, from: data)
        }

        public func sendUnaryNativeRPC(
            httpBaseURL: URL,
            bearerToken: String,
            requestID: RequestID,
            request: RequestEnvelope
        ) async throws -> String {
            let requestPayload = try NativeServerRPCWire.httpRequestBody(
                requestID: requestID,
                request: request
            )
            var httpRequest = URLRequest(url: httpBaseURL.appendingPathComponent("api/native/rpc"))
            httpRequest.httpMethod = "POST"
            httpRequest.timeoutInterval = TimeInterval(max(request.timeoutMilliseconds, 1)) / 1000
            httpRequest.setValue("application/json", forHTTPHeaderField: "content-type")
            httpRequest.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "authorization")
            httpRequest.httpBody = requestPayload

            let (data, response) = try await urlSession.data(for: httpRequest)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw ServerConnectionError.transportUnavailable
            }
            guard (200..<300).contains(httpResponse.statusCode) else {
                let body = String(decoding: data.prefix(1000), as: UTF8.self)
                NSLog("Fenrir Native server RPC HTTP request failed: status=\(httpResponse.statusCode) url=\(httpRequest.url?.absoluteString ?? "") body=\(body)")
                if httpResponse.statusCode == 401 || httpResponse.statusCode == 403 {
                    throw ServerConnectionError.authRejected
                }
                throw ServerConnectionError.requestRejected
            }
            return try NativeServerRPCWire.parseUnaryHTTPResponse(data)
        }

        public func streamNativeRPC(
            httpBaseURL: URL,
            bearerToken: String,
            requestID: RequestID,
            request: RequestEnvelope
        ) async -> AsyncThrowingStream<Data, Error> {
            AsyncThrowingStream { continuation in
                let task = Task {
                    do {
                        let requestPayload = try NativeServerRPCWire.httpRequestBody(
                            requestID: requestID,
                            request: request
                        )
                        var httpRequest = URLRequest(url: httpBaseURL.appendingPathComponent("api/native/rpc/stream"))
                        httpRequest.httpMethod = "POST"
                        httpRequest.timeoutInterval = 0
                        httpRequest.setValue("application/json", forHTTPHeaderField: "content-type")
                        httpRequest.setValue("application/x-ndjson", forHTTPHeaderField: "accept")
                        httpRequest.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "authorization")
                        httpRequest.httpBody = requestPayload

                        let (bytes, response) = try await urlSession.bytes(for: httpRequest)
                        guard let httpResponse = response as? HTTPURLResponse else {
                            throw ServerConnectionError.transportUnavailable
                        }
                        guard (200..<300).contains(httpResponse.statusCode) else {
                            let body = String(decoding: try await bytes.reduce(into: Data()) { data, byte in
                                if data.count < 1000 {
                                    data.append(byte)
                                }
                            }, as: UTF8.self)
                            NSLog("Fenrir Native server RPC stream HTTP request failed: status=\(httpResponse.statusCode) url=\(httpRequest.url?.absoluteString ?? "") body=\(body)")
                            throw httpResponse.statusCode == 401 || httpResponse.statusCode == 403
                                ? ServerConnectionError.authRejected
                                : ServerConnectionError.requestRejected
                        }
                        for try await line in bytes.lines {
                            if Task.isCancelled {
                                NSLog("Fenrir Native server RPC stream cancelled while reading lines")
                                break
                            }
                            guard !line.isEmpty else {
                                continue
                            }
                            NSLog("Fenrir Native server RPC stream line bytes=\(line.utf8.count)")
                            continuation.yield(Data(line.utf8))
                        }
                        NSLog("Fenrir Native server RPC stream finished reading lines")
                        continuation.finish()
                    } catch {
                        NSLog("Fenrir Native server RPC stream failed: \(String(describing: error))")
                        continuation.finish(throwing: error)
                    }
                }
                continuation.onTermination = { _ in task.cancel() }
            }
        }
    }
}
