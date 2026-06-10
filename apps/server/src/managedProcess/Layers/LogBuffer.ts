/**
 * LogBuffer layer - Per-instance ring buffer + on-disk append log.
 *
 * Ring buffer caps: 2 MiB bytes AND 10,000 lines.
 * Chunk-list deque approach: each append is stored as a tagged chunk with
 * byte length and line count. Eviction pops from the front.
 *
 * On-disk log at:
 *   {stateDir}/managed-process/{projectId}/{worktreeKey}/{processDefId}.log
 *
 * Disk write errors are logged but never propagated.
 *
 * @module ManagedProcess/Layers/LogBuffer
 */
import { createHash } from "node:crypto";
import * as nodeFs from "node:fs";
import nodePath from "node:path";

import { Effect, Layer } from "effect";

import { ServerConfig } from "../../config.ts";
import { LogBuffer, type LogBufferReadResult, type LogBufferShape } from "../Services/LogBuffer.ts";
import type { ProjectId } from "@fenrir/contracts";

// ── Constants ──

const MAX_RING_BYTES = 2 * 1024 * 1024; // 2 MiB
const MAX_RING_LINES = 10_000;

// ── worktreeKey derivation ──

export function deriveWorktreeKey(worktreePath: string | null): string {
  if (worktreePath === null) return "__project__";

  // Replace path separators with `--`, strip non-safe chars
  let slug = worktreePath.replace(/[\\/]/g, "--").replace(/[^a-zA-Z0-9._-]/g, "_");

  if (slug.length > 200) {
    const hash = createHash("sha1").update(worktreePath).digest("hex").slice(0, 8);
    slug = `${slug.slice(0, 191)}-${hash}`;
  }

  return slug;
}

// ── Ring buffer chunk deque ──

interface Chunk {
  readonly bytes: string;
  readonly byteLength: number;
  readonly lineCount: number;
  readonly sequenceNumber: number;
}

interface InstanceBuffer {
  chunks: Chunk[];
  totalBytes: number;
  totalLines: number;
  sequenceCounter: number;
  truncated: boolean;
  subscribers: Set<(chunk: { bytes: string; sequenceNumber: number }) => void>;
  // Disk writer state
  fd: number | null;
  logPath: string;
  previousLogPath: string;
}

interface ClosedBufferSnapshot extends LogBufferReadResult {
  readonly logPath: string;
  readonly previousLogPath: string;
}

function countLines(s: string): number {
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 10) count++;
  }
  return count;
}

function evict(buf: InstanceBuffer): void {
  while (
    buf.chunks.length > 0 &&
    (buf.totalBytes > MAX_RING_BYTES || buf.totalLines > MAX_RING_LINES)
  ) {
    const front = buf.chunks.shift()!;
    buf.totalBytes -= front.byteLength;
    buf.totalLines -= front.lineCount;
    buf.truncated = true;
  }
}

function openFdSafe(dirPath: string, filePath: string): number | null {
  try {
    nodeFs.mkdirSync(dirPath, { recursive: true });
    return nodeFs.openSync(filePath, "a");
  } catch (e) {
    // Log but don't propagate disk errors
    console.warn(`LogBuffer: failed to open log file ${filePath}:`, e);
    return null;
  }
}

function closeFdSafe(fd: number | null): void {
  if (fd === null) return;
  try {
    nodeFs.fsyncSync(fd);
    nodeFs.closeSync(fd);
  } catch {
    // best-effort
  }
}

function writeSafe(fd: number | null, bytes: string): void {
  if (fd === null) return;
  try {
    nodeFs.writeSync(fd, bytes);
  } catch (e) {
    console.warn("LogBuffer: disk write failed:", e);
  }
}

function rotateSafe(logPath: string, previousLogPath: string): void {
  try {
    nodeFs.renameSync(logPath, previousLogPath);
  } catch {
    // Previous may not exist, or rename may fail — best-effort
  }
}

// ── Implementation ──

