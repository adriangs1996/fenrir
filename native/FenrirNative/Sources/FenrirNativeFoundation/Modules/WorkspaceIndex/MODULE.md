# WorkspaceIndex

Owns the native client's lightweight workspace catalog, recents/favorites,
open-state summaries, and list/query contracts. Summaries must not include pane
bytes, layouts, auth tokens, or renderer state.

Visual contract: `docs/native-terminal-ui-shell.html` (D-041). Sidebar
projections form a workspace tree: workspace rows expand into agent sessions
(hook presence, D-038), integrated apps (detection adapters, D-039), and dev
servers (managed-process metadata rows, D-034). The active workspace
auto-expands; collapsed workspaces roll attention into row badges. Projections
stay row-level cached so presence flaps update one row, never the tree.
