import { type Terminal } from "@xterm/xterm";
import { describe, expect, it } from "vitest";

import { extractLastCommandOutput } from "../lib/extractLastCommandOutput";

function createMockTerminal(lines: string[]): Terminal {
  const rows = lines.length;
  return {
    rows,
    buffer: {
      active: {
        baseY: 0,
        cursorY: 0,
        getLine(index: number) {
          if (index < 0 || index >= lines.length) return null;
          return {
            translateToString(_trimRight?: boolean) {
              return lines[index]!;
            },
          };
        },
      },
    },
  } as unknown as Terminal;
}

describe("extractLastCommandOutput", () => {
  it("extracts output between two bash prompts", () => {
    const terminal = createMockTerminal([
      "user@host:~/project$ ls",
      "file1.ts",
      "file2.ts",
      "user@host:~/project$ ",
    ]);
    expect(extractLastCommandOutput(terminal)).toBe("file1.ts\nfile2.ts");
  });

  it("extracts output between two zsh prompts", () => {
    const terminal = createMockTerminal([
      "~/project % echo hello",
      "hello",
      "~/project % ",
    ]);
    expect(extractLastCommandOutput(terminal)).toBe("hello");
  });

  it("extracts output with custom prompt characters", () => {
    const terminal = createMockTerminal([
      "❯ git status",
      "On branch main",
      "nothing to commit",
      "❯ ",
    ]);
    expect(extractLastCommandOutput(terminal)).toBe(
      "On branch main\nnothing to commit",
    );
  });

  it("returns null when terminal is empty", () => {
    const terminal = createMockTerminal([""]);
    expect(extractLastCommandOutput(terminal)).toBeNull();
  });

  it("returns null when no prompts are found", () => {
    const terminal = createMockTerminal(["some random output", "more output"]);
    expect(extractLastCommandOutput(terminal)).toBeNull();
  });

  it("returns output after single prompt when only one prompt exists", () => {
    const terminal = createMockTerminal([
      "user@host:~$ cat file.txt",
      "line 1",
      "line 2",
    ]);
    expect(extractLastCommandOutput(terminal)).toBe("line 1\nline 2");
  });

  it("returns null when command has no output", () => {
    const terminal = createMockTerminal([
      "user@host:~$ touch file.txt",
      "user@host:~$ ",
    ]);
    expect(extractLastCommandOutput(terminal)).toBeNull();
  });

  it("trims trailing empty lines from output", () => {
    const terminal = createMockTerminal([
      "user@host:~$ echo test",
      "test",
      "",
      "",
      "user@host:~$ ",
      "",
      "",
    ]);
    expect(extractLastCommandOutput(terminal)).toBe("test");
  });

  it("handles root prompt (#)", () => {
    const terminal = createMockTerminal([
      "root@server:/# whoami",
      "root",
      "root@server:/# ",
    ]);
    expect(extractLastCommandOutput(terminal)).toBe("root");
  });

  it("handles multiline output from a real command", () => {
    const terminal = createMockTerminal([
      "user@host:~/project$ npm test",
      "",
      " PASS  src/index.test.ts",
      "  ✓ should work (2ms)",
      "",
      "Tests:  1 passed, 1 total",
      "user@host:~/project$ ",
    ]);
    expect(extractLastCommandOutput(terminal)).toBe(
      "\n PASS  src/index.test.ts\n  ✓ should work (2ms)\n\nTests:  1 passed, 1 total",
    );
  });

  it("handles starship/oh-my-zsh ➜ prompt", () => {
    const terminal = createMockTerminal([
      "➜ project git:(main) ls",
      "README.md",
      "src/",
      "➜ project git:(main) ",
    ]);
    expect(extractLastCommandOutput(terminal)).toBe("README.md\nsrc/");
  });
});
