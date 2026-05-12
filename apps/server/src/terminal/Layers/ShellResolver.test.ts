import { describe, expect, it } from "vitest";

import { makeShellResolver } from "./ShellResolver";

describe("makeShellResolver", () => {
  it("prefers the user login shell when SHELL is missing on macOS-style launches", () => {
    const previousShell = process.env.SHELL;
    delete process.env.SHELL;

    try {
      const resolver = makeShellResolver({
        userShell: "/bin/zsh",
      });

      expect(resolver.resolve().slice(0, 3)).toEqual([
        { shell: "/bin/zsh", args: ["-o", "nopromptsp"] },
        { shell: "/bin/bash" },
        { shell: "/bin/sh" },
      ]);
    } finally {
      if (previousShell === undefined) {
        delete process.env.SHELL;
      } else {
        process.env.SHELL = previousShell;
      }
    }
  });

  it("keeps an explicitly configured shell ahead of user-shell fallbacks", () => {
    const resolver = makeShellResolver({
      shellResolver: () => "/opt/homebrew/bin/fish",
      userShell: "/bin/zsh",
    });

    expect(resolver.resolve().slice(0, 2)).toEqual([
      { shell: "/opt/homebrew/bin/fish" },
      { shell: "/bin/zsh", args: ["-o", "nopromptsp"] },
    ]);
  });
});
