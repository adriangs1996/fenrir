# TerminalViewport

Owns one native terminal viewport bound to one tmux pane. Renderer, clipboard,
runtime writing, and sizing are swappable ports. Public DTOs never expose raw
libGhostty, AppKit objects, server streams, auth secrets, or scrollback.
