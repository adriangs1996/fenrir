import { describe, expect, it, beforeEach } from "vitest";
import { useTerminalStateStore } from "./terminalStateStore";

describe("terminalStateStore tmux tracking", () => {
  beforeEach(() => {
    // Reset store between tests
    useTerminalStateStore.setState({ activeTmuxProjectId: null });
  });

  it("initializes with null activeTmuxProjectId", () => {
    const state = useTerminalStateStore.getState();
    expect(state.activeTmuxProjectId).toBeNull();
  });

  it("setActiveTmuxProject updates the projectId", () => {
    useTerminalStateStore.getState().setActiveTmuxProject("proj-abc");
    expect(useTerminalStateStore.getState().activeTmuxProjectId).toBe(
      "proj-abc",
    );
  });

  it("setActiveTmuxProject(null) clears the projectId", () => {
    useTerminalStateStore.getState().setActiveTmuxProject("proj-abc");
    useTerminalStateStore.getState().setActiveTmuxProject(null);
    expect(useTerminalStateStore.getState().activeTmuxProjectId).toBeNull();
  });

  it("setActiveTmuxProject replaces previous projectId", () => {
    useTerminalStateStore.getState().setActiveTmuxProject("proj-1");
    useTerminalStateStore.getState().setActiveTmuxProject("proj-2");
    expect(useTerminalStateStore.getState().activeTmuxProjectId).toBe("proj-2");
  });
});
