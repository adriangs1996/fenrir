import { expect, it } from "@effect/vitest";
import {
  AuthSessionId,
  TmuxPaneId,
  TmuxPaneStreamId,
  TmuxWorkspaceId,
  type TmuxPaneStreamDescriptor,
} from "@fenrir/contracts";
import { Effect, Stream } from "effect";

import { TmuxPaneStreamServiceLive } from "../Layers/TmuxPaneStreamService";
import { TmuxPaneStreamService } from "../Services/TmuxPaneStreamService";

const WORKSPACE_ID = TmuxWorkspaceId.make("workspace-1");
const STREAM_ACTOR = { sessionId: AuthSessionId.make("auth-session-1"), subject: "owner" };

function descriptor(paneId = TmuxPaneId.make("pane-1")): TmuxPaneStreamDescriptor {
  return {
    streamId: TmuxPaneStreamId.make(`stream-${paneId}`),
    paneId,
    encoding: "utf8",
    lowSeq: 0,
    highSeq: 0,
    droppedCount: 0,
    backfillAvailable: false,
    maxChunkBytes: 256 * 1024,
  };
}

it.effect("assigns monotonic sequence numbers and backfills from a requested sequence", () =>
  Effect.gen(function* () {
    const service = yield* TmuxPaneStreamService;
    const pane = TmuxPaneId.make("pane-1");
    yield* service.ensurePane(descriptor(pane));
    yield* service.append(pane, "one");
    yield* service.append(pane, "two");

    const stream = yield* service.subscribe({
      workspaceId: WORKSPACE_ID,
      paneId: pane,
      actor: STREAM_ACTOR,
      afterSeq: 1,
      backfill: "from-seq",
      slowClientPolicy: "fast-forward",
      maxBufferedChunks: 10,
    });
    const events = Array.from(yield* stream.pipe(Stream.take(2), Stream.runCollect));

    expect(events.map((event) => event.type)).toEqual(["backfill-started", "chunk"]);
    expect(events[1]).toMatchObject({ type: "chunk", seq: 2, data: "two" });
  }).pipe(Effect.provide(TmuxPaneStreamServiceLive)),
);

it.effect("emits a server-restart gap when descriptors survive without replay chunks", () =>
  Effect.gen(function* () {
    const service = yield* TmuxPaneStreamService;
    const pane = TmuxPaneId.make("pane-restored");
    yield* service.ensurePane({
      ...descriptor(pane),
      lowSeq: 7,
      highSeq: 9,
      backfillAvailable: true,
    });

    const stream = yield* service.subscribe({
      workspaceId: WORKSPACE_ID,
      paneId: pane,
      actor: STREAM_ACTOR,
      afterSeq: 3,
      backfill: "from-seq",
      slowClientPolicy: "fast-forward",
      maxBufferedChunks: 10,
    });
    const events = Array.from(yield* stream.pipe(Stream.take(1), Stream.runCollect));

    expect(events[0]).toMatchObject({
      type: "gap",
      requestedAfterSeq: 3,
      resumedAtSeq: 9,
      reason: "server-restart",
    });
  }).pipe(Effect.provide(TmuxPaneStreamServiceLive)),
);

it.effect("emits a server-restart gap for the next missing restored sequence", () =>
  Effect.gen(function* () {
    const service = yield* TmuxPaneStreamService;
    const pane = TmuxPaneId.make("pane-restored-next");
    yield* service.ensurePane({
      ...descriptor(pane),
      lowSeq: 7,
      highSeq: 9,
      backfillAvailable: true,
    });

    const stream = yield* service.subscribe({
      workspaceId: WORKSPACE_ID,
      paneId: pane,
      actor: STREAM_ACTOR,
      afterSeq: 8,
      backfill: "from-seq",
      slowClientPolicy: "fast-forward",
      maxBufferedChunks: 10,
    });
    const events = Array.from(yield* stream.pipe(Stream.take(1), Stream.runCollect));

    expect(events[0]).toMatchObject({
      type: "gap",
      requestedAfterSeq: 8,
      resumedAtSeq: 9,
      reason: "server-restart",
    });
  }).pipe(Effect.provide(TmuxPaneStreamServiceLive)),
);

it.effect("does not truncate initial backfill to the live subscriber queue capacity", () =>
  Effect.gen(function* () {
    const service = yield* TmuxPaneStreamService;
    const pane = TmuxPaneId.make("pane-backfill-small-queue");
    yield* service.ensurePane(descriptor(pane));
    for (let index = 1; index <= 25; index += 1) {
      yield* service.append(pane, String(index));
    }

    const stream = yield* service.subscribe({
      workspaceId: WORKSPACE_ID,
      paneId: pane,
      actor: STREAM_ACTOR,
      afterSeq: 0,
      backfill: "from-seq",
      slowClientPolicy: "fast-forward",
      maxBufferedChunks: 10,
    });
    const events = Array.from(yield* stream.pipe(Stream.take(26), Stream.runCollect));

    expect(events[0]).toMatchObject({ type: "backfill-started", fromSeq: 1, toSeq: 25 });
    expect(events.filter((event) => event.type === "chunk")).toHaveLength(25);
    expect(events.at(-1)).toMatchObject({ type: "chunk", seq: 25, data: "25" });
  }).pipe(Effect.provide(TmuxPaneStreamServiceLive)),
);

