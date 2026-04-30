export const NEW_PLAN_PROMPT = `
Help me break down a new feature into implementation plans.

Create a \`.plans/{featureName}/\` directory with .md plan files. Each plan should have YAML frontmatter with:
- id: unique identifier
- depends_on: array of plan IDs this depends on

Then the markdown body with the full implementation plan.

Interview me relentlessly about every aspect of this feature until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.
Do one question at a time.

If a question can be answered by exploring the codebase, explore the codebase instead.

Feature to plan: `;

export function buildPlanRefinementPrompt(input: {
  filename: string;
  content: string;
}): string {
  return `Here is a plan file I'd like to refine:\n\n# @${input.filename}\n\nPlease update this plan based on the following feedback:\n`;
}
