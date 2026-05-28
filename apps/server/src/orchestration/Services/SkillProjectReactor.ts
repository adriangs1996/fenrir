/**
 * SkillProjectReactor - Reacts to project lifecycle events to keep the
 * SkillService in sync with the active project's workspace root.
 *
 * When a project is created or its metadata is updated (e.g. workspaceRoot
 * changes), this reactor calls `skillService.setActiveProjectRoot` so the
 * skill panel reflects the correct project's `.claude/skills/` directory.
 *
 * @module SkillProjectReactor
 */
import { Context } from "effect";
import type { Effect, Scope } from "effect";

/**
 * SkillProjectReactorShape - Service API for skill ↔ project lifecycle sync.
 */
export interface SkillProjectReactorShape {
  /**
   * Start reacting to project.created and project.meta-updated domain events.
   *
   * Must be run in a scope so worker fibers are finalized on shutdown.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Resolves when the internal processing queue is empty and idle.
   * Intended for test use.
   */
  readonly drain: Effect.Effect<void>;
}

/**
 * SkillProjectReactor - Service tag for skill ↔ project lifecycle reactor.
 */
export class SkillProjectReactor extends Context.Service<
  SkillProjectReactor,
  SkillProjectReactorShape
>()("t3/orchestration/Services/SkillProjectReactor") {}
