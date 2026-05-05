/**
 * ProviderSkillAdapter - Bidirectional skill sync interface.
 *
 * Implementations read from / write to provider-native skill directories.
 * Each provider adapter is responsible for format conversion between
 * Fenrir's ServerProviderSkill and the provider's native representation.
 *
 * ClaudeSkillAdapter syncs with .claude/skills/ using SKILL.md files.
 * CodexSkillAdapter is a stub — Codex does not yet support skill sync.
 *
 * @module ProviderSkillAdapter
 */
import type { Effect } from "effect";
import { Schema } from "effect";

import type { ProviderKind, ServerProviderSkill } from "@fenrir/contracts";

import type { RawSkillFile } from "./skillFileFormat.ts";

// ─── Adapter Error ─────────────────────────────────────────────

export class SkillAdapterError extends Schema.TaggedErrorClass<SkillAdapterError>()(
  "SkillAdapterError",
  {
    provider: Schema.String,
    reason: Schema.String,
    filePath: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    const loc = this.filePath !== undefined ? ` (${this.filePath})` : "";
    return `[${this.provider}] Skill adapter error: ${this.reason}${loc}`;
  }
}

// ─── Adapter Interface ─────────────────────────────────────────

export interface ProviderSkillAdapter {
  /**
   * Provider kind implemented by this adapter.
   */
  readonly provider: ProviderKind;

  /**
   * Read all skills from the provider's native directory.
   * e.g., .claude/skills/ for Claude.
   *
   * Returned RawSkillFile frontmatter is enriched with Fenrir defaults so
   * validateSkillFile can decode a complete ServerProviderSkill.
   * Tolerates parse failures — bad files are logged as warnings and skipped.
   */
  readonly readProviderSkills: () => Effect.Effect<RawSkillFile[], SkillAdapterError>;

  /**
   * Write a Fenrir skill to the provider's native format.
   * Strips Fenrir-only fields (displayName, icon, tags, enabled, syncStatus).
   * Keeps provider-compatible fields only.
   */
  readonly writeSkillToProvider: (
    skill: ServerProviderSkill,
  ) => Effect.Effect<void, SkillAdapterError>;

  /**
   * Delete a skill from the provider's native directory.
   * Gracefully handles "not found" — no error if the skill does not exist.
   */
  readonly deleteSkillFromProvider: (skillName: string) => Effect.Effect<void, SkillAdapterError>;

  /**
   * Return the directory path this adapter watches for external changes.
   * null if the provider does not support skill sync.
   */
  readonly watchPath: () => string | null;
}
