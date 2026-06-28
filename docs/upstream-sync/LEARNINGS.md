# Upstream Sync — Learnings

Durable, curated memory for the `upstream-sync` workflow. Every agent in the
workflow reads this file before acting; the Consolidate agent rewrites it at the
end of each run. Keep it **small and high-signal**.

## What counts as a real learning (keep)

- Architecture/layering rules that ported code MUST follow in this repo.
- Mapping rules: "upstream X lives at `apps/web/...`; in Fenrir it lives at `...`".
- Test patterns that catch regressions for a specific area (file + technique).
- A concrete tool/command that solved a specific class of problem.
- A pitfall that broke a build/test, with the fix, so it is never repeated.

## What is fatuous (never add)

- Restatements of obvious facts ("run tests before finishing").
- One-off details with no reuse value.
- Anything already in `CLAUDE.md` / `AGENTS.md`.
- Vague advice ("be careful", "write clean code").

---

## Architecture & mapping rules

- Fenrir hides agent interactions behind a **provider** interface — any ported
  upstream feature must be wired through the common provider interface, not
  hardcoded to one provider.
- Server interaction → expose over **websocket**; use Electron IPC only if
  absolutely necessary.
- Use **Effect v4** API. Search docs when unsure.

## Test patterns

- Never `bun test`. Always `bun run test` (Vitest via turbo).
- Gate completion on `bun fmt`, `bun lint`, `bun typecheck` all passing.

## Tooling

- Formatter is `oxfmt` (`bun fmt`), linter is `oxlint` (`bun lint`).

## Known pitfalls

(none yet)
