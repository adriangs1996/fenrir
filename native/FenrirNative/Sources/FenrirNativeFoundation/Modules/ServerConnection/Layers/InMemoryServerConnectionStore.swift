import Foundation
import FenrirNativeShared

public extension ServerConnection {
    actor InMemoryServerConnectionStore: ServerConnectionStore, LocalServerSupervisorStateStore {
        private var session: Session?
        private var activeRequests: Int
        private var streams: [StreamID: StreamHandle]
        private var stats: TransportStats
        private var supervisorState: LocalServerSupervisorState?

        public init(
            session: Session? = nil,
            activeRequests: Int = 0,
            streams: [StreamID: StreamHandle] = [:],
            stats: TransportStats = TransportStats(),
            supervisorState: LocalServerSupervisorState? = nil
        ) {
            self.session = session
            self.activeRequests = max(0, activeRequests)
            self.streams = streams
            self.stats = stats
            self.supervisorState = supervisorState
        }

        public func loadSession(sessionID: SessionID?) async throws -> Session? {
            guard let session else {
                return nil
            }
            guard let sessionID else {
                return session
            }
            return session.sessionID == sessionID ? session : nil
        }

        public func saveSession(_ session: Session) async throws {
            self.session = session
        }

        public func deleteSession(sessionID: SessionID) async throws {
            guard session?.sessionID == sessionID else {
                return
            }
            session = nil
            activeRequests = 0
            streams.removeAll()
            stats = TransportStats()
        }

        public func nextReconnectGeneration(sessionID: SessionID) async throws -> UInt64 {
            guard let session, session.sessionID == sessionID else {
                throw ServerConnectionError.sessionClosed
            }
            return session.reconnectGeneration + 1
        }

        public func activeRequestCount(sessionID: SessionID) async throws -> Int {
            guard session?.sessionID == sessionID else {
                throw ServerConnectionError.sessionClosed
            }
            return activeRequests
        }

        public func incrementActiveRequestCount(sessionID: SessionID) async throws {
            guard session?.sessionID == sessionID else {
                throw ServerConnectionError.sessionClosed
            }
            activeRequests += 1
        }

        public func decrementActiveRequestCount(sessionID: SessionID) async throws {
            guard session?.sessionID == sessionID else {
                throw ServerConnectionError.sessionClosed
            }
            activeRequests = max(0, activeRequests - 1)
        }

        public func loadStreams(sessionID: SessionID) async throws -> [StreamHandle] {
            guard session?.sessionID == sessionID else {
                throw ServerConnectionError.sessionClosed
            }
            return streams.values.sorted { $0.streamID.rawValue < $1.streamID.rawValue }
        }

        public func saveStream(_ stream: StreamHandle, sessionID: SessionID) async throws {
            guard session?.sessionID == sessionID else {
                throw ServerConnectionError.sessionClosed
            }
            streams[stream.streamID] = stream
        }

        public func deleteStream(streamID: StreamID, sessionID: SessionID) async throws {
            guard session?.sessionID == sessionID else {
                throw ServerConnectionError.sessionClosed
            }
            streams.removeValue(forKey: streamID)
        }

        public func transportStats(sessionID: SessionID) async throws -> TransportStats {
            guard session?.sessionID == sessionID else {
                throw ServerConnectionError.sessionClosed
            }
            return stats
        }

        public func saveTransportStats(_ stats: TransportStats, sessionID: SessionID) async throws {
            guard session?.sessionID == sessionID else {
                throw ServerConnectionError.sessionClosed
            }
            self.stats = stats
        }

        public func commitReconnect(_ commit: ReconnectCommit) async throws {
            guard session?.sessionID == commit.session.sessionID else {
                throw ServerConnectionError.sessionClosed
            }
            session = commit.session
            stats = commit.transportStats
            for stream in commit.streams {
                streams[stream.streamID] = stream
            }
        }

        public func loadLocalServerSupervisorState() async throws -> LocalServerSupervisorState? {
            supervisorState
        }

        public func saveLocalServerSupervisorState(_ state: LocalServerSupervisorState) async throws {
            supervisorState = state
        }

        public func clearLocalServerSupervisorState() async throws {
            supervisorState = nil
        }
    }
}
