import { describe, expect, it } from "@effect/vitest";

import {
  parseTmuxGlobalOptionValue,
  parseTmuxListKeysOutput,
  parseTmuxPrefixKey,
  parseTmuxRepeatTimeMs,
} from "../Layers/TmuxKeymapParser";

describe("parseTmuxListKeysOutput", () => {
  it("parses plain prefix-table bindings with multi-word commands verbatim", () => {
    const output = [
      'bind-key    -T prefix       s                         split-window -h -c "#{pane_current_path}"',
      'bind-key    -T prefix       t                         split-window -v -c "#{pane_current_path}"',
      "bind-key    -T prefix       f                         resize-pane -Z",
    ].join("\n");

    const bindings = parseTmuxListKeysOutput(output);

    expect(bindings).toEqual([
      {
        table: "prefix",
        key: "s",
        repeat: false,
        command: 'split-window -h -c "#{pane_current_path}"',
      },
      {
        table: "prefix",
        key: "t",
        repeat: false,
        command: 'split-window -v -c "#{pane_current_path}"',
      },
      { table: "prefix", key: "f", repeat: false, command: "resize-pane -Z" },
    ]);
  });

  it("unescapes backslash-escaped keys and keeps escaped command separators verbatim", () => {
    const output = [
      'bind-key    -T prefix       \\"                        split-window -c "#{pane_current_path}"',
      "bind-key    -T prefix       \\%                        split-window -h",
      "bind-key    -T prefix       \\;                        last-pane",
      "bind-key    -T copy-mode    MouseDrag1Pane            select-pane \\; send-keys -X begin-selection",
    ].join("\n");

    const bindings = parseTmuxListKeysOutput(output);

    expect(bindings.map((binding) => binding.key)).toEqual(['"', "%", ";", "MouseDrag1Pane"]);
    // The command remainder must stay verbatim, including the escaped `\;`
    // chaining separator: the client decides what to do with it.
    expect(bindings[3]?.command).toBe("select-pane \\; send-keys -X begin-selection");
  });

  it("unquotes double-quoted keys such as M-{ and keys containing spaces", () => {
    const output = [
      'bind-key    -T copy-mode    "M-{"                     send-keys -X previous-paragraph',
      'bind-key    -T copy-mode    "M-}"                     send-keys -X next-paragraph',
    ].join("\n");

    const bindings = parseTmuxListKeysOutput(output);

    expect(bindings).toEqual([
      { table: "copy-mode", key: "M-{", repeat: false, command: "send-keys -X previous-paragraph" },
      { table: "copy-mode", key: "M-}", repeat: false, command: "send-keys -X next-paragraph" },
    ]);
  });

  it("captures the -r repeat flag", () => {
    const output = [
      "bind-key -r -T prefix       C-h                       resize-pane -L 5",
      "bind-key -r -T prefix       C-j                       resize-pane -D 5",
      "bind-key    -T prefix       h                         select-pane -L",
    ].join("\n");

    const bindings = parseTmuxListKeysOutput(output);

    expect(bindings[0]).toEqual({
      table: "prefix",
      key: "C-h",
      repeat: true,
      command: "resize-pane -L 5",
    });
    expect(bindings[1]?.repeat).toBe(true);
    expect(bindings[2]?.repeat).toBe(false);
  });

  it("keeps root and custom table names raw", () => {
    const output = [
      "bind-key    -T root         M-1                       select-window -t :=1",
      "bind-key    -T root         C-i                       run-shell ~/bin/screenshot.sh",
      "bind-key    -T copy-mode-vi v                         send-keys -X begin-selection",
      "bind-key    -T my-table     x                         kill-pane",
    ].join("\n");

    const bindings = parseTmuxListKeysOutput(output);

    expect(bindings.map((binding) => binding.table)).toEqual([
      "root",
      "root",
      "copy-mode-vi",
      "my-table",
    ]);
  });

  it("keeps single-line display-menu payloads intact without corrupting neighbours", () => {
    const menuCommand =
      'display-menu -T "#[align=centre]#{window_index}:#{window_name}" -x W -y W ' +
      '"#{?#{>:#{session_windows},1},,-}Swap Left" l { swap-window -t :-1 } ' +
      '\'\' Kill X { kill-window } Rename n { command-prompt -F -I "#W" { rename-window -t "#{window_id}" "%%" } }';
    const output = [
      "bind-key    -T prefix       <                         " + menuCommand,
      'bind-key    -T prefix       c                         new-window -c "#{pane_current_path}"',
    ].join("\n");

    const bindings = parseTmuxListKeysOutput(output);

    expect(bindings).toHaveLength(2);
    expect(bindings[0]?.key).toBe("<");
    expect(bindings[0]?.command).toBe(menuCommand);
    expect(bindings[1]).toEqual({
      table: "prefix",
      key: "c",
      repeat: false,
      command: 'new-window -c "#{pane_current_path}"',
    });
  });

  it("folds multi-line command payloads into the owning binding", () => {
    const output = [
      "bind-key    -T prefix       m                         display-menu -T menu {",
      '    "Item One" 1 { select-window -t :=1 }',
      '    "Item Two" 2 { select-window -t :=2 }',
      "}",
      "bind-key    -T prefix       n                         new-window",
    ].join("\n");

    const bindings = parseTmuxListKeysOutput(output);

    expect(bindings).toHaveLength(2);
    expect(bindings[0]?.command).toBe(
      [
        "display-menu -T menu {",
        '    "Item One" 1 { select-window -t :=1 }',
        '    "Item Two" 2 { select-window -t :=2 }',
        "}",
      ].join("\n"),
    );
    // The entry after the multi-line payload must parse cleanly.
    expect(bindings[1]).toEqual({
      table: "prefix",
      key: "n",
      repeat: false,
      command: "new-window",
    });
  });

  it("skips malformed lines and leading continuation noise", () => {
    const output = [
      "stray output before any binding",
      "bind-key    -T prefix",
      "bind-key    -T prefix       q                         display-panes",
    ].join("\n");

    const bindings = parseTmuxListKeysOutput(output);

    expect(bindings).toEqual([
      { table: "prefix", key: "q", repeat: false, command: "display-panes" },
    ]);
  });

  it("handles empty output and trailing newlines", () => {
    expect(parseTmuxListKeysOutput("")).toEqual([]);
    expect(parseTmuxListKeysOutput("\n")).toEqual([]);
    expect(parseTmuxListKeysOutput("bind-key -T prefix z resize-pane -Z\n")).toEqual([
      { table: "prefix", key: "z", repeat: false, command: "resize-pane -Z" },
    ]);
  });
});

