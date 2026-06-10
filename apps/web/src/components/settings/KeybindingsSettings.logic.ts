import {
  type KeybindingCommand,
  type KeybindingShortcut,
  type KeybindingWhenNode,
  type ResolvedKeybindingRule,
  type ResolvedKeybindingsConfig,
  STATIC_KEYBINDING_COMMANDS,
  type StaticKeybindingCommand,
} from "@fenrir/contracts";
import {
  DEFAULT_RESOLVED_KEYBINDINGS,
  isGlobalScriptKeybindingCommand,
  isProjectScriptKeybindingCommand,
  parseKeybindingWhenExpression,
} from "@fenrir/shared/keybindings";
import { isMacPlatform } from "../../lib/utils";

export type KeybindingSource = "Default" | "Custom" | "Project" | "Global" | "Unbound";
export const DEFAULT_WHEN_VARIABLE = "terminalFocus";

export interface KeybindingRow {
  readonly id: string;
  readonly command: KeybindingCommand;
  readonly key: string;
  readonly when: string;
  readonly source: KeybindingSource;
  readonly defaultKey: string | null;
  readonly defaultWhen: string;
  readonly binding: ResolvedKeybindingRule | null;
  readonly conflicts: ReadonlyArray<string>;
}

export type WhenVariableOption = string;
export type KeybindingCommandOption = KeybindingCommand;

const CORE_WHEN_VARIABLES = [DEFAULT_WHEN_VARIABLE, "terminalOpen", "true", "false"] as const;

const DEFAULT_WHEN_VARIABLES = new Set<string>(CORE_WHEN_VARIABLES);
for (const binding of DEFAULT_RESOLVED_KEYBINDINGS) {
  collectWhenIdentifiersFromNode(binding.whenAst, DEFAULT_WHEN_VARIABLES);
}

const KNOWN_WHEN_VARIABLES = new Set(DEFAULT_WHEN_VARIABLES);
const STATIC_KEYBINDING_COMMAND_SET = new Set<KeybindingCommand>(STATIC_KEYBINDING_COMMANDS);
const STATIC_COMMAND_LABELS: Partial<Record<StaticKeybindingCommand, string>> = {
  "editor.toggleChatTab": "Editor: Toggle",
  "gitDiff.toggle": "Git Diff: Toggle",
};

function isStaticKeybindingCommand(command: KeybindingCommand): command is StaticKeybindingCommand {
  return STATIC_KEYBINDING_COMMAND_SET.has(command);
}

export function shortcutToKeybindingInput(shortcut: KeybindingShortcut): string {
  const parts: string[] = [];
  if (shortcut.modKey) parts.push("mod");
  if (shortcut.metaKey) parts.push("meta");
  if (shortcut.ctrlKey) parts.push("ctrl");
  if (shortcut.altKey) parts.push("alt");
  if (shortcut.shiftKey) parts.push("shift");
  parts.push(shortcut.key === " " ? "space" : shortcut.key === "escape" ? "esc" : shortcut.key);
  return parts.join("+");
}

export function whenAstToExpression(node: KeybindingWhenNode | undefined): string {
  if (!node) return "";
  switch (node.type) {
    case "identifier":
      return node.name;
    case "not":
      return `!${wrapWhenExpression(node.node)}`;
    case "and":
      return `${wrapWhenExpression(node.left)} && ${wrapWhenExpression(node.right)}`;
    case "or":
      return `${wrapWhenExpression(node.left)} || ${wrapWhenExpression(node.right)}`;
  }
}

function wrapWhenExpression(node: KeybindingWhenNode): string {
  if (node.type === "identifier" || node.type === "not") {
    return whenAstToExpression(node);
  }
  return `(${whenAstToExpression(node)})`;
}

export function parseWhenExpressionDraft(
  expression: string,
): { ok: true; value: KeybindingWhenNode | undefined } | { ok: false; message: string } {
  const trimmed = expression.trim();
  if (trimmed.length === 0) return { ok: true, value: undefined };

  const ast = parseKeybindingWhenExpression(trimmed);
  if (!ast) {
    return {
      ok: false,
      message: "Use variables with !, &&, ||, and parentheses.",
    };
  }

  return { ok: true, value: ast };
}

function sourceForBinding(binding: ResolvedKeybindingRule): KeybindingSource {
  const command = String(binding.command);
  if (isProjectScriptKeybindingCommand(command)) {
    return "Project";
  }
  if (isGlobalScriptKeybindingCommand(command)) {
    return "Global";
  }

  const bindingKey = shortcutToKeybindingInput(binding.shortcut);
  const bindingWhen = whenAstToExpression(binding.whenAst);
  const isDefault = DEFAULT_RESOLVED_KEYBINDINGS.some(
    (entry) =>
      entry.command === binding.command &&
      shortcutToKeybindingInput(entry.shortcut) === bindingKey &&
      whenAstToExpression(entry.whenAst) === bindingWhen,
  );

  return isDefault ? "Default" : "Custom";
}

