import { MessageChannelMain, type MessagePortMain } from "electron";
import type { Frame, InputEvent } from "@fenrir/contracts";
import {
  RENDER_FRAME_PORT_CHANNEL,
  RENDER_INPUT_CHANNEL,
  RENDER_SET_EDITOR_FONT_METRICS_CHANNEL,
  RENDER_SET_FPS_CHANNEL,
  RENDER_START_CHANNEL,
  RENDER_STOP_CHANNEL,
  RENDER_SYNC_VIEWPORT_CHANNEL,
} from "@fenrir/contracts";

import type { NeovimSource } from "../neovim";
import { RenderLoop } from "../render/RenderLoop";
import { registerHandler, registerListener } from "./registerHandler";
import { requireNumber, requireObject, ValidationError } from "./validators";

export interface RenderRuntimeDeps {
  readonly neovimSource: NeovimSource;
}

export interface RenderRuntime {
  readonly registerRenderHandlers: () => void;
  /** Stop the frame loop (used during app shutdown). */
  readonly stopRenderLoop: () => void;
}

function parseMods(value: unknown): {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
} {
  if (typeof value !== "object" || value === null) {
    return { ctrl: false, alt: false, shift: false, meta: false };
  }
  const m = value as Record<string, unknown>;
  return {
    ctrl: !!m["ctrl"],
    alt: !!m["alt"],
    shift: !!m["shift"],
    meta: !!m["meta"],
  };
}

export function parseInputEvent(payload: unknown): InputEvent | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const kind = p["kind"];
  if (kind === "key") {
    const type = p["type"];
    if (type !== "down" && type !== "up") return null;
    if (typeof p["key"] !== "string" || typeof p["code"] !== "string") return null;
    return {
      kind: "key",
      type,
      key: p["key"],
      code: p["code"],
      mods: parseMods(p["mods"]),
    };
  }
  if (kind === "paste") {
    if (typeof p["text"] !== "string") return null;
    return { kind: "paste", text: p["text"] };
  }
  if (kind === "mouse") {
    const type = p["type"];
    if (type !== "down" && type !== "up" && type !== "move" && type !== "wheel") return null;
    if (typeof p["x"] !== "number" || typeof p["y"] !== "number") return null;
    const button = p["button"];
    const buttonOk = button === undefined || button === 0 || button === 1 || button === 2;
    if (!buttonOk) return null;
    const ev: InputEvent = {
      kind: "mouse",
      type,
      x: p["x"],
      y: p["y"],
      mods: parseMods(p["mods"]),
    };
    if (button === 0 || button === 1 || button === 2) ev.button = button;
    if (typeof p["deltaX"] === "number") ev.deltaX = p["deltaX"];
    if (typeof p["deltaY"] === "number") ev.deltaY = p["deltaY"];
    return ev;
  }
  if (kind === "resize") {
    if (typeof p["w"] !== "number" || typeof p["h"] !== "number") return null;
    return { kind: "resize", w: p["w"], h: p["h"] };
  }
  return null;
}

export function createRenderRuntime(deps: RenderRuntimeDeps): RenderRuntime {
  const { neovimSource } = deps;
  let renderFramePort: MessagePortMain | null = null;

  const renderLoop = new RenderLoop({
    fps: 60,
    emit: (frame: Frame) => {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Electron MessagePortMain does not take a targetOrigin argument.
      renderFramePort?.postMessage(frame);
    },
  });
  renderLoop.setSource(neovimSource);

  function replaceRenderFramePort(next: MessagePortMain | null): void {
    try {
      renderFramePort?.close();
    } catch (error) {
      console.warn("[render] closing previous frame port failed:", error);
    }
    renderFramePort = next;
    renderFramePort?.start();
  }

  function registerRenderHandlers(): void {
    registerHandler(RENDER_START_CHANNEL, async (event) => {
      const { port1, port2 } = new MessageChannelMain();
      replaceRenderFramePort(port1);
      event.sender.postMessage(RENDER_FRAME_PORT_CHANNEL, null, [port2]);
      // After a renderer reload (Cmd+R) the GL canvas is reset and has no
      // grid contents, but the embedded nvim still holds full state. Force
      // a full-snapshot frame so the renderer can repaint without waiting
      // for nvim to push deltas for unchanged regions.
      neovimSource.requestFullRepaint();
      renderLoop.start();
    });

    registerHandler(RENDER_STOP_CHANNEL, async () => {
      renderLoop.stop();
      replaceRenderFramePort(null);
    });

    registerHandler(RENDER_SET_FPS_CHANNEL, async (_event, fps: unknown) => {
      renderLoop.setFps(requireNumber("fps", fps));
    });

    registerHandler(
      RENDER_SYNC_VIEWPORT_CHANNEL,
      async (_event, width: unknown, height: unknown) => {
        if (
          typeof width !== "number" ||
          typeof height !== "number" ||
          !Number.isFinite(width) ||
          !Number.isFinite(height) ||
          width < 1 ||
          height < 1
        ) {
          throw new ValidationError("viewport");
        }
        renderLoop.pushInput({ kind: "resize", w: width, h: height });
        neovimSource.requestFullRepaint();
      },
    );

    registerListener(RENDER_INPUT_CHANNEL, (_event, payload: unknown) => {
      // Silent semantics: unparseable input events are dropped.
      const ev = parseInputEvent(payload);
      if (ev) renderLoop.pushInput(ev);
    });

    registerHandler(RENDER_SET_EDITOR_FONT_METRICS_CHANNEL, async (_event, payload: unknown) => {
      const m = requireObject("metrics", payload);
      if (
        typeof m["width"] !== "number" ||
        typeof m["height"] !== "number" ||
        typeof m["ascent"] !== "number" ||
        typeof m["font"] !== "string" ||
        typeof m["fontWeight"] !== "number" ||
        typeof m["ligatures"] !== "boolean"
      ) {
        throw new ValidationError("metrics fields");
      }
      neovimSource.setEditorFontMetrics({
        width: m["width"],
        height: m["height"],
        ascent: m["ascent"],
        font: m["font"],
        fontWeight: m["fontWeight"],
        ligatures: m["ligatures"],
      });
    });
  }

  return {
    registerRenderHandlers,
    stopRenderLoop: () => {
      renderLoop.stop();
    },
  };
}
