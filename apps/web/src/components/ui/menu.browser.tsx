import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { Button } from "./button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./menu";

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

describe("Menu", () => {
  it("stays open when a mouse click follows the opening mousedown without pointerdown", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <Menu>
        <MenuTrigger render={<Button size="sm" variant="outline" />}>Actions</MenuTrigger>
        <MenuPopup>
          <MenuItem>Run action</MenuItem>
        </MenuPopup>
      </Menu>,
      { container: host },
    );

    try {
      const trigger = host.querySelector("button");
      if (!trigger) {
        throw new Error("Expected menu trigger button.");
      }

      dispatchMouseEvent(trigger, "mousedown");

      await vi.waitFor(() => {
        expect(trigger.getAttribute("aria-expanded")).toBe("true");
        expect(document.body.textContent ?? "").toContain("Run action");
      });

      dispatchMouseEvent(trigger, "mouseup");
      dispatchMouseEvent(trigger, "click");

      await vi.waitFor(() => {
        expect(trigger.getAttribute("aria-expanded")).toBe("true");
        expect(document.body.textContent ?? "").toContain("Run action");
      });
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
