import Foundation
import FenrirNativeShared

public extension Notifications {
    struct DescribeNotificationsModule: FenrirAction {
        public typealias Failure = NotificationsError

        public let clock: any NotificationsClock

        public init(clock: any NotificationsClock) {
            self.clock = clock
        }

        public func run(_ input: DescribeNotificationsModuleInput) async -> Result<DescribeNotificationsModuleResult, NotificationsError> {
            let timestamp = clock.now()
            return .success(DescribeNotificationsModuleResult(
                requestID: input.requestID,
                summary: ModuleSummary(registeredAt: timestamp),
                timestamp: timestamp
            ))
        }
    }

    struct CreateNotification: FenrirAction {
        public typealias Failure = NotificationsError

        public let clock: any NotificationsClock
        public let store: any NotificationStore

        public init(clock: any NotificationsClock, store: any NotificationStore) {
            self.clock = clock
            self.store = store
        }

        public func run(_ input: CreateNotificationInput) async -> Result<CreateNotificationResult, NotificationsError> {
            let timestamp = clock.now()

            do {
                let result: CreateNotificationResult = try await store.mutateNotifications { notifications in
                    var notifications = notifications
                    if let existingIndex = notifications.firstIndex(where: {
                        $0.workspaceID == input.workspaceID &&
                            $0.dedupeKey == input.dedupeKey &&
                            $0.lifecycle == .active
                    }) {
                        let existing = notifications[existingIndex]
                        let notification = NotificationRecord(
                            id: existing.id,
                            workspaceID: existing.workspaceID,
                            source: input.source,
                            severity: input.severity,
                            title: input.title,
                            message: input.message,
                            dedupeKey: existing.dedupeKey,
                            lifecycle: .active,
                            createdAt: existing.createdAt,
                            updatedAt: timestamp,
                            expiresAt: Notifications.expirationDate(now: timestamp, ttlSeconds: input.ttlSeconds)
                        )
                        notifications[existingIndex] = notification
                        return (
                            notifications,
                            CreateNotificationResult(
                                requestID: input.requestID,
                                notification: notification,
                                deduped: true,
                                timestamp: timestamp
                            )
                        )
                    }

                    let notification = NotificationRecord(
                        id: .generated(),
                        workspaceID: input.workspaceID,
                        source: input.source,
                        severity: input.severity,
                        title: input.title,
                        message: input.message,
                        dedupeKey: input.dedupeKey,
                        createdAt: timestamp,
                        updatedAt: timestamp,
                        expiresAt: Notifications.expirationDate(now: timestamp, ttlSeconds: input.ttlSeconds)
                    )
                    notifications.append(notification)
                    return (
                        notifications,
                        CreateNotificationResult(
                            requestID: input.requestID,
                            notification: notification,
                            deduped: false,
                            timestamp: timestamp
                        )
                    )
                }
                return .success(result)
            } catch let error as NotificationsError {
                return .failure(error)
            } catch {
                return .failure(.storeFailure(String(describing: error)))
            }
        }
    }

    struct AcknowledgeNotification: FenrirAction {
        public typealias Failure = NotificationsError

        public let clock: any NotificationsClock
        public let store: any NotificationStore

        public init(clock: any NotificationsClock, store: any NotificationStore) {
            self.clock = clock
            self.store = store
        }

        public func run(_ input: AcknowledgeNotificationInput) async -> Result<AcknowledgeNotificationResult, NotificationsError> {
            let timestamp = clock.now()

            do {
                let result: AcknowledgeNotificationResult = try await store.mutateNotifications { notifications in
                    var notifications = notifications
                    guard let index = notifications.firstIndex(where: {
                        $0.id == input.notificationID && $0.workspaceID == input.workspaceID
                    }) else {
                        throw NotificationsError.notificationNotFound(input.notificationID)
                    }

                    let existing = notifications[index]
                    guard existing.lifecycle == .active else {
                        return (
                            notifications,
                            AcknowledgeNotificationResult(
                                requestID: input.requestID,
                                notification: existing,
                                changed: false,
                                timestamp: timestamp
                            )
                        )
                    }

                    let acknowledged = existing.withLifecycle(.acknowledged, updatedAt: timestamp)
                    notifications[index] = acknowledged
                    return (
                        notifications,
                        AcknowledgeNotificationResult(
                            requestID: input.requestID,
                            notification: acknowledged,
                            changed: true,
                            timestamp: timestamp
                        )
                    )
                }
                return .success(result)
            } catch let error as NotificationsError {
                return .failure(error)
            } catch {
                return .failure(.storeFailure(String(describing: error)))
            }
        }
    }

