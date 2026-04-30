import { describe, expect, it } from "vitest";

import { parsePlanFrontmatter } from "./frontmatter.ts";

describe("parsePlanFrontmatter", () => {
  it("falls back when no frontmatter exists", () => {
    expect(parsePlanFrontmatter("# Plan body", "fallback-id")).toEqual({
      id: "fallback-id",
      depends_on: [],
      max_retries: 2,
      body: "# Plan body",
    });
  });

  it("parses YAML frontmatter with structured fields", () => {
    expect(
      parsePlanFrontmatter(
        `---
id: plan-a
depends_on:
  - setup
  - api
max_retries: 4
---
# Body
`,
        "fallback-id",
      ),
    ).toEqual({
      id: "plan-a",
      depends_on: ["setup", "api"],
      max_retries: 4,
      body: "# Body\n",
    });
  });

  it("keeps an empty body empty instead of treating the whole file as content", () => {
    expect(
      parsePlanFrontmatter(
        `---
id: only-meta
---`,
        "fallback-id",
      ),
    ).toEqual({
      id: "only-meta",
      depends_on: [],
      max_retries: 2,
      body: "",
    });
  });

  it("rejects malformed YAML frontmatter", () => {
    expect(() =>
      parsePlanFrontmatter(
        `---
id: [broken
---
body`,
        "fallback-id",
      ),
    ).toThrow(/invalid YAML frontmatter/i);
  });

  it("rejects invalid depends_on shapes", () => {
    expect(() =>
      parsePlanFrontmatter(
        `---
depends_on: setup
---
body`,
        "fallback-id",
      ),
    ).toThrow(/depends_on/);
  });

  it("rejects invalid max_retries values", () => {
    expect(() =>
      parsePlanFrontmatter(
        `---
max_retries: -1
---
body`,
        "fallback-id",
      ),
    ).toThrow(/max_retries/);
  });

  it("rejects duplicate YAML keys", () => {
    expect(() =>
      parsePlanFrontmatter(
        `---
id: first
id: second
---
body`,
        "fallback-id",
      ),
    ).toThrow(/YAML frontmatter/i);
  });
});
