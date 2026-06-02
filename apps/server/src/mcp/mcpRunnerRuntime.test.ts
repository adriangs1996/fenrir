import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { getElectronNodeRunnerEnv, resolveMcpRunnerPath } from "./mcpRunnerRuntime.ts";

describe("mcpRunnerRuntime", () => {
  it("resolves a sibling TypeScript runner in development layouts", () => {
    const root = mkdtempSync(join(tmpdir(), "fenrir-mcp-runner-dev-"));
    try {
      const moduleFile = join(root, "remoteHostMcpRuntime.ts");
      const runnerFile = join(root, "remoteHostRunner.ts");
      writeFileSync(moduleFile, "export {};\n");
      writeFileSync(runnerFile, "export {};\n");

      expect(resolveMcpRunnerPath(pathToFileURL(moduleFile).href, "remoteHostRunner")).toBe(
        runnerFile,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves a built runner from the nested dist/mcp layout", () => {
    const root = mkdtempSync(join(tmpdir(), "fenrir-mcp-runner-dist-"));
    try {
      const moduleFile = join(root, "browserLabMcpRuntime.js");
      const mcpDir = join(root, "mcp");
      const runnerFile = join(mcpDir, "browserLabRunner.mjs");
      mkdirSync(mcpDir, { recursive: true });
      writeFileSync(moduleFile, "export {};\n");
      writeFileSync(runnerFile, "export {};\n");

      expect(resolveMcpRunnerPath(pathToFileURL(moduleFile).href, "browserLabRunner")).toBe(
        runnerFile,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws when the runner artifact is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "fenrir-mcp-runner-missing-"));
    try {
      const moduleFile = join(root, "remoteHostMcpRuntime.js");
      writeFileSync(moduleFile, "export {};\n");

      expect(() =>
        resolveMcpRunnerPath(pathToFileURL(moduleFile).href, "remoteHostRunner"),
      ).toThrow(/Could not find MCP runner 'remoteHostRunner'/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("forwards ELECTRON_RUN_AS_NODE when present", () => {
    const previous = process.env.ELECTRON_RUN_AS_NODE;
    process.env.ELECTRON_RUN_AS_NODE = "1";
    try {
      expect(getElectronNodeRunnerEnv()).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
    } finally {
      if (previous === undefined) {
        delete process.env.ELECTRON_RUN_AS_NODE;
      } else {
        process.env.ELECTRON_RUN_AS_NODE = previous;
      }
    }
  });
});
