import type { ServerProviderSkill } from "@fenrir/contracts";

const WEIGHT_NAME = 5;
const WEIGHT_DISPLAY_NAME = 4;
const WEIGHT_SHORT_DESCRIPTION = 3;
const WEIGHT_DESCRIPTION = 2;
const WEIGHT_SCOPE = 1;

function scoreField(field: string | undefined, query: string, weight: number): number {
  if (!field) return 0;
  const lowerField = field.toLowerCase();
  const lowerQuery = query.toLowerCase();

  if (lowerField === lowerQuery) {
    return weight * 4;
  }
  if (lowerField.startsWith(lowerQuery)) {
    return weight * 3;
  }
  if (lowerField.includes(lowerQuery)) {
    return weight * 2;
  }
  // Partial word match: any query token found in field
  const tokens = lowerQuery.split(/\s+/).filter(Boolean);
  const matchedTokens = tokens.filter((token) => lowerField.includes(token));
  if (matchedTokens.length > 0) {
    return weight * (matchedTokens.length / tokens.length);
  }
  return 0;
}

function scoreSkill(skill: ServerProviderSkill, query: string): number {
  let score = 0;

  score += scoreField(skill.name, query, WEIGHT_NAME);
  score += scoreField(skill.displayName, query, WEIGHT_DISPLAY_NAME);
  score += scoreField(skill.shortDescription, query, WEIGHT_SHORT_DESCRIPTION);
  score += scoreField(skill.description, query, WEIGHT_DESCRIPTION);
  score += scoreField(skill.scope, query, WEIGHT_SCOPE);

  return score;
}

function dedupeSkillsByName(skills: readonly ServerProviderSkill[]): ServerProviderSkill[] {
  const seenNames = new Set<string>();
  const deduped: ServerProviderSkill[] = [];

  for (const skill of skills) {
    if (seenNames.has(skill.name)) {
      continue;
    }
    seenNames.add(skill.name);
    deduped.push(skill);
  }

  return deduped;
}

/**
 * Search skills against a query string.
 * Scores each provider-reported skill across name, displayName, description, and scope.
 * Returns prompt-addressable skill names once, sorted by score descending, zero-score entries excluded.
 */
export function searchProviderSkills(
  skills: readonly ServerProviderSkill[],
  query: string,
): ServerProviderSkill[] {
  const enabledSkills = skills.filter((skill) => skill.enabled);
  const trimmed = query.trim();
  if (!trimmed) {
    return dedupeSkillsByName(enabledSkills);
  }

  const scored = enabledSkills
    .map((skill) => ({ skill, score: scoreSkill(skill, trimmed) }))
    .filter(({ score }) => score > 0)
    .toSorted((a, b) => b.score - a.score);

  return dedupeSkillsByName(scored.map(({ skill }) => skill));
}
