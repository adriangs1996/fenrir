# WorkspaceShell

Owns one workspace window's shell presentation: sidebar, tab strip, switcher,
active pane-grid host, and shell focus state. AppKit may live in Views/Layers,
but public DTOs do not expose raw window or view objects.
