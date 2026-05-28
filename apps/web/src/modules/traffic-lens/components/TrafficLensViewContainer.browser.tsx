import "../../../index.css";

import type { TrafficLensTabSnapshot } from "@fenrir/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { useTrafficLensStore } from "../stores/useTrafficLensStore";
import { TrafficLensViewContainer } from "./TrafficLensViewContainer";

const makeTab = (overrides?: Partial<TrafficLensTabSnapshot>): TrafficLensTabSnapshot => ({
  tabId: "tab-1" as any,
  profileId: "default" as any,
  profileName: "Default",
  url: "https://target.htb",
  title: "Target",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  viewMode: "desktop",
  mobilePreset: "iphone-15-pro",
  ...overrides,
});

describe("TrafficLensViewContainer", () => {
  beforeEach(() => {
    useTrafficLensStore.setState({
      tabs: {},
      activeTabId: null,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders a measurable browser viewport target in desktop mode", async () => {
    useTrafficLensStore.getState().upsertTab(makeTab());

    await render(<TrafficLensViewContainer />);

    expect(document.querySelector('[data-browser-lab-viewport="desktop"]')).toBeTruthy();
  });

  it("renders a mobile-sized browser viewport target in mobile mode", async () => {
    useTrafficLensStore.getState().upsertTab(
      makeTab({
        viewMode: "mobile",
        mobilePreset: "pixel-8",
      }),
    );

    await render(
      <div className="h-[900px] w-[900px]">
        <TrafficLensViewContainer />
      </div>,
    );

    const viewport = document.querySelector<HTMLElement>('[data-browser-lab-viewport="mobile"]');

    expect(viewport).toBeTruthy();
    expect(viewport!.getBoundingClientRect().width).toBe(412);
    expect(document.body.textContent).toContain("Phone Wide");
    expect(document.body.textContent).toContain("412");
    expect(document.body.textContent).toContain("760");
  });
});
