export const meta = {
  name: "upstream-sync",
  description:
    "Pull upstream pingdotgg/t3code, find portable improvements, classify, implement, verify, and grow durable learnings",
  whenToUse:
    "Periodically harvest features/fixes/optimizations from the upstream project this repo was forked from, with a self-improving feedback loop.",
  phases: [
    {
      title: "Scout",
      detail: "update references/t3code, read learnings, list candidate improvements",
    },
    { title: "Classify", detail: "decide portable / adapt / skip given how far the fork diverged" },
    { title: "Implement", detail: "apply each portable improvement (serial, one working tree)" },
    { title: "Verify", detail: "run test/lint/typecheck + per-change UX check" },
    { title: "Consolidate", detail: "curate LEARNINGS.md and STATE.md; emit run report" },
  ],
};

// ---- Tunables (override via Workflow args) -------------------------------
// args.maxImplement : max portable improvements to actually implement this run
// args.lookback     : commits to scan when STATE has no last-synced SHA
// args.dryRun       : true => Scout+Classify only, no edits
const MAX_IMPLEMENT = (args && args.maxImplement) || 3;
const LOOKBACK = (args && args.lookback) || 80;
const DRY_RUN = !!(args && args.dryRun);

const LEARNINGS = "docs/upstream-sync/LEARNINGS.md";
const STATE = "docs/upstream-sync/STATE.md";

// ---- Schemas -------------------------------------------------------------
const DISCOVERY_SCHEMA = {
  type: "object",
  required: ["lastSyncedSha", "newHeadSha", "learnings", "candidates"],
  properties: {
    lastSyncedSha: {
      type: "string",
      description: 'previously evaluated upstream SHA, or "" if none',
    },
    newHeadSha: { type: "string", description: "current upstream HEAD SHA after pulling" },
    learnings: { type: "string", description: "verbatim relevant content of LEARNINGS.md" },
    candidates: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "title", "kind", "commits", "summary", "upstreamPaths"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          kind: { type: "string", enum: ["feature", "fix", "optimization", "refactor", "other"] },
          commits: { type: "array", items: { type: "string" } },
          summary: { type: "string" },
          upstreamPaths: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

const CLASSIFY_SCHEMA = {
  type: "object",
  required: ["id", "verdict", "rationale", "effort", "value", "targetPaths", "plan"],
  properties: {
    id: { type: "string" },
    verdict: { type: "string", enum: ["portable", "adapt", "skip"] },
    rationale: { type: "string" },
    effort: { type: "string", enum: ["low", "medium", "high"] },
    value: { type: "string", enum: ["low", "medium", "high"] },
    targetPaths: {
      type: "array",
      items: { type: "string" },
      description: "where it lands in THIS repo",
    },
    plan: { type: "string", description: "concise port plan respecting Fenrir architecture" },
  },
};

const IMPL_SCHEMA = {
  type: "object",
  required: ["id", "status", "changedPaths", "gateResults", "notes"],
  properties: {
    id: { type: "string" },
    status: { type: "string", enum: ["done", "partial", "aborted"] },
    changedPaths: { type: "array", items: { type: "string" } },
    gateResults: {
      type: "object",
      required: ["fmt", "lint", "typecheck"],
      properties: {
        fmt: { type: "string" },
        lint: { type: "string" },
        typecheck: { type: "string" },
      },
    },
    notes: {
      type: "string",
      description: "what worked / what fought back — raw material for learnings",
    },
  },
};

const VERIFY_SCHEMA = {
  type: "object",
  required: ["overall", "testResult", "perChange", "regressions", "uxAssessment"],
  properties: {
    overall: { type: "string", enum: ["pass", "fail", "mixed"] },
    testResult: { type: "string" },
    perChange: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "status", "evidence"],
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: ["ok", "broken", "unverified"] },
          evidence: { type: "string" },
        },
      },
    },
    regressions: { type: "array", items: { type: "string" } },
    uxAssessment: {
      type: "string",
      description: "did user-facing experience stay good or improve?",
    },
  },
};

