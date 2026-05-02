import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Terminal } from "@xterm/xterm";
import { createStore } from "zustand";
import { terminalThemeFromApp } from "../../terminal/xtermTheme";

interface TerminalMountOptions {
  container: HTMLDivElement;
  onData: (data: string) => void;
}

interface TerminalHandlerState {
  mount: (options: TerminalMountOptions) => void;
  syncOutput: (output: string) => void;
  focus: () => void;
  getViewport: () => { cols: number; rows: number } | null;
  setInputEnabled: (enabled: boolean) => void;
  writeSystemMessage: (message: string) => void;
  dispose: () => void;
}

const isPrintableText = (data: string): boolean =>
  Array.from(data).every((char) => {
    const codePoint = char.codePointAt(0);
    return codePoint !== undefined && codePoint >= 0x20 && codePoint !== 0x7f;
  });

export const terminalHandlerStore = createStore<TerminalHandlerState>(() => {
  let terminal: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let inputDisposable: { dispose: () => void } | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let themeObserver: MutationObserver | null = null;
  let currentContainer: HTMLDivElement | null = null;
  let syncedOutput = "";
  let pendingLocalEcho = "";
  let inputEnabled = true;
  let inputHandler: ((data: string) => void) | null = null;

  const fit = () => {
    try {
      fitAddon?.fit();
    } catch {
      // xterm fit can throw during layout transitions
    }
  };

  const disposeTerminal = () => {
    themeObserver?.disconnect();
    themeObserver = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    inputDisposable?.dispose();
    inputDisposable = null;
    terminal?.dispose();
    terminal = null;
    fitAddon = null;
    currentContainer = null;
    syncedOutput = "";
    pendingLocalEcho = "";
    inputEnabled = true;
    inputHandler = null;
  };

  const resetOutput = (output: string) => {
    if (!terminal) {
      syncedOutput = output;
      pendingLocalEcho = "";
      return;
    }
    terminal.write("\u001bc");
    if (output.length > 0) {
      terminal.write(output);
    }
    syncedOutput = output;
    pendingLocalEcho = "";
  };

  const dropLastEchoCharacter = () => {
    if (pendingLocalEcho.length === 0) {
      return;
    }
    const chars = Array.from(pendingLocalEcho);
    chars.pop();
    pendingLocalEcho = chars.join("");
  };

  const applyLocalEcho = (data: string) => {
    if (!terminal || !inputEnabled) {
      return;
    }

    if (data === "\x7f") {
      if (pendingLocalEcho.length === 0) {
        return;
      }
      dropLastEchoCharacter();
      terminal.write("\b \b");
      return;
    }

    if (data === "\t" || isPrintableText(data)) {
      terminal.write(data);
      pendingLocalEcho += data;
    }
  };

  const consumePendingLocalEcho = (chunk: string) => {
    let remainingChunk = chunk;

    while (pendingLocalEcho.length > 0 && remainingChunk.length > 0) {
      if (remainingChunk.startsWith(pendingLocalEcho)) {
        remainingChunk = remainingChunk.slice(pendingLocalEcho.length);
        pendingLocalEcho = "";
        break;
      }

      if (pendingLocalEcho.startsWith(remainingChunk)) {
        pendingLocalEcho = pendingLocalEcho.slice(remainingChunk.length);
        remainingChunk = "";
        break;
      }

      let sharedPrefixLength = 0;
      const maxPrefixLength = Math.min(pendingLocalEcho.length, remainingChunk.length);
      while (
        sharedPrefixLength < maxPrefixLength &&
        pendingLocalEcho[sharedPrefixLength] === remainingChunk[sharedPrefixLength]
      ) {
        sharedPrefixLength += 1;
      }

      if (sharedPrefixLength === 0) {
        return {
          remainingChunk,
          resetRequired: true,
        };
      }

      pendingLocalEcho = pendingLocalEcho.slice(sharedPrefixLength);
      remainingChunk = remainingChunk.slice(sharedPrefixLength);
    }

    return {
      remainingChunk,
      resetRequired: false,
    };
  };

  return {
    mount: ({ container, onData }) => {
      if (terminal && currentContainer === container) {
        inputHandler = onData;
        terminal.options.disableStdin = !inputEnabled;
        fit();
        return;
      }

      disposeTerminal();

      currentContainer = container;
      inputHandler = onData;

      const nextFitAddon = new FitAddon();
      const unicode11Addon = new Unicode11Addon();
      const nextTerminal = new Terminal({
        allowProposedApi: true,
        cursorBlink: true,
        disableStdin: !inputEnabled,
        scrollback: 5_000,
        theme: terminalThemeFromApp(container),
      });

      nextTerminal.loadAddon(nextFitAddon);
      nextTerminal.loadAddon(unicode11Addon);
      nextTerminal.unicode.activeVersion = "11";
      nextTerminal.open(container);

      terminal = nextTerminal;
      fitAddon = nextFitAddon;

      inputDisposable = nextTerminal.onData((data) => {
        applyLocalEcho(data);
        inputHandler?.(data);
      });

      resizeObserver = new ResizeObserver(() => {
        const activeTerminal = terminal;
        if (!activeTerminal) return;
        const wasAtBottom =
          activeTerminal.buffer.active.viewportY >= activeTerminal.buffer.active.baseY;
        fit();
        if (wasAtBottom) {
          activeTerminal.scrollToBottom();
        }
      });
      resizeObserver.observe(container);

      themeObserver = new MutationObserver(() => {
        const activeTerminal = terminal;
        if (!activeTerminal) return;
        activeTerminal.options.theme = terminalThemeFromApp(currentContainer);
        activeTerminal.refresh(0, Math.max(activeTerminal.rows - 1, 0));
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });

      fit();
    },
    syncOutput: (output: string) => {
      const activeTerminal = terminal;
      if (!activeTerminal) {
        syncedOutput = output;
        pendingLocalEcho = "";
        return;
      }
      if (output === syncedOutput) {
        return;
      }
      if (!output.startsWith(syncedOutput)) {
        resetOutput(output);
        return;
      }

      const chunk = output.slice(syncedOutput.length);
      syncedOutput = output;

      const { remainingChunk, resetRequired } = consumePendingLocalEcho(chunk);
      if (resetRequired) {
        resetOutput(output);
        return;
      }

      if (remainingChunk.length > 0) {
        activeTerminal.write(remainingChunk);
      }
    },
    focus: () => {
      terminal?.focus();
    },
    getViewport: () => {
      if (!terminal) {
        return null;
      }
      return {
        cols: terminal.cols,
        rows: terminal.rows,
      };
    },
    setInputEnabled: (enabled: boolean) => {
      inputEnabled = enabled;
      if (terminal) {
        terminal.options.disableStdin = !enabled;
      }
    },
    writeSystemMessage: (message: string) => {
      terminal?.write(`\r\n[terminal] ${message}\r\n`);
    },
    dispose: () => {
      disposeTerminal();
    },
  };
});
