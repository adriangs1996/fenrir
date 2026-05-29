import { describe, expect, it } from "vitest";

import {
  GLOBAL_TERMINAL_ROUTE,
  resolveGlobalTerminalToggleHref,
  shouldStoreGlobalTerminalReturnHref,
} from "../globalTerminal";

describe("global terminal navigation", () => {
  it("opens the global terminal from any non-global route", () => {
    expect(
      resolveGlobalTerminalToggleHref({
        pathname: "/browser-lab",
        returnHref: "/browser-lab?target=local",
      }),
    ).toBe(GLOBAL_TERMINAL_ROUTE);
  });

  it("returns from the global terminal to the remembered route", () => {
    expect(
      resolveGlobalTerminalToggleHref({
        pathname: GLOBAL_TERMINAL_ROUTE,
        returnHref: "/settings/keybindings",
      }),
    ).toBe("/settings/keybindings");
  });

  it("falls back to chat home when the global terminal has no remembered route", () => {
    expect(
      resolveGlobalTerminalToggleHref({
        pathname: GLOBAL_TERMINAL_ROUTE,
        returnHref: null,
      }),
    ).toBe("/");
  });

  it("stores return hrefs only outside the global terminal route", () => {
    expect(shouldStoreGlobalTerminalReturnHref("/")).toBe(true);
    expect(shouldStoreGlobalTerminalReturnHref(GLOBAL_TERMINAL_ROUTE)).toBe(false);
  });
});
