import { ORCHESTRATION_WS_METHODS } from "../orchestration";
import { WS_METHODS } from "./methods";

export type WsMethodName =
  | (typeof WS_METHODS)[keyof typeof WS_METHODS]
  | (typeof ORCHESTRATION_WS_METHODS)[keyof typeof ORCHESTRATION_WS_METHODS];

export type WsMethodPlane = "control" | "event-stream" | "data-stream" | "compat-data-stream";

/**
 * Methods that currently carry bulk or byte-like payloads over the WebSocket RPC
 * path for compatibility. Future native terminal/provider transports should
 * treat these as the compatibility boundary to split into an explicit data
 * plane before increasing throughput or backpressure requirements. Server
 * observability labels these as `compat-data-stream` for stream item counters.
 */
export const WS_COMPAT_DATA_STREAM_METHODS = [
  WS_METHODS.terminalWrite,
  WS_METHODS.terminalWriteTmux,
  WS_METHODS.subscribeTerminalEvents,
  WS_METHODS.managedProcessWriteStdin,
  WS_METHODS.managedProcessSubscribeLog,
  // Full domain events can include provider/user message text payloads.
  WS_METHODS.subscribeOrchestrationDomainEvents,
  WS_METHODS.rawTcpSessionWrite,
  WS_METHODS.subscribeRawTcpEvents,
] as const satisfies readonly WsMethodName[];

/**
 * Explicit data-plane methods for high-volume pane streams and pane input.
 *
 * Unlike `compat-data-stream`, these contracts are expected to define replay,
 * sequencing, overflow, and slow-client behavior in their payload schemas.
 */
export const WS_DATA_STREAM_METHODS = [
  WS_METHODS.tmuxPaneWrite,
  WS_METHODS.tmuxPaneSubscribeStream,
] as const satisfies readonly WsMethodName[];

/**
 * Metadata and lifecycle subscriptions. These streams are still control-plane
 * WebSocket RPCs: they publish state transitions, snapshots, and provider/workflow
 * lifecycle events rather than owning terminal byte-stream backpressure.
 */
export const WS_EVENT_STREAM_METHODS = [
  WS_METHODS.subscribeVcsStatus,
  WS_METHODS.subscribeServerConfig,
  WS_METHODS.subscribeServerLifecycle,
  WS_METHODS.subscribeAuthAccess,
  WS_METHODS.subscribeLocalServers,
  WS_METHODS.subscribeRemoteControllerEvents,
  WS_METHODS.subscribeTrafficLensEvents,
  WS_METHODS.subscribePlanRunnerEvents,
  WS_METHODS.subscribeWorkflowEvents,
  WS_METHODS.subscribeSourceControlStackEvents,
  WS_METHODS.tmuxWorkspaceSubscribe,
  ORCHESTRATION_WS_METHODS.subscribeShell,
  ORCHESTRATION_WS_METHODS.subscribeManagedProcesses,
] as const satisfies readonly WsMethodName[];

const COMPAT_DATA_STREAM_METHOD_SET = new Set<WsMethodName>(WS_COMPAT_DATA_STREAM_METHODS);
const DATA_STREAM_METHOD_SET = new Set<WsMethodName>(WS_DATA_STREAM_METHODS);
const EVENT_STREAM_METHOD_SET = new Set<WsMethodName>(WS_EVENT_STREAM_METHODS);

export function getWsMethodPlane(method: WsMethodName): WsMethodPlane {
  if (COMPAT_DATA_STREAM_METHOD_SET.has(method)) {
    return "compat-data-stream";
  }
  if (DATA_STREAM_METHOD_SET.has(method)) {
    return "data-stream";
  }
  if (EVENT_STREAM_METHOD_SET.has(method)) {
    return "event-stream";
  }
  return "control";
}