function defaultBindingForBinding(
  binding: ResolvedKeybindingRule,
): ResolvedKeybindingRule | undefined {
  const bindingKey = shortcutToKeybindingInput(binding.shortcut);
  const bindingWhen = whenAstToExpression(binding.whenAst);

  return (
    DEFAULT_RESOLVED_KEYBINDINGS.find(
      (entry) =>
        entry.command === binding.command &&
        shortcutToKeybindingInput(entry.shortcut) === bindingKey &&
        whenAstToExpression(entry.whenAst) === bindingWhen,
    ) ??
    DEFAULT_RESOLVED_KEYBINDINGS.find(
      (entry) =>
        entry.command === binding.command && whenAstToExpression(entry.whenAst) === bindingWhen,
    ) ??
    DEFAULT_RESOLVED_KEYBINDINGS.find((entry) => entry.command === binding.command)
  );
}

function defaultBindingForCommand(command: KeybindingCommand): ResolvedKeybindingRule | undefined {
  return DEFAULT_RESOLVED_KEYBINDINGS.find((entry) => entry.command === command);
}

function keybindingRowId(command: KeybindingCommand, key: string, when: string): string {
  return `${command}\u0000${key}\u0000${when}`;
}

function conflictsWithWhen(leftWhen: string, rightWhen: string): boolean {
  return leftWhen.length === 0 || rightWhen.length === 0 || leftWhen === rightWhen;
}

export function keybindingConflictLabels(
  rows: ReadonlyArray<KeybindingRow>,
  input: { readonly rowId: string; readonly key: string; readonly when: string },
): ReadonlyArray<string> {
  if (input.key.trim().length === 0) return [];
  const conflicts = rows
    .filter(
      (candidate) =>
        candidate.id !== input.rowId &&
        candidate.key === input.key &&
        conflictsWithWhen(candidate.when, input.when),
    )
    .map((candidate) => commandLabel(candidate.command));
  return [...new Set(conflicts)].toSorted();
}

export function buildKeybindingRows(
  keybindings: ResolvedKeybindingsConfig,
  query: string,
): ReadonlyArray<KeybindingRow> {
  const normalizedQuery = query.trim().toLowerCase();
  const rows: KeybindingRow[] = keybindings.map((binding, index) => {
    const defaultBinding = defaultBindingForBinding(binding);
    const key = shortcutToKeybindingInput(binding.shortcut);
    const when = whenAstToExpression(binding.whenAst);

    return {
      id: `${keybindingRowId(binding.command, key, when)}\u0000${index}`,
      command: binding.command,
      key,
      when,
      source: sourceForBinding(binding),
      defaultKey: defaultBinding ? shortcutToKeybindingInput(defaultBinding.shortcut) : null,
      defaultWhen: whenAstToExpression(defaultBinding?.whenAst),
      binding,
      conflicts: [],
    } satisfies KeybindingRow;
  });

  const boundStaticCommands = new Set(
    rows.filter((row) => isStaticKeybindingCommand(row.command)).map((row) => row.command),
  );
  for (const command of STATIC_KEYBINDING_COMMANDS) {
    if (boundStaticCommands.has(command)) continue;
    const defaultBinding = defaultBindingForCommand(command);
    rows.push({
      id: `${keybindingRowId(command, "", "")}\u0000unbound`,
      command,
      key: "",
      when: "",
      source: "Unbound",
      defaultKey: defaultBinding ? shortcutToKeybindingInput(defaultBinding.shortcut) : null,
      defaultWhen: whenAstToExpression(defaultBinding?.whenAst),
      binding: null,
      conflicts: [],
    });
  }

  const rowsWithConflicts = rows.map((row) => {
    const conflicts = keybindingConflictLabels(rows, {
      rowId: row.id,
      key: row.key,
      when: row.when,
    });
    return conflicts.length > 0
      ? {
          id: row.id,
          command: row.command,
          key: row.key,
          when: row.when,
          source: row.source,
          defaultKey: row.defaultKey,
          defaultWhen: row.defaultWhen,
          binding: row.binding,
          conflicts,
        }
      : row;
  });

  rowsWithConflicts.sort((left, right) => {
    const commandCompare = commandLabel(left.command).localeCompare(commandLabel(right.command));
    if (commandCompare !== 0) return commandCompare;
    return left.key.localeCompare(right.key);
  });

  if (normalizedQuery.length === 0) {
    return rowsWithConflicts;
  }

  return rowsWithConflicts.filter((row) => {
    return (
      commandLabel(row.command).toLowerCase().includes(normalizedQuery) ||
      row.key.toLowerCase().includes(normalizedQuery) ||
      row.when.toLowerCase().includes(normalizedQuery) ||
      row.source.toLowerCase().includes(normalizedQuery)
    );
  });
}