// ==========================================================================
// Phase 1 — Scout: update the upstream clone and surface candidates
// ==========================================================================
phase("Scout");
const discovery = await agent(
  `You are the UPSTREAM SCOUT for the Fenrir repo (a hard fork of pingdotgg/t3code).

STEP 1 — Read the durable memory (use the Read tool):
  - ${LEARNINGS}
  - ${STATE}  (extract the "Last evaluated upstream SHA")
Return the relevant LEARNINGS content verbatim in the "learnings" field so later agents inherit it.

STEP 2 — Update the upstream clone at references/t3code:
  - git -C references/t3code fetch origin --prune
  - git -C references/t3code pull --ff-only origin main   (if it fails, log and continue read-only)
  - Capture current upstream HEAD: git -C references/t3code rev-parse HEAD  -> newHeadSha

STEP 3 — Find candidate improvements introduced upstream that we have NOT yet evaluated:
  - If STATE has a last-synced SHA, diff range = <sha>..HEAD on the clone.
  - Otherwise scan the most recent ${LOOKBACK} commits.
  - Use: git -C references/t3code log --oneline and git -C references/t3code show <sha> --stat as needed.
  - Group related commits into coherent candidates (a feature may span several commits).

CANDIDATE FILTER — keep only things with real value to THIS fork:
  - features, bug fixes, performance optimizations, meaningful refactors.
  DROP: version bumps, branding/copy, lockfile churn, changes to areas Fenrir
  has already rewritten beyond recognition, anything matching a known pitfall in LEARNINGS.

For each candidate record id (kebab-case), title, kind, the upstream commit SHAs,
a short summary of the user-facing or technical benefit, and the upstream file paths touched.
Return ALL candidates you find (do not pre-limit). Output the schema only.`,
  { phase: "Scout", schema: DISCOVERY_SCHEMA },
);

log(
  `Scout: ${discovery.candidates.length} candidate(s) since ${discovery.lastSyncedSha || "(initial)"} -> head ${discovery.newHeadSha.slice(0, 9)}`,
);

if (discovery.candidates.length === 0) {
  return {
    ran: true,
    candidates: 0,
    message: "Upstream had nothing new worth porting.",
    newHeadSha: discovery.newHeadSha,
  };
}

// ==========================================================================
// Phase 2 — Classify: portable / adapt / skip, given fork divergence
// ==========================================================================
phase("Classify");
const classified = (
  await parallel(
    discovery.candidates.map(
      (c) => () =>
        agent(
          `You are the PORTABILITY JUDGE for the Fenrir fork of pingdotgg/t3code.

DURABLE LEARNINGS (obey architecture & mapping rules here):
${discovery.learnings}

CANDIDATE:
${JSON.stringify(c, null, 2)}

The fork has diverged HARD. Compare the upstream implementation against this repo:
  - Upstream code lives under references/t3code/<path>.
  - Read the corresponding area in THIS repo (apps/*, packages/*) to see how far it drifted.
  - Remember Fenrir wraps agent interactions behind a provider interface, prefers
    websockets over IPC, and uses Effect v4.

Decide:
  - "portable"  : applies almost as-is to our code.
  - "adapt"     : valuable but must be reshaped to our architecture (give the plan).
  - "skip"      : not worth it (already have it, conflicts with our design, or low value).

Set effort, value, the targetPaths in OUR repo, and a concise port plan.
Be skeptical: when value is low or it touches a rewritten subsystem, prefer "skip".
Output the schema only.`,
          { label: `classify:${c.id}`, phase: "Classify", schema: CLASSIFY_SCHEMA },
        ),
    ),
  )
).filter(Boolean);

const portable = classified
  .filter((c) => c.verdict === "portable" || c.verdict === "adapt")
  .sort((a, b) => rank(b) - rank(a))
  .slice(0, MAX_IMPLEMENT);

log(
  `Classify: ${classified.filter((c) => c.verdict !== "skip").length} bringable, implementing top ${portable.length} (cap ${MAX_IMPLEMENT})`,
);

if (DRY_RUN || portable.length === 0) {
  return {
    ran: true,
    dryRun: DRY_RUN,
    newHeadSha: discovery.newHeadSha,
    classified,
    implemented: [],
    note: DRY_RUN ? "dry run — no edits applied" : "nothing classified as bringable",
  };
}

