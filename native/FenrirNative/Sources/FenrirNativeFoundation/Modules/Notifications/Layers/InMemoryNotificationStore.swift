import Foundation
import FenrirNativeShared

extension Notifications {
    actor InMemoryNotificationStore: NotificationStore {
        private var notifications: [NotificationRecord]

        init(initialNotifications: [NotificationRecord] = []) {
            self.notifications = initialNotifications
        }

        func loadNotifications() async throws -> [NotificationRecord] {
            notifications
        }

        func saveNotifications(_ notifications: [NotificationRecord]) async throws {
            self.notifications = notifications
        }

        func mutateNotifications<Output: Sendable>(
            _ mutation: @Sendable ([NotificationRecord]) throws -> (notifications: [NotificationRecord], output: Output)
        ) async throws -> Output {
            let result = try mutation(notifications)
            notifications = result.notifications
            return result.output
        }
    }
}
