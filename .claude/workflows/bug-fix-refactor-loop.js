export const meta = {
  name: "bug-fix-refactor-loop",
  description:
    "Iterative loop: scout one task (bug -> else architecture violation -> else oversized file), reproduce if bug, implement, record. Repeat until nothing found.",
  whenToUse:
    "Autonomous codebase improvement pass. Finds and fixes one issue per iteration, escalating from bugs to refactors, logging each fix so work is never repeated.",
  phases: [{ title: "Scout" }, { title: "Reproduce" }, { title: "Implement" }, { title: "Record" }],
};

// ---- Config -------------------------------------------------------------
// args: { maxIterations?: number, scope?: string, recordFile?: string }
const MAX_ITERS = (args && args.maxIterations) || 10;
const SCOPE = (args && args.scope) || "the whole repository";
const RECORD = (args && args.recordFile) || ".claude/bug-fix-refactor-loop.md";

// Project gates (AGENTS.md): never `bun test`.
const GATES =
  "`bun fmt`, `bun lint`, `bun typecheck`; plus relevant `bun run test` coverage when tests or behavior changed";

// ---- Schemas ------------------------------------------------------------
const TASK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["found", "kind", "title", "description", "files", "rationale"],
  properties: {
    found: { type: "boolean", description: "true if a task was detected this iteration" },
    kind: { type: "string", enum: ["bug", "architecture", "large-file", "none"] },
    title: {
      type: "string",
      description: "short stable identifier for the task, used in the record",
    },
    description: { type: "string", description: "what is wrong / what to change" },
    files: { type: "array", items: { type: "string" }, description: "relevant file paths" },
    rationale: {
      type: "string",
      description: "why this is the highest-priority task and why it is not already in the record",
    },
  },
};

const REPRO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["testFile", "fails", "notes"],
  properties: {
    testFile: { type: "string", description: "path to the test that reproduces the bug" },
    fails: {
      type: "boolean",
      description: "true only if the new test fails against current code (red)",
    },
    notes: { type: "string", description: "what was mocked (if anything) and why" },
  },
};

const DONE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["completed", "gatesPass", "summary"],
  properties: {
    completed: { type: "boolean" },
    gatesPass: { type: "boolean", description: "true only if all gates pass" },
    summary: { type: "string" },
  },
};

// ---- Loop ---------------------------------------------------------------
const log_done = [];

for (let i = 1; i <= MAX_ITERS; i++) {
  if (budget.total && budget.remaining() < 80_000) {
    log(
      `Budget low (${Math.round(budget.remaining() / 1000)}k left). Stopping before iteration ${i}.`,
    );
    break;
  }

  log(`Iteration ${i}/${MAX_ITERS}`);
  phase("Scout");

  // --- Scout: escalate tiers, skip anything already in the record -------
  const task = await agent(
    `You are the SCOUT for an autonomous fix/refactor loop over ${SCOPE}.

First, READ the record file \`${RECORD}\` if it exists. Treat every task already listed there as DONE - never resurface it. Also skip anything marked attempted/skipped there.

Find exactly ONE task, escalating through tiers IN ORDER. Only move to the next tier if the current tier yields nothing new:
  1. BUG - a real defect or deviation from intended behavior (wrong logic, broken edge case, contract violation, race, incorrect error handling). Read code, don't guess. Must be concrete and reproducible.
  2. ARCHITECTURE - a violation of the project's layering/provider-interface conventions (see AGENTS.md: provider-agnostic interface, shared logic not duplicated, consistent software layers per slice). Pick the most impactful.
  3. LARGE-FILE - an oversized file doing too much that genuinely warrants extraction into modules. Prefer the file with worst size-to-cohesion.

Return the single highest-priority task found. If ALL three tiers are exhausted with nothing new, return found=false, kind="none".

Be precise in \`title\` - it is the dedupe key written to the record. Do NOT modify any files.`,
    { phase: "Scout", label: `scout#${i}`, schema: TASK_SCHEMA, agentType: "Explore" },
  );

  if (!task || !task.found || task.kind === "none") {
    log(`Nothing left to do (iteration ${i}). Terminating.`);
    break;
  }

  log(`[${task.kind}] ${task.title}`);

  // --- Reproduce (bugs only): failing test, minimal mocking -------------
  let repro = null;
  if (task.kind === "bug") {
    phase("Reproduce");
    repro = await agent(
      `Write a test that REPRODUCES this bug. It must FAIL against the current (unfixed) code.

Task: ${task.title}
Details: ${task.description}
Files: ${(task.files || []).join(", ")}

Rules:
- Mock as little as possible. Only mock what is strictly necessary (true external boundaries). Prefer real code paths.
- Follow existing test conventions in the nearest *.test.ts files.
- Run the test with \`bun run test\` (NEVER \`bun test\`) and confirm it is RED for the right reason.
- Do NOT fix the bug yet. Only add the failing test.

Return the test file path and whether it fails.`,
      { phase: "Reproduce", label: `repro#${i}`, schema: REPRO_SCHEMA },
    );
    if (repro && !repro.fails) {
      log(`Repro test not red - scout claim unconfirmed. Recording as unverified, skipping fix.`);
    }
  }

  // --- Implement --------------------------------------------------------
  phase("Implement");
  const verb = task.kind === "bug" ? "Fix the bug" : "Perform the refactor";
  const reproLine =
    repro && repro.fails
      ? `A failing test already exists at \`${repro.testFile}\`. Make it pass without weakening it.`
      : "";
  const guard =
    task.kind === "bug" && repro && !repro.fails
      ? "NOTE: the reproduction test did not fail, so the bug is unconfirmed. Investigate; if there is no real bug, make NO code changes and say so."
      : "";

  const impl = await agent(
    `${verb} for this task in ${SCOPE}.

Task: ${task.title}
Details: ${task.description}
Files: ${(task.files || []).join(", ")}
${reproLine}
${guard}

Requirements:
- Reuse existing modules/functions; do NOT duplicate logic (AGENTS.md). Keep changes behind the common provider interface where relevant.
- For refactors: preserve behavior exactly; move/extract, don't rewrite semantics.
- Make the change minimal and focused on THIS task only.
- All gates must pass before you finish: ${GATES}. Never run \`bun test\`.

Return whether you completed it and whether all gates pass.`,
    { phase: "Implement", label: `impl#${i}`, schema: DONE_SCHEMA },
  );

  // --- Record: append to log so work is never repeated ------------------
  phase("Record");
  await agent(
    `Append ONE entry to the record file \`${RECORD}\` (create it with a markdown header if missing). Do not edit prior entries.

Entry must include:
- Iteration: ${i}
- Kind: ${task.kind}
- Title: ${task.title}  (this is the dedupe key - keep it stable and exact)
- What was done: ${impl ? impl.summary : "no implementation result returned"}
- Test: ${repro ? repro.testFile + (repro.fails ? " (reproduced red -> now green)" : " (did not reproduce - unverified)") : "n/a"}
- Gates pass: ${impl ? impl.gatesPass : "unknown"}
- Status: ${impl && impl.completed && impl.gatesPass ? "DONE" : "INCOMPLETE/SKIPPED"}

Then VALIDATE: run ${GATES} once more (never \`bun test\`) and confirm the tree is green. State clearly if anything is broken so the next iteration can react.`,
    { phase: "Record", label: `record#${i}` },
  );

  log_done.push({
    iteration: i,
    kind: task.kind,
    title: task.title,
    completed: impl ? impl.completed : false,
    gatesPass: impl ? impl.gatesPass : false,
  });
}

return { iterations: log_done.length, tasks: log_done, recordFile: RECORD };
