# WorkspaceShell

Owns one workspace window's shell presentation: sidebar, tab strip, switcher,
active pane-grid host, and shell focus state. AppKit may live in Views/Layers,
but public DTOs do not expose raw window or view objects.

Visual contract: `docs/native-terminal-ui-shell.html` (D-041). Operations-deck
chrome; quiet tmux tabs as bare titlebar text with an accent underline and a
per-tab presence dot; collapsible sidebar; pane headers with process, pane id,
integration status, and presence chip; status bar with stream health. All
colors come from the shared theme-token contract (same registry ids as Fenrir
Desktop) — no hardcoded colors in shell surfaces.
