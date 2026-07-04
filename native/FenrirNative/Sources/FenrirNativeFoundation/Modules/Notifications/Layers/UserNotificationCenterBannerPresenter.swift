import Foundation
import UserNotifications
import FenrirNativeShared

extension Notifications {
    /// Live macOS banner layer over `UNUserNotificationCenter` (D-043/D-045).
    ///
    /// The caller decides *whether* a banner should show (banners only present
    /// while the app is inactive, per `Notifications.shouldPresentBanner`);
    /// this layer only performs the presentation. Processes without a bundle
    /// identifier (bare `swift run`, `swift test`) cannot talk to the user
    /// notification center, so presentation degrades to a debug log instead of
    /// crashing.
    struct UserNotificationCenterBannerPresenter: NotificationBannerPresenting {
        init() {}

        func present(title: String?, body: String, workspaceID: WorkspaceID, paneID: PaneID?) async {
            // UNUserNotificationCenter requires a real app bundle; bare
            // executables and test runners crash in `current()`.
            guard Bundle.main.bundleIdentifier != nil, Bundle.main.bundleURL.pathExtension == "app" else {
                NSLog(
                    "Fenrir Native banner suppressed (no bundle identifier) workspace=%@ pane=%@",
                    workspaceID.rawValue,
                    paneID?.rawValue ?? "-"
                )
                return
            }

            let center = UNUserNotificationCenter.current()
            let granted = (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
            guard granted else {
                return
            }

            let content = UNMutableNotificationContent()
            content.title = title ?? "Fenrir"
            content.body = body
            content.userInfo = [
                "workspaceID": workspaceID.rawValue,
                "paneID": paneID?.rawValue ?? ""
            ]
            let request = UNNotificationRequest(
                identifier: "fenrir-workspace-notification-\(UUID().uuidString)",
                content: content,
                trigger: nil
            )
            try? await center.add(request)
        }
    }
}