    struct ExpireNotifications: FenrirAction {
        public typealias Failure = NotificationsError

        public let clock: any NotificationsClock
        public let store: any NotificationStore

        public init(clock: any NotificationsClock, store: any NotificationStore) {
            self.clock = clock
            self.store = store
        }

        public func run(_ input: ExpireNotificationsInput) async -> Result<ExpireNotificationsResult, NotificationsError> {
            let timestamp = clock.now()

            do {
                let result: ExpireNotificationsResult = try await store.mutateNotifications { notifications in
                    var notifications = notifications
                    var expired: [NotificationRecord] = []

                    for index in notifications.indices {
                        let notification = notifications[index]
                        guard notification.lifecycle == .active,
                              input.workspaceID == nil || notification.workspaceID == input.workspaceID,
                              Notifications.isExpired(notification, now: timestamp)
                        else {
                            continue
                        }

                        let next = notification.withLifecycle(.expired, updatedAt: timestamp)
                        notifications[index] = next
                        expired.append(next)
                    }

                    return (
                        notifications,
                        ExpireNotificationsResult(
                            requestID: input.requestID,
                            expired: Notifications.sortedForAttention(expired),
                            timestamp: timestamp
                        )
                    )
                }
                return .success(result)
            } catch let error as NotificationsError {
                return .failure(error)
            } catch {
                return .failure(.storeFailure(String(describing: error)))
            }
        }
    }

    struct ListNotifications: FenrirAction {
        public typealias Failure = NotificationsError

        public let clock: any NotificationsClock
        public let store: any NotificationStore

        public init(clock: any NotificationsClock, store: any NotificationStore) {
            self.clock = clock
            self.store = store
        }

        public func run(_ input: ListNotificationsInput) async -> Result<ListNotificationsResult, NotificationsError> {
            let timestamp = clock.now()

            do {
                let notifications = try await store.loadNotifications()
                return .success(ListNotificationsResult(
                    requestID: input.requestID,
                    notifications: Notifications.visibleNotifications(
                        from: notifications,
                        workspaceID: input.workspaceID,
                        includeAcknowledged: input.includeAcknowledged,
                        includeExpired: input.includeExpired
                    ),
                    timestamp: timestamp
                ))
            } catch let error as NotificationsError {
                return .failure(error)
            } catch {
                return .failure(.storeFailure(String(describing: error)))
            }
        }
    }

    struct ProjectWorkspaceNotifications: FenrirAction {
        public typealias Failure = NotificationsError

        public let clock: any NotificationsClock
        public let store: any NotificationStore

        public init(clock: any NotificationsClock, store: any NotificationStore) {
            self.clock = clock
            self.store = store
        }

        public func run(_ input: ProjectWorkspaceNotificationsInput) async -> Result<ProjectWorkspaceNotificationsResult, NotificationsError> {
            let timestamp = clock.now()

            do {
                let notifications = try await store.loadNotifications()
                return .success(ProjectWorkspaceNotificationsResult(
                    requestID: input.requestID,
                    projection: Notifications.activeProjection(from: notifications, workspaceID: input.workspaceID),
                    timestamp: timestamp
                ))
            } catch let error as NotificationsError {
                return .failure(error)
            } catch {
                return .failure(.storeFailure(String(describing: error)))
            }
        }
    }
}

extension Notifications {
    static func expirationDate(now: FenrirTimestamp, ttlSeconds: TimeInterval?) -> FenrirTimestamp? {
        guard let ttlSeconds else {
            return nil
        }

        return FenrirTimestamp(now.date.addingTimeInterval(ttlSeconds))
    }
}

extension Notifications.NotificationRecord {
    func withLifecycle(
        _ lifecycle: Notifications.NotificationLifecycle,
        updatedAt: FenrirTimestamp
    ) -> Notifications.NotificationRecord {
        Notifications.NotificationRecord(
            id: id,
            workspaceID: workspaceID,
            source: source,
            severity: severity,
            title: title,
            message: message,
            dedupeKey: dedupeKey,
            lifecycle: lifecycle,
            createdAt: createdAt,
            updatedAt: updatedAt,
            expiresAt: expiresAt
        )
    }
}
