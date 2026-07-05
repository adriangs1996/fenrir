# NativeRuntime

Owns Swift runtime contracts for tmux-backed workspaces and panes through the
Fenrir server: capability discovery, attach/detach/reconnect, pane stream
cursor state, write acknowledgements, resize requests, window control
(create/rename/focus/close), pane zoom toggling (D-028 keymap actions), and
runtime error tags.

`ServerTmuxRuntimeAdapter.subscribeWorkspaceEvents` exposes the workspace
kernel event feed (`tmux.workspace.subscribe`) as coarse
`WorkspaceRuntimeEventKind` ticks. Hosts re-enumerate the workspace snapshot on
each `.layoutOrFocusChanged` tick, so focus/layout changes that originate
inside tmux (vim-tmux-navigator `select-pane`, splits from a shell, other
clients) reach the native grid live.

It does not render terminal bytes, own AppKit views, or store auth secrets.