// ==========================================================================
// Phase 3 — Implement: SERIAL on one working tree (correctness > speed)
// ==========================================================================
phase("Implement");
const implemented = [];
for (const item of portable) {
  const candidate = discovery.candidates.find((c) => c.id === item.id);
  const result = await agent(
    `You are the IMPLEMENTER porting an upstream improvement into the Fenrir repo.

DURABLE LEARNINGS (follow them — they encode how we do things here):
${discovery.learnings}

CLASSIFICATION & PLAN:
${JSON.stringify(item, null, 2)}

UPSTREAM CANDIDATE (reference implementation under references/t3code):
${JSON.stringify(candidate, null, 2)}

RULES:
  - Implement the plan in THIS repo's working tree. Do NOT touch references/t3code.
  - Match surrounding code: same layering, naming, provider interface, Effect v4 idioms.
  - Reuse existing modules/helpers before writing new ones (no duplication).
  - When porting "adapt" work, reshape to our architecture rather than copying verbatim.
  - After editing, run the gates and capture exact results:
      bun fmt   (oxfmt)
      bun lint  (oxlint)
      bun typecheck
    Fix what you can. If a gate still fails, set status "partial" and explain in notes.
    If the change proves infeasible without large collateral edits, revert your edits
    (git checkout -- <paths>) and set status "aborted".
  - notes: capture what worked and what fought back — this becomes durable learnings.
Output the schema only.`,
    { label: `impl:${item.id}`, phase: "Implement", schema: IMPL_SCHEMA },
  );
  if (result) implemented.push(result);
  log(`Implement ${item.id}: ${result ? result.status : "agent died"}`);
}

const landed = implemented.filter((r) => r.status !== "aborted");

// ==========================================================================
// Phase 4 — Verify: full suite + per-change UX check
// ==========================================================================
phase("Verify");
const verification = await agent(
  `You are the VERIFIER. Implementers just ported ${landed.length} upstream improvement(s)
into the working tree. Confirm nothing broke and the user experience held or improved.

CHANGES UNDER TEST:
${JSON.stringify(
  landed.map((r) => ({ id: r.id, status: r.status, changedPaths: r.changedPaths })),
  null,
  2,
)}

DO:
  1. Run the gates fresh: bun typecheck, bun lint, bun fmt:check.
  2. Run the test suite: bun run test  (NEVER 'bun test'). Capture pass/fail + failing names.
  3. For each change, judge ok / broken / unverified with concrete evidence
     (a passing test, a typecheck clean, a code read). Be honest about "unverified".
  4. uxAssessment: reason about whether the user-facing behavior stayed good or improved.
     Flag any regression in responsiveness, predictability, or reliability.
  5. List regressions precisely (file + symptom) so they can be fixed or learned from.
Output the schema only.`,
  { phase: "Verify", schema: VERIFY_SCHEMA },
);
log(`Verify: ${verification.overall} — ${verification.regressions.length} regression(s)`);

// ==========================================================================
// Phase 5 — Consolidate: curate durable learnings + advance state
// ==========================================================================
phase("Consolidate");
const consolidation = await agent(
  `You are the LEARNING CURATOR. Update the durable memory so the NEXT run is faster
and more correct. Quality of learnings > quantity.

RUN OUTCOMES:
  classified:   ${JSON.stringify(classified, null, 2)}
  implemented:  ${JSON.stringify(implemented, null, 2)}
  verification: ${JSON.stringify(verification, null, 2)}
  newHeadSha:   ${discovery.newHeadSha}

TASK A — Rewrite ${LEARNINGS} (Read it first, then Edit/Write):
  Fold in ONLY durable, reusable learnings under the existing sections
  (Architecture & mapping rules / Test patterns / Tooling / Known pitfalls):
    - a mapping rule confirmed this run (upstream path -> our path)
    - a test pattern that caught (or should have caught) a regression
    - a tool/command that solved a specific problem
    - a pitfall that broke a gate/test, WITH the fix
  RUTHLESSLY reject fatuous entries (see the file's own "fatuous" list): no
  restating the obvious, no one-off trivia, nothing already in AGENTS.md/CLAUDE.md.
  Merge with / dedupe existing entries; keep the file small and high-signal.

TASK B — Update ${STATE} (Read then Write):
  - Set "Last evaluated upstream SHA" to ${discovery.newHeadSha}.
  - Replace "Last run summary" with a terse summary: counts (candidates/bringable/
    implemented/landed), verify verdict, and any regressions still open.

Return a one-paragraph human summary of what this run accomplished and what is left.`,
  { phase: "Consolidate" },
);

return {
  ran: true,
  newHeadSha: discovery.newHeadSha,
  counts: {
    candidates: discovery.candidates.length,
    bringable: classified.filter((c) => c.verdict !== "skip").length,
    implemented: implemented.length,
    landed: landed.length,
  },
  verify: verification.overall,
  regressions: verification.regressions,
  summary: consolidation,
};

// ---- helpers -------------------------------------------------------------
function rank(c) {
  const v = { low: 1, medium: 2, high: 3 };
  const e = { low: 3, medium: 2, high: 1 }; // lower effort ranks higher
  return (v[c.value] || 0) * 2 + (e[c.effort] || 0);
}
