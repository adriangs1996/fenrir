export interface SessionMode {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

export interface SessionModeState {
  readonly currentModeId?: string;
  readonly availableModes?: ReadonlyArray<SessionMode>;
}

export interface SelectSessionConfigOption {
  readonly id: string;
  readonly name?: string;
  readonly category?: string;
  readonly type: "select";
  readonly currentValue?: string;
  readonly options?: ReadonlyArray<{
    readonly value: string;
    readonly name?: string;
    readonly description?: string;
  }>;
}

export interface BooleanSessionConfigOption {
  readonly id: string;
  readonly name?: string;
  readonly category?: string;
  readonly type: "boolean";
  readonly currentValue?: boolean;
}

export type SessionConfigOption = SelectSessionConfigOption | BooleanSessionConfigOption;

export interface InitializeRequest {
  readonly protocolVersion: number;
  readonly clientCapabilities?: {
    readonly fs?: {
      readonly readTextFile?: boolean;
      readonly writeTextFile?: boolean;
    };
    readonly terminal?: boolean;
    readonly auth?: unknown;
    readonly elicitation?: unknown;
    readonly _meta?: Record<string, unknown>;
  };
  readonly clientInfo?: {
    readonly name: string;
    readonly version: string;
  };
}

export interface InitializeResponse {
  readonly protocolVersion: number;
  readonly agentCapabilities?: {
    readonly loadSession?: boolean;
    readonly [key: string]: unknown;
  };
}

export interface AuthenticateRequest {
  readonly methodId: string;
}

export interface AuthenticateResponse {
  readonly [key: string]: unknown;
}

export interface LogoutRequest {
  readonly [key: string]: unknown;
}

export interface LogoutResponse {
  readonly [key: string]: unknown;
}

export interface NewSessionRequest {
  readonly cwd?: string;
  readonly mcpServers?: ReadonlyArray<unknown>;
}

export interface NewSessionResponse {
  readonly sessionId: string;
  readonly modes?: SessionModeState;
  readonly configOptions?: ReadonlyArray<SessionConfigOption> | null;
}

export interface LoadSessionRequest {
  readonly sessionId: string;
  readonly cwd?: string;
  readonly mcpServers?: ReadonlyArray<unknown>;
}

export interface LoadSessionResponse {
  readonly modes?: SessionModeState;
  readonly configOptions?: ReadonlyArray<SessionConfigOption> | null;
}

export interface ResumeSessionResponse {
  readonly modes?: SessionModeState;
  readonly configOptions?: ReadonlyArray<SessionConfigOption> | null;
}

export interface PromptRequest {
  readonly sessionId: string;
  readonly prompt: ReadonlyArray<ContentBlock>;
}

export interface PromptResponse {
  readonly stopReason?: string;
}

export interface RequestPermissionRequest {
  readonly sessionId: string;
  readonly toolCall?: {
    readonly toolCallId?: string;
    readonly title?: string;
    readonly kind?: ToolKind | string;
    readonly status?: ToolCallStatus | string;
    readonly content?: ReadonlyArray<ToolCallContent> | null;
    readonly [key: string]: unknown;
  };
  readonly options?: ReadonlyArray<{
    readonly optionId: string;
    readonly name?: string;
    readonly kind?: string;
  }>;
}

export interface RequestPermissionResponse {
  readonly outcome:
    | { readonly outcome: "cancelled" }
    | { readonly outcome: "selected"; readonly optionId: string };
}

export interface ElicitationRequest {
  readonly [key: string]: unknown;
}

export interface ElicitationResponse {
  readonly [key: string]: unknown;
}

export interface ReadTextFileRequest {
  readonly [key: string]: unknown;
}

export interface ReadTextFileResponse {
  readonly [key: string]: unknown;
}

export interface WriteTextFileRequest {
  readonly [key: string]: unknown;
}

export interface WriteTextFileResponse {
  readonly [key: string]: unknown;
}

export interface CreateTerminalRequest {
  readonly sessionId: string;
  readonly [key: string]: unknown;
}

export interface CreateTerminalResponse {
  readonly terminalId: string;
}

export interface TerminalOutputRequest {
  readonly [key: string]: unknown;
}

export interface TerminalOutputResponse {
  readonly [key: string]: unknown;
}

export interface WaitForTerminalExitRequest {
  readonly [key: string]: unknown;
}

export interface WaitForTerminalExitResponse {
  readonly [key: string]: unknown;
}

export interface KillTerminalRequest {
  readonly [key: string]: unknown;
}

export interface KillTerminalResponse {
  readonly [key: string]: unknown;
}

export interface ReleaseTerminalRequest {
  readonly [key: string]: unknown;
}

export interface ReleaseTerminalResponse {
  readonly [key: string]: unknown;
}

export interface SetSessionModeResponse {
  readonly [key: string]: unknown;
}

export interface SetSessionConfigOptionRequest {
  readonly sessionId: string;
  readonly configId: string;
  readonly value?: string | boolean;
  readonly type?: "boolean";
}

export interface SetSessionConfigOptionResponse {
  readonly configOptions?: ReadonlyArray<SessionConfigOption> | null;
}

export type ContentBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: string; readonly [key: string]: unknown };

export type ToolCallContent = {
  readonly type?: string;
  readonly content?: ContentBlock;
  readonly [key: string]: unknown;
};

export type ToolCallLocation = {
  readonly path?: string;
  readonly line?: number;
  readonly [key: string]: unknown;
};

export type ToolKind = string;
export type ToolCallStatus = string;

export interface SessionNotification {
  readonly sessionId: string;
  readonly update:
    | {
        readonly sessionUpdate: "user_message_chunk" | "agent_message_chunk";
        readonly content: ContentBlock;
      }
    | {
        readonly sessionUpdate: "plan";
        readonly entries?: ReadonlyArray<{
          readonly content?: string;
          readonly priority?: string;
          readonly status?: string;
        }>;
      }
    | {
        readonly sessionUpdate: "tool_call";
        readonly toolCallId: string;
        readonly title?: string;
        readonly kind?: ToolKind;
        readonly status?: ToolCallStatus;
        readonly rawInput?: unknown;
        readonly content?: ReadonlyArray<ToolCallContent> | null;
        readonly locations?: ReadonlyArray<ToolCallLocation> | null;
      }
    | {
        readonly sessionUpdate: "tool_call_update";
        readonly toolCallId: string;
        readonly title?: string;
        readonly kind?: ToolKind;
        readonly status?: ToolCallStatus;
        readonly rawOutput?: unknown;
        readonly content?: ReadonlyArray<ToolCallContent> | null;
        readonly locations?: ReadonlyArray<ToolCallLocation> | null;
      }
    | {
        readonly sessionUpdate: string;
        readonly [key: string]: unknown;
      };
}
