# NeovimBridge

## Purpose

Own native client actions for Neovim panes that run as real tmux processes.
The module coordinates runtime pane focus, optional bridge calls, active buffer
state discovery, and palette file-open routing.

## Public API

- `OpenFileInNeovim`
- `FocusNeovimPane`
- `DetectActiveNeovimState`
- palette file provider and action executor helpers

## Dependencies

- `NativeRuntime` public contracts and service ports
- `WorkspaceOverlays` palette contracts for optional palette integration

## Events

This slice does not emit events. Callers receive typed action results.

## Testing

Use fake runtime, bridge, catalog, and creator services. Cover active pane
success, no active pane, stale pane, unsupported bridge, and palette routing.
