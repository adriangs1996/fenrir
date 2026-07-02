# Notifications

Owns native notification and attention-state contracts. It projects alerts to
workspace shell, overlays, and auxiliary surfaces without reaching into pane
streams or renderer internals.

Public API:

- notification contracts and typed action DTOs
- notification service ports

Dependencies consumed:

- `FenrirNativeShared`
- `Settings`

Events emitted:

- notification registration and future attention-state events

Testing:

- keep unit tests in `__tests__`
- mock delivery services at the action boundary
