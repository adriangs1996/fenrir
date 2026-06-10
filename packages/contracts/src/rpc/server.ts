import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";

import { AuthAccessStreamEvent } from "../auth";
import { TrimmedNonEmptyString } from "../baseSchemas";
import { KeybindingsConfigError } from "../keybindings";
import { GlobalActionsRpcError, GlobalScript, ProjectScriptIcon } from "../orchestration";
import { ProviderInstanceId } from "../providerInstance";
import {
  ServerConfigStreamEvent,
  ServerConfig,
  ServerProcessDiagnosticsResult,
  ServerProcessResourceHistoryInput,
  ServerProcessResourceHistoryResult,
  ServerProviderUpdateError,
  ServerProviderUpdateInput,
  ServerRemoveKeybindingInput,
  ServerRemoveKeybindingResult,
  ServerLifecycleStreamEvent,
  ServerProviderUpdatedPayload,
  ServerSignalProcessInput,
  ServerSignalProcessResult,
  ServerTraceDiagnosticsResult,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
} from "../server";
import { ServerListProviderSkillsInput, ServerListProviderSkillsResult } from "../skill";
import { ServerSettings, ServerSettingsError, ServerSettingsPatch } from "../settings";
import { SourceControlDiscoveryResult } from "../sourceControl";
import { WS_METHODS } from "./methods";

export const WsServerUpsertKeybindingRpc = Rpc.make(WS_METHODS.serverUpsertKeybinding, {
  payload: ServerUpsertKeybindingInput,
  success: ServerUpsertKeybindingResult,
  error: KeybindingsConfigError,
});

export const WsServerRemoveKeybindingRpc = Rpc.make(WS_METHODS.serverRemoveKeybinding, {
  payload: ServerRemoveKeybindingInput,
  success: ServerRemoveKeybindingResult,
  error: KeybindingsConfigError,
});

export const WsServerGetTraceDiagnosticsRpc = Rpc.make(WS_METHODS.serverGetTraceDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerTraceDiagnosticsResult,
});

export const WsServerGetProcessDiagnosticsRpc = Rpc.make(WS_METHODS.serverGetProcessDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerProcessDiagnosticsResult,
});

export const WsServerGetProcessResourceHistoryRpc = Rpc.make(
  WS_METHODS.serverGetProcessResourceHistory,
  {
    payload: ServerProcessResourceHistoryInput,
    success: ServerProcessResourceHistoryResult,
  },
);

export const WsServerSignalProcessRpc = Rpc.make(WS_METHODS.serverSignalProcess, {
  payload: ServerSignalProcessInput,
  success: ServerSignalProcessResult,
});

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError]),
});

export const WsServerListProviderSkillsRpc = Rpc.make(WS_METHODS.serverListProviderSkills, {
  payload: ServerListProviderSkillsInput,
  success: ServerListProviderSkillsResult,
});

export const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({
    instanceId: Schema.optional(ProviderInstanceId),
  }),
  success: ServerProviderUpdatedPayload,
});

export const WsServerUpdateProviderRpc = Rpc.make(WS_METHODS.serverUpdateProvider, {
  payload: ServerProviderUpdateInput,
  success: ServerProviderUpdatedPayload,
  error: ServerProviderUpdateError,
});

export const WsServerGetSettingsRpc = Rpc.make(WS_METHODS.serverGetSettings, {
  payload: Schema.Struct({}),
  success: ServerSettings,
  error: ServerSettingsError,
});

export const WsServerUpdateSettingsRpc = Rpc.make(WS_METHODS.serverUpdateSettings, {
  payload: Schema.Struct({ patch: ServerSettingsPatch }),
  success: ServerSettings,
  error: ServerSettingsError,
});

export const WsServerDiscoverSourceControlRpc = Rpc.make(WS_METHODS.serverDiscoverSourceControl, {
  payload: Schema.Struct({}),
  success: SourceControlDiscoveryResult,
});

export const WsServerGetGlobalActionsRpc = Rpc.make(WS_METHODS.serverGetGlobalActions, {
  payload: Schema.Struct({}),
  success: Schema.Array(GlobalScript),
  error: GlobalActionsRpcError,
});

export const WsServerCreateGlobalActionRpc = Rpc.make(WS_METHODS.serverCreateGlobalAction, {
  payload: Schema.Struct({
    name: Schema.String,
    command: Schema.String,
    icon: ProjectScriptIcon,
  }),
  success: GlobalScript,
  error: GlobalActionsRpcError,
});

export const WsServerUpdateGlobalActionRpc = Rpc.make(WS_METHODS.serverUpdateGlobalAction, {
  payload: Schema.Struct({
    id: TrimmedNonEmptyString,
    name: Schema.String,
    command: Schema.String,
    icon: ProjectScriptIcon,
  }),
  success: GlobalScript,
  error: GlobalActionsRpcError,
});

export const WsServerDeleteGlobalActionRpc = Rpc.make(WS_METHODS.serverDeleteGlobalAction, {
  payload: Schema.Struct({ id: TrimmedNonEmptyString }),
  error: GlobalActionsRpcError,
});

export const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({}),
  success: ServerConfigStreamEvent,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError]),
  stream: true,
});

export const WsSubscribeServerLifecycleRpc = Rpc.make(WS_METHODS.subscribeServerLifecycle, {
  payload: Schema.Struct({}),
  success: ServerLifecycleStreamEvent,
  stream: true,
});

export const WsSubscribeAuthAccessRpc = Rpc.make(WS_METHODS.subscribeAuthAccess, {
  payload: Schema.Struct({}),
  success: AuthAccessStreamEvent,
  stream: true,
});
