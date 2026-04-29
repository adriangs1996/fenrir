import type { Terminal } from "@xterm/xterm";

/**
 * Heuristic: detect lines that look like a shell prompt.
 * Covers bash (`$`), zsh (`%`), root (`#`), and custom prompts (`❯`, `➜`, `›`, `»`).
 */
export function looksLikePromptLine(line: string): boolean {
  const trimmed = line.trimEnd();
  if (trimmed.length === 0 || trimmed.length > 500) return false;
  // Custom prompt characters — very reliable signals
  if (/[❯➜›»](\s|$)/.test(trimmed)) return true;
  // user@host:path$ or [user@host path]$ patterns
  if (/\w@[\w.-]+[^$#]*[$#]\s/.test(trimmed)) return true;
  // Line ends with $ or # (minimal prompts, finished commands)
  if (/[$#]\s*$/.test(trimmed)) return true;
  // zsh-style: path followed by % (with optional trailing space or at end of line)
  if (/^[~/].*%(\s|$)/.test(trimmed)) return true;
  return false;
}

/**
 * Extract the output of the last command from the terminal buffer.
 * Walks backward from the end to find two prompt-like lines;
 * the text between them is the last command's output.
 */
export function extractLastCommandOutput(terminal: Terminal): string | null {
  const buffer = terminal.buffer.active;
  const totalRows = buffer.baseY + terminal.rows;

  // Read all lines from buffer
  const lines: string[] = [];
  for (let i = 0; i < totalRows; i++) {
    const bufferLine = buffer.getLine(i);
    if (!bufferLine) continue;
    lines.push(bufferLine.translateToString(true));
  }

  // Trim trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") {
    lines.pop();
  }

  if (lines.length === 0) return null;

  // Walk backward to find the last two prompt lines
  const promptIndices: number[] = [];
  for (let i = lines.length - 1; i >= 0 && promptIndices.length < 2; i--) {
    if (looksLikePromptLine(lines[i]!)) {
      promptIndices.unshift(i);
    }
  }

  if (promptIndices.length === 2) {
    // Output is between the two prompt lines
    const outputLines = lines.slice(promptIndices[0]! + 1, promptIndices[1]!);
    const text = outputLines.join("\n").trimEnd();
    return text.length > 0 ? text : null;
  }

  if (promptIndices.length === 1) {
    // Only one prompt found — return everything after it
    const outputLines = lines.slice(promptIndices[0]! + 1);
    const text = outputLines.join("\n").trimEnd();
    return text.length > 0 ? text : null;
  }

  return null;
}
