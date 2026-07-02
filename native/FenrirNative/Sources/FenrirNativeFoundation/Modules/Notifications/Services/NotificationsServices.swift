import Foundation
import FenrirNativeShared

public extension Notifications {
    protocol NotificationsClock: Sendable {
        func now() -> FenrirTimestamp
    }

    protocol NotificationStore: Sendable {
        func loadNotifications() async throws -> [NotificationRecord]
        func saveNotifications(_ notifications: [NotificationRecord]) async throws
        func mutateNotifications<Output: Sendable>(
            _ mutation: @Sendable ([NotificationRecord]) throws -> (notifications: [NotificationRecord], output: Output)
        ) async throws -> Output
    }

    static func inMemoryNotificationStore(initialNotifications: [NotificationRecord] = []) -> any NotificationStore {
        InMemoryNotificationStore(initialNotifications: initialNotifications)
    }
}
