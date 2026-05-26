import type { Effect, Layer, ServiceMap } from "effect";

import type * as AcpProtocol from "./protocol";
import type * as AcpSchema from "./schema";
import type * as AcpErrors from "./errors";

export interface AcpClientAgentApi {
  readonly initialize: (
    payload: AcpSchema.InitializeRequest,
  ) => Effect.Effect<AcpSchema.InitializeResponse, AcpErrors.AcpError>;
  readonly authenticate: (
    payload: AcpSchema.AuthenticateRequest,
  ) => Effect.Effect<AcpSchema.AuthenticateResponse, AcpErrors.AcpError>;
  readonly loadSession: (
    payload: AcpSchema.LoadSessionRequest,
  ) => Effect.Effect<AcpSchema.LoadSessionResponse, AcpErrors.AcpError>;
  readonly createSession: (
    payload: AcpSchema.NewSessionRequest,
  ) => Effect.Effect<AcpSchema.NewSessionResponse, AcpErrors.AcpError>;
  readonly setSessionConfigOption: (
    payload: AcpSchema.SetSessionConfigOptionRequest,
  ) => Effect.Effect<AcpSchema.SetSessionConfigOptionResponse, AcpErrors.AcpError>;
  readonly prompt: (
    payload: AcpSchema.PromptRequest,
  ) => Effect.Effect<AcpSchema.PromptResponse, AcpErrors.AcpError>;
  readonly cancel: (payload: { sessionId: string }) => Effect.Effect<void, AcpErrors.AcpError>;
}

export interface AcpClientShape {
  readonly agent: AcpClientAgentApi;
  readonly raw: {
    readonly request: (
      method: string,
      payload: unknown,
    ) => Effect.Effect<unknown, AcpErrors.AcpError>;
    readonly notify: (method: string, payload: unknown) => Effect.Effect<void, AcpErrors.AcpError>;
  };
  readonly handleRequestPermission: (
    handler: (
      payload: AcpSchema.RequestPermissionRequest,
    ) => Effect.Effect<AcpSchema.RequestPermissionResponse, AcpErrors.AcpError>,
  ) => Effect.Effect<void>;
  readonly handleElicitation: (
    handler: (...args: ReadonlyArray<unknown>) => Effect.Effect<unknown>,
  ) => Effect.Effect<void>;
  readonly handleReadTextFile: (
    handler: (...args: ReadonlyArray<unknown>) => Effect.Effect<unknown>,
  ) => Effect.Effect<void>;
  readonly handleWriteTextFile: (
    handler: (...args: ReadonlyArray<unknown>) => Effect.Effect<unknown>,
  ) => Effect.Effect<void>;
  readonly handleCreateTerminal: (
    handler: (...args: ReadonlyArray<unknown>) => Effect.Effect<unknown>,
  ) => Effect.Effect<void>;
  readonly handleTerminalOutput: (
    handler: (...args: ReadonlyArray<unknown>) => Effect.Effect<unknown>,
  ) => Effect.Effect<void>;
  readonly handleTerminalWaitForExit: (
    handler: (...args: ReadonlyArray<unknown>) => Effect.Effect<unknown>,
  ) => Effect.Effect<void>;
  readonly handleTerminalKill: (
    handler: (...args: ReadonlyArray<unknown>) => Effect.Effect<unknown>,
  ) => Effect.Effect<void>;
  readonly handleTerminalRelease: (
    handler: (...args: ReadonlyArray<unknown>) => Effect.Effect<unknown>,
  ) => Effect.Effect<void>;
  readonly handleSessionUpdate: (
    handler: (
      notification: AcpSchema.SessionNotification,
    ) => Effect.Effect<void, AcpErrors.AcpError>,
  ) => Effect.Effect<void>;
  readonly handleElicitationComplete: (
    handler: (...args: ReadonlyArray<unknown>) => Effect.Effect<unknown>,
  ) => Effect.Effect<void>;
  readonly handleUnknownExtRequest: (
    handler: (method: string, params: unknown) => Effect.Effect<unknown, AcpErrors.AcpError>,
  ) => Effect.Effect<void>;
  readonly handleUnknownExtNotification: (
    handler: (method: string, params: unknown) => Effect.Effect<void, AcpErrors.AcpError>,
  ) => Effect.Effect<void>;
  readonly handleExtRequest: <A>(
    method: string,
    payload: unknown,
    handler: (payload: A) => Effect.Effect<unknown, AcpErrors.AcpError>,
  ) => Effect.Effect<void>;
  readonly handleExtNotification: <A>(
    method: string,
    payload: unknown,
    handler: (payload: A) => Effect.Effect<void, AcpErrors.AcpError>,
  ) => Effect.Effect<void>;
}

export declare class AcpClient extends ServiceMap.Service<AcpClient, AcpClientShape>()(
  "effect-acp/AcpClient",
) {}
export declare const AcpClientTag: ServiceMap.Service<AcpClient, AcpClientShape>;

export declare const layerChildProcess: (
  handle: unknown,
  options?: {
    readonly logIncoming?: boolean;
    readonly logOutgoing?: boolean;
    readonly logger?: (event: AcpProtocol.AcpProtocolLogEvent) => Effect.Effect<void, never>;
  },
) => Layer.Layer<AcpClient>;
