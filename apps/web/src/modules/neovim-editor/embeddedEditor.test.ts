import { describe, expect, it } from "vitest";
import { resolveActiveEmbeddedEditor } from "./embeddedEditor";

describe("resolveActiveEmbeddedEditor", () => {
  it("uses the preferred embedded editor when available", () => {
    expect(
      resolveActiveEmbeddedEditor({
        preferredEditor: "vscode",
        nvimReady: true,
        vscodeReady: true,
      }),
    ).toBe("vscode");
  });

  it("falls back to neovim when VS Code is preferred but unavailable", () => {
    expect(
      resolveActiveEmbeddedEditor({
        preferredEditor: "vscode",
        nvimReady: true,
        vscodeReady: false,
      }),
    ).toBe("neovim");
  });

  it("falls back to VS Code when neovim is preferred but unavailable", () => {
    expect(
      resolveActiveEmbeddedEditor({
        preferredEditor: "neovim",
        nvimReady: false,
        vscodeReady: true,
      }),
    ).toBe("vscode");
  });
});
