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
}

export class TmuxPaneStreamService extends Context.Service<
  TmuxPaneStreamService,
  TmuxPaneStreamServiceShape
>()("t3/terminal/Services/TmuxPaneStreamService") {}

export type { TmuxPaneSlowClientPolicy };
