import { describe, expect, it } from "@effect/vitest";

import { diffSkillManifests } from "./skillDiff.ts";
import type { SkillManifest } from "./skillManifest.ts";

const manifest = (entries: SkillManifest["entries"]): SkillManifest => ({ entries });

describe("diffSkillManifests", () => {
  const baseEntry = {
    relativePath: "skill.md",
    kind: "file" as const,
    executable: false,
    contentHash: "hash-a",
  };

  it("treats deleted files as pending drift", () => {
    const diff = diffSkillManifests(manifest([baseEntry]), manifest([]));

    expect(diff.state).toBe("pending");
    expect(diff.missing).toEqual([baseEntry]);
    expect(diff.extra).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  it("treats edited files as conflicts", () => {
    const diff = diffSkillManifests(
      manifest([baseEntry]),
      manifest([{ ...baseEntry, contentHash: "hash-b" }]),
    );

    expect(diff.state).toBe("conflict");
    expect(diff.changed).toEqual([
      {
        expected: baseEntry,
        actual: { ...baseEntry, contentHash: "hash-b" },
      },
    ]);
  });

  it("treats added files as conflicts", () => {
    const diff = diffSkillManifests(
      manifest([baseEntry]),
      manifest([baseEntry, { ...baseEntry, relativePath: "notes.md", contentHash: "hash-c" }]),
    );

    expect(diff.state).toBe("conflict");
    expect(diff.extra).toEqual([
      {
        ...baseEntry,
        relativePath: "notes.md",
        contentHash: "hash-c",
      },
    ]);
  });
});
