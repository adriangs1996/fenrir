export interface AcpProtocolLogEvent {
  readonly direction: "incoming" | "outgoing";
  readonly stage: "raw" | "decoded" | "decode_failed";
  readonly payload: unknown;
}

export interface AcpIncomingNotification {
  readonly _tag: string;
  readonly method?: string;
  readonly params?: unknown;
}
