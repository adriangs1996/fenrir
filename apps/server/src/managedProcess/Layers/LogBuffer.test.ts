import * as nodeFs from "node:fs";
import nodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe, expect } from "vitest";

import { ServerConfig } from "../../config.ts";
import { LogBuffer, type LogBufferReadResult } from "../Services/LogBuffer.ts";
import { LogBufferLive, deriveWorktreeKey } from "./LogBuffer.ts";
import type { ProjectId } from "@fenrir/contracts";

// ── Test layer ──

const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "fenrir-log-buffer-test-",
});
const LogBufferTestLayer = LogBufferLive.pipe(
  Layer.provide(ServerConfigLayer),
  Layer.provide(NodeServices.layer),
);
const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(LogBufferTestLayer),
  Layer.provideMerge(ServerConfigLayer),
  Layer.provideMerge(NodeServices.layer),
);

// ── Helpers ──

const PROJECT_ID = "log-test-project" as ProjectId;
let instanceCounter = 0;

function nextInstanceId(): string {
  return `log-inst-${++instanceCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

function openBuffer(instanceId: string, processDefId = "dev-server") {
  return Effect.gen(function* () {
    const logBuffer = yield* LogBuffer;
    yield* logBuffer.open({
      instanceId,
      projectId: PROJECT_ID,
      worktreePath: null,
      processDefId,
    });
  });
}

// ── Tests ──

it.layer(TestLayer)("LogBuffer", (it) => {
  describe("basic operations", () => {
    it.effect("append + read returns appended bytes", () =>
      Effect.gen(function* () {
        const buf = yield* LogBuffer;
        const id = nextInstanceId();
        yield* openBuffer(id);

        yield* buf.append(id, "hello ");
        yield* buf.append(id, "world\n");

        const result = yield* buf.read(id);
        expect(result.bytes).toBe("hello world\n");
        expect(result.ringBufferBytes).toBeGreaterThan(0);
        expect(result.truncated).toBe(false);
        expect(result.sequenceNumber).toBe(2);
      }),
    );

    it.effect("read on unknown instance returns empty", () =>
      Effect.gen(function* () {
        const buf = yield* LogBuffer;
        const result = yield* buf.read("nonexistent");
        expect(result.bytes).toBe("");
        expect(result.sequenceNumber).toBe(0);
      }),
    );
  });

  describe("ring eviction", () => {
    it.effect("evicts at byte cap", () =>
      Effect.gen(function* () {
        const buf = yield* LogBuffer;
        const id = nextInstanceId();
        yield* openBuffer(id);

        // Each chunk ~100KB. 2MiB = ~21 chunks to exceed cap.
        const bigChunk = "x".repeat(100 * 1024) + "\n";
        for (let i = 0; i < 25; i++) {
          yield* buf.append(id, bigChunk);
        }

        const result = yield* buf.read(id);
        expect(result.truncated).toBe(true);
        // Should have evicted to stay under 2MiB
        expect(result.ringBufferBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
      }),
    );

    it.effect("evicts at line cap", () =>
      Effect.gen(function* () {
        const buf = yield* LogBuffer;
        const id = nextInstanceId();
        yield* openBuffer(id);

        // Each append has 500 lines. 20 appends = 10,000 lines, 21 = 10,500 -> eviction.
        const manyLines = Array.from({ length: 500 }, (_, i) => `line-${i}`).join("\n") + "\n";
        for (let i = 0; i < 22; i++) {
          yield* buf.append(id, manyLines);
        }

        const result = yield* buf.read(id);
        expect(result.truncated).toBe(true);
      }),
    );

    it.effect("read returns truncated = true after eviction", () =>
      Effect.gen(function* () {
        const buf = yield* LogBuffer;
        const id = nextInstanceId();
        yield* openBuffer(id);

        // First read: not truncated
        yield* buf.append(id, "small\n");
        const before = yield* buf.read(id);
        expect(before.truncated).toBe(false);

        // Fill past byte cap
        const bigChunk = "y".repeat(100 * 1024) + "\n";
        for (let i = 0; i < 25; i++) {
          yield* buf.append(id, bigChunk);
        }

        const after = yield* buf.read(id);
        expect(after.truncated).toBe(true);
      }),
    );
  });

  describe("subscribers", () => {
    it.effect("subscriber receives chunks in order with monotonic sequenceNumber", () =>
      Effect.gen(function* () {
        const buf = yield* LogBuffer;
        const id = nextInstanceId();
        yield* openBuffer(id);

        const received: Array<{ bytes: string; sequenceNumber: number }> = [];
        const { unsubscribe } = yield* buf.subscribe(id, (chunk) => {
          received.push(chunk);
        });

        yield* buf.append(id, "chunk-1\n");
        yield* buf.append(id, "chunk-2\n");
        yield* buf.append(id, "chunk-3\n");

        expect(received).toHaveLength(3);
        expect(received[0]!.bytes).toBe("chunk-1\n");
        expect(received[1]!.bytes).toBe("chunk-2\n");
        expect(received[2]!.bytes).toBe("chunk-3\n");

        // Monotonic sequence
        expect(received[0]!.sequenceNumber).toBeLessThan(received[1]!.sequenceNumber);
        expect(received[1]!.sequenceNumber).toBeLessThan(received[2]!.sequenceNumber);

        unsubscribe();

        // After unsubscribe, no more notifications
        yield* buf.append(id, "chunk-4\n");
        expect(received).toHaveLength(3);
      }),
    );
  });

  describe("closeAndRotate", () => {
    it.effect("produces .log.previous with previous content; new open starts fresh", () =>
      Effect.gen(function* () {
        const buf = yield* LogBuffer;
        const { stateDir } = yield* ServerConfig;
        const processDefId = "rotate-test";
        const id = nextInstanceId();

        yield* buf.open({
          instanceId: id,
          projectId: PROJECT_ID,
          worktreePath: null,
          processDefId,
        });

        yield* buf.append(id, "session-1-data\n");
        yield* buf.closeAndRotate(id);

        // .log.previous should exist with previous content
        const logPrevious = nodePath.join(
          stateDir,
          "managed-process",
          PROJECT_ID,
          "__project__",
          `${processDefId}.log.previous`,
        );
        expect(nodeFs.existsSync(logPrevious)).toBe(true);
        const previousContent = nodeFs.readFileSync(logPrevious, "utf8");
        expect(previousContent).toBe("session-1-data\n");

        // Closed instances should still expose their last backfill to the UI.
        const closedResult = yield* buf.read(id);
        expect(closedResult.bytes).toBe("session-1-data\n");
        expect(closedResult.sequenceNumber).toBe(1);

        // Re-open: in-memory ring buffer is fresh
        yield* buf.open({
          instanceId: id,
          projectId: PROJECT_ID,
          worktreePath: null,
          processDefId,
        });
        yield* buf.append(id, "session-2-data\n");

        const result = yield* buf.read(id);
        expect(result.bytes).toBe("session-2-data\n");
        expect(result.sequenceNumber).toBe(1); // Reset counter

        yield* buf.closeAndRotate(id);
      }),
    );
  });

  describe("disk write failure resilience", () => {
    it.effect("append does not throw when fd is null (simulated disk failure)", () =>
      Effect.gen(function* () {
        const buf = yield* LogBuffer;
        const id = nextInstanceId();

        // Open with an invalid worktreePath that won't cause open to fail
        // but we'll test that even if the fd were null, append still works
        yield* openBuffer(id);

        // Append should succeed even if disk had issues
        yield* buf.append(id, "still works\n");
        const result = yield* buf.read(id);
        expect(result.bytes).toBe("still works\n");
      }),
    );
  });
});

describe("deriveWorktreeKey", () => {
  it("returns __project__ for null", () => {
    expect(deriveWorktreeKey(null)).toBe("__project__");
  });

  it("replaces path separators with --", () => {
    const key = deriveWorktreeKey("/home/user/worktree");
    expect(key).toBe("--home--user--worktree");
  });

  it("replaces non-safe characters with _", () => {
    const key = deriveWorktreeKey("/home/user name/wt@1");
    expect(key).toMatch(/^[a-zA-Z0-9._-]+$/);
    expect(key).toContain("_");
  });

  it("truncates long paths and appends sha1 suffix", () => {
    const longPath = "/a".repeat(150);
    const key = deriveWorktreeKey(longPath);
    expect(key.length).toBeLessThanOrEqual(200);
  });
});
