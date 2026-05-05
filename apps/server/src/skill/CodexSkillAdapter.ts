/**
 * CodexSkillAdapter - Stub implementation of ProviderSkillAdapter for Codex.
 *
 * Codex does not currently support a skill directory analogous to .claude/skills/.
 * All methods are no-ops that return empty results. watchPath returns null
 * so the file watcher ignores this adapter.
 *
 * @module CodexSkillAdapter
 */
import { Effect, Layer, ServiceMap } from "effect";

import { type ProviderSkillAdapter } from "./ProviderSkillAdapter.ts";
import { type RawSkillFile } from "./skillFileFormat.ts";

// ─── Service Tag ───────────────────────────────────────────────

/**
 * CodexSkillAdapter - Service tag for the Codex skill adapter stub.
 */
export class CodexSkillAdapter extends ServiceMap.Service<
  CodexSkillAdapter,
  ProviderSkillAdapter
>()("t3/skill/CodexSkillAdapter") {}

// ─── Live Layer ────────────────────────────────────────────────

const codexSkillAdapterImpl: ProviderSkillAdapter = {
  provider: "codex",

  readProviderSkills: () =>
    Effect.andThen(
      Effect.logDebug("Codex skill sync not yet implemented"),
      Effect.succeed([] as RawSkillFile[]),
    ),

  writeSkillToProvider: (_skill) =>
    Effect.andThen(Effect.logDebug("Codex skill sync not yet implemented"), Effect.void),

  deleteSkillFromProvider: (_skillName) =>
    Effect.andThen(Effect.logDebug("Codex skill sync not yet implemented"), Effect.void),

  watchPath: () => null,
};

/**
 * CodexSkillAdapterLive - Layer that provides the Codex skill adapter stub.
 * All operations are no-ops; no filesystem access is performed.
 */
export const CodexSkillAdapterLive: Layer.Layer<CodexSkillAdapter> = Layer.effect(
  CodexSkillAdapter,
  Effect.succeed(codexSkillAdapterImpl),
);
