import { Buffer } from "node:buffer";

import type { Path } from "effect";

import { expandHomePath } from "../pathExpansion.ts";

export interface SkillProjectIdentity {
  readonly workspaceRoot: string;
}

export interface SkillProjectMetadata {
  readonly version: 1;
  readonly projectKey: string;
  readonly workspaceRoot: string;
  readonly repositoryIdentity: null;
}

export interface ProjectSkillStatePaths {
  readonly workspaceRoot: string;
  readonly projectKey: string;
  readonly projectsRootDir: string;
  readonly projectRootStateDir: string;
  readonly skillsRootDir: string;
  readonly generalSkillsDir: string;
  readonly providerSkillsDir: string;
  readonly skillIndexDir: string;
  readonly projectMetadataPath: string;
}

export const normalizeWorkspaceRoot = (workspaceRoot: string, path: Path.Path): string =>
  path.resolve(expandHomePath(workspaceRoot.trim()));

export const encodeSkillProjectKey = (workspaceRoot: string, path: Path.Path): string => {
  const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot, path);
  return Buffer.from(normalizedWorkspaceRoot, "utf8").toString("base64url");
};

export const decodeSkillProjectKey = (projectKey: string): SkillProjectIdentity => ({
  workspaceRoot: Buffer.from(projectKey, "base64url").toString("utf8"),
});

export const getProjectSkillStatePaths = (input: {
  readonly stateDir: string;
  readonly workspaceRoot: string;
  readonly path: Path.Path;
}): ProjectSkillStatePaths => {
  const normalizedWorkspaceRoot = normalizeWorkspaceRoot(input.workspaceRoot, input.path);
  const projectKey = encodeSkillProjectKey(normalizedWorkspaceRoot, input.path);
  const projectsRootDir = input.path.join(input.stateDir, "projects");
  const projectRootStateDir = input.path.join(projectsRootDir, projectKey);
  const skillsRootDir = input.path.join(projectRootStateDir, "skills");

  return {
    workspaceRoot: normalizedWorkspaceRoot,
    projectKey,
    projectsRootDir,
    projectRootStateDir,
    skillsRootDir,
    generalSkillsDir: input.path.join(skillsRootDir, "general"),
    providerSkillsDir: input.path.join(skillsRootDir, "providers"),
    skillIndexDir: input.path.join(skillsRootDir, "index"),
    projectMetadataPath: input.path.join(skillsRootDir, "project.json"),
  };
};

export const buildSkillProjectMetadata = (
  paths: Pick<ProjectSkillStatePaths, "projectKey" | "workspaceRoot">,
): SkillProjectMetadata => ({
  version: 1,
  projectKey: paths.projectKey,
  workspaceRoot: paths.workspaceRoot,
  repositoryIdentity: null,
});
