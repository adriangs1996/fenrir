export const NEW_PLAN_PROMPT = `
Help me break down a new feature into implementation plans.

If this project does not contains sub-projects then
  Create a \`.plans/{featureName}/\` directory with .md plan files.
Else:
  Create a \`{projectName}/.plans/{featureName}/\` directory with .md plan files
  for each project this feature might affect.

A subproject usually referes to git submodules or gitignored folders that contain
other git repos. Packages in a monorepo are not considered subprojects.

Each plan should have YAML frontmatter with:
- id: unique identifier
- depends_on: array of plan IDs this depends on

Then the markdown body with the full implementation plan.
Each plan should be specific and small enough for an agent to be completed
without to much effort. The plan can include code snippets, and
concrete instructions for the agent to follow.

Interview me relentlessly about every aspect of this feature until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.
Do one question at a time.

If a question can be answered by exploring the codebase, explore the codebase instead.

Feature to plan: \n\n`;

export function buildNewPlanComposerPrompt(currentPrompt: string): string {
  if (currentPrompt.trim().length === 0) {
    return NEW_PLAN_PROMPT;
  }
  if (
    currentPrompt.startsWith(NEW_PLAN_PROMPT) ||
    currentPrompt.startsWith(NEW_PLAN_PROMPT.trimStart())
  ) {
    return currentPrompt;
  }
  return `${NEW_PLAN_PROMPT}${currentPrompt}`;
}

export function buildPlanRefinementPrompt(input: { filename: string; content: string }): string {
  return `Here is a plan file I'd like to refine:\n\n# @${input.filename}\n\nPlease update this plan based on the following feedback:\n`;
}
