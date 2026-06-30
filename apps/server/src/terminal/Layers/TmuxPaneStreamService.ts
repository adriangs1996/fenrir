import {
  TmuxKernelError,
  type TmuxPaneId,
  type TmuxPaneStreamDescriptor,
  type TmuxPaneStreamEvent,
} from "@fenrir/contracts";
import { Effect, Layer, Queue, Ref, Stream, type Cause } from "effect";

import {
  TmuxPaneStreamService,
  type TmuxPaneStreamAppendResult,
  type TmuxPaneStreamServiceShape,
} from "../Services/TmuxPaneStreamService";

const DEFAULT_REPLAY_CHUNKS = 2_000;
const MAX_CHUNK_BYTES = 256 * 1024;
const RECOVERY_EVENT_CAPACITY = 2;

interface BufferedChunk {
  readonly seq: number;
  readonly data: string;
  readonly emittedAt: string;
}

interface Subscriber {
  readonly queue: Queue.Queue<TmuxPaneStreamEvent, Cause.Done<void>>;
  readonly policy: "close" | "fast-forward";
}

interface PaneStreamState {
  descriptor: TmuxPaneStreamDescriptor;
  readonly chunks: BufferedChunk[];
  readonly subscribers: Map<string, Subscriber>;
  nextSubscriberId: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function kernelError(input: {
  code: TmuxKernelError["code"];
  message: string;
  paneId?: TmuxPaneId;
  cause?: unknown;
}): TmuxKernelError {
  return new TmuxKernelError(input);
}

function restoreDescriptor(descriptor: TmuxPaneStreamDescriptor): TmuxPaneStreamDescriptor {
  return {
    ...descriptor,
    lowSeq: descriptor.highSeq,
    backfillAvailable: false,
  };
}

function descriptorForChunks(
  descriptor: TmuxPaneStreamDescriptor,
  chunks: readonly BufferedChunk[],
  droppedCount: number,
): TmuxPaneStreamDescriptor {
  return {
    ...descriptor,
    lowSeq: chunks[0]?.seq ?? descriptor.highSeq,
    droppedCount,
    backfillAvailable: chunks.length > 0,
    maxChunkBytes: MAX_CHUNK_BYTES,
  };
}

function chunkEvent(
  descriptor: TmuxPaneStreamDescriptor,
  chunk: BufferedChunk,
): TmuxPaneStreamEvent {
  return {
    type: "chunk",
    descriptor,
    seq: chunk.seq,
    data: chunk.data,
    emittedAt: chunk.emittedAt,
  };
}

function overflowEvent(
  descriptor: TmuxPaneStreamDescriptor,
  droppedCount: number,
  policy: "close" | "fast-forward",
  reason: "buffer-overflow" | "slow-client",
): TmuxPaneStreamEvent {
  return {
    type: "overflow",
    descriptor,
    droppedCount: Math.max(1, droppedCount),
    policy,
    reason,
  };
}

function gapEvent(
  descriptor: TmuxPaneStreamDescriptor,
  requestedAfterSeq: number | null,
  resumedAtSeq: number,
  reason: "buffer-overflow" | "server-restart" | "slow-client",
): TmuxPaneStreamEvent {
  return {
    type: "gap",
    descriptor,
    requestedAfterSeq,
    resumedAtSeq,
    reason,
  };
}

function closedEvent(
  descriptor: TmuxPaneStreamDescriptor,
  reason: Extract<TmuxPaneStreamEvent, { type: "closed" }>["reason"],
): TmuxPaneStreamEvent {
  return {
    type: "closed",
    descriptor,
    reason,
  };
}

export const TmuxPaneStreamServiceLive = Layer.effect(
  TmuxPaneStreamService,
  Effect.gen(function* () {
    const panesRef = yield* Ref.make(new Map<TmuxPaneId, PaneStreamState>());

    const getPane = (paneId: TmuxPaneId): Effect.Effect<PaneStreamState, TmuxKernelError> =>
      Ref.get(panesRef).pipe(
        Effect.flatMap((panes) => {
          const state = panes.get(paneId);
          if (!state) {
            return Effect.fail(
              kernelError({
                code: "not-found",
                message: `tmux pane stream ${paneId} was not found`,
                paneId,
              }),
            );
          }
          return Effect.succeed(state);
        }),
      );

    const offerToSubscriber = (
      state: PaneStreamState,
      subscriberId: string,
      event: TmuxPaneStreamEvent,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const subscriber = state.subscribers.get(subscriberId);
        if (!subscriber) return;
        const offered = yield* Queue.offer(subscriber.queue, event);
        if (offered) return;

        const overflow = overflowEvent(state.descriptor, 1, subscriber.policy, "slow-client");
        if (subscriber.policy === "close") {
          yield* Queue.clear(subscriber.queue);
          yield* Queue.offer(subscriber.queue, overflow);
          yield* Queue.offer(subscriber.queue, closedEvent(state.descriptor, "slow-client"));
          yield* Queue.end(subscriber.queue);
          state.subscribers.delete(subscriberId);
          return;
        }

        yield* Queue.clear(subscriber.queue);
        yield* Queue.offer(subscriber.queue, overflow);
        yield* Queue.offer(
          subscriber.queue,
          gapEvent(state.descriptor, null, state.descriptor.highSeq, "slow-client"),
        );
      });

    const publish = (state: PaneStreamState, event: TmuxPaneStreamEvent): Effect.Effect<void> =>
      Effect.forEach(
        [...state.subscribers.keys()],
        (subscriberId) => offerToSubscriber(state, subscriberId, event),
        { discard: true },
      );

    const service: TmuxPaneStreamServiceShape = {
      ensurePane: (descriptor) =>
        Ref.modify(panesRef, (panes) => {
          const existing = panes.get(descriptor.paneId);
          if (existing) {
            existing.descriptor = {
              ...descriptor,
              lowSeq: existing.descriptor.lowSeq,
              highSeq: existing.descriptor.highSeq,
              droppedCount: existing.descriptor.droppedCount,
              backfillAvailable: existing.chunks.length > 0,
              maxChunkBytes: MAX_CHUNK_BYTES,
            };
            return [existing.descriptor, panes];
          }

          const restored = restoreDescriptor(descriptor);
          panes.set(descriptor.paneId, {
            descriptor: restored,
            chunks: [],
            subscribers: new Map(),
            nextSubscriberId: 0,
          });
          return [restored, panes];
        }),

      append: (paneId, data) =>
        Effect.gen(function* () {
          if (Buffer.byteLength(data, "utf8") > MAX_CHUNK_BYTES) {
            return yield* kernelError({
              code: "stream-overflow",
              message: `tmux pane stream chunk exceeds ${MAX_CHUNK_BYTES} bytes`,
              paneId,
            });
          }

          const state = yield* getPane(paneId);
          const chunk: BufferedChunk = {
            seq: state.descriptor.highSeq + 1,
            data,
            emittedAt: nowIso(),
          };
          state.chunks.push(chunk);

          let dropped = 0;
          while (state.chunks.length > DEFAULT_REPLAY_CHUNKS) {
            state.chunks.shift();
            dropped += 1;
          }

          state.descriptor = descriptorForChunks(
            {
              ...state.descriptor,
              highSeq: chunk.seq,
            },
            state.chunks,
            state.descriptor.droppedCount + dropped,
          );

          if (dropped > 0) {
            yield* publish(
              state,
              overflowEvent(state.descriptor, dropped, "fast-forward", "buffer-overflow"),
            );
          }
          yield* publish(state, chunkEvent(state.descriptor, chunk));

          return {
            descriptor: state.descriptor,
            overflow:
              dropped > 0
                ? {
                    droppedCount: dropped,
                    reason: "ring-buffer-overflow",
                  }
                : null,
          } satisfies TmuxPaneStreamAppendResult;
        }),

      closePane: (paneId, reason) =>
        Effect.gen(function* () {
          const exit = yield* Effect.exit(getPane(paneId));
          if (exit._tag === "Failure") return;
          const state = exit.value;
          const event = closedEvent(state.descriptor, reason);
          yield* Effect.forEach(
            [...state.subscribers.values()],
            (subscriber) =>
              Effect.gen(function* () {
                yield* Queue.clear(subscriber.queue);
                yield* Queue.offer(subscriber.queue, event);
                yield* Queue.end(subscriber.queue);
              }),
            { discard: true },
          );
          state.subscribers.clear();
        }),

      subscribe: (input) =>
        Effect.gen(function* () {
          const state = yield* getPane(input.paneId);
          const queue = yield* Queue.dropping<TmuxPaneStreamEvent, Cause.Done<void>>(
            Math.max(input.maxBufferedChunks, RECOVERY_EVENT_CAPACITY),
          );
          const subscriberId = `subscriber-${state.nextSubscriberId++}`;
          state.subscribers.set(subscriberId, {
            queue,
            policy: input.slowClientPolicy,
          });

          const initialEvents: TmuxPaneStreamEvent[] = [];
          const requestedAfterSeq =
            input.backfill === "from-seq" ? (input.afterSeq ?? state.descriptor.lowSeq - 1) : null;
          const availableAfterSeq =
            input.backfill === "latest" ? state.descriptor.highSeq : requestedAfterSeq;
          if (input.backfill === "from-seq" && requestedAfterSeq !== null) {
            if (state.chunks.length === 0) {
              if (requestedAfterSeq < state.descriptor.highSeq) {
                initialEvents.push(
                  gapEvent(
                    state.descriptor,
                    requestedAfterSeq,
                    state.descriptor.highSeq,
                    "server-restart",
                  ),
                );
              }
            } else {
              const firstAvailable = state.chunks[0]!.seq;
              if (requestedAfterSeq < firstAvailable - 1) {
                initialEvents.push(
                  gapEvent(state.descriptor, requestedAfterSeq, firstAvailable, "buffer-overflow"),
                );
              }
            }

            const backfillChunks = state.chunks.filter((chunk) => chunk.seq > requestedAfterSeq);
            if (backfillChunks.length > 0) {
              initialEvents.push({
                type: "backfill-started",
                descriptor: state.descriptor,
                fromSeq: backfillChunks[0]!.seq,
                toSeq: backfillChunks.at(-1)!.seq,
              });
              for (const chunk of backfillChunks) {
                initialEvents.push(chunkEvent(state.descriptor, chunk));
              }
            }
          } else if (
            availableAfterSeq !== null &&
            input.afterSeq !== undefined &&
            input.afterSeq < state.descriptor.highSeq
          ) {
            initialEvents.push(
              gapEvent(state.descriptor, input.afterSeq, state.descriptor.highSeq, "slow-client"),
            );
          }

          return Stream.fromIterable(initialEvents).pipe(
            Stream.concat(Stream.fromQueue(queue)),
            Stream.ensuring(
              Ref.update(panesRef, (panes) => {
                panes.get(input.paneId)?.subscribers.delete(subscriberId);
                return panes;
              }),
            ),
          );
        }),
    };

    return service;
  }),
);
