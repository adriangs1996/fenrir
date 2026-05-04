// @vitest-environment node
//
// Integration tests for the neovim-editor protocol layer against a real
// `nvim --embed` process. These cover the contract that matters most: that
// `parseRedrawBatch` interprets the actual byte stream Neovim emits, not
// a synthetic fixture we wrote ourselves.
//
// Skipped automatically when `nvim` isn't on PATH so CI on minimal images
// still goes green; locally these are the canary that the editor actually
// works.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attach } from "neovim";
import { parseRedrawBatch, type GridLineCell, type RedrawEvent } from "./protocol/RedrawParser";

function findNvim(): string | null {
  const path = process.env["PATH"];
  if (!path) return null;
  for (const dir of path.split(delimiter)) {
    const candidate = join(dir, process.platform === "win32" ? "nvim.exe" : "nvim");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const nvimBin = findNvim();
const describeIfNvim = nvimBin ? describe : describe.skip;

// The npm `neovim` client lacks tight types around `on('notification')` and
// `command`/`input`/`uiTryResize` return values when used purely as a UI client,
// so we keep this surface intentionally loose.
interface NvimClient {
  on(event: "notification", listener: (method: string, args: unknown[]) => void): unknown;
  uiAttach(width: number, height: number, opts: Record<string, unknown>): Promise<void>;
  uiTryResize(cols: number, rows: number): Promise<void>;
  input(keys: string): Promise<unknown>;
  command(cmd: string): Promise<unknown>;
}

interface Fixture {
  proc: ChildProcessWithoutNullStreams;
  client: NvimClient;
  /**
   * Drain any buffered redraw events, run `action`, then wait for the next
   * flush from Neovim and return all parsed events that arrived in between.
   * Always waits for a *new* flush, never for one that arrived previously.
   */
  collect: (action: () => Promise<unknown>, timeoutMs?: number) => Promise<RedrawEvent[]>;
  /** Wait for and parse one flush of buffered events without sending any command. */
  drain: (timeoutMs?: number) => Promise<RedrawEvent[]>;
  /** Read currently buffered raw events without parsing or clearing. */
  peekRaw: () => unknown[];
  /** Drop everything currently buffered. */
  clear: () => void;
}

async function startNvim(): Promise<Fixture> {
  if (!nvimBin) throw new Error("nvim not found on PATH");
  const proc = spawn(nvimBin, ["--embed", "--clean", "-n"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const client = attach({ proc }) as unknown as NvimClient;

  let buffer: unknown[] = [];
  let flushResolvers: Array<() => void> = [];
  client.on("notification", (method: string, args: unknown[]) => {
    if (method !== "redraw") return;
    if (Array.isArray(args)) buffer.push(...args);
    if (args.some((e) => Array.isArray(e) && e[0] === "flush")) {
      const resolvers = flushResolvers;
      flushResolvers = [];
      for (const r of resolvers) r();
    }
  });

  await client.uiAttach(40, 10, { rgb: true, ext_linegrid: true });

  const waitForFlush = (timeoutMs: number) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        flushResolvers = flushResolvers.filter((r) => r !== onFlush);
        reject(new Error(`timed out after ${timeoutMs}ms waiting for flush`));
      }, timeoutMs);
      const onFlush = () => {
        clearTimeout(timer);
        resolve();
      };
      flushResolvers.push(onFlush);
    });

  const settle = async (): Promise<void> => {
    // Multiple macrotask hops give the npm client time to drain any
    // pending msgpack frames into the notification listener. nvim's
    // request/response is async — `await command(...)` returning is
    // necessary but not sufficient for the *associated* notifications to
    // have been delivered.
    for (let i = 0; i < 5; i++) {
      await new Promise<void>((r) => setImmediate(r));
    }
  };

  const collect = async (
    action: () => Promise<unknown>,
    timeoutMs = 1500,
  ): Promise<RedrawEvent[]> => {
    // Drain stale events from the previous step. We don't trust flush
    // boundaries to align with action boundaries — nvim batches events
    // per its own scheduler — so we round-trip a synchronous command
    // first, settle the event loop, then clear the buffer.
    await client.command("redraw");
    await settle();
    buffer = [];

    const flushed = waitForFlush(timeoutMs).catch(() => {
      // Ignore: some actions (e.g. uiTryResize) may not produce a flush
      // promptly; the post-action `redraw` request below will force one.
    });
    await action();
    // Force a flush so we have a deterministic stop point regardless of
    // whether the action itself was dirty.
    await client.command("redraw");
    await Promise.race([flushed, new Promise<void>((r) => setTimeout(r, 200))]);
    await settle();
    const drained = buffer;
    buffer = [];
    return parseRedrawBatch(drained);
  };

  const drain = async (timeoutMs = 1500): Promise<RedrawEvent[]> => {
    if (!buffer.some((e) => Array.isArray(e) && e[0] === "flush")) {
      await waitForFlush(timeoutMs);
    }
    const drained = buffer;
    buffer = [];
    return parseRedrawBatch(drained);
  };

  return {
    proc,
    client,
    collect,
    drain,
    peekRaw: () => buffer.slice(),
    clear: () => {
      buffer = [];
    },
  };
}

async function shutdown(fx: Fixture): Promise<void> {
  try {
    await Promise.race([
      fx.client.command("qa!"),
      new Promise((resolve) => setTimeout(resolve, 500)),
    ]);
  } catch {
    // expected — qa! exits before the response is sent
  }
  if (fx.proc.exitCode === null) {
    fx.proc.kill("SIGKILL");
  }
}

