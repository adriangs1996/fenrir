export interface AcpError extends Error {}

export class AcpSpawnError extends Error implements AcpError {
  readonly command?: string;
  readonly cause?: unknown;
  constructor(args: { command?: string; cause?: unknown });
}

export class AcpProcessExitedError extends Error implements AcpError {
  readonly code?: number | null;
  readonly cause?: unknown;
  constructor(args: { code?: number | null; cause?: unknown });
}

export class AcpProtocolParseError extends Error implements AcpError {
  readonly detail: string;
  readonly cause?: unknown;
  constructor(args: { detail: string; cause?: unknown });
}

export class AcpTransportError extends Error implements AcpError {
  readonly detail: string;
  readonly cause?: unknown;
  constructor(args: { detail: string; cause?: unknown });
}

export class AcpRequestError extends Error implements AcpError {
  readonly code: number;
  readonly errorMessage: string;
  readonly data?: unknown;
  readonly cause?: unknown;
  constructor(args: { code: number; errorMessage: string; data?: unknown; cause?: unknown });
  static fromProtocolError(error: {
    code: number;
    message: string;
    data?: unknown;
  }): AcpRequestError;
  static parseError(message?: string, data?: unknown): AcpRequestError;
  static invalidRequest(message?: string, data?: unknown): AcpRequestError;
  static methodNotFound(method: string): AcpRequestError;
  static invalidParams(message?: string, data?: unknown): AcpRequestError;
  static internalError(message?: string, data?: unknown): AcpRequestError;
  static authRequired(message?: string, data?: unknown): AcpRequestError;
  static resourceNotFound(message?: string, data?: unknown): AcpRequestError;
  toProtocolError(): { code: number; message: string; data?: unknown };
}
