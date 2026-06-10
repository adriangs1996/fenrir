import type { Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import { refreshTerminalFontMetrics } from "./xtermFontRefresh";

type TestTerminal = Terminal & {
  _core?: {
    _charSizeService?: {
      measure?: ReturnType<typeof vi.fn>;
    };
    _renderService?: {
      clear?: ReturnType<typeof vi.fn>;
      handleCharSizeChanged?: ReturnType<typeof vi.fn>;
    };
  };
  clearTextureAtlas?: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  scrollToBottom: ReturnType<typeof vi.fn>;
};

function createTerminalMock(options?: { atBottom?: boolean }): TestTerminal {
  const atBottom = options?.atBottom ?? true;
  return {
    buffer: {
      active: {
        viewportY: atBottom ? 8 : 3,
        baseY: 8,
      },
    },
    rows: 24,
    refresh: vi.fn(),
    scrollToBottom: vi.fn(),
    clearTextureAtlas: vi.fn(),
    _core: {
      _charSizeService: {
        measure: vi.fn(),
      },
      _renderService: {
        clear: vi.fn(),
        handleCharSizeChanged: vi.fn(),
      },
    },
  } as unknown as TestTerminal;
}

describe("refreshTerminalFontMetrics", () => {
  it("forces xterm to re-measure font metrics and refresh rows", () => {
    const terminal = createTerminalMock();
    const fitAddon = { fit: vi.fn() };
    const webglAddon = { clearTextureAtlas: vi.fn() };

    refreshTerminalFontMetrics(terminal, fitAddon, webglAddon);

    expect(terminal._core?._charSizeService?.measure).toHaveBeenCalledTimes(1);
    expect(terminal._core?._renderService?.handleCharSizeChanged).toHaveBeenCalledTimes(1);
    expect(terminal._core?._renderService?.clear).toHaveBeenCalledTimes(1);
    expect(webglAddon.clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(terminal.clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(fitAddon.fit).toHaveBeenCalledTimes(1);
    expect(terminal.refresh).toHaveBeenCalledWith(0, 23);
    expect(terminal.scrollToBottom).toHaveBeenCalledTimes(1);
  });

  it("preserves non-bottom scroll position while refreshing", () => {
    const terminal = createTerminalMock({ atBottom: false });

    refreshTerminalFontMetrics(terminal, null);

    expect(terminal.refresh).toHaveBeenCalledWith(0, 23);
    expect(terminal.scrollToBottom).not.toHaveBeenCalled();
  });
});
