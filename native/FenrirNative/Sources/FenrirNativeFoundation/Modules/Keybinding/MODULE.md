# Keybinding

Owns native keybinding contracts, lookup ports, and future keybinding editing
surfaces. It coordinates shortcuts for shell, overlays, pane grid, and terminal
viewport without taking ownership of terminal bytes or tmux state.

Public API:

- keybinding contracts and typed action DTOs
- keybinding service ports
- `ImportTmuxKeymap` for converting runtime-supplied effective tmux keymap
  records from root, prefix, prefix2, and relevant custom tables into Fenrir
  actions plus diagnostics
- `ResolveKeybinding` for deciding whether a native or terminal key is handled
  by Fenrir, enters a tmux key-table state, reports an unsupported prefix-table
  key, or passes through to the shell

Dependencies consumed:

- `FenrirNativeShared`
- `Settings`

Events emitted:

- keybinding registration and future keymap mutation events

Testing:

- keep unit tests in `__tests__`
- test keybinding resolution with mocked settings ports
- do not parse `.tmux.conf` in this module; live adapters must supply effective
  keymap records from the runtime/server boundary
- unsupported tmux commands are diagnostics only and must never be routed as raw
  tmux command strings