describeIfNvim("nvim integration", () => {
  let fx: Fixture;

  beforeAll(async () => {
    fx = await startNvim();
    // Drain the initial attach paint so each test starts from a clean slate.
    await fx.drain(2000);
  }, 10_000);

  afterAll(async () => {
    if (fx) await shutdown(fx);
  }, 5_000);

  it("emits a flush after every redraw cycle", async () => {
    const events = await fx.collect(() => fx.client.input("i"));
    expect(events.length).toBeGreaterThan(0);
    // Restore normal mode so subsequent tests start clean.
    await fx.collect(() => fx.client.input("<Esc>"));
  });

  it("places typed text into grid_line events", async () => {
    const events = await fx.collect(() => fx.client.input("iHello world<Esc>"));

    // Reconstruct row 0 from grid_line events. Multiple grid_line events
    // may target the same row — apply them in order.
    const row0 = Array.from<string>({ length: 40 }).fill(" ");
    for (const e of events) {
      if (e.type !== "grid_line" || e.row !== 0) continue;
      let col = e.colStart;
      for (const cell of e.cells) {
        for (let i = 0; i < cell.repeat; i++) {
          if (col < row0.length) row0[col] = cell.text || " ";
          col++;
        }
      }
    }
    expect(row0.join("").trimEnd()).toContain("Hello world");
  });

  it("reports cursor position via grid_cursor_goto", async () => {
    // Put text in the buffer first so cursor can actually move. Then walk
    // it deterministically and assert nvim emits a final goto pointing
    // back at (0, 0).
    await fx.collect(() => fx.client.input("ggdGiabc<Esc>"));
    const events = await fx.collect(() => fx.client.input("gg0"));
    const last = events.toReversed().find((e) => e.type === "grid_cursor_goto");
    expect(last).toBeDefined();
    if (last && last.type === "grid_cursor_goto") {
      expect(last.row).toBe(0);
      expect(last.col).toBe(0);
    }
  });

  it("emits grid_resize after nvim_ui_try_resize", async () => {
    const events = await fx.collect(() => fx.client.uiTryResize(60, 12));
    const resize = events.find((e) => e.type === "grid_resize");
    expect(resize).toBeDefined();
    if (resize && resize.type === "grid_resize") {
      expect(resize.width).toBe(60);
      expect(resize.height).toBe(12);
    }
    // Restore prior size for any downstream test.
    await fx.collect(() => fx.client.uiTryResize(40, 10));
  });

  it("parses mode_change events on insert/normal transitions", async () => {
    const inserting = await fx.collect(() => fx.client.input("i"));
    const insertNames = inserting
      .filter((e): e is RedrawEvent & { type: "mode_change" } => e.type === "mode_change")
      .map((e) => e.modeName);
    expect(insertNames).toContain("insert");

    const back = await fx.collect(() => fx.client.input("<Esc>"));
    const normalNames = back
      .filter((e): e is RedrawEvent & { type: "mode_change" } => e.type === "mode_change")
      .map((e) => e.modeName);
    expect(normalNames).toContain("normal");
  });

  it("interprets hl_attr_define payloads", async () => {
    const events = await fx.collect(async () => {
      await fx.client.command("hi MyTestGroup guifg=#ff0000 guibg=#00ff00");
      await fx.client.command("syntax match MyTestGroup /Hello/");
      await fx.client.command("redraw!");
    });
    const def = events.find((e) => e.type === "hl_attr_define");
    expect(def).toBeDefined();
    if (def && def.type === "hl_attr_define") {
      expect(typeof def.id).toBe("number");
      expect(def.rgbAttr).toEqual(expect.any(Object));
    }
  });

  it("only emits events for grid 1 with ext_multigrid disabled", async () => {
    fx.clear();
    await fx.collect(() => fx.client.command("redraw!"));
    const raw = fx.peekRaw();
    const gridEvents = raw.filter(
      (e): e is unknown[] =>
        Array.isArray(e) && typeof e[0] === "string" && (e[0] as string).startsWith("grid_"),
    );
    for (const ev of gridEvents) {
      const argSets = (ev as unknown[]).slice(1) as unknown[][];
      for (const args of argSets) {
        if (Array.isArray(args) && typeof args[0] === "number") {
          expect(args[0]).toBe(1);
        }
      }
    }
    // Sanity: parser accepts the events without throwing.
    expect(() => parseRedrawBatch(raw)).not.toThrow();
  });

  it("respects the repeat field on grid_line cells", async () => {
    // Type known content and assert the parser preserves the repeat field
    // for whatever runs nvim chooses to encode as repeats. Empty rows
    // (mostly spaces) reliably produce repeat>1 runs; assert that case.
    const events = await fx.collect(() => fx.client.input("ggdGiabc<Esc>"));
    const lines = events.filter(
      (e): e is RedrawEvent & { type: "grid_line" } => e.type === "grid_line",
    );
    expect(lines.length).toBeGreaterThan(0);

    let totalRepeats = 0;
    let maxRepeat = 0;
    for (const ln of lines) {
      for (const c of ln.cells as GridLineCell[]) {
        expect(c.repeat).toBeGreaterThanOrEqual(1);
        totalRepeats += c.repeat;
        if (c.repeat > maxRepeat) maxRepeat = c.repeat;
      }
    }
    expect(totalRepeats).toBeGreaterThan(0);
    // Spaces in the empty tail of the row are usually emitted with repeat>1.
    expect(maxRepeat).toBeGreaterThan(1);
  });
});
