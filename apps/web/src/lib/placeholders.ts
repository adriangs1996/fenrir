const PLACEHOLDER_REGEX = /\{\{(\w+)\}\}/g;

export function parsePlaceholders(command: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of command.matchAll(PLACEHOLDER_REGEX)) {
    const name = match[1]!;
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

export function substitutePlaceholders(command: string, values: Record<string, string>): string {
  return command.replace(PLACEHOLDER_REGEX, (full, name: string) =>
    name in values ? values[name]! : full,
  );
}
