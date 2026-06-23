import "../../index.css";

import { EnvironmentId } from "@fenrir/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useRightPanelStore } from "../../rightPanelStore";
import { RightPanelTabs } from "./RightPanelTabs";

vi.mock("../PlanSidebar", () => ({
  default: (props: { onClose: () => void }) => (
    <button type="button" onClick={props.onClose}>
      Close plan sidebar
    </button>
  ),
}));

vi.mock("~/modules/workflows", () => ({
  WorkflowPanel: (props: { onClose: () => void }) => (
    <button type="button" onClick={props.onClose}>
      Close workflows panel
    </button>
  ),
}));

const THREAD_KEY = "environment-local:thread-right-panel-tabs";
const ENVIRONMENT_ID = EnvironmentId.make("environment-local");

describe("RightPanelTabs", () => {
  afterEach(() => {
    useRightPanelStore.getState().reset();
    document.body.innerHTML = "";
  });

  it("uses the plan close path when clicking the active Plan tab", async () => {
    const onPlanClose = vi.fn();
    useRightPanelStore.getState().openTab(THREAD_KEY, "plan");

    const mounted = await render(
      <RightPanelTabs
        threadKey={THREAD_KEY}
        planProps={{
          activePlan: null,
          activeProposedPlan: null,
          label: "Plan",
          environmentId: ENVIRONMENT_ID,
          markdownCwd: undefined,
          workspaceRoot: undefined,
          timestampFormat: "locale",
          onClose: onPlanClose,
        }}
        workflowProps={{
          projectId: null,
          originThreadId: null,
          onClose: vi.fn(),
        }}
      />,
    );

    await page.getByRole("tab", { name: "Plan" }).click();

    expect(onPlanClose).toHaveBeenCalledTimes(1);

    await mounted.unmount();
  });
});
