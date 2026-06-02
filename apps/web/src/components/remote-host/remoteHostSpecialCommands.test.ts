import { describe, expect, it } from "vitest";

import { resolveRemoteHostSpecialCommand } from "./remoteHostSpecialCommands";

describe("resolveRemoteHostSpecialCommand", () => {
  it("resolves clear aliases that should be handled locally", () => {
    expect(resolveRemoteHostSpecialCommand("clear")).toEqual({ type: "clear-terminal" });
    expect(resolveRemoteHostSpecialCommand(" CLS ")).toEqual({ type: "clear-terminal" });
    expect(resolveRemoteHostSpecialCommand("clean")).toEqual({ type: "clear-terminal" });
  });

  it("does not intercept remote commands that only contain a special command name", () => {
    expect(resolveRemoteHostSpecialCommand("clear -x")).toBeNull();
    expect(resolveRemoteHostSpecialCommand("clean build")).toBeNull();
    expect(resolveRemoteHostSpecialCommand("echo clear")).toBeNull();
    expect(resolveRemoteHostSpecialCommand("")).toBeNull();
  });
});
