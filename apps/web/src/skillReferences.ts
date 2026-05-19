import type { ServerProviderSkill } from "@fenrir/contracts";

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

export function expandSkillReferences(
  text: string,
  skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "body">>,
): {
  text: string;
  expandedSkillNames: string[];
  unresolvedSkillNames: string[];
} {
  const matches = findSkillReferenceMatches(text);
  if (matches.length === 0) {
    return {
      text,
      expandedSkillNames: [],
      unresolvedSkillNames: [],
    };
  }

  const skillsByName = new Map(skills.map((skill) => [skill.name, skill]));
  const expandedSkillNames: string[] = [];
  const unresolvedSkillNames = new Set<string>();
  const parts: string[] = [];
  let cursor = 0;

  for (const match of matches) {
    const skill = skillsByName.get(match.name);
    if (!skill) {
      unresolvedSkillNames.add(match.name);
      continue;
    }

    if (match.start > cursor) {
      parts.push(text.slice(cursor, match.start));
    }
    parts.push(skill.body);
    cursor = match.end;
    expandedSkillNames.push(match.name);
  }

  if (expandedSkillNames.length === 0) {
    return {
      text,
      expandedSkillNames,
      unresolvedSkillNames: [...unresolvedSkillNames],
    };
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return {
    text: parts.join(""),
    expandedSkillNames,
    unresolvedSkillNames: [...unresolvedSkillNames],
  };
}
