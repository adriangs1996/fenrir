/**
 * Pretty-print + risk-detection helpers for shell commands shown in approval UI.
 *
 * Goals:
 * - Wrap long commands across multiple lines so users can read every flag.
 * - Highlight tokens that indicate destructive/dangerous behavior.
 * - Strip optional `Bash:` / `Shell:` provider prefix while preserving it for the caller.
 */

export interface CommandPrefixSplit {
  /** Optional prefix like "Bash" or "rtk-bash" the provider attached. */
  prefix: string | undefined;
  /** Raw command text without the prefix. */
  command: string;
}

/**
 * Provider adapters render approvals as `${toolName}: ${command}` (e.g. `Bash: rtk gcloud ...`).
 * Split the prefix back out so the UI can render it as a label.
 */
export function splitCommandPrefix(detail: string): CommandPrefixSplit {
  const match = /^([A-Za-z][A-Za-z0-9_-]*):\s+/.exec(detail);
  if (!match) {
    return { prefix: undefined, command: detail };
  }
  return { prefix: match[1], command: detail.slice(match[0].length) };
}

/** Tokens that should trigger a visual warning in the approval UI. */
export interface RiskySpan {
  /** Index of first character of risky span, in the original command. */
  start: number;
  /** Index after the last character of risky span. */
  end: number;
  /** Short reason shown to the user. */
  reason: string;
}

const RISKY_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(?:-[a-zA-Z]*[rRfF][a-zA-Z]*\s+)+\S+/g, reason: "recursive/forced delete" },
  { pattern: /\bsudo\b/g, reason: "elevated privileges" },
  { pattern: /\bdd\s+if=/g, reason: "raw disk write" },
  { pattern: /\bmkfs\.\S+/g, reason: "filesystem format" },
  { pattern: /\bchmod\s+[0-7]?777\b/g, reason: "world-writable permissions" },
  { pattern: /\bchown\s+(?:-R\s+)?root/g, reason: "ownership change to root" },
  { pattern: /\b(?:curl|wget)\s+[^|;&\n]*\|\s*(?:sh|bash|zsh)\b/g, reason: "remote pipe to shell" },
  { pattern: /\bgit\s+push\s+(?:--force|-f)\b/g, reason: "force push" },
  { pattern: /\bgit\s+reset\s+--hard\b/g, reason: "hard reset" },
  { pattern: /\bgit\s+clean\s+-[fdx]+/g, reason: "clean working tree" },
  { pattern: /\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b/gi, reason: "drop SQL object" },
  { pattern: /\bTRUNCATE\s+TABLE\b/gi, reason: "truncate table" },
  { pattern: /\b--force\b|\b--no-verify\b/g, reason: "bypass safety check" },
  { pattern: /\beval\s+["'`$]/g, reason: "eval of dynamic input" },
  { pattern: />\s*\/dev\/sd[a-z]/g, reason: "redirect to raw disk" },
  { pattern: /\s>\s*\/etc\/\S+/g, reason: "overwrite system config" },
];

/**
 * Scan a command and return the spans that look dangerous.
 * Spans are sorted by `start` and never overlap (later overlapping matches are dropped).
 */
export function findRiskySpans(command: string): ReadonlyArray<RiskySpan> {
  const spans: RiskySpan[] = [];
  for (const { pattern, reason } of RISKY_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(command)) !== null) {
      spans.push({ start: match.index, end: match.index + match[0].length, reason });
      if (match[0].length === 0) {
        pattern.lastIndex += 1;
      }
    }
  }
  spans.sort((a, b) => a.start - b.start);

  const merged: RiskySpan[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start < last.end) {
      // Drop overlapping later match — first detected wins.
      continue;
    }
    merged.push(span);
  }
  return merged;
}

/**
 * Pretty-print a long shell command across multiple lines.
 *
 * Rules:
 * - Break before any of `&&`, `||`, `|`, `;` and indent the continuation by two spaces.
 * - Break before long `--flag=...` arguments when the running line would exceed `maxLineLength`.
 * - Preserve quoted strings and comments verbatim — never split inside them.
 */
export function prettyPrintCommand(command: string, maxLineLength = 80): string {
  const tokens = tokenizeShellCommand(command);
  if (tokens.length === 0) return command;

  const lines: string[] = [];
  let current = "";

  const flush = (): void => {
    if (current.trimEnd().length > 0) {
      lines.push(current.trimEnd());
    }
    current = "";
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] as string;

    if (token === "&&" || token === "||" || token === "|" || token === ";") {
      flush();
      // Operator stays on its own continuation line, indented.
      current = `  ${token} `;
      continue;
    }

    const candidate =
      current.length === 0 ? token : `${current}${current.endsWith(" ") ? "" : " "}${token}`;

    const isLongFlag = token.startsWith("--") && token.length > 12;
    const wouldOverflow = candidate.length > maxLineLength;

    if (current.length > 0 && (wouldOverflow || (isLongFlag && current.length > 4))) {
      flush();
      current = `  ${token}`;
      continue;
    }

    current = candidate;
  }

  flush();
  return lines.join("\n");
}

/**
 * Tokenize a shell command, preserving quoted strings and `&&|||;` operators as standalone tokens.
 * Not a full shell parser — good enough for display purposes.
 */
export function tokenizeShellCommand(command: string): ReadonlyArray<string> {
  const tokens: string[] = [];
  let i = 0;
  const len = command.length;

  while (i < len) {
    const ch = command[i] as string;

    if (ch === " " || ch === "\t" || ch === "\n") {
      i += 1;
      continue;
    }

    // Operators
    if (ch === "&" && command[i + 1] === "&") {
      tokens.push("&&");
      i += 2;
      continue;
    }
    if (ch === "|" && command[i + 1] === "|") {
      tokens.push("||");
      i += 2;
      continue;
    }
    if (ch === "|") {
      tokens.push("|");
      i += 1;
      continue;
    }
    if (ch === ";") {
      tokens.push(";");
      i += 1;
      continue;
    }

    // Word — read until whitespace/operator, preserving quoted runs.
    let start = i;
    let buf = "";
    while (i < len) {
      const c = command[i] as string;
      if (c === " " || c === "\t" || c === "\n") break;
      if (c === "&" && command[i + 1] === "&") break;
      if (c === "|") break;
      if (c === ";") break;
      if (c === '"' || c === "'") {
        const quote = c;
        buf += c;
        i += 1;
        while (i < len) {
          const qc = command[i] as string;
          buf += qc;
          i += 1;
          if (qc === "\\" && i < len) {
            buf += command[i];
            i += 1;
            continue;
          }
          if (qc === quote) break;
        }
        continue;
      }
      buf += c;
      i += 1;
    }
    if (buf.length === 0) {
      // Defensive: avoid infinite loop on unexpected char.
      buf = command.slice(start, i + 1);
      i += 1;
    }
    tokens.push(buf);
  }

  return tokens;
}
