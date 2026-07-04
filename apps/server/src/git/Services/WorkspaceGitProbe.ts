/**
 * WorkspaceGitProbe - Effect service contract for the D-045 workspace git/PR
 * probe.
 *
 * Answers "what branch is this workspace on, how far ahead/behind is it, and
 * does the current branch have a pull request (number/state/checks)?" cheaply
 * enough for sidebar refreshes. Results are cached per workspace with a short
 * TTL, and PR data degrades gracefully to `null` when the GitHub CLI is
 * missing or unauthenticated — the probe never makes clients shell out to
 * `git`/`gh` themselves.
 *
 * @module WorkspaceGitProbe
 */
import { Context } from "effect";
import type { Effect } from "effect";

import type {
  GitCommandError,
  WorkspaceGitProbeInput,
  WorkspaceGitProbeResult,
} from "@fenrir/contracts";

/**
 * WorkspaceGitProbeShape - Service API for probing workspace git/PR status.
 */
export interface WorkspaceGitProbeShape {
  /**
   * Probe branch, ahead/behind and PR status for a workspace path. Serves a
   * cached snapshot when one is fresh (short TTL) so sidebar polling stays
   * cheap.
   */
  readonly probe: (
    input: WorkspaceGitProbeInput,
  ) => Effect.Effect<WorkspaceGitProbeResult, GitCommandError>;
}

/**
 * WorkspaceGitProbe - Service tag for the workspace git/PR probe.
 */
export class WorkspaceGitProbe extends Context.Service<WorkspaceGitProbe, WorkspaceGitProbeShape>()(
  "t3/git/Services/WorkspaceGitProbe",
) {}
