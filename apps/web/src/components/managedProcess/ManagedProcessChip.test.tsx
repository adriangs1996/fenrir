import type {
  ManagedProcess,
  ManagedProcessInstance,
  ManagedProcessInstanceStatus,
} from "@fenrir/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ManagedProcessChip } from "./ManagedProcessChip";

// ---------- Stub globals ----------

beforeAll(() => {
  vi.stubGlobal("window", { location: { hostname: "localhost" } });
});

// ---------- Factories ----------

function makeDef(overrides?: Partial<ManagedProcess>): ManagedProcess {
  return {
    id: "def-1",
    name: "TestProcess",
    command: "echo test",
    icon: "play",
    scope: "project",
    cwd: null,
    env: {},
    proxy: null,
    readiness: { kind: "none" },
    autoRestart: null,
    ...overrides,
  } as ManagedProcess;
}

function makeInstance(overrides?: Partial<ManagedProcessInstance>): ManagedProcessInstance {
  return {
    instanceId: "inst-1",
    projectId: "proj-1",
    processDefId: "def-1",
    worktreePath: null,
    scope: "project",
    status: "running",
    ready: true,
    executor: "direct",
    url: { estimate: null, confirmed: null },
    startedAt: "2024-01-01T00:00:00Z",
    stoppedAt: null,
    exitCode: null,
    exitSignal: null,
    restartAttempt: 0,
    lastError: null,
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  } as ManagedProcessInstance;
}

// Mock environment connection for RPC calls
vi.mock("~/environments/runtime", () => ({
  readEnvironmentConnection: () => null,
}));

const defaultProps = {
  projectId: "proj-1" as ManagedProcessInstance["projectId"],
  environmentId: "env-1" as unknown as ManagedProcessInstance["projectId"] extends string
    ? never
    : never,
  currentWorktreePath: null,
  onOpenLogs: () => {},
};

// ---------- State snapshot tests ----------

describe("ManagedProcessChip", () => {
  describe("state snapshots", () => {
    const stateMatrix: Array<{
      label: string;
      status: ManagedProcessInstanceStatus;
      ready: boolean;
      exitCode: number | null;
      expectedTexts: string[];
      unexpectedTexts: string[];
    }> = [
      {
        label: "idle (no instance)",
        status: "idle",
        ready: false,
        exitCode: null,
        expectedTexts: ["TestProcess", "Start"],
        unexpectedTexts: ["Stop", "Restart", "Logs"],
      },
      {
        label: "starting",
        status: "starting",
        ready: false,
        exitCode: null,
        expectedTexts: ["TestProcess", "Cancel", "Logs"],
        unexpectedTexts: ["Start", "Stop", "Restart"],
      },
      {
        label: "running not-ready",
        status: "running",
        ready: false,
        exitCode: null,
        expectedTexts: ["TestProcess", "Stop", "Restart", "Logs"],
        unexpectedTexts: ["Start"],
      },
      {
        label: "running ready",
        status: "running",
        ready: true,
        exitCode: null,
        expectedTexts: ["TestProcess", "Stop", "Restart", "Logs"],
        unexpectedTexts: ["Start"],
      },
      {
        label: "stopping",
        status: "stopping",
        ready: false,
        exitCode: null,
        expectedTexts: ["TestProcess", "Force kill", "Logs"],
        unexpectedTexts: ["Start", "Stop", "Restart"],
      },
      {
        label: "stopped",
        status: "stopped",
        ready: false,
        exitCode: 0,
        expectedTexts: ["TestProcess", "Start"],
        unexpectedTexts: ["Stop", "Restart", "Force kill", "Logs"],
      },
      {
        label: "crashed",
        status: "crashed",
        ready: false,
        exitCode: 1,
        expectedTexts: ["TestProcess", "Restart", "exit 1"],
        unexpectedTexts: ["Stop", "Force kill", "Start"],
      },
    ];

    it.each(stateMatrix)(
      "renders $label state correctly",
      ({ status, ready, exitCode, expectedTexts, unexpectedTexts }) => {
        const def = makeDef();
        const instance = status === "idle" ? null : makeInstance({ status, ready, exitCode });

        const markup = renderToStaticMarkup(
          <ManagedProcessChip {...defaultProps} definition={def} instance={instance} />,
        );

        for (const text of expectedTexts) {
          expect(markup).toContain(text);
        }
        for (const text of unexpectedTexts) {
          expect(markup).not.toContain(text);
        }
      },
    );
  });

  describe("URL rendering", () => {
    it("renders same-host URL as a link when proxy is portless", () => {
      const def = makeDef({ proxy: { kind: "portless" } });
      const instance = makeInstance({
        url: { estimate: null, confirmed: "http://localhost:3000" },
      });

      const markup = renderToStaticMarkup(
        <ManagedProcessChip {...defaultProps} definition={def} instance={instance} />,
      );

      expect(markup).toContain("http://localhost:3000");
      expect(markup).toContain("href=");
    });

    it("renders remote URL with tooltip for non-same-host", () => {
      // Override window.location to simulate remote access
      vi.stubGlobal("window", { location: { hostname: "remote.example.com" } });

      const def = makeDef({ proxy: { kind: "portless" } });
      const instance = makeInstance({
        url: { estimate: "http://server.local:3000", confirmed: null },
      });

      const markup = renderToStaticMarkup(
        <ManagedProcessChip {...defaultProps} definition={def} instance={instance} />,
      );

      expect(markup).toContain("http://server.local:3000");
      // Should NOT be an anchor link (remote URL)
      expect(markup).not.toContain('href="http://server.local:3000"');

      // Restore
      vi.stubGlobal("window", { location: { hostname: "localhost" } });
    });

    it("does not render URL link when proxy is not portless", () => {
      const def = makeDef({ proxy: null });
      const instance = makeInstance({
        url: { estimate: "http://localhost:3000", confirmed: null },
      });

      const markup = renderToStaticMarkup(
        <ManagedProcessChip {...defaultProps} definition={def} instance={instance} />,
      );

      // The URL should not appear as a clickable link (no href)
      expect(markup).not.toContain('href="http://localhost:3000"');
    });
  });

  describe("accessibility", () => {
    it("has aria-label with name, status, and URL info", () => {
      const def = makeDef({ name: "MyServer" });
      const instance = makeInstance({
        status: "running",
        ready: true,
        url: { estimate: null, confirmed: "http://localhost:8080" },
      });

      const markup = renderToStaticMarkup(
        <ManagedProcessChip {...defaultProps} definition={def} instance={instance} />,
      );

      expect(markup).toContain("MyServer");
      expect(markup).toContain("running (ready)");
      expect(markup).toContain("http://localhost:8080");
    });

    it("crashed chip includes aria-live announcement", () => {
      const def = makeDef({ name: "Crasher" });
      const instance = makeInstance({
        status: "crashed",
        ready: false,
        exitCode: 42,
      });

      const markup = renderToStaticMarkup(
        <ManagedProcessChip {...defaultProps} definition={def} instance={instance} />,
      );

      expect(markup).toContain('aria-live="polite"');
      expect(markup).toContain("Crasher crashed");
      expect(markup).toContain("exit code 42");
    });
  });
});
