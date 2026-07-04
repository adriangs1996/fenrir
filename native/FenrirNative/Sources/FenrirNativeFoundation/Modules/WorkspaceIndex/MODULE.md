# WorkspaceIndex

Owns the native client's lightweight workspace catalog, recents/favorites,
open-state summaries, and list/query contracts. Summaries must not include pane
bytes, layouts, auth tokens, or renderer state.

Also owns the open-in-editor target catalogue (D-045): `EditorTargetCatalog`
lists editor/terminal/git-client/Finder/`$EDITOR` targets,
`EditorTargetResolver` filters them to installed apps through injectable
application/filesystem/environment ports, and `OpenWorkspaceInEditor` opens a
workspace path via the `EditorTargetLaunching` port. Pure client feature over
workspace identity; no server contract. This module never reads Settings — the
chosen default target id always comes from the caller. `$EDITOR` is never
launched here: the action returns a `routeToTerminalPane` marker and the shell
layer must run the resolved command inside a real tmux pane (D-019).

Visual contract: `docs/native-terminal-ui-shell.html` (D-041). Sidebar
projections form a workspace tree: workspace rows expand into agent sessions
(hook presence, D-038), integrated apps (detection adapters, D-039), and dev
servers (managed-process metadata rows, D-034). The active workspace
auto-expands; collapsed workspaces roll attention into row badges. Projections
stay row-level cached so presence flaps update one row, never the tree.
