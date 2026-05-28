/**
 * Logic tests for ArchivedPlansPanel derivations.
 *
 * These verify the pure grouping, sorting, and error-message logic used by the
 * ArchivedPlansPanel component without rendering React trees.
 */
import { IsoDateTime, ProjectId, TrimmedNonEmptyString } from "@fenrir/contracts";
import type { ArchivedFeatureSummary } from "@fenrir/contracts";
import { describe, expect, it } from "vitest";

const pid = ProjectId.make;
const tn = TrimmedNonEmptyString.make;
const ts = IsoDateTime.make;

function makeArchived(partial: {
  projectId?: string;
  featureName: string;
  archivedDirName?: string;
  planCount?: number;
  archivedAt?: string;
}): ArchivedFeatureSummary {
  return {
    projectId: pid(partial.projectId ?? "proj-1"),
    featureName: tn(partial.featureName),
    archivedDirName: tn(partial.archivedDirName ?? partial.featureName),
    planCount: partial.planCount ?? 1,
    archivedAt: ts(partial.archivedAt ?? "2026-04-01T00:00:00.000Z"),
  };
}

interface ProjectStub {
  id: ProjectId;
  name: string;
}

/**
 * Mirrors the grouping + sorting derivation inside ArchivedPlansPanel.
 * Kept as a pure function so it can be tested without React.
 */
function deriveArchivedGroups(
  projects: ProjectStub[],
  archivedByProject: Record<string, ArchivedFeatureSummary[]>,
) {
  return projects
    .map((project) => {
      const features = archivedByProject[project.id] ?? [];
      return {
        project,
        features: features.toSorted((a, b) => b.archivedAt.localeCompare(a.archivedAt)),
      };
    })
    .filter((group) => group.features.length > 0);
}

/**
 * Mirrors the error-message resolution inside ArchivedFeatureRow.
 */
function resolveUnarchiveError(err: Error, featureName: string): string {
  const msg = err.message;
  if (/already exists/i.test(msg)) {
    return `A feature named "${featureName}" already exists. Rename or delete the existing .plans/${featureName}/ folder, then retry.`;
  }
  return msg;
}

// ── Grouping + Sorting ──────────────────────────────────────────────────────

describe("ArchivedPlansPanel grouping derivation", () => {
  it("returns empty when no projects have archived features", () => {
    const projects: ProjectStub[] = [
      { id: pid("proj-1"), name: "Project 1" },
      { id: pid("proj-2"), name: "Project 2" },
    ];
    const groups = deriveArchivedGroups(projects, {});
    expect(groups).toEqual([]);
  });

  it("groups archived features by project and sorts within group by archivedAt desc", () => {
    const projects: ProjectStub[] = [{ id: pid("proj-1"), name: "Project 1" }];
    const archivedByProject: Record<string, ArchivedFeatureSummary[]> = {
      "proj-1": [
        makeArchived({ featureName: "older", archivedAt: "2026-03-01T00:00:00.000Z" }),
        makeArchived({ featureName: "newer", archivedAt: "2026-04-15T00:00:00.000Z" }),
      ],
    };

    const groups = deriveArchivedGroups(projects, archivedByProject);
    expect(groups.length).toBe(1);
    expect(groups[0]!.project.id).toBe("proj-1");
    // newer first
    expect(groups[0]!.features[0]!.featureName).toBe("newer");
    expect(groups[0]!.features[1]!.featureName).toBe("older");
  });

  it("returns groups for multiple projects with archives", () => {
    const projects: ProjectStub[] = [
      { id: pid("proj-1"), name: "Project 1" },
      { id: pid("proj-2"), name: "Project 2" },
      { id: pid("proj-3"), name: "Project 3" },
    ];
    const archivedByProject: Record<string, ArchivedFeatureSummary[]> = {
      "proj-1": [makeArchived({ projectId: "proj-1", featureName: "a" })],
      // proj-2 has no archives
      "proj-3": [
        makeArchived({ projectId: "proj-3", featureName: "b" }),
        makeArchived({ projectId: "proj-3", featureName: "c" }),
      ],
    };

    const groups = deriveArchivedGroups(projects, archivedByProject);
    expect(groups.length).toBe(2);
    expect(groups[0]!.project.name).toBe("Project 1");
    expect(groups[0]!.features.length).toBe(1);
    expect(groups[1]!.project.name).toBe("Project 3");
    expect(groups[1]!.features.length).toBe(2);
  });

  it("filters out projects with zero archived features", () => {
    const projects: ProjectStub[] = [
      { id: pid("proj-1"), name: "Empty" },
      { id: pid("proj-2"), name: "Has Archives" },
    ];
    const archivedByProject: Record<string, ArchivedFeatureSummary[]> = {
      "proj-1": [],
      "proj-2": [makeArchived({ projectId: "proj-2", featureName: "x" })],
    };

    const groups = deriveArchivedGroups(projects, archivedByProject);
    expect(groups.length).toBe(1);
    expect(groups[0]!.project.name).toBe("Has Archives");
  });
});

// ── Error Resolution ────────────────────────────────────────────────────────

describe("ArchivedFeatureRow error resolution", () => {
  it("produces collision error message when error contains 'already exists'", () => {
    const msg = resolveUnarchiveError(new Error("Feature already exists in .plans/"), "my-feature");
    expect(msg).toContain('A feature named "my-feature" already exists');
    expect(msg).toContain(".plans/my-feature/");
  });

  it("passes through generic error messages", () => {
    const msg = resolveUnarchiveError(new Error("Network failure"), "my-feature");
    expect(msg).toBe("Network failure");
  });
});
