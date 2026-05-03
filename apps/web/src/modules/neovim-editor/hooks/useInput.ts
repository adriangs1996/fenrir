import type { KeyboardEvent } from "react";

export function useInput(nvim: any) {
  function translateKey(e: KeyboardEvent): string {
    const ctrl = e.ctrlKey && !e.metaKey;
    const shift = e.shiftKey;

    // Named keys
    switch (e.key) {
      case "Escape":       return "<Esc>";
      case "Enter":        return "<CR>";
      case "Backspace":    return "<BS>";
      case "Delete":       return "<Del>";
      case "Tab":          return shift ? "<S-Tab>" : "<Tab>";
      case "ArrowUp":      return ctrl ? "<C-Up>"    : "<Up>";
      case "ArrowDown":    return ctrl ? "<C-Down>"  : "<Down>";
      case "ArrowLeft":    return ctrl ? "<C-Left>"  : "<Left>";
      case "ArrowRight":   return ctrl ? "<C-Right>" : "<Right>";
      case "Home":         return "<Home>";
      case "End":          return "<End>";
      case "PageUp":       return "<PageUp>";
      case "PageDown":     return "<PageDown>";
      case "Insert":       return "<Insert>";
      case "F1":  return "<F1>";  case "F2":  return "<F2>";
      case "F3":  return "<F3>";  case "F4":  return "<F4>";
      case "F5":  return "<F5>";  case "F6":  return "<F6>";
      case "F7":  return "<F7>";  case "F8":  return "<F8>";
      case "F9":  return "<F9>";  case "F10": return "<F10>";
      case "F11": return "<F11>"; case "F12": return "<F12>";
    }

    // Ctrl+letter / Ctrl+symbol
    if (ctrl && e.key.length === 1) return `<C-${e.key.toLowerCase()}>`;

    // Printable character (covers shift variants naturally via e.key)
    if (e.key.length === 1) return e.key;

    return "";
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!nvim) return;
    const input = translateKey(e);
    if (!input) return;
    e.preventDefault();
    nvim.input(input);
  }

  return { onKeyDown };
}
