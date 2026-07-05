import type {
  TmuxKernelError,
  TmuxPaneId,
  TmuxPaneSlowClientPolicy,
  TmuxPaneStreamDescriptor,
  TmuxPaneStreamEvent,
  TmuxPaneStreamSubscribeInput,
} from "@fenrir/contracts";
import { Context, Effect, Stream } from "effect";

export interface TmuxPaneStreamAppendResult {
  readonly descriptor: TmuxPaneStreamDescriptor;
  readonly overflow: {
    readonly droppedCount: number;
    readonly reason: "ring-buffer-overflow";
  } | null;
}

export interface TmuxPaneStreamServiceShape {
  readonly ensurePane: (
    descriptor: TmuxPaneStreamDescriptor,
  ) => Effect.Effect<TmuxPaneStreamDescriptor>;
  readonly append: (
    paneId: TmuxPaneId,
    data: string,
  ) => Effect.Effect<TmuxPaneStreamAppendResult, TmuxKernelError>;
  readonly closePane: (
    paneId: TmuxPaneId,
    reason: Extract<TmuxPaneStreamEvent, { type: "closed" }>["reason"],
  ) => Effect.Effect<void>;
  readonly subscribe: (
    input: TmuxPaneStreamSubscribeInput,
  ) => Effect.Effect<Stream.Stream<TmuxPaneStreamEvent, never>, TmuxKernelError>;
  /**
   * Registers the recovery hook invoked (detached, debounce is the handler's
   * responsibility) whenever a live subscriber loses chunks — a fast-forward
   * slow-client drop leaves the subscriber's terminal missing a byte range
   * mid-escape-sequence, so the owner must reinject a full screen repaint.
   */
  readonly setSubscriberGapHandler: (
    handler: (paneId: TmuxPaneId) => Effect.Effect<void>,
  ) => Effect.Effect<void>;
}

export class TmuxPaneStreamService extends Context.Service<
  TmuxPaneStreamService,
  TmuxPaneStreamServiceShape
>()("t3/terminal/Services/TmuxPaneStreamService") {}

export type { TmuxPaneSlowClientPolicy };
