# Keybinding

Owns native keybinding contracts, lookup ports, and future keybinding editing
surfaces. It coordinates shortcuts for shell, overlays, pane grid, and terminal
viewport without taking ownership of terminal bytes or tmux state.

Public API:

- keybinding contracts and typed action DTOs
- keybinding service ports
- `ImportTmuxKeymap` for converting effective tmux prefix bindings into
  Fenrir actions plus diagnostics
- `ResolveKeybinding` for deciding whether a key is handled by Fenrir or passed
  through to the shell

Dependencies consumed:

- `FenrirNativeShared`
- `Settings`

Events emitted:

- keybinding registration and future keymap mutation events

Testing:

- keep unit tests in `__tests__`
- test keybinding resolution with mocked settings ports