const makeLogBuffer = Effect.gen(function* () {
  const { stateDir } = yield* ServerConfig;

  const buffers = new Map<string, InstanceBuffer>();
  const closedSnapshots = new Map<string, ClosedBufferSnapshot>();

  function logDir(
    projectId: ProjectId,
    worktreePath: string | null,
    processDefId: string,
  ): {
    logPath: string;
    previousLogPath: string;
    dir: string;
  } {
    const worktreeKey = deriveWorktreeKey(worktreePath);
    const dir = nodePath.join(stateDir, "managed-process", projectId, worktreeKey);
    return {
      logPath: nodePath.join(dir, `${processDefId}.log`),
      previousLogPath: nodePath.join(dir, `${processDefId}.log.previous`),
      dir,
    };
  }

  const open: LogBufferShape["open"] = (input) =>
    Effect.sync(() => {
      const existing = buffers.get(input.instanceId);
      if (existing) {
        // Close prior buffer
        closeFdSafe(existing.fd);
        for (const sub of existing.subscribers) {
          existing.subscribers.delete(sub);
        }
      }
      closedSnapshots.delete(input.instanceId);

      const paths = logDir(input.projectId, input.worktreePath, input.processDefId);
      const fd = openFdSafe(paths.dir, paths.logPath);

      const buf: InstanceBuffer = {
        chunks: [],
        totalBytes: 0,
        totalLines: 0,
        sequenceCounter: 0,
        truncated: false,
        subscribers: new Set(),
        fd,
        logPath: paths.logPath,
        previousLogPath: paths.previousLogPath,
      };
      buffers.set(input.instanceId, buf);
    });

  const append: LogBufferShape["append"] = (instanceId, bytes) =>
    Effect.sync(() => {
      const buf = buffers.get(instanceId);
      if (!buf) return;

      buf.sequenceCounter++;
      const chunk: Chunk = {
        bytes,
        byteLength: Buffer.byteLength(bytes, "utf8"),
        lineCount: countLines(bytes),
        sequenceNumber: buf.sequenceCounter,
      };

      buf.chunks.push(chunk);
      buf.totalBytes += chunk.byteLength;
      buf.totalLines += chunk.lineCount;
      evict(buf);

      // Write to disk (best-effort)
      writeSafe(buf.fd, bytes);

      // Notify subscribers
      for (const handler of buf.subscribers) {
        try {
          handler({ bytes, sequenceNumber: chunk.sequenceNumber });
        } catch {
          // Subscriber errors don't propagate
        }
      }
    });

  const read: LogBufferShape["read"] = (instanceId) =>
    Effect.sync((): LogBufferReadResult => {
      const buf = buffers.get(instanceId);
      if (!buf) {
        return (
          closedSnapshots.get(instanceId) ?? {
            bytes: "",
            ringBufferBytes: 0,
            truncated: false,
            sequenceNumber: 0,
          }
        );
      }

      const concatenated = buf.chunks.map((c) => c.bytes).join("");
      return {
        bytes: concatenated,
        ringBufferBytes: buf.totalBytes,
        truncated: buf.truncated,
        sequenceNumber: buf.sequenceCounter,
      };
    });

  const subscribe: LogBufferShape["subscribe"] = (instanceId, handler) =>
    Effect.sync(() => {
      const buf = buffers.get(instanceId);
      if (!buf) {
        return { unsubscribe: () => {} };
      }

      buf.subscribers.add(handler);
      return {
        unsubscribe: () => {
          buf.subscribers.delete(handler);
        },
      };
    });

  const closeAndRotate: LogBufferShape["closeAndRotate"] = (instanceId) =>
    Effect.sync(() => {
      const buf = buffers.get(instanceId);
      if (!buf) return;

      const snapshot: ClosedBufferSnapshot = {
        bytes: buf.chunks.map((chunk) => chunk.bytes).join(""),
        ringBufferBytes: buf.totalBytes,
        truncated: buf.truncated,
        sequenceNumber: buf.sequenceCounter,
        logPath: buf.logPath,
        previousLogPath: buf.previousLogPath,
      };

      // Flush + fsync + close fd
      closeFdSafe(buf.fd);
      buf.fd = null;

      // Rotate .log -> .log.previous
      rotateSafe(buf.logPath, buf.previousLogPath);

      // Clear subscribers
      buf.subscribers.clear();

      closedSnapshots.set(instanceId, snapshot);

      // Remove from map
      buffers.delete(instanceId);
    });

  return { open, append, read, subscribe, closeAndRotate } satisfies LogBufferShape;
});

export const LogBufferLive = Layer.effect(LogBuffer, makeLogBuffer);
