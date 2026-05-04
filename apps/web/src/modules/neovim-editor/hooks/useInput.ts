import type { KeyboardEvent } from "react";
import { debugLog, recordKey } from "../debug/debug";

export function useInput(nvim: any) {
  function translateKey(e: KeyboardEvent): string {
    const ctrl = e.ctrlKey && !e.metaKey;
    const shift = e.shiftKey;

    // Named keys
    switch (e.key) {
      case "Escape":
        return "<Esc>";
      case "Enter":
        return "<CR>";
      case "Backspace":
        return "<BS>";
      case "Delete":
        return "<Del>";
      case "Tab":
        return shift ? "<S-Tab>" : "<Tab>";
      case "ArrowUp":
        return ctrl ? "<C-Up>" : "<Up>";
      case "ArrowDown":
        return ctrl ? "<C-Down>" : "<Down>";
      case "ArrowLeft":
        return ctrl ? "<C-Left>" : "<Left>";
      case "ArrowRight":
        return ctrl ? "<C-Right>" : "<Right>";
      case "Home":
        return "<Home>";
      case "End":
        return "<End>";
      case "PageUp":
        return "<PageUp>";
      case "PageDown":
        return "<PageDown>";
      case "Insert":
        return "<Insert>";
      case "F1":
        return "<F1>";
      case "F2":
        return "<F2>";
      case "F3":
        return "<F3>";
      case "F4":
        return "<F4>";
      case "F5":
        return "<F5>";
      case "F6":
        return "<F6>";
      case "F7":
        return "<F7>";
      case "F8":
        return "<F8>";
      case "F9":
        return "<F9>";
      case "F10":
        return "<F10>";
      case "F11":
        return "<F11>";
      case "F12":
        return "<F12>";
    }

    // Ctrl+letter / Ctrl+symbol. Literal "<" must be wrapped as `<C-lt>`
    // (the special-key form), never `<C-<>`.
    if (ctrl && e.key.length === 1) {
      const k = e.key === "<" ? "lt" : e.key.toLowerCase();
      return `<C-${k}>`;
    }

    // Printable character (covers shift variants naturally via e.key).
    // Literal "<" must be sent as <lt> — nvim's input parser treats raw "<"
    // as the start of a special-key sequence and may eat following bytes,
    // landing the user in unexpected modes (cmdline, etc).
    if (e.key === "<") return "<lt>";
    if (e.key.length === 1) return e.key;

    return "";
  }

  function onKeyDown(e: KeyboardEvent) {
    // IME / dead-key composition: skip while composing. The OS will fire
    // a "real" keydown with the composed character once composition finishes.
    // Without this, dead keys (Spanish acute, tilde, German umlauts) get
    // translated as their bare key and sent prematurely to nvim, corrupting
    // input and sometimes triggering unintended modes like cmdline.
    const native = e.nativeEvent;
    if (native.isComposing || native.keyCode === 229) {
      debugLog("input", `skip composing key=${JSON.stringify(e.key)}`);
      return;
    }

    const input = translateKey(e);
    recordKey(e.key, input, !!nvim);
    if (!nvim) {
      debugLog("input", `dropped (no handle) key=${JSON.stringify(e.key)}`);
      return;
    }
    if (!input) {
      debugLog("input", `untranslated key=${JSON.stringify(e.key)}`);
      return;
    }
    e.preventDefault();
    debugLog("input", `send ${JSON.stringify(input)} (raw=${JSON.stringify(e.key)})`);
    nvim.input(input);
  }

  return { onKeyDown };
}