it.effect("reports ring-buffer overflow while preserving the latest bounded replay", () =>
  Effect.gen(function* () {
    const service = yield* TmuxPaneStreamService;
    const pane = TmuxPaneId.make("pane-overflow");
    yield* service.ensurePane(descriptor(pane));

    let latest = yield* service.append(pane, "0");
    for (let index = 1; index <= 2_005; index += 1) {
      latest = yield* service.append(pane, String(index));
    }

    const stream = yield* service.subscribe({
      workspaceId: WORKSPACE_ID,
      paneId: pane,
      actor: STREAM_ACTOR,
      afterSeq: 1,
      backfill: "from-seq",
      slowClientPolicy: "fast-forward",
      maxBufferedChunks: 10_000,
    });
    const events = Array.from(yield* stream.pipe(Stream.take(3), Stream.runCollect));

    expect(latest.descriptor).toMatchObject({
      highSeq: 2_006,
      lowSeq: 7,
      droppedCount: 6,
      backfillAvailable: true,
    });
    expect(events[0]).toMatchObject({
      type: "gap",
      requestedAfterSeq: 1,
      resumedAtSeq: 7,
      reason: "buffer-overflow",
    });
    expect(events[1]).toMatchObject({ type: "backfill-started", fromSeq: 7, toSeq: 2_006 });
    expect(events[2]).toMatchObject({ type: "chunk", seq: 7, data: "6" });
  }).pipe(Effect.provide(TmuxPaneStreamServiceLive)),
);

it.effect("fast-forwards slow subscribers without blocking pane append", () =>
  Effect.gen(function* () {
    const service = yield* TmuxPaneStreamService;
    const pane = TmuxPaneId.make("pane-slow-fast-forward");
    yield* service.ensurePane(descriptor(pane));
    const stream = yield* service.subscribe({
      workspaceId: WORKSPACE_ID,
      paneId: pane,
      actor: STREAM_ACTOR,
      backfill: "latest",
      slowClientPolicy: "fast-forward",
      maxBufferedChunks: 1,
    });

    yield* service.append(pane, "one");
    yield* service.append(pane, "two");
    yield* service.append(pane, "three");
    const events = Array.from(yield* stream.pipe(Stream.take(2), Stream.runCollect));

    expect(events.map((event) => event.type)).toEqual(["overflow", "gap"]);
    expect(events[1]).toMatchObject({ type: "gap", resumedAtSeq: 3, reason: "slow-client" });
  }).pipe(Effect.provide(TmuxPaneStreamServiceLive)),
);

it.effect("closes slow subscribers when requested by policy", () =>
  Effect.gen(function* () {
    const service = yield* TmuxPaneStreamService;
    const pane = TmuxPaneId.make("pane-slow-close");
    yield* service.ensurePane(descriptor(pane));
    const stream = yield* service.subscribe({
      workspaceId: WORKSPACE_ID,
      paneId: pane,
      actor: STREAM_ACTOR,
      backfill: "latest",
      slowClientPolicy: "close",
      maxBufferedChunks: 1,
    });

    yield* service.append(pane, "one");
    yield* service.append(pane, "two");
    yield* service.append(pane, "three");
    const events = Array.from(yield* stream.pipe(Stream.take(2), Stream.runCollect));

    expect(events.map((event) => event.type)).toEqual(["overflow", "closed"]);
    expect(events[1]).toMatchObject({ type: "closed", reason: "slow-client" });
  }).pipe(Effect.provide(TmuxPaneStreamServiceLive)),
);

it.effect("delivers pane closed reason even when the subscriber queue is full", () =>
  Effect.gen(function* () {
    const service = yield* TmuxPaneStreamService;
    const pane = TmuxPaneId.make("pane-close-full-queue");
    yield* service.ensurePane(descriptor(pane));
    const stream = yield* service.subscribe({
      workspaceId: WORKSPACE_ID,
      paneId: pane,
      actor: STREAM_ACTOR,
      backfill: "latest",
      slowClientPolicy: "fast-forward",
      maxBufferedChunks: 1,
    });

    yield* service.append(pane, "queued-before-close");
    yield* service.closePane(pane, "pane-closed");
    const events = Array.from(yield* stream.pipe(Stream.take(1), Stream.runCollect));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "closed", reason: "pane-closed" });
  }).pipe(Effect.provide(TmuxPaneStreamServiceLive)),
);
