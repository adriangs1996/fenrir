import * as ChildProcess from "node:child_process";
import * as FS from "node:fs";
import * as Path from "node:path";

import type { BrowserWindow } from "electron";
import {
  NEOVIM_ATTACH_CHANNEL,
  NEOVIM_DETACH_CHANNEL,
  NEOVIM_INPUT_CHANNEL,
  NEOVIM_REDRAW_CHANNEL,
  NEOVIM_RESIZE_CHANNEL,
  NEOVIM_SET_CWD_CHANNEL,
  NEOVIM_SET_THEME_CHANNEL,
  NVIM_AVAILABLE_CHANNEL,
  NVIM_PROBE_DETAIL_CHANNEL,
  type NeovimThemeSelection,
} from "@fenrir/contracts";

import { FENRIR_EXIT_LUA, FENRIR_INIT_LUA, NeovimSource } from "../neovim";
import { probeNvim } from "../neovim/probe";
import { createEmbeddedThemeRuntimeCommand } from "../neovim/themeRuntime";
import { registerHandler } from "./registerHandler";
import { requireNonEmptyString, requireNumber, requireObject, requireString } from "./validators";

export interface NeovimHandlersDeps {
  readonly getMainWindow: () => BrowserWindow | null;
  readonly ensureShellEnvironmentSynced: (reason: string) => void;
  readonly neovimSource: NeovimSource;
}

export interface NeovimIpcController {
  /**
   * Run the embedded Neovim's exit handler (force-quit via Lua), then escalate
   * to SIGTERM/SIGKILL with timeouts.
   */
  readonly shutdownNvim: (reason: string) => Promise<void>;
}

function sanitizeForIpc(val: unknown): unknown {
  if (Array.isArray(val)) return val.map(sanitizeForIpc);
  if (
    val !== null &&
    typeof val === "object" &&
    "data" in val &&
    (val as any).data instanceof Uint8Array
  ) {
    return Buffer.from((val as any).data).readUInt32BE(0);
  }
  return val;
}

function nvimStartupArgs(): string[] {
  const args = ["--embed"];
  try {
    args.push("--cmd", createEmbeddedThemeRuntimeCommand());
  } catch (error) {
    console.warn("[neovim:main] embedded theme runtime setup failed:", error);
  }
  args.push("--cmd", "tnoremap <Esc> <C-\\><C-n>");
  return args;
}

function requireNeovimThemeSelection(value: unknown): NeovimThemeSelection {
  const payload = requireObject("neovim theme selection", value);
  return {
    appTheme: requireNonEmptyString("neovim theme appTheme", payload.appTheme),
    syntaxTheme: requireNonEmptyString("neovim theme syntaxTheme", payload.syntaxTheme),
    colorscheme: requireNonEmptyString("neovim theme colorscheme", payload.colorscheme),
  };
}

