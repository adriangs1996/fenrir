import { beforeEach, describe, expect, it } from "vitest";

import { selectRightPanelActiveTab, useRightPanelStore } from "./rightPanelStore";

describe("rightPanelStore", () => {
  beforeEach(() => {
    useRightPanelStore.getState().reset();
  });

  it("defaults missing thread panel state to closed", () => {
    expect(selectRightPanelActiveTab(useRightPanelStore.getState(), "env-1:thread-1")).toBeNull();
  });

  it("stores closed state per thread", () => {
    const store = useRightPanelStore.getState();

    store.close("env-1:thread-1");

    expect(selectRightPanelActiveTab(useRightPanelStore.getState(), "env-1:thread-1")).toBeNull();
    expect(selectRightPanelActiveTab(useRightPanelStore.getState(), "env-1:thread-2")).toBeNull();
  });

  it("toggles the active tab for one thread without changing another", () => {
    const store = useRightPanelStore.getState();

    store.openTab("env-1:thread-1", "workflows");
    store.toggleTab("env-1:thread-1", "workflows");
    store.toggleTab("env-1:thread-2", "diff");

    expect(selectRightPanelActiveTab(useRightPanelStore.getState(), "env-1:thread-1")).toBeNull();
    expect(selectRightPanelActiveTab(useRightPanelStore.getState(), "env-1:thread-2")).toBe("diff");
  });
});
