import { describe, expect, it } from "vitest";
import { dirtyConfirmMessage, needsDirtyConfirm, shouldPush } from "../useEditorCwdSync";

describe("shouldPush", () => {
  const base = { bridgeAvailable: true, main: true, cwd: "/repo-a", lastPushed: null };

  it("returns true when bridge available, main window, cwd set, and no previous push", () => {
    expect(shouldPush(base)).toBe(true);
  });

  it("returns false when bridge unavailable", () => {
    expect(shouldPush({ ...base, bridgeAvailable: false })).toBe(false);
  });

  it("returns false when not main window", () => {
    expect(shouldPush({ ...base, main: false })).toBe(false);
  });

  it("returns false when cwd is null", () => {
    expect(shouldPush({ ...base, cwd: null })).toBe(false);
  });

  it("returns false when cwd equals lastPushed (dedup)", () => {
    expect(shouldPush({ ...base, lastPushed: "/repo-a" })).toBe(false);
  });

  it("returns true when cwd differs from lastPushed", () => {
    expect(shouldPush({ ...base, lastPushed: "/repo-b" })).toBe(true);
  });
});

describe("needsDirtyConfirm", () => {
  it("returns false on first push (lastPushed null) even with dirty files", () => {
    expect(needsDirtyConfirm(3, null)).toBe(false);
  });

  it("returns false when no dirty files", () => {
    expect(needsDirtyConfirm(0, "/repo-a")).toBe(false);
  });

  it("returns true when dirty files exist and lastPushed is set", () => {
    expect(needsDirtyConfirm(2, "/repo-a")).toBe(true);
  });
});

describe("dirtyConfirmMessage", () => {
  it("includes buffer count", () => {
    const msg = dirtyConfirmMessage(3);
    expect(msg).toContain("3 buffer(s)");
  });

  it("mentions switching projects", () => {
    expect(dirtyConfirmMessage(1)).toMatch(/switching projects/i);
  });
});
