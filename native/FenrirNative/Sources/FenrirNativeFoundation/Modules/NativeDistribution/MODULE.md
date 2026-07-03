# NativeDistribution

Owns native app distribution readiness checks for external tools, bundled
server assets, terminal renderer artifacts, and startup-mode diagnostics.

Public API:

- `AssessStartupReadiness`
- startup mode and dependency contracts
- `TmuxDependencyChecking` and `ServerAssetLocating` service ports
- live service factories for PATH tmux, app resource server asset discovery, and terminal renderer artifact discovery

Distribution assumptions:

- `tmux` is required for local default and existing local server modes.
- the Fenrir server remains separate from the native app and may be bundled as
  an app resource for local default startup.
- existing local server mode does not require a bundled server asset.
- remote attach mode does not require local tmux or a local server binary.
- Neovim is not bundled; Neovim panes are created by server/tmux workflows when
  available.
- the native terminal renderer artifact is required by default; bootstrap text
  rendering is an explicit local smoke fallback and reports degraded readiness.

Testing:

- mock service ports at action boundaries
- cover dependency missing, unsupported version, and startup-mode differences
