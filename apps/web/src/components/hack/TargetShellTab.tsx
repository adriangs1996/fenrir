import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { buildTerminalFontFamily } from "@fenrir/contracts";
import { useMetasploitSessionTerminalStore } from "../../metasploitSessionTerminalStore";
import { useSettings } from "../../hooks/useSettings";

interface TargetShellTabProps {
  sessionId: string;
}

export function TargetShellTab({ sessionId }: TargetShellTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const serializeAddonRef = useRef<SerializeAddon | null>(null);
  const { terminalFontFamily, terminalFontSize, terminalLineHeight } = useSettings((s) => ({
    terminalFontFamily: s.terminalFontFamily,
    terminalFontSize: s.terminalFontSize,
    terminalLineHeight: s.terminalLineHeight,
  }));

  // Reactively update terminal font when settings change
  useEffect(() => {
    const activeTerminal = terminalRef.current;
    const activeFitAddon = fitAddonRef.current;
    if (!activeTerminal) return;
    activeTerminal.options.fontFamily = buildTerminalFontFamily(terminalFontFamily);
    activeTerminal.options.fontSize = terminalFontSize;
    activeTerminal.options.lineHeight = terminalLineHeight;
    try {
      activeFitAddon?.fit();
    } catch {
      // fit may throw during transitions
    }
  }, [terminalFontFamily, terminalFontSize, terminalLineHeight]);

  useEffect(() => {
    if (!containerRef.current) return;

    const mount = containerRef.current;
    const isDark = document.documentElement.classList.contains("dark");

    const terminal = new Terminal({
      cursorBlink: true,
      lineHeight: terminalLineHeight,
      fontSize: terminalFontSize,
      scrollback: 5_000,
      fontFamily: buildTerminalFontFamily(terminalFontFamily),
      theme: {
        background: isDark ? "rgb(14, 18, 24)" : "rgb(255, 255, 255)",
        foreground: isDark ? "rgb(237, 241, 247)" : "rgb(28, 33, 41)",
        cursor: isDark ? "rgb(180, 203, 255)" : "rgb(38, 56, 78)",
      },
    });

    const fitAddon = new FitAddon();
    const serializeAddon = new SerializeAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(serializeAddon);
    terminal.open(mount);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    serializeAddonRef.current = serializeAddon;

    // Handle user input -- send to session via RPC
    const inputDisposable = terminal.onData((_data) => {
      // Will be wired to environmentApi.metasploit.sessionWrite
      // once the RPC bridge for hack sessions is connected.
    });

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // Ignore fit errors during unmount
      }
    });
    resizeObserver.observe(mount);

    // Theme sync
    const themeObserver = new MutationObserver(() => {
      const activeTerminal = terminalRef.current;
      if (!activeTerminal) return;
      const dark = document.documentElement.classList.contains("dark");
      activeTerminal.options.theme = {
        background: dark ? "rgb(14, 18, 24)" : "rgb(255, 255, 255)",
        foreground: dark ? "rgb(237, 241, 247)" : "rgb(28, 33, 41)",
        cursor: dark ? "rgb(180, 203, 255)" : "rgb(38, 56, 78)",
      };
      activeTerminal.refresh(0, activeTerminal.rows - 1);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    return () => {
      inputDisposable.dispose();
      themeObserver.disconnect();
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      serializeAddonRef.current = null;
    };
  }, [sessionId]);

  // Subscribe to session output from the terminal store
  useEffect(() => {
    let lastId = 0;

    const unsubscribe = useMetasploitSessionTerminalStore.subscribe(
      (state) => {
        const entries = state.entries.filter(
          (e) => e.sessionId === sessionId && e.id > lastId,
        );
        for (const entry of entries) {
          terminalRef.current?.write(entry.data);
          lastId = entry.id;
        }
      },
    );

    return () => unsubscribe();
  }, [sessionId]);

  return <div ref={containerRef} className="h-full w-full" />;
}
