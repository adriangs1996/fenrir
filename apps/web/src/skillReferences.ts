export const SKILL_REFERENCE_REGEX = /(^|\s)\$([a-zA-Z][a-zA-Z0-9:_-]*)(?=\s|$)/g;

export interface SkillReferenceMatch {
  name: string;
  rawText: string;
  start: number;
  end: number;
}

export function formatSkillReferenceToken(name: string): string {
  return `$${name}`;
}

export function findSkillReferenceMatches(text: string): SkillReferenceMatch[] {
  const matches: SkillReferenceMatch[] = [];
  SKILL_REFERENCE_REGEX.lastIndex = 0;

  for (const match of text.matchAll(SKILL_REFERENCE_REGEX)) {
    const prefix = match[1] ?? "";
    const name = match[2] ?? "";
    const start = (match.index ?? 0) + prefix.length;
    const rawText = formatSkillReferenceToken(name);
    matches.push({
      name,
      rawText,
      start,
      end: start + rawText.length,
    });
  }

  return matches;
}
