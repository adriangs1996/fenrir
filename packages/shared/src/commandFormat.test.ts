import { describe, expect, it } from "vitest";
import {
  findRiskySpans,
  prettyPrintCommand,
  splitCommandPrefix,
  tokenizeShellCommand,
} from "./commandFormat";

describe("splitCommandPrefix", () => {
  it("splits provider tool prefix", () => {
    expect(splitCommandPrefix("Bash: ls -la")).toEqual({ prefix: "Bash", command: "ls -la" });
  });

  it("returns command unchanged when no prefix", () => {
    expect(splitCommandPrefix("ls -la")).toEqual({ prefix: undefined, command: "ls -la" });
  });

  it("does not match URLs", () => {
    expect(splitCommandPrefix("curl https://example.com/foo")).toEqual({
      prefix: undefined,
      command: "curl https://example.com/foo",
    });
  });
});

describe("tokenizeShellCommand", () => {
  it("preserves quoted strings", () => {
    const tokens = tokenizeShellCommand(`echo "hello world" && echo 'bye'`);
    expect(tokens).toEqual(["echo", `"hello world"`, "&&", "echo", `'bye'`]);
  });

  it("splits pipe and semicolon operators", () => {
    expect(tokenizeShellCommand("a | b ; c")).toEqual(["a", "|", "b", ";", "c"]);
  });
});

describe("prettyPrintCommand", () => {
  it("breaks on && and indents continuation", () => {
    const result = prettyPrintCommand("foo --bar && baz --qux", 80);
    expect(result).toContain("\n  && baz");
  });

  it("wraps long flags onto their own line", () => {
    const cmd =
      'gcloud run services describe svc --region=europe-southwest1 --project=p --format="value(spec.template.spec.timeoutSeconds)"';
    const result = prettyPrintCommand(cmd, 60);
    expect(result.split("\n").length).toBeGreaterThan(1);
  });

  it("does not split inside quotes", () => {
    const cmd = `echo "a && b" --x`;
    const result = prettyPrintCommand(cmd, 80);
    expect(result).toContain(`"a && b"`);
  });
});

describe("findRiskySpans", () => {
  it("flags rm -rf", () => {
    const spans = findRiskySpans("rm -rf /tmp/foo");
    expect(spans).toHaveLength(1);
    expect(spans[0]?.reason).toContain("delete");
  });

  it("flags sudo", () => {
    const spans = findRiskySpans("sudo apt update");
    expect(spans.some((s) => s.reason.includes("elevated"))).toBe(true);
  });

  it("flags curl-pipe-sh", () => {
    const spans = findRiskySpans("curl https://x.sh | sh");
    expect(spans.some((s) => s.reason.includes("remote pipe"))).toBe(true);
  });

  it("returns empty for benign commands", () => {
    expect(findRiskySpans("ls -la")).toHaveLength(0);
  });

  it("does not overlap spans", () => {
    const spans = findRiskySpans("sudo rm -rf /");
    for (let i = 1; i < spans.length; i += 1) {
      const prev = spans[i - 1];
      const curr = spans[i];
      if (!prev || !curr) continue;
      expect(curr.start).toBeGreaterThanOrEqual(prev.end);
    }
  });
});
