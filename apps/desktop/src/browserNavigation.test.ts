import * as OS from "node:os";
import * as Path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { normalizeBrowserNavigationUrl } from "./browserNavigation";

describe("normalizeBrowserNavigationUrl", () => {
  it("keeps ordinary HTTP navigation targets compatible with the address bar", () => {
    expect(normalizeBrowserNavigationUrl("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeBrowserNavigationUrl("https://example.com")).toBe("https://example.com");
  });

  it("preserves and canonicalizes file URLs", () => {
    expect(normalizeBrowserNavigationUrl("file:///tmp/demo page.html")).toBe(
      "file:///tmp/demo%20page.html",
    );
  });

  it("turns absolute filesystem paths into file URLs", () => {
    const filePath = Path.join(OS.tmpdir(), "fenrir browser lab.html");

    expect(normalizeBrowserNavigationUrl(filePath)).toBe(pathToFileURL(filePath).toString());
  });

  it("preserves about pages", () => {
    expect(normalizeBrowserNavigationUrl("about:blank")).toBe("about:blank");
  });
});
