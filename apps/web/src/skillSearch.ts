import type { ServerProviderSkill } from "@fenrir/contracts";

// ─── Scoring weights ───────────────────────────────────────────────────────

const WEIGHT_NAME = 5;
const WEIGHT_DISPLAY_NAME = 4;
const WEIGHT_DESCRIPTION = 3;
const WEIGHT_TAGS = 2;
const WEIGHT_BODY = 1;

function scoreField(field: string, query: string, weight: number): number {
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
  score += scoreField(skill.description, query, WEIGHT_DESCRIPTION);

  for (const tag of skill.tags) {
    score += scoreField(tag, query, WEIGHT_TAGS);
  }

  // Body: substring only — no prefix/exact bonus
  const lowerBody = skill.body.toLowerCase();
  const lowerQuery = query.toLowerCase();
  if (lowerBody.includes(lowerQuery)) {
    score += WEIGHT_BODY * 2;
  } else {
    const tokens = lowerQuery.split(/\s+/).filter(Boolean);
    const matchedTokens = tokens.filter((token) => lowerBody.includes(token));
    if (matchedTokens.length > 0) {
      score += WEIGHT_BODY * (matchedTokens.length / tokens.length);
    }
  }

  return score;
}

/**
 * Search skills against a query string.
 * Scores each skill across name, displayName, description, tags, and body.
 * Returns results sorted by score descending, zero-score entries excluded.
 */
export function searchProviderSkills(
  skills: readonly ServerProviderSkill[],
  query: string,
): ServerProviderSkill[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return [...skills];
  }

  const scored = skills
    .map((skill) => ({ skill, score: scoreSkill(skill, trimmed) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map(({ skill }) => skill);
}
