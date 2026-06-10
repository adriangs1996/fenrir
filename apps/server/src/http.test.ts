import { describe, expect, it } from "vitest";

import { isAllowedBrowserClientOrigin, isLoopbackHostname, resolveDevRedirectUrl } from "./http.ts";

describe("http dev routing", () => {
  it("treats localhost and loopback addresses as local", () => {
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
  });

  it("does not treat LAN addresses as local", () => {
    expect(isLoopbackHostname("192.168.86.35")).toBe(false);
    expect(isLoopbackHostname("10.0.0.24")).toBe(false);
    expect(isLoopbackHostname("example.local")).toBe(false);
  });

  it("allows browser client origins that need credentialed CORS", () => {
    expect(isAllowedBrowserClientOrigin("t3://app")).toBe(true);
    expect(isAllowedBrowserClientOrigin("http://localhost:5733")).toBe(true);
    expect(isAllowedBrowserClientOrigin("http://192.168.86.35:3773")).toBe(true);
    expect(isAllowedBrowserClientOrigin("file://app")).toBe(false);
    expect(isAllowedBrowserClientOrigin("not a url")).toBe(false);
  });

  it("preserves path and query when redirecting to the dev server", () => {
    const devUrl = new URL("http://127.0.0.1:5173/");
    const requestUrl = new URL("http://127.0.0.1:3774/pair?token=test-token");

    expect(resolveDevRedirectUrl(devUrl, requestUrl)).toBe(
      "http://127.0.0.1:5173/pair?token=test-token",
    );
  });
});
