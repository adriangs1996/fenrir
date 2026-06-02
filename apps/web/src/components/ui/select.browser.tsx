import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./select";

function dispatchMouseEvent(target: Element, type: "mousedown" | "mouseup" | "click") {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      button: 0,
      buttons: type === "mousedown" ? 1 : 0,
      cancelable: true,
      detail: 1,
    }),
  );
}

describe("Select", () => {
  it("stays open when a mouse click follows the opening mousedown without pointerdown", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <Select defaultValue="alpha">
        <SelectTrigger aria-label="Model">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value="alpha">Alpha</SelectItem>
          <SelectItem value="beta">Beta</SelectItem>
        </SelectPopup>
      </Select>,
      { container: host },
    );

    try {
      const trigger = host.querySelector("button");
      if (!trigger) {
        throw new Error("Expected select trigger button.");
      }

      dispatchMouseEvent(trigger, "mousedown");

      await vi.waitFor(() => {
        expect(trigger.getAttribute("aria-expanded")).toBe("true");
        expect(document.body.textContent ?? "").toContain("Beta");
      });

      dispatchMouseEvent(trigger, "mouseup");
      dispatchMouseEvent(trigger, "click");

      await vi.waitFor(() => {
        expect(trigger.getAttribute("aria-expanded")).toBe("true");
        expect(document.body.textContent ?? "").toContain("Beta");
      });
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