export function registerNeovimHandlers(deps: NeovimHandlersDeps): NeovimIpcController {
  let nvimSession: {
    client: any;
    proc: ChildProcess.ChildProcessWithoutNullStreams;
  } | null = null;

  /**
   * Run the embedded Neovim's exit handler (force-quit via Lua), then escalate
   * to SIGTERM/SIGKILL with timeouts. Mirrors neovide's pattern of asking
   * Neovim to quit itself before tearing down the process — without this we
   * SIGTERM into modified buffers and lose unsaved work / hang on prompts.
   *
   * Always nulls `nvimSession` synchronously before awaiting, so concurrent
   * callers don't double-shutdown the same session.
   */
  async function shutdownNvim(reason: string): Promise<void> {
    const session = nvimSession;
    if (!session) return;
    nvimSession = null;
    console.log(`[neovim:main] shutdown (${reason})`);

    const exitPromise = new Promise<void>((resolve) => {
      if (session.proc.exitCode !== null || session.proc.signalCode !== null) {
        resolve();
        return;
      }
      session.proc.once("exit", () => resolve());
    });

    const isAlive = () => session.proc.exitCode === null && session.proc.signalCode === null;

    // 1. Ask Neovim to quit itself. Don't await this past the deadline — the
    //    RPC reply never comes when nvim exits before responding (see
    //    neovim/neovim#26743), so we time out and fall through to wait on exit.
    try {
      await Promise.race([
        session.client.request("nvim_exec_lua", [FENRIR_EXIT_LUA, []]),
        new Promise<void>((resolve) => setTimeout(resolve, 1_500)),
      ]);
    } catch (e) {
      // Common when nvim exited mid-request; not fatal.
      console.log("[neovim:main] exec_lua quit returned error (expected on quick exit):", e);
    }

    // 2. Wait for actual process exit.
    await Promise.race([exitPromise, new Promise<void>((resolve) => setTimeout(resolve, 1_500))]);

    // 3. Escalate if still alive.
    if (isAlive()) {
      console.warn("[neovim:main] graceful quit timed out — sending SIGTERM");
      try {
        session.proc.kill("SIGTERM");
      } catch (e) {
        console.warn("[neovim:main] SIGTERM threw:", e);
      }
      await Promise.race([exitPromise, new Promise<void>((resolve) => setTimeout(resolve, 1_000))]);
    }
    if (isAlive()) {
      console.warn("[neovim:main] SIGTERM ignored — sending SIGKILL");
      try {
        session.proc.kill("SIGKILL");
      } catch (e) {
        console.warn("[neovim:main] SIGKILL threw:", e);
      }
    }
  }

  registerHandler(
    NEOVIM_ATTACH_CHANNEL,
    async (_event, cwd: unknown, cols: unknown, rows: unknown) => {
      console.log("[neovim:main] attach called — cwd:", cwd, "cols:", cols, "rows:", rows);
      const validCwd = requireString("cwd", cwd);
      const validCols = requireNumber("cols", cols);
      const validRows = requireNumber("rows", rows);

      if (nvimSession) {
        await shutdownNvim("re-attach");
      }

      const { attach } = await import("neovim");
      deps.ensureShellEnvironmentSynced("neovim-attach");
      const nvimBin =
        process.env.PATH?.split(":")
          .map((p) => Path.join(p, "nvim"))
          .find((p) => FS.existsSync(p)) ?? "nvim";
      console.log("[neovim:main] spawning nvim at:", nvimBin);
      const proc = ChildProcess.spawn(nvimBin, nvimStartupArgs(), {
        cwd: validCwd,
        stdio: ["pipe", "pipe", "pipe"],
      });

      proc.on("error", (err) => console.error("[neovim:main] proc error:", err));
      proc.on("exit", (code, signal) =>
        console.log("[neovim:main] proc exit — code:", code, "signal:", signal),
      );

      const client = attach({ proc });

      nvimSession = { client, proc };

      // Catch-all notification logger so we can see EVERY notification name
      // nvim emits, not just redraw. Helps diagnose whether nvim is emitting
      // events at all vs the npm client filtering them.
      client.on("notification", (method: string, args: unknown) => {
        if (method === "redraw") {
          const sanitized = sanitizeForIpc(args);
          const names = Array.isArray(sanitized)
            ? (sanitized as any[]).map((e: any) => (Array.isArray(e) ? e[0] : e))
            : [];
          console.log(`[neovim:main] redraw batch (${names.length} events): ${names.join(",")}`);
          deps.getMainWindow()?.webContents.send(NEOVIM_REDRAW_CHANNEL, sanitized);
        } else {
          console.log(
            `[neovim:main] non-redraw notification: ${method}`,
            Array.isArray(args) ? `args.length=${args.length}` : args,
          );
        }
      });

      // Listen for raw stderr from nvim — startup errors (E444, "press enter")
      // surface here.
      proc.stderr?.on("data", (chunk) => {
        console.log("[neovim:main] stderr:", chunk.toString());
      });

      console.log("[neovim:main] calling nvim_ui_attach (raw RPC) —", validCols, validRows);
      try {
        // Single-grid mode (ext_multigrid OFF): Neovim composes splits +
        // floats into grid 1, matching what a TUI sees. Multigrid adds large
        // amounts of UI complexity (compositor, anchored floats, msg grid)
        // for animation features Fenrir doesn't use today. Re-enable only
        // when there's a concrete win.
        const result = await client.request("nvim_ui_attach", [
          validCols,
          validRows,
          { rgb: true, ext_linegrid: true },
        ]);
        console.log("[neovim:main] nvim_ui_attach returned:", result);
      } catch (e) {
        console.error("[neovim:main] nvim_ui_attach FAILED:", e);
        throw e;
      }
      console.log("[neovim:main] uiAttach done");

      // Identify Fenrir to Neovim and run init lua (vim.g.fenrir, ginit.vim,
      // _G.fenrir.private namespace). All best-effort: older nvim or partial
      // failures must not abort attach — the editor still works without them.
      try {
        await client.request("nvim_set_var", ["fenrir", true]);
      } catch (e) {
        console.warn("[neovim:main] set_var(fenrir) failed:", e);
      }
      try {
        await client.request("nvim_set_client_info", [
          "fenrir",
          { major: 0, minor: 1, patch: 0 },
          "ui",
          {},
          {},
        ]);
      } catch (e) {
        console.warn("[neovim:main] set_client_info failed:", e);
      }
      try {
        await client.request("nvim_exec_lua", [FENRIR_INIT_LUA, []]);
        console.log("[neovim:main] init lua executed");
      } catch (e) {
        console.warn("[neovim:main] init lua failed:", e);
      }

      // Force an initial redraw so nvim paints the welcome / current buffer
      // state immediately. With ext_multigrid, nvim doesn't always emit a
      // full initial paint until something triggers it.
      try {
        await client.command("redraw!");
        console.log("[neovim:main] initial redraw! sent");
      } catch (e) {
        console.error("[neovim:main] initial redraw! failed:", e);
      }
    },
  );

  registerHandler(NEOVIM_DETACH_CHANNEL, async () => {
    console.log("[neovim:main] detach called");
    await shutdownNvim("detach");
  });

  registerHandler(NEOVIM_INPUT_CHANNEL, async (_event, keys: unknown) => {
    const validKeys = requireString("keys", keys);
    // Silent semantics: input without an attached session is dropped.
    if (!nvimSession) return;
    await nvimSession.client.input(validKeys);
  });

  registerHandler(NEOVIM_RESIZE_CHANNEL, async (_event, cols: unknown, rows: unknown) => {
    const validCols = requireNumber("cols", cols);
    const validRows = requireNumber("rows", rows);
    // Silent semantics: resize without an attached session is dropped.
    if (!nvimSession) return;
    await nvimSession.client.uiTryResize(validCols, validRows);
  });

  registerHandler(NEOVIM_SET_CWD_CHANNEL, async (_event, cwd: unknown) => {
    await deps.neovimSource.setCwd(requireNonEmptyString("cwd", cwd));
  });

  registerHandler(NEOVIM_SET_THEME_CHANNEL, async (_event, rawSelection: unknown) => {
    await deps.neovimSource.setTheme(requireNeovimThemeSelection(rawSelection));
  });

  registerHandler(NVIM_AVAILABLE_CHANNEL, async () => {
    deps.ensureShellEnvironmentSynced("neovim-probe");
    const result = await probeNvim();
    return result.available;
  });

  registerHandler(NVIM_PROBE_DETAIL_CHANNEL, async () => {
    deps.ensureShellEnvironmentSynced("neovim-probe-detail");
    return probeNvim();
  });

  return { shutdownNvim };
}
