# PaneGrid

Owns presentation of tmux pane split layout for the active workspace tab. It
creates/disposes viewport hosts and routes focus/resize intents, but never
subscribes to pane bytes directly.
