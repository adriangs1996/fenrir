import { describe, expect, it } from "vitest";

import { normalizeBrowserAddressInput } from "./browserNavigation";

describe("normalizeBrowserAddressInput", () => {
  it("keeps explicit HTTP, file, and about targets unchanged", () => {
    expect(normalizeBrowserAddressInput("https://example.com")).toBe("https://example.com");
    expect(normalizeBrowserAddressInput("file:///Users/adrian/demo.html")).toBe(
      "file:///Users/adrian/demo.html",
    );
    expect(normalizeBrowserAddressInput("about:blank")).toBe("about:blank");
  });

  it("passes absolute filesystem paths through for desktop normalization", () => {
    expect(normalizeBrowserAddressInput("/Users/adrian/demo.html")).toBe("/Users/adrian/demo.html");
    expect(normalizeBrowserAddressInput("C:\\Users\\Adrian\\demo.html")).toBe(
      "C:\\Users\\Adrian\\demo.html",
    );
    expect(normalizeBrowserAddressInput("\\\\server\\share\\demo.html")).toBe(
      "\\\\server\\share\\demo.html",
    );
  });

  it("keeps host-like input on the existing HTTP path", () => {
    expect(normalizeBrowserAddressInput("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeBrowserAddressInput("example.com")).toBe("http://example.com");
  });

  it("returns null for empty input", () => {
    expect(normalizeBrowserAddressInput(" ")).toBeNull();
  });
});
