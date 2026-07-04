import { Clock, Effect, Layer, Schema } from "effect";

import type {
  WorkspaceGitProbeChecksState,
  WorkspaceGitProbePullRequest,
  WorkspaceGitProbePullRequestState,
  WorkspaceGitProbeResult,
} from "@fenrir/contracts";

import { GitCore } from "../Services/GitCore.ts";
import { GitHubCli } from "../Services/GitHubCli.ts";
import { WorkspaceGitProbe, type WorkspaceGitProbeShape } from "../Services/WorkspaceGitProbe.ts";

/**
 * How long a probe snapshot stays fresh. Sidebar refresh polling within the
 * TTL is answered from cache without touching `git` or `gh`.
 */
export const WORKSPACE_GIT_PROBE_TTL_MS = 45_000;

/** Hard bound so a long-lived server cannot accumulate stale workspaces. */
const WORKSPACE_GIT_PROBE_CACHE_MAX_ENTRIES = 256;

/** PR resolution is best-effort; a slow `gh` must not wedge sidebar polls. */
const GH_PROBE_TIMEOUT_MS = 10_000;

const RawStatusCheckSchema = Schema.Struct({
  // CheckRun entries report status ("COMPLETED", "IN_PROGRESS", …) plus a
  // conclusion once completed; StatusContext entries report a single state.
  status: Schema.optional(Schema.NullOr(Schema.String)),
  conclusion: Schema.optional(Schema.NullOr(Schema.String)),
  state: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawGitHubPullRequestProbeSchema = Schema.Struct({
  number: Schema.Number,
  state: Schema.String,
  isDraft: Schema.optional(Schema.Boolean),
  url: Schema.optional(Schema.NullOr(Schema.String)),
  statusCheckRollup: Schema.optional(Schema.NullOr(Schema.Array(RawStatusCheckSchema))),
});

type RawGitHubPullRequestProbe = typeof RawGitHubPullRequestProbeSchema.Type;
type RawStatusCheck = typeof RawStatusCheckSchema.Type;

const decodeRawGitHubPullRequestProbe = Schema.decodeEffect(
  Schema.fromJsonString(RawGitHubPullRequestProbeSchema),
);

const CHECK_FAILURE_SIGNALS = new Set([
  "FAILURE",
  "ERROR",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);

const CHECK_PENDING_SIGNALS = new Set([
  "PENDING",
  "EXPECTED",
  "QUEUED",
  "IN_PROGRESS",
  "WAITING",
  "REQUESTED",
  "STALE",
]);

const CHECK_PASS_SIGNALS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

function checkSignal(check: RawStatusCheck): string {
  const conclusion = check.conclusion?.trim() ?? "";
  if (conclusion.length > 0) {
    return conclusion.toUpperCase();
  }
  const state = check.state?.trim() ?? "";
  if (state.length > 0) {
    return state.toUpperCase();
  }
  const status = check.status?.trim() ?? "";
  if (status.length > 0 && status.toUpperCase() !== "COMPLETED") {
    // A CheckRun that is not completed and has no conclusion is in flight.
    return "IN_PROGRESS";
  }
  return "";
}

/**
 * Collapse a `gh pr view --json statusCheckRollup` payload into the probe's
 * chip-sized checks state: any failing check wins, then any pending check,
 * then pass; an empty/unreported rollup is `unknown`.
 */
export function mapWorkspaceGitProbeChecksState(
  rollup: ReadonlyArray<RawStatusCheck> | null | undefined,
): WorkspaceGitProbeChecksState {
  if (!rollup || rollup.length === 0) {
    return "unknown";
  }

  let sawPending = false;
  let sawPass = false;
  for (const check of rollup) {
    const signal = checkSignal(check);
    if (CHECK_FAILURE_SIGNALS.has(signal)) {
      return "fail";
    }
    if (CHECK_PENDING_SIGNALS.has(signal)) {
      sawPending = true;
    } else if (CHECK_PASS_SIGNALS.has(signal)) {
      sawPass = true;
    }
  }

  if (sawPending) {
    return "pending";
  }
  return sawPass ? "pass" : "unknown";
}

/**
 * Map GitHub's PR lifecycle (`OPEN`/`CLOSED`/`MERGED` + `isDraft`) onto the
 * probe's four-state contract.
 */
export function mapWorkspaceGitProbePullRequestState(
  state: string,
  isDraft: boolean,
): WorkspaceGitProbePullRequestState {
  switch (state.trim().toUpperCase()) {
    case "MERGED":
      return "merged";
    case "CLOSED":
      return "closed";
    default:
      return isDraft ? "draft" : "open";
  }
}

function normalizeProbedPullRequest(
  raw: RawGitHubPullRequestProbe,
): WorkspaceGitProbePullRequest | null {
  if (!Number.isInteger(raw.number) || raw.number < 1) {
    return null;
  }
  return {
    number: raw.number,
    state: mapWorkspaceGitProbePullRequestState(raw.state, raw.isDraft ?? false),
    checks: mapWorkspaceGitProbeChecksState(raw.statusCheckRollup ?? null),
    url: raw.url ?? "",
  };
}

interface CachedProbe {
  readonly expiresAtMs: number;
  readonly result: WorkspaceGitProbeResult;
}

const makeWorkspaceGitProbe = Effect.gen(function* () {
  const gitCore = yield* GitCore;
  const gitHubCli = yield* GitHubCli;

  const cache = new Map<string, CachedProbe>();

  const remember = (cwd: string, nowMs: number, result: WorkspaceGitProbeResult) => {
    if (cache.size >= WORKSPACE_GIT_PROBE_CACHE_MAX_ENTRIES && !cache.has(cwd)) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) {
        cache.delete(oldestKey);
      }
    }
    cache.set(cwd, { expiresAtMs: nowMs + WORKSPACE_GIT_PROBE_TTL_MS, result });
    return result;
  };

  // PR resolution is graceful by contract: a missing/unauthenticated gh, a
  // branch without a PR, or malformed CLI output all yield `pr: null`.
  const probePullRequest = (cwd: string) =>
    gitHubCli
      .execute({
        cwd,
        args: ["pr", "view", "--json", "number,state,isDraft,url,statusCheckRollup"],
        timeoutMs: GH_PROBE_TIMEOUT_MS,
      })
      .pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed(null)
            : decodeRawGitHubPullRequestProbe(raw).pipe(Effect.map(normalizeProbedPullRequest)),
        ),
        Effect.catch(() => Effect.succeed(null)),
      );

  const probe: WorkspaceGitProbeShape["probe"] = (input) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const cached = cache.get(input.cwd);
      if (cached && cached.expiresAtMs > now) {
        return cached.result;
      }

      const local = yield* gitCore
        .statusDetailsLocal(input.cwd)
        .pipe(Effect.catch(() => Effect.succeed(null)));

      if (local === null || !local.isRepo) {
        return remember(input.cwd, now, { branch: null, ahead: null, behind: null, pr: null });
      }

      const pr = local.branch === null ? null : yield* probePullRequest(input.cwd);

      return remember(input.cwd, now, {
        branch: local.branch,
        ahead: local.hasUpstream ? local.aheadCount : null,
        behind: local.hasUpstream ? local.behindCount : null,
        pr,
      });
    });

  return { probe } satisfies WorkspaceGitProbeShape;
});

export const WorkspaceGitProbeLive = Layer.effect(WorkspaceGitProbe, makeWorkspaceGitProbe);
