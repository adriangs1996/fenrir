import { actionRunDoneMarker } from "./actionRunStore";

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildTmuxActionCommand(input: {
  readonly runId: string;
  readonly name: string;
  readonly command: string;
  readonly env?: Record<string, string>;
}): string {
  const marker = actionRunDoneMarker(input.runId);
  const name = input.name.replaceAll("\n", " ").trim() || "Action";
  const command = input.command.trim();
  const exports = Object.entries(input.env ?? {})
    .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
    .map(([key, value]) => `export ${key}=${shellSingleQuote(value)}`);

  return [
    `printf '\\n[fenrir] action ${shellSingleQuote(name)} started (${input.runId})\\n'`,
    ...exports,
    `sh -lc ${shellSingleQuote(command)}`,
    "__fenrir_action_status=$?",
    `printf '\\n${marker}%s\\n' "$__fenrir_action_status"`,
  ].join("; ");
}
