import path from "node:path";

import type { ProjectScript } from "@fenrir/contracts";

interface ProjectScriptRuntimeEnvInput {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
  extraEnv?: Record<string, string>;
}

export function projectScriptCwd(input: {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
}): string {
  return input.worktreePath ?? input.project.cwd;
}

export function projectScriptRuntimeEnv(
  input: ProjectScriptRuntimeEnvInput,
): Record<string, string> {
  const env: Record<string, string> = {
    FENRIR_PROJECT_ROOT: input.project.cwd,
  };
  if (input.worktreePath) {
    env.FENRIR_WORKTREE_PATH = input.worktreePath;
  }
  if (input.extraEnv) {
    return { ...env, ...input.extraEnv };
  }
  return env;
}

export function setupProjectScript(scripts: readonly ProjectScript[]): ProjectScript | null {
  return scripts.find((script) => script.runOnWorktreeCreate) ?? null;
}

/**
 * Resolve the cwd for a managed process relative to its scope root.
 *
 * - `null` cwd -> scope root
 * - Absolute cwd -> rejected
 * - Relative cwd that escapes scope root -> rejected
 */
export function resolveManagedProcessCwd(input: {
  scopeRoot: string;
  cwd: string | null;
}): { ok: true; absolute: string } | { ok: false; reason: string } {
  if (input.cwd === null) return { ok: true, absolute: input.scopeRoot };
  if (path.isAbsolute(input.cwd)) {
    return { ok: false, reason: "cwd must be relative to the scope root" };
  }
  const joined = path.resolve(input.scopeRoot, input.cwd);
  const rel = path.relative(input.scopeRoot, joined);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { ok: false, reason: "cwd escapes the scope root" };
  }
  return { ok: true, absolute: joined };
}
