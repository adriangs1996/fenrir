/**
 * SkillProjectReactor implementation.
 *
 * Subscribes to orchestration domain events and calls
 * `skillService.setActiveProjectRoot` when a project is created or its
 * workspaceRoot is updated. This ensures the skill panel always reflects
 * the current project's `.claude/skills/` directory rather than the
 * server's startup CWD.
 *
 * @module SkillProjectReactor
 */
import type { OrchestrationEvent } from "@fenrir/contracts";
import { makeDrainableWorker } from "@fenrir/shared/DrainableWorker";
import { Cause, Effect, Layer, Stream } from "effect";

import { SkillService } from "../../skill/SkillService.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  SkillProjectReactor,
  type SkillProjectReactorShape,
} from "../Services/SkillProjectReactor.ts";

type ProjectCreatedEvent = Extract<OrchestrationEvent, { type: "project.created" }>;
type ProjectMetaUpdatedEvent = Extract<OrchestrationEvent, { type: "project.meta-updated" }>;
type ProjectEvent = ProjectCreatedEvent | ProjectMetaUpdatedEvent;

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const skillService = yield* SkillService;

  const processProjectEvent = Effect.fn("processProjectEvent")(function* (event: ProjectEvent) {
    const workspaceRoot =
      event.type === "project.created"
        ? event.payload.workspaceRoot
        : (event.payload.workspaceRoot ?? null);

    if (workspaceRoot === null) return;

    yield* skillService
      .setActiveProjectRoot(workspaceRoot)
      .pipe(
        Effect.catch((e) =>
          Effect.logWarning(
            `SkillProjectReactor: failed to switch project root to "${workspaceRoot}": ${e.message}`,
          ),
        ),
      );
  });

  const processProjectEventSafely = (event: ProjectEvent) =>
    processProjectEvent(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("SkillProjectReactor: failed to process event", {
          eventType: event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processProjectEventSafely);

  const start: SkillProjectReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (event.type !== "project.created" && event.type !== "project.meta-updated") {
          return Effect.void;
        }
        return worker.enqueue(event);
      }),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies SkillProjectReactorShape;
});

export const SkillProjectReactorLive = Layer.effect(SkillProjectReactor, make);
