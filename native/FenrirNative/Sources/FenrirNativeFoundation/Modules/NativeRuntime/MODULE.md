# NativeRuntime

Owns Swift runtime contracts for tmux-backed workspaces and panes through the
Fenrir server: capability discovery, attach/detach/reconnect, pane stream
cursor state, write acknowledgements, resize requests, and runtime error tags.

It does not render terminal bytes, own AppKit views, or store auth secrets.
