import type { ManagedProcess, ManagedProcessInstance } from "@fenrir/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ManagedProcessStatusBar } from "./ManagedProcessStatusBar";

// ---------- Stub globals needed for SSR ----------

beforeAll(() => {
  vi.stubGlobal("window", { location: { hostname: "localhost" } });
});

// ---------- Factories ----------

function makeDef(
  overrides: Partial<ManagedProcess> & { id: string; name: string },
): ManagedProcess {
  return {
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

function makeInstance(
  overrides: Partial<ManagedProcessInstance> & {
    instanceId: string;
    processDefId: string;
  },
): ManagedProcessInstance {
  return {
    projectId: "proj-1" as ManagedProcessInstance["projectId"],
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

// ---------- Mock store ----------

const mockDefinitions: ManagedProcess[] = [];
const mockInstances: ManagedProcessInstance[] = [];

vi.mock("~/store", () => ({
  useStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock("~/storeSelectors", () => ({
  createManagedProcessDefinitionsSelector:
    () =>
    (_state: unknown): ManagedProcess[] =>
      mockDefinitions,
  createManagedProcessInstancesSelector:
    () =>
    (_state: unknown): ManagedProcessInstance[] =>
      mockInstances,
}));

// Mock environment connection for RPC
vi.mock("~/environments/runtime", () => ({
  readEnvironmentConnection: () => null,
}));

// ---------- Tests ----------

describe("ManagedProcessStatusBar", () => {
  it("renders nothing when project has no definitions", () => {
    mockDefinitions.length = 0;
    mockInstances.length = 0;

    const markup = renderToStaticMarkup(
      <ManagedProcessStatusBar
        projectId={"proj-1" as ManagedProcessInstance["projectId"]}
        environmentId={
          "env-1" as ManagedProcessInstance["projectId"] extends string ? never : never
        }
        currentWorktreePath={null}
      />,
    );

    expect(markup).toBe("");
  });

  it("renders one chip per definition", () => {
    mockDefinitions.length = 0;
    mockInstances.length = 0;
    mockDefinitions.push(
      makeDef({ id: "def-1", name: "Dev Server" }),
      makeDef({ id: "def-2", name: "Worker" }),
    );

    const markup = renderToStaticMarkup(
      <ManagedProcessStatusBar
        projectId={"proj-1" as ManagedProcessInstance["projectId"]}
        environmentId={
          "env-1" as ManagedProcessInstance["projectId"] extends string ? never : never
        }
        currentWorktreePath={null}
      />,
    );

    expect(markup).toContain("Dev Server");
    expect(markup).toContain("Worker");
    // Toolbar role
    expect(markup).toContain('role="toolbar"');
  });

  it("worktree-scope chip shows instance for current worktree only", () => {
    mockDefinitions.length = 0;
    mockInstances.length = 0;
    mockDefinitions.push(makeDef({ id: "def-wt", name: "WtProcess", scope: "worktree" }));
    // Instance on a different worktree
    mockInstances.push(
      makeInstance({
        instanceId: "inst-other",
        processDefId: "def-wt",
        worktreePath: "/other/wt",
        scope: "worktree",
        status: "running",
        ready: true,
      }),
    );

    const markup = renderToStaticMarkup(
      <ManagedProcessStatusBar
        projectId={"proj-1" as ManagedProcessInstance["projectId"]}
        environmentId={
          "env-1" as ManagedProcessInstance["projectId"] extends string ? never : never
        }
        currentWorktreePath="/current/wt"
      />,
    );

    // Should render the chip (from definition) but NOT show running status
    // since the instance is for a different worktree. The Start button should
    // appear because there's no matching instance.
    expect(markup).toContain("WtProcess");
    expect(markup).toContain("Start");
  });

  it("project-scope chip ignores currentWorktreePath", () => {
    mockDefinitions.length = 0;
    mockInstances.length = 0;
    mockDefinitions.push(makeDef({ id: "def-proj", name: "ProjProcess", scope: "project" }));
    mockInstances.push(
      makeInstance({
        instanceId: "inst-proj",
        processDefId: "def-proj",
        worktreePath: null,
        scope: "project",
        status: "running",
        ready: true,
      }),
    );

    const markup = renderToStaticMarkup(
      <ManagedProcessStatusBar
        projectId={"proj-1" as ManagedProcessInstance["projectId"]}
        environmentId={
          "env-1" as ManagedProcessInstance["projectId"] extends string ? never : never
        }
        currentWorktreePath="/some/worktree"
      />,
    );

    // Project-scope instance should match even with a currentWorktreePath set
    expect(markup).toContain("ProjProcess");
    expect(markup).toContain("Stop");
  });

  it("crashed chip shows exit code badge", () => {
    mockDefinitions.length = 0;
    mockInstances.length = 0;
    mockDefinitions.push(makeDef({ id: "def-crash", name: "Crasher" }));
    mockInstances.push(
      makeInstance({
        instanceId: "inst-crash",
        processDefId: "def-crash",
        status: "crashed",
        ready: false,
        exitCode: 137,
      }),
    );

    const markup = renderToStaticMarkup(
      <ManagedProcessStatusBar
        projectId={"proj-1" as ManagedProcessInstance["projectId"]}
        environmentId={
          "env-1" as ManagedProcessInstance["projectId"] extends string ? never : never
        }
        currentWorktreePath={null}
      />,
    );

    expect(markup).toContain("Crasher");
    expect(markup).toContain("exit 137");
    expect(markup).toContain("Restart");
  });
});
