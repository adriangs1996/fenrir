import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { CursorSettings } from "@fenrir/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import {
  CURSOR_CLI_INSTALLATION_DOCS_URL,
  checkCursorProviderStatus,
  formatCursorAcpSetupFailureMessage,
  formatCursorCliHealthCheckFailure,
  parseCursorAuthStatusFromOutput,
} from "./CursorProvider.ts";

const baseCursorSettings: CursorSettings = {
  enabled: true,
  binaryPath: "agent",
  apiEndpoint: "",
  customModels: [],
};

async function withTempExecutable(
  script: string,
  run: (binaryPath: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "fenrir-cursor-provider-"));
  const binaryPath = join(dir, "agent");
  try {
    await writeFile(binaryPath, script, "utf8");
    await chmod(binaryPath, 0o755);
    await run(binaryPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("CursorProvider diagnostics", () => {
  it("reports actionable install guidance when the Cursor CLI command is missing", async () => {
    const binaryPath = "/definitely/not/installed/fenrir-cursor-agent";
    const provider = await Effect.runPromise(
      checkCursorProviderStatus(
        {
          ...baseCursorSettings,
          binaryPath,
        },
        process.cwd(),
      ),
    );

    expect(provider).toMatchObject({
      installed: false,
      status: "error",
      auth: { status: "unknown" },
    });
    expect(provider.message).toContain(`Cursor CLI command \`${binaryPath}\` was not found.`);
    expect(provider.message).toContain(CURSOR_CLI_INSTALLATION_DOCS_URL);
  });

  it("sanitizes nonzero Cursor CLI health-check output", async () => {
    await withTempExecutable(
      [
        "#!/usr/bin/env node",
        "if (process.argv.includes('--version')) {",
        "  console.error('secret-token=cursor-secret');",
        "  process.exit(7);",
        "}",
        "process.exit(0);",
        "",
      ].join("\n"),
      async (binaryPath) => {
        const provider = await Effect.runPromise(
          checkCursorProviderStatus(
            {
              ...baseCursorSettings,
              binaryPath,
            },
            process.cwd(),
          ),
        );

        expect(provider).toMatchObject({
          installed: true,
          status: "error",
          auth: { status: "unknown" },
        });
        expect(provider.message).toContain("Cursor CLI is installed but failed the health check.");
        expect(provider.message).toContain("`agent --version` exited with code 7.");
        expect(provider.message).toContain(CURSOR_CLI_INSTALLATION_DOCS_URL);
        expect(provider.message).not.toContain("cursor-secret");
      },
    );
  });

  it("formats timeout health-check diagnostics without command output", () => {
    const message = formatCursorCliHealthCheckFailure({ timedOut: true });

    expect(message).toContain("Timed out while running `agent --version`.");
    expect(message).toContain(CURSOR_CLI_INSTALLATION_DOCS_URL);
  });

  it("parses unauthenticated Cursor status output with existing semantics", () => {
    expect(
      parseCursorAuthStatusFromOutput({
        stdout: "",
        stderr: "not authenticated",
        code: 1,
      }),
    ).toEqual({
      status: "error",
      auth: { status: "unauthenticated" },
      message:
        "Cursor CLI is not authenticated. Run `agent login` or set `CURSOR_API_KEY` and try again.",
    });
  });

  it("sanitizes unknown Cursor auth-status failures", () => {
    const parsed = parseCursorAuthStatusFromOutput({
      stdout: "",
      stderr: "request failed with token=cursor-secret",
      code: 42,
    });

    expect(parsed).toEqual({
      status: "warning",
      auth: { status: "unknown" },
      message: "Could not verify Cursor authentication status. `agent status` exited with code 42.",
    });
    expect(parsed.message).not.toContain("cursor-secret");
  });

  it("formats actionable ACP setup guidance", () => {
    const message = formatCursorAcpSetupFailureMessage();

    expect(message).toContain("Cursor ACP setup failed.");
    expect(message).toContain(CURSOR_CLI_INSTALLATION_DOCS_URL);
    expect(message).toContain("Check server logs for ACP details.");
  });
});
