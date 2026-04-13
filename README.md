# Fenrir

Fenrir is a minimal web GUI for coding agents (currently Codex and Claude, more coming soon).

## Installation

> [!WARNING]
> Fenrir currently supports Codex and Claude.
> Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://github.com/openai/codex) and run `codex login`
> - Claude: install Claude Code and run `claude auth login`

### Run without installing

```bash
npx fenrir
```

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/adriangs1996/fenrir/releases), or from your favorite package registry:

#### Windows (`winget`)

```bash
winget install Fenrir.Fenrir
```

#### macOS (Homebrew)

```bash
brew install --cask fenrir
```

#### Arch Linux (AUR)

```bash
yay -S fenrir-bin
```

## Some notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

Observability guide: [docs/observability.md](./docs/observability.md)

## If you REALLY want to contribute still.... read this first

Before local development, prepare the environment and install dependencies:

```bash
# Optional: only needed if you use mise for dev tool management.
mise install
bun install .
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