describe("show-options parsing", () => {
  it("extracts option values", () => {
    expect(parseTmuxGlobalOptionValue("prefix C-s", "prefix")).toBe("C-s");
    expect(parseTmuxGlobalOptionValue("repeat-time 500", "repeat-time")).toBe("500");
    expect(parseTmuxGlobalOptionValue("", "prefix")).toBeNull();
  });

  it("does not match options that merely share a prefix", () => {
    expect(parseTmuxGlobalOptionValue("prefix2 C-a", "prefix")).toBeNull();
  });

  it("maps unset prefix2 (None or missing) to null", () => {
    expect(parseTmuxPrefixKey("prefix2 None", "prefix2")).toBeNull();
    expect(parseTmuxPrefixKey("", "prefix2")).toBeNull();
    expect(parseTmuxPrefixKey("prefix2 C-a", "prefix2")).toBe("C-a");
    expect(parseTmuxPrefixKey("prefix C-s", "prefix")).toBe("C-s");
  });

  it("parses repeat-time in milliseconds and rejects garbage", () => {
    expect(parseTmuxRepeatTimeMs("repeat-time 500")).toBe(500);
    expect(parseTmuxRepeatTimeMs("repeat-time 0")).toBe(0);
    expect(parseTmuxRepeatTimeMs("repeat-time nope")).toBeNull();
    expect(parseTmuxRepeatTimeMs("")).toBeNull();
  });
});
