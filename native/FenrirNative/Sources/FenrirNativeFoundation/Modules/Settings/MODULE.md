# Settings

Owns native-client settings contracts, validation/defaulting, and local
persistence service ports. Settings are consumed by workspace indexing,
keybindings, notifications, server connection defaults, and auxiliary SwiftUI
surfaces without exposing storage implementation details.

Public API:

- `ReadSettings`
- `ValidateSettings`
- `UpdateSettings`
- `ObserveSettings`
- local configuration contracts for app mode, server connection defaults,
  workspace UI preferences, appearance/theme preferences, keybinding import
  preferences, and diagnostics policy
- `LocalSettingsPersistence` port for local settings data only

Secrets:

- Settings may store remote profile metadata such as profile ID, display name,
  and endpoint URL.
- Bearer tokens, pairing secrets, API keys, and actor/session credentials
  belong to `AuthSession` and Keychain-backed services, not Settings.

Dependencies consumed:

- `FenrirNativeShared`
- local persistence adapters only

Events emitted:

- settings registration
- settings changed
- settings observation failed

Testing:

- keep unit tests in `__tests__`
- mock services at the action boundary
- cover malformed local config, migration/defaults, validation, and persistence
  failures
