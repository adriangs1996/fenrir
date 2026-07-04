# Notifications

Owns native notification and attention-state contracts. It projects alerts to
workspace shell, overlays, and auxiliary surfaces without reaching into pane
streams or renderer internals.

Public API:

- notification contracts and typed action DTOs
- notification service ports
- workspace attention feed (D-043/D-045): `WorkspaceNotification` records with
  coalescing and bounded retention behind `WorkspaceNotificationStoring`,
  pure jump-target resolution for jump-to-latest-unread, and the
  `NotificationBannerPresenting` macOS banner port (callers pass
  `isAppActive`; this module never imports AppKit)
- agent approval feed (D-042): `ApprovalFeedCard`/`ApprovalFeedStreamEvent`
  contracts mirroring the server relay, the bounded pending-card store
  behind `ApprovalFeedStoring`, pure banner-action identifier mapping in
  `ApprovalBannerAction`, and the actionable `ApprovalBannerPresenting`
  macOS banner port (per-request categories whose buttons decide directly).
  Cards carry only the structured hook payload — never terminal content —
  and settlement always comes from the server stream

Dependencies consumed:

- `FenrirNativeShared`
- `Settings`

Events emitted:

- notification registration and future attention-state events

Testing:

- keep unit tests in `__tests__`
- mock delivery services at the action boundary
