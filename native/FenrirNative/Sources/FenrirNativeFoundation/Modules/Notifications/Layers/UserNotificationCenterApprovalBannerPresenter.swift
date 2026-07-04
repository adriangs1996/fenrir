import Foundation
import UserNotifications
import FenrirNativeShared

public extension Notifications {
    /// Live actionable-banner layer for approval cards (D-042) over
    /// `UNUserNotificationCenter`.
    ///
    /// Each presented card registers a per-request category whose actions
    /// are the card's options, so banner buttons decide directly. Like the
    /// D-043 banner presenter, presentation degrades to a debug log outside
    /// a real app bundle (bare `swift run` / `swift test` cannot reach the
    /// user notification center).
    struct UserNotificationCenterApprovalBannerPresenter: ApprovalBannerPresenting {
        public init() {}

        public func presentApprovalBanner(card: ApprovalFeedCard) async {
            guard Bundle.main.bundleIdentifier != nil, Bundle.main.bundleURL.pathExtension == "app" else {
                NSLog(
                    "Fenrir Native approval banner suppressed (no bundle identifier) workspace=%@ request=%@",
                    card.workspaceID.rawValue,
                    card.requestID
                )
                return
            }

            let center = UNUserNotificationCenter.current()
            let granted = (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
            guard granted else {
                return
            }

            // Register (or refresh) a per-request category carrying the
            // card's options as banner action buttons.
            let categoryIdentifier = "\(ApprovalBannerAction.categoryIdentifier).\(card.requestID)"
            let actions = card.options.prefix(4).map { option in
                UNNotificationAction(
                    identifier: ApprovalBannerAction.actionIdentifier(optionID: option.id),
                    title: option.label,
                    options: []
                )
            }
            let category = UNNotificationCategory(
                identifier: categoryIdentifier,
                actions: Array(actions),
                intentIdentifiers: [],
                options: []
            )
            let existing = await center.notificationCategories()
            center.setNotificationCategories(existing.union([category]))

            let content = UNMutableNotificationContent()
            content.title = "\(card.kind.displayName) · \(card.agentID)"
            content.body = card.summary
            content.categoryIdentifier = categoryIdentifier
            content.userInfo = [
                ApprovalBannerAction.requestIDUserInfoKey: card.requestID,
                "workspaceID": card.workspaceID.rawValue
            ]
            let request = UNNotificationRequest(
                identifier: Self.notificationIdentifier(requestID: card.requestID),
                content: content,
                trigger: nil
            )
            try? await center.add(request)
        }

        public func withdrawApprovalBanner(requestID: String) async {
            guard Bundle.main.bundleIdentifier != nil, Bundle.main.bundleURL.pathExtension == "app" else {
                return
            }
            let center = UNUserNotificationCenter.current()
            let identifier = Self.notificationIdentifier(requestID: requestID)
            center.removeDeliveredNotifications(withIdentifiers: [identifier])
            center.removePendingNotificationRequests(withIdentifiers: [identifier])
        }

        static func notificationIdentifier(requestID: String) -> String {
            "fenrir-approval-\(requestID)"
        }
    }
}