function collectWhenIdentifiersFromNode(
  node: KeybindingWhenNode | undefined,
  identifiers: Set<string>,
): void {
  if (!node) return;
  switch (node.type) {
    case "identifier":
      identifiers.add(node.name);
      return;
    case "not":
      collectWhenIdentifiersFromNode(node.node, identifiers);
      return;
    case "and":
    case "or":
      collectWhenIdentifiersFromNode(node.left, identifiers);
      collectWhenIdentifiersFromNode(node.right, identifiers);
      return;
  }
}

export function unknownWhenVariables(node: KeybindingWhenNode | undefined): ReadonlyArray<string> {
  const identifiers = new Set<string>();
  collectWhenIdentifiersFromNode(node, identifiers);
  return [...identifiers].filter((identifier) => !KNOWN_WHEN_VARIABLES.has(identifier)).toSorted();
}

export function isKnownWhenVariable(variable: string): boolean {
  return KNOWN_WHEN_VARIABLES.has(variable);
}

export function buildWhenVariableOptions(): ReadonlyArray<WhenVariableOption> {
  return [...KNOWN_WHEN_VARIABLES].toSorted((left, right) => {
    const leftCoreIndex = CORE_WHEN_VARIABLES.indexOf(left as (typeof CORE_WHEN_VARIABLES)[number]);
    const rightCoreIndex = CORE_WHEN_VARIABLES.indexOf(
      right as (typeof CORE_WHEN_VARIABLES)[number],
    );
    if (leftCoreIndex !== -1 || rightCoreIndex !== -1) {
      return (
        (leftCoreIndex === -1 ? Number.MAX_SAFE_INTEGER : leftCoreIndex) -
        (rightCoreIndex === -1 ? Number.MAX_SAFE_INTEGER : rightCoreIndex)
      );
    }
    return left.localeCompare(right);
  });
}

export function buildKeybindingCommandOptions(
  keybindings: ResolvedKeybindingsConfig,
): ReadonlyArray<KeybindingCommandOption> {
  const commands = new Set<KeybindingCommand>();
  for (const command of STATIC_KEYBINDING_COMMANDS) {
    commands.add(command);
  }
  for (const binding of DEFAULT_RESOLVED_KEYBINDINGS) {
    commands.add(binding.command);
  }
  for (const binding of keybindings) {
    commands.add(binding.command);
  }
  return [...commands].toSorted((left, right) =>
    commandLabel(left).localeCompare(commandLabel(right)),
  );
}

export function commandLabel(command: KeybindingCommand): string {
  if (isStaticKeybindingCommand(command)) {
    const label = STATIC_COMMAND_LABELS[command];
    if (label) return label;
  }

  const raw = String(command);
  if (isProjectScriptKeybindingCommand(raw)) {
    return `Run Script: ${titleCaseCommandSegment(raw.slice("script.".length, -".run".length))}`;
  }
  if (isGlobalScriptKeybindingCommand(raw)) {
    return `Run Global Script: ${titleCaseCommandSegment(
      raw.slice("global-script.".length, -".run".length),
    )}`;
  }
  return raw.split(".").map(titleCaseCommandSegment).join(": ");
}

function titleCaseCommandSegment(segment: string): string {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function normalizeShortcutKeyToken(key: string): string | null {
  const normalized = key.toLowerCase();
  if (
    normalized === "meta" ||
    normalized === "control" ||
    normalized === "ctrl" ||
    normalized === "shift" ||
    normalized === "alt" ||
    normalized === "option"
  ) {
    return null;
  }
  if (normalized === " ") return "space";
  if (normalized === "escape") return "esc";
  if (normalized === "arrowup" || normalized === "arrowdown") return normalized;
  if (normalized === "arrowleft" || normalized === "arrowright") return normalized;
  if (normalized.length === 1) return normalized;
  if (/^f\d{1,2}$/.test(normalized)) return normalized;
  if (
    normalized === "enter" ||
    normalized === "tab" ||
    normalized === "backspace" ||
    normalized === "delete" ||
    normalized === "home" ||
    normalized === "end" ||
    normalized === "pageup" ||
    normalized === "pagedown"
  ) {
    return normalized;
  }
  return null;
}

export function keybindingFromKeyboardEvent(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  platform: string,
): string | null {
  const keyToken = normalizeShortcutKeyToken(event.key);
  if (!keyToken) return null;

  const parts: string[] = [];
  if (isMacPlatform(platform)) {
    if (event.metaKey) parts.push("mod");
  } else {
    if (event.ctrlKey) parts.push("mod");
  }
  if (event.metaKey && !isMacPlatform(platform)) parts.push("meta");
  if (event.ctrlKey && isMacPlatform(platform)) parts.push("ctrl");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  parts.push(keyToken);
  return parts.join("+");
}
