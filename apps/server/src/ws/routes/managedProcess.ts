import { Effect, Stream } from "effect";

import {
  type ManagedProcessLogServerMessage,
  ManagedProcessRpcError,
  WS_METHODS,
} from "@fenrir/contracts";
import { resolveManagedProcessCwd } from "@fenrir/shared/projectScripts";

import { ImportResolver } from "../../managedProcess/Services/ImportResolver";
import { ManagedProcessManager } from "../../managedProcess/Services/Manager";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine";
import { makeControlPlaneDomainWithErrors } from "../controlPlane";
import { toManagedProcessRpcError } from "../rpcErrors";
import { serverCommandId } from "../shared";

export const makeManagedProcessRoutes = Effect.gen(function* () {
  const managedProcessManager = yield* ManagedProcessManager;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const importResolver = yield* ImportResolver;

  const managedProcess = makeControlPlaneDomainWithErrors(
    "managedProcess",
    toManagedProcessRpcError,
  );

  return {
    [WS_METHODS.managedProcessList]: managedProcess.effect(WS_METHODS.managedProcessList, (input) =>
      managedProcessManager.list(input.projectId),
    ),
    [WS_METHODS.managedProcessStart]: managedProcess.effect(
      WS_METHODS.managedProcessStart,
      (input) => managedProcessManager.start(input),
    ),
    [WS_METHODS.managedProcessStop]: managedProcess.effect(WS_METHODS.managedProcessStop, (input) =>
      managedProcessManager.stop(input.instanceId),
    ),
    [WS_METHODS.managedProcessForceKill]: managedProcess.effect(
      WS_METHODS.managedProcessForceKill,
      (input) => managedProcessManager.forceKill(input.instanceId),
    ),
    [WS_METHODS.managedProcessRestart]: managedProcess.effect(
      WS_METHODS.managedProcessRestart,
      (input) => managedProcessManager.restart(input.instanceId),
    ),
    [WS_METHODS.managedProcessWriteStdin]: managedProcess.effect(
      WS_METHODS.managedProcessWriteStdin,
      (input) => managedProcessManager.writeStdin(input),
    ),
    [WS_METHODS.managedProcessUpsertDefinition]: managedProcess.effect(
      WS_METHODS.managedProcessUpsertDefinition,
      (input) =>
        Effect.gen(function* () {
          // Server-side validation of the definition before dispatching
          const project = (yield* orchestrationEngine.getReadModel()).projects.find(
            (p) => p.id === input.projectId,
          );
          if (!project) {
            return yield* new ManagedProcessRpcError({
              code: "not-found",
              message: `Project '${input.projectId}' does not exist.`,
            });
          }

          // Validate cwd resolves cleanly against the scope root
          const scopeRoot = project.workspaceRoot;
          const cwdResult = resolveManagedProcessCwd({
            scopeRoot,
            cwd: input.definition.cwd,
          });
          if (!cwdResult.ok) {
            return yield* new ManagedProcessRpcError({
              code: "invalid-state",
              message: `Invalid cwd: ${cwdResult.reason}`,
            });
          }

          // Validate readiness log-pattern regex compiles
          if (input.definition.readiness.kind === "log-pattern") {
            const readinessPattern = input.definition.readiness.pattern;
            yield* Effect.try({
              try: () => {
                void new RegExp(readinessPattern);
              },
              catch: () =>
                new ManagedProcessRpcError({
                  code: "invalid-state",
                  message: `Invalid readiness log-pattern regex: "${readinessPattern}"`,
                }),
            });
          }

          yield* orchestrationEngine.dispatch({
            type: "project.managedProcess.upsert",
            commandId: serverCommandId("managed-process-upsert"),
            projectId: input.projectId,
            definition: input.definition,
          });
        }),
    ),
    [WS_METHODS.managedProcessDeleteDefinition]: managedProcess.effect(
      WS_METHODS.managedProcessDeleteDefinition,
      (input) =>
        orchestrationEngine
          .dispatch({
            type: "project.managedProcess.delete",
            commandId: serverCommandId("managed-process-delete"),
            projectId: input.projectId,
            processDefId: input.processDefId,
          })
          .pipe(Effect.asVoid),
    ),
    [WS_METHODS.managedProcessProposedImports]: managedProcess.effect(
      WS_METHODS.managedProcessProposedImports,
      (input) =>
        Effect.gen(function* () {
          const readModel = yield* orchestrationEngine.getReadModel();
          const project = readModel.projects.find((p) => p.id === input.projectId);
          if (!project) {
            return yield* new ManagedProcessRpcError({
              code: "not-found",
              message: `Project '${input.projectId}' does not exist.`,
            });
          }
          return yield* importResolver.propose({
            projectId: input.projectId,
            workspaceRoot: project.workspaceRoot,
            existingDefinitions: [...(project.managedProcesses ?? [])],
          });
        }),
    ),
    [WS_METHODS.managedProcessSubscribeLog]: managedProcess.streamEffect(
      WS_METHODS.managedProcessSubscribeLog,
      (input) =>
        managedProcessManager.subscribeLog(input.instanceId).pipe(
          Effect.map(({ backfill, stream }) => {
            const backfillMsg: ManagedProcessLogServerMessage = {
              type: "backfill",
              instanceId: input.instanceId,
              bytes: backfill.bytes,
              ringBufferBytes: backfill.ringBufferBytes,
              truncated: backfill.truncated,
              sequenceNumber: backfill.sequenceNumber,
            };
            const liveStream = stream.pipe(
              Stream.map(
                (chunk): ManagedProcessLogServerMessage => ({
                  type: "chunk",
                  instanceId: input.instanceId,
                  bytes: chunk.bytes,
                  sequenceNumber: chunk.sequenceNumber,
                }),
              ),
            );
            return Stream.concat(Stream.make(backfillMsg), liveStream);
          }),
          Effect.mapError(toManagedProcessRpcError),
        ),
    ),
  };
});
