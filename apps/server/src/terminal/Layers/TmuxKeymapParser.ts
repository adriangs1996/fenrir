/**
 * Pure parsers for the effective tmux keymap export (D-028).
 *
 * The server ships RAW tmux strings to clients: `list-keys` lines are split
 * into table/key/repeat, and the remainder of each line is kept verbatim as
 * the command. No command interpretation happens here — mapping raw commands
 * to typed actions is the client's job.
 */

export interface ParsedTmuxKeyBinding {
  readonly table: string;
  readonly key: string;
  readonly repeat: boolean;
  readonly command: string;
}

interface TokenRead {
  readonly value: string;
  readonly end: number;
}

const isSpace = (character: string | undefined): boolean => character === " " || character === "\t";

/**
 * Reads one whitespace-delimited token starting at `start`, honoring the
 * quoting/escaping tmux `list-keys` uses for keys and option values:
 * double-quoted (`"M-{"`, with `\"`/`\\` escapes), single-quoted, and bare
 * tokens with backslash escapes (`\;`, `\"`, `\%`, ...). Returns the literal
 * (unescaped) value.
 */
const readToken = (line: string, start: number): TokenRead | null => {
  let index = start;
  while (index < line.length && isSpace(line[index])) index += 1;
  if (index >= line.length) return null;

  const quote = line[index];
  if (quote === '"' || quote === "'") {
    let value = "";
    index += 1;
    while (index < line.length) {
      const character = line[index]!;
      if (quote === '"' && character === "\\" && index + 1 < line.length) {
        value += line[index + 1];
        index += 2;
        continue;
      }
      if (character === quote) {
        return { value, end: index + 1 };
      }
      value += character;
      index += 1;
    }
    // Unterminated quote: keep what was read rather than dropping the entry.
    return { value, end: index };
  }

  let value = "";
  while (index < line.length && !isSpace(line[index])) {
    const character = line[index]!;
    if (character === "\\" && index + 1 < line.length && !isSpace(line[index + 1])) {
      value += line[index + 1];
      index += 2;
      continue;
    }
    value += character;
    index += 1;
  }
  return { value, end: index };
};

const stripTrailingCarriageReturn = (line: string): string =>
  line.endsWith("\r") ? line.slice(0, -1) : line;

interface MutableBinding {
  table: string;
  key: string;
  repeat: boolean;
  command: string;
}

/**
 * Parses `tmux list-keys` output into raw bindings.
 *
 * Each entry has the shape `bind-key [-r] -T <table> <key> <command...>`.
 * Lines that do not start with `bind-key` are treated as continuations of the
 * previous entry's command (multi-line payloads, e.g. display-menu blocks
 * containing literal newlines) so they never corrupt neighbouring entries.
 */
export const parseTmuxListKeysOutput = (output: string): readonly ParsedTmuxKeyBinding[] => {
  const lines = output.split("\n");
  if (lines.at(-1) === "") lines.pop();

  const bindings: MutableBinding[] = [];

  for (const rawLine of lines) {
    const line = stripTrailingCarriageReturn(rawLine);

    if (!line.startsWith("bind-key") || !isSpace(line["bind-key".length])) {
      const previous = bindings.at(-1);
      if (previous) previous.command += `\n${line}`;
      continue;
    }

    let cursor = "bind-key".length;
    let repeat = false;
    // tmux binds without an explicit table into the prefix table; list-keys
    // always prints -T on modern tmux, this is only a defensive default.
    let table = "prefix";
    let key: string | null = null;

    while (key === null) {
      const token = readToken(line, cursor);
      if (!token) break;
      if (token.value === "-r") {
        repeat = true;
        cursor = token.end;
        continue;
      }
      if (token.value === "-T" || token.value === "-N") {
        const argument = readToken(line, token.end);
        if (!argument) break;
        if (token.value === "-T") table = argument.value;
        cursor = argument.end;
        continue;
      }
      key = token.value;
      cursor = token.end;
    }

    // Malformed line (no key token): skip it rather than corrupting output.
    if (key === null || key.length === 0) continue;

    let commandStart = cursor;
    while (commandStart < line.length && isSpace(line[commandStart])) commandStart += 1;
    // The command is the remainder of the line VERBATIM (quotes, braces,
    // escaped semicolons and all) — no server-side interpretation.
    const command = line.slice(commandStart);

    bindings.push({ table, key, repeat, command });
  }

  return bindings;
};

/**
 * Extracts the value of one option from `tmux show-options -g <name>` output
 * (`<name> <value>`). Returns null when the option is absent from the output.
 */
export const parseTmuxGlobalOptionValue = (output: string, option: string): string | null => {
  for (const rawLine of output.split("\n")) {
    const line = stripTrailingCarriageReturn(rawLine).trim();
    if (!line.startsWith(option)) continue;
    const rest = line.slice(option.length);
    if (rest.length > 0 && !isSpace(rest[0])) continue;
    const token = readToken(line, option.length);
    return token?.value ?? null;
  }
  return null;
};

/**
 * Parses a prefix option value. tmux reports an unset secondary prefix as
 * `None`, which maps to null.
 */
export const parseTmuxPrefixKey = (output: string, option: string): string | null => {
  const value = parseTmuxGlobalOptionValue(output, option);
  if (value === null || value.length === 0 || value === "None") return null;
  return value;
};

export const parseTmuxRepeatTimeMs = (output: string): number | null => {
  const value = parseTmuxGlobalOptionValue(output, "repeat-time");
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 0) return null;
  return parsed;
};
