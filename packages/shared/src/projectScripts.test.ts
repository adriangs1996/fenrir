import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveManagedProcessCwd } from "./projectScripts";

describe("resolveManagedProcessCwd", () => {
  const scopeRoot = "/home/user/project";

  it("returns scope root when cwd is null", () => {
    const result = resolveManagedProcessCwd({ scopeRoot, cwd: null });
    expect(result).toEqual({ ok: true, absolute: scopeRoot });
  });

  it("resolves a relative subpath", () => {
    const result = resolveManagedProcessCwd({ scopeRoot, cwd: "packages/web" });
    expect(result).toEqual({ ok: true, absolute: path.join(scopeRoot, "packages/web") });
  });

  it("rejects absolute cwd", () => {
    const result = resolveManagedProcessCwd({ scopeRoot, cwd: "/etc/passwd" });
    expect(result).toEqual({ ok: false, reason: "cwd must be relative to the scope root" });
  });

  it("rejects ../escape", () => {
    const result = resolveManagedProcessCwd({ scopeRoot, cwd: "../escape" });
    expect(result).toEqual({ ok: false, reason: "cwd escapes the scope root" });
  });

  it("rejects ..//escape", () => {
    const result = resolveManagedProcessCwd({ scopeRoot, cwd: "..//escape" });
    expect(result).toEqual({ ok: false, reason: "cwd escapes the scope root" });
  });

  it("rejects deeply nested escape via ../../../", () => {
    const result = resolveManagedProcessCwd({ scopeRoot, cwd: "a/../../.." });
    expect(result).toEqual({ ok: false, reason: "cwd escapes the scope root" });
  });

  it("accepts nested paths that normalize within scope", () => {
    const result = resolveManagedProcessCwd({ scopeRoot, cwd: "a/../b" });
    expect(result).toEqual({ ok: true, absolute: path.join(scopeRoot, "b") });
  });
});
