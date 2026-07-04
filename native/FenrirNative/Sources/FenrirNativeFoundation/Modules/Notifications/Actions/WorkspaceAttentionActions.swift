import Foundation
import FenrirNativeShared

public extension Notifications {
    /// Routes one D-043 notification event into the workspace attention feed
    /// and, when the app is NOT active, to the macOS banner port (D-045).
    ///
    /// The store owns coalescing (identical title+body+pane within the policy
    /// window collapse into one record) and bounded retention. Malformed
    /// payloads — empty after D-043 sanitization — fail with
    /// `.malformedNotificationPayload` so callers can keep a diagnostics count.
    ///
    /// `input.isAppActive` is supplied by the caller (typically
    /// `NSApplication.shared.isActive`) so this module stays AppKit-free.
    struct IngestWorkspaceNotification: FenrirAction {
        public typealias Failure = NotificationsError

        public let clock: any NotificationsClock
        public let store: any WorkspaceNotificationStoring
        public let bannerPresenter: any NotificationBannerPresenting

        public init(
            clock: any NotificationsClock,
            store: any WorkspaceNotificationStoring,
            bannerPresenter: any NotificationBannerPresenting
        ) {
            self.clock = clock
            self.store = store
            self.bannerPresenter = bannerPresenter
        }

        public func run(
            _ input: IngestWorkspaceNotificationInput
        ) async -> Result<IngestWorkspaceNotificationResult, NotificationsError> {
            let draft = WorkspaceNotificationDraft(
                workspaceID: input.workspaceID,
                paneID: input.paneID,
                title: input.title,
                body: input.body,
                source: input.notificationSource
            )

            guard let outcome = await store.append(draft) else {
                return .failure(.malformedNotificationPayload)
            }

            let unreadCount = await store.unreadCount(workspaceID: input.workspaceID)
            let bannerPresented = await Notifications.presentBannerIfNeeded(
                for: outcome.notification,
                isAppActive: input.isAppActive,
                using: bannerPresenter
            )

            return .success(IngestWorkspaceNotificationResult(
                requestID: input.requestID,
                notification: outcome.notification,
                coalesced: outcome.coalesced,
                unreadCount: unreadCount,
                bannerPresented: bannerPresented,
                timestamp: clock.now()
            ))
        }
    }
}
