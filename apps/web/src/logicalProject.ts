import { scopedProjectKey, scopeProjectRef } from "@fenrir/client-runtime";
import type { ScopedProjectRef } from "@fenrir/contracts";
import type { Project } from "./types";

export function deriveLogicalProjectKey(
  project: Pick<Project, "environmentId" | "id" | "repositoryIdentity">,
): string {
  return (
    project.repositoryIdentity?.canonicalKey ??
    scopedProjectKey(scopeProjectRef(project.environmentId, project.id))
  );
}

export function deriveLogicalProjectKeyFromRef(
  projectRef: ScopedProjectRef,
  project: Pick<Project, "repositoryIdentity"> | null | undefined,
): string {
  return project?.repositoryIdentity?.canonicalKey ?? scopedProjectKey(projectRef);
}
