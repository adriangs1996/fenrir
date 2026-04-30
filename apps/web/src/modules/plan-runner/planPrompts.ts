export const NEW_PLAN_PROMPT = `Help me break down a new feature into implementation plans.

Create a \`.plans/{featureName}/\` directory with .md plan files. Each plan should have YAML frontmatter with:
- id: unique identifier
- depends_on: array of plan IDs this depends on
- max_retries: number (default 2)

Then the markdown body with the full implementation plan.

Feature to plan: `;

export function buildPlanRefinementPrompt(input: { filename: string; content: string }): string {
  return `Here is a plan file I'd like to refine:\n\n# ${input.filename}\n${input.content}\n\nPlease update this plan based on the following feedback:\n`;
}
