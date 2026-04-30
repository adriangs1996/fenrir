import { describe, expect, it } from "vitest";

import {
  extractProviderChangedFiles,
  extractProviderToolCommand,
  formatProviderActivityLogDisplay,
  stripTrailingExitCode,
} from "./providerActivityLog";

describe("providerActivityLog", () => {
  it("unwraps shell wrappers when extracting tool commands", () => {
    expect(
      extractProviderToolCommand({
        itemType: "command_execution",
        detail:
          '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoLogo -NoProfile -Command \'rg -n -F "new Date()" .\' <exited with exit code 0>',
      }),
    ).toEqual({
      command: 'rg -n -F "new Date()" .',
      rawCommand: `"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoLogo -NoProfile -Command 'rg -n -F "new Date()" .'`,
    });
  });

  it("extracts changed files from nested tool payloads", () => {
    expect(
      extractProviderChangedFiles({
        data: {
          item: {
            changes: [
              { path: "apps/web/src/components/ChatView.tsx" },
              { filename: "apps/web/src/session-logic.ts" },
            ],
          },
        },
      }),
    ).toEqual(["apps/web/src/components/ChatView.tsx", "apps/web/src/session-logic.ts"]);
  });

  it("formats command tool activities with concrete details", () => {
    expect(
      formatProviderActivityLogDisplay({
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          title: "bash",
          detail: '{ "dev": "vite dev --port 3000" } <exited with exit code 0>',
          data: {
            item: {
              command: ["bun", "run", "dev"],
            },
          },
        },
      }),
    ).toEqual({
      title: "bun run dev",
      bodyText: 'Type: Command\nCommand: bun run dev\n\n{ "dev": "vite dev --port 3000" }',
      copyText:
        'bun run dev\n\nType: Command\nCommand: bun run dev\n\n{ "dev": "vite dev --port 3000" }',
    });
  });

  it("strips trailing exit code markers from detail text", () => {
    expect(stripTrailingExitCode("bun run lint <exited with exit code 0>")).toEqual({
      output: "bun run lint",
      exitCode: 0,
    });
  });
});
