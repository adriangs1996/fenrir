import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";

import { ProjectId, TrimmedNonEmptyString } from "../baseSchemas";
import { ManagedProcessLogServerMessage } from "../managedProcessLog";
import { ManagedProcess, ManagedProcessInstance, ManagedProcessRpcError } from "../orchestration";
import { WS_METHODS } from "./methods";

export const WsManagedProcessListRpc = Rpc.make(WS_METHODS.managedProcessList, {
  payload: Schema.Struct({ projectId: ProjectId }),
  success: Schema.Array(ManagedProcessInstance),
  error: ManagedProcessRpcError,
});

export const WsManagedProcessStartRpc = Rpc.make(WS_METHODS.managedProcessStart, {
  payload: Schema.Struct({
    projectId: ProjectId,
    processDefId: TrimmedNonEmptyString,
    worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  }),
  success: ManagedProcessInstance,
  error: ManagedProcessRpcError,
});

export const WsManagedProcessStopRpc = Rpc.make(WS_METHODS.managedProcessStop, {
  payload: Schema.Struct({ instanceId: TrimmedNonEmptyString }),
  success: ManagedProcessInstance,
  error: ManagedProcessRpcError,
});

export const WsManagedProcessForceKillRpc = Rpc.make(WS_METHODS.managedProcessForceKill, {
  payload: Schema.Struct({ instanceId: TrimmedNonEmptyString }),
  success: ManagedProcessInstance,
  error: ManagedProcessRpcError,
});

export const WsManagedProcessRestartRpc = Rpc.make(WS_METHODS.managedProcessRestart, {
  payload: Schema.Struct({ instanceId: TrimmedNonEmptyString }),
  success: ManagedProcessInstance,
  error: ManagedProcessRpcError,
});

export const WsManagedProcessWriteStdinRpc = Rpc.make(WS_METHODS.managedProcessWriteStdin, {
  payload: Schema.Struct({
    instanceId: TrimmedNonEmptyString,
    data: Schema.String.check(Schema.isMaxLength(64 * 1024)),
  }),
  error: ManagedProcessRpcError,
});

export const WsManagedProcessUpsertDefinitionRpc = Rpc.make(
  WS_METHODS.managedProcessUpsertDefinition,
  {
    payload: Schema.Struct({
      projectId: ProjectId,
      definition: ManagedProcess,
    }),
    error: ManagedProcessRpcError,
  },
);

export const WsManagedProcessDeleteDefinitionRpc = Rpc.make(
  WS_METHODS.managedProcessDeleteDefinition,
  {
    payload: Schema.Struct({
      projectId: ProjectId,
      processDefId: TrimmedNonEmptyString,
    }),
    error: ManagedProcessRpcError,
  },
);

export const WsManagedProcessSubscribeLogRpc = Rpc.make(WS_METHODS.managedProcessSubscribeLog, {
  payload: Schema.Struct({ instanceId: TrimmedNonEmptyString }),
  success: ManagedProcessLogServerMessage,
  error: ManagedProcessRpcError,
  stream: true,
});

export const ManagedProcessImportProposal = Schema.Struct({
  suggestedDefinition: ManagedProcess,
  sourceLabel: Schema.String,
  conflictsWithDefId: Schema.NullOr(Schema.String),
});
export type ManagedProcessImportProposal = typeof ManagedProcessImportProposal.Type;

export const WsManagedProcessProposedImportsRpc = Rpc.make(
  WS_METHODS.managedProcessProposedImports,
  {
    payload: Schema.Struct({ projectId: ProjectId }),
    success: Schema.Array(ManagedProcessImportProposal),
    error: ManagedProcessRpcError,
  },
);
