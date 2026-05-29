import { describe, expect, it } from "vitest";

import { stripActionRunControlSequences } from "./actionRunStore";
import { buildTmuxActionCommand } from "./actionRunCommand";

describe("stripActionRunControlSequences", () => {
  it("removes ANSI control sequences from compact action output", () => {
    expect(stripActionRunControlSequences("\u001b[32mPassed\u001b[0m\u001b[K\rDone")).toBe(
      "Passed\nDone",
    );
  });
});

describe("buildTmuxActionCommand", () => {
  it("clears inherited tmux environment before running the action", () => {
    const command = buildTmuxActionCommand({
      runId: "run-1",
      name: "Quit Projects",
      command: "./projects down",
    });

    expect(command).toContain("unset TMUX TMUX_PANE");
    expect(command.indexOf("unset TMUX TMUX_PANE")).toBeLessThan(command.indexOf("sh -lc"));
  });
});
