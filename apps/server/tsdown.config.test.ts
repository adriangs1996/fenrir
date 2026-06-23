import { describe, expect, it } from "vitest";

import config from "./tsdown.config.ts";

describe("tsdown config", () => {
  it("builds built-in MCP runners", () => {
    const entries = Array.isArray(config.entry) ? config.entry : [config.entry];
    expect(entries).toContain("src/mcp/browserLabRunner.ts");
    expect(entries).toContain("src/mcp/remoteHostRunner.ts");
    expect(entries).toContain("src/mcp/workflowRunner.ts");
  });
});
