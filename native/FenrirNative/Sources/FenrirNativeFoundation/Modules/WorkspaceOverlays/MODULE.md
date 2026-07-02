# WorkspaceOverlays

Owns workspace-scoped native overlay surfaces such as agent composer,
conversation detail, diagnostics, help, and keybinding help. Overlays are not
tmux panes and must never appear as fake panes in the pane grid.

Public API:

- overlay contracts and typed action DTOs
- overlay service ports
- command palette query, result, action, and provider contracts
- `SearchCommandPalette` and `ExecutePaletteSelection` actions
- workspace switcher and static palette provider factories

Dependencies consumed:

- `FenrirNativeShared`
- `Keybinding`
- `Notifications`

Events emitted:

- overlay registration and future overlay focus lifecycle events

Testing:

- keep unit tests in `__tests__`
- test focus-return and pinning logic with mocked shell ports
- test palette providers, prefix routing, ranking, and action execution without
  AppKit
