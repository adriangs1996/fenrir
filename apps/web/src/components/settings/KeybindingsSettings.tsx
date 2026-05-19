import {
  Edit3Icon,
  FileJsonIcon,
  KeyboardIcon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  SearchIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { KeybindingCommand, ServerRemoveKeybindingInput } from "@fenrir/contracts";
import { parseKeybindingShortcut } from "@fenrir/shared/keybindings";

import { openInPreferredEditor } from "../../editorPreferences";
import { formatShortcutLabel } from "../../keybindings";
import { ensureLocalApi } from "../../localApi";
import {
  useServerConfig,
  useServerKeybindings,
  useServerKeybindingsConfigPath,
} from "../../rpc/serverState";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import {
  buildKeybindingCommandOptions,
  buildKeybindingRows,
  buildWhenVariableOptions,
  commandLabel,
  keybindingConflictLabels,
  keybindingFromKeyboardEvent,
  parseWhenExpressionDraft,
  shortcutToKeybindingInput,
  type KeybindingRow,
  unknownWhenVariables,
} from "./KeybindingsSettings.logic";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

type DraftState = {
  readonly mode: "create" | "edit";
  readonly rowId: string;
  readonly initialRow: KeybindingRow | null;
  readonly command: KeybindingCommand;
  readonly key: string;
  readonly when: string;
};

function makeDraftState(
  row: KeybindingRow | null,
  commands: ReadonlyArray<KeybindingCommand>,
): DraftState {
  const fallbackCommand = commands[0] ?? "commandPalette.toggle";
  return {
    mode: row ? "edit" : "create",
    rowId: row?.id ?? "new",
    initialRow: row,
    command: row?.command ?? fallbackCommand,
    key: row?.key ?? "",
    when: row?.when ?? "",
  };
}

function sourceBadgeVariant(source: KeybindingRow["source"]): "info" | "outline" | "secondary" {
  switch (source) {
    case "Default":
      return "secondary";
    case "Custom":
      return "outline";
    case "Project":
    case "Global":
      return "info";
  }
}

function draftToRemoveInput(row: KeybindingRow): ServerRemoveKeybindingInput {
  return row.when.trim().length === 0
    ? { key: row.key, command: row.command }
    : { key: row.key, command: row.command, when: row.when };
}

function KeybindingStatus({
  row,
  draftKey,
  draftWhen,
  rows,
}: {
  row: KeybindingRow | null;
  draftKey: string;
  draftWhen: string;
  rows: ReadonlyArray<KeybindingRow>;
}) {
  const parsedWhen = parseWhenExpressionDraft(draftWhen);
  const unknownVariables =
    parsedWhen.ok && parsedWhen.value ? unknownWhenVariables(parsedWhen.value) : [];
  const conflicts = keybindingConflictLabels(rows, {
    rowId: row?.id ?? "new",
    key: draftKey.trim(),
    when: draftWhen.trim(),
  });

  const items: ReactNode[] = [];
  if (!parsedWhen.ok) {
    items.push(
      <p key="invalid-when" className="text-xs text-destructive">
        {parsedWhen.message}
      </p>,
    );
  }
  if (unknownVariables.length > 0) {
    items.push(
      <p key="unknown-when" className="text-xs text-warning-foreground">
        Unknown variables: {unknownVariables.join(", ")}
      </p>,
    );
  }
  if (conflicts.length > 0) {
    items.push(
      <p key="conflicts" className="text-xs text-warning-foreground">
        Conflicts with: {conflicts.join(", ")}
      </p>,
    );
  }

  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        `when` is optional. Leave it blank to make the shortcut global.
      </p>
    );
  }

  return <div className="space-y-1">{items}</div>;
}

function KeybindingEditor({
  draft,
  rows,
  commands,
  whenVariables,
  busy,
  onCancel,
  onDelete,
  onSave,
}: {
  draft: DraftState;
  rows: ReadonlyArray<KeybindingRow>;
  commands: ReadonlyArray<KeybindingCommand>;
  whenVariables: ReadonlyArray<string>;
  busy: boolean;
  onCancel: () => void;
  onDelete: () => void;
  onSave: (draft: DraftState) => Promise<void>;
}) {
  const [command, setCommand] = useState<KeybindingCommand>(draft.command);
  const [shortcut, setShortcut] = useState(draft.key);
  const [when, setWhen] = useState(draft.when);
  const [captureActive, setCaptureActive] = useState(false);

  useEffect(() => {
    setCommand(draft.command);
    setShortcut(draft.key);
    setWhen(draft.when);
    setCaptureActive(false);
  }, [draft]);

  useEffect(() => {
    if (!captureActive) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const nextShortcut = keybindingFromKeyboardEvent(event, navigator.platform);
      if (!nextShortcut) {
        return;
      }
      setShortcut(nextShortcut);
      setCaptureActive(false);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [captureActive]);

  const parsedShortcut = useMemo(() => parseKeybindingShortcut(shortcut.trim()), [shortcut]);
  const whenPreview = useMemo(() => {
    const parsed = parseWhenExpressionDraft(when);
    if (!parsed.ok || !parsed.value) return null;
    const unknownVariables = unknownWhenVariables(parsed.value);
    return {
      parsed,
      unknownVariables,
    };
  }, [when]);

  const shortcutError =
    shortcut.trim().length === 0
      ? "Shortcut is required."
      : !parsedShortcut
        ? "Use a single key with modifiers like mod+k or shift+esc."
        : null;

  const handleSave = async () => {
    if (shortcutError) return;
    await onSave({
      ...draft,
      command,
      key: shortcut,
      when,
    });
  };

  return (
    <div className="space-y-4 rounded-xl border border-border/70 bg-background/70 p-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,.9fr)_minmax(0,1fr)]">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Command</span>
          <Select value={command} onValueChange={(value) => setCommand(value as KeybindingCommand)}>
            <SelectTrigger aria-label="Keybinding command">
              <SelectValue>{commandLabel(command)}</SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              {commands.map((option) => (
                <SelectItem hideIndicator key={option} value={option}>
                  {commandLabel(option)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Shortcut</span>
          <div className="flex items-center gap-2">
            <Input
              value={shortcut}
              onChange={(event) => setShortcut(event.currentTarget.value)}
              placeholder="mod+k"
              aria-label="Shortcut"
            />
            <Button
              size="xs"
              variant={captureActive ? "secondary" : "outline"}
              onClick={() => setCaptureActive((value) => !value)}
            >
              {captureActive ? "Listening..." : "Capture"}
            </Button>
          </div>
          {parsedShortcut ? (
            <p className="text-xs text-muted-foreground">
              Resolves to {formatShortcutLabel(parsedShortcut)}
            </p>
          ) : shortcutError ? (
            <p className="text-xs text-destructive">{shortcutError}</p>
          ) : null}
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">When</span>
          <Input
            value={when}
            onChange={(event) => setWhen(event.currentTarget.value)}
            placeholder="!terminalFocus"
            aria-label="When expression"
          />
          <p className="text-xs text-muted-foreground">
            Known variables: {whenVariables.join(", ")}
          </p>
        </label>
      </div>

      <KeybindingStatus row={draft.initialRow} draftKey={shortcut} draftWhen={when} rows={rows} />

      {whenPreview && whenPreview.unknownVariables.length === 0 ? (
        <p className="text-xs text-muted-foreground">Expression parsed successfully.</p>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {draft.initialRow && draft.initialRow.source !== "Default" ? (
          <Button size="xs" variant="destructive-outline" disabled={busy} onClick={onDelete}>
            <Trash2Icon className="size-3.5" />
            Delete
          </Button>
        ) : null}
        <Button size="xs" variant="ghost" disabled={busy} onClick={onCancel}>
          <XIcon className="size-3.5" />
          Cancel
        </Button>
        <Button
          size="xs"
          disabled={busy || Boolean(shortcutError)}
          onClick={() => void handleSave()}
        >
          <SaveIcon className="size-3.5" />
          {busy ? "Saving..." : draft.mode === "create" ? "Add binding" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

export function KeybindingsSettings() {
  const serverConfig = useServerConfig();
  const keybindings = useServerKeybindings();
  const keybindingsConfigPath = useServerKeybindingsConfigPath();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);

  const rows = useMemo(() => buildKeybindingRows(keybindings, query), [keybindings, query]);
  const commands = useMemo(() => buildKeybindingCommandOptions(keybindings), [keybindings]);
  const whenVariables = useMemo(() => buildWhenVariableOptions(), []);
  const keybindingIssue =
    serverConfig?.issues.find((issue) => issue.kind.startsWith("keybindings.")) ?? null;

  const openFile = async () => {
    if (!keybindingsConfigPath) return;
    try {
      const api = ensureLocalApi();
      await openInPreferredEditor(api, keybindingsConfigPath);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to open keybindings file",
        description: error instanceof Error ? error.message : "Unknown error opening file.",
      });
    }
  };

  const saveDraft = async (nextDraft: DraftState) => {
    const parsedShortcut = parseKeybindingShortcut(nextDraft.key.trim());
    if (!parsedShortcut) {
      toastManager.add({
        type: "error",
        title: "Invalid shortcut",
        description: "Use a single key with optional modifiers such as mod+k.",
      });
      return;
    }

    const parsedWhen = parseWhenExpressionDraft(nextDraft.when);
    if (!parsedWhen.ok) {
      toastManager.add({
        type: "error",
        title: "Invalid when expression",
        description: parsedWhen.message,
      });
      return;
    }

    const api = ensureLocalApi();
    const canonicalKey = shortcutToKeybindingInput(parsedShortcut);
    const when = nextDraft.when.trim();

    setBusyRowId(nextDraft.rowId);
    try {
      await api.server.upsertKeybinding({
        key: canonicalKey,
        command: nextDraft.command,
        ...(when.length > 0 ? { when } : {}),
        ...(nextDraft.initialRow
          ? {
              replace:
                nextDraft.initialRow.when.trim().length > 0
                  ? {
                      key: nextDraft.initialRow.key,
                      command: nextDraft.initialRow.command,
                      when: nextDraft.initialRow.when,
                    }
                  : {
                      key: nextDraft.initialRow.key,
                      command: nextDraft.initialRow.command,
                    },
            }
          : {}),
      });
      setDraft(null);
      toastManager.add({
        type: "success",
        title: nextDraft.mode === "create" ? "Keybinding added" : "Keybinding updated",
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to save keybinding",
        description: error instanceof Error ? error.message : "Unknown error saving keybinding.",
      });
    } finally {
      setBusyRowId(null);
    }
  };

  const deleteRow = async (row: KeybindingRow) => {
    setBusyRowId(row.id);
    try {
      await ensureLocalApi().server.removeKeybinding(draftToRemoveInput(row));
      if (draft?.rowId === row.id) {
        setDraft(null);
      }
      toastManager.add({
        type: "success",
        title: "Keybinding removed",
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to remove keybinding",
        description: error instanceof Error ? error.message : "Unknown error removing keybinding.",
      });
    } finally {
      setBusyRowId(null);
    }
  };

  const resetRow = async (row: KeybindingRow) => {
    if (!row.defaultKey) {
      await deleteRow(row);
      return;
    }

    setBusyRowId(row.id);
    try {
      await ensureLocalApi().server.upsertKeybinding({
        key: row.defaultKey,
        command: row.command,
        ...(row.defaultWhen.trim().length > 0 ? { when: row.defaultWhen } : {}),
        replace: draftToRemoveInput(row),
      });
      if (draft?.rowId === row.id) {
        setDraft(null);
      }
      toastManager.add({
        type: "success",
        title: "Keybinding reset to default",
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to reset keybinding",
        description: error instanceof Error ? error.message : "Unknown error resetting keybinding.",
      });
    } finally {
      setBusyRowId(null);
    }
  };

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Keybindings"
        icon={<KeyboardIcon className="size-3.5" />}
        headerAction={
          <div className="flex items-center gap-2">
            <Button
              size="xs"
              variant="outline"
              onClick={() => setDraft(makeDraftState(null, commands))}
            >
              <PlusIcon className="size-3.5" />
              Add binding
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={!keybindingsConfigPath}
              onClick={() => void openFile()}
            >
              <FileJsonIcon className="size-3.5" />
              Open file
            </Button>
          </div>
        }
      >
        <div className="space-y-0">
          <div className="border-b border-border/60 px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Edit app shortcuts without leaving Fenrir.
                </p>
                <p className="text-xs text-muted-foreground">
                  The editor writes to{" "}
                  <span className="font-mono text-foreground">
                    {keybindingsConfigPath ?? "keybindings.json"}
                  </span>
                  .
                </p>
              </div>
              <div className="relative w-full sm:w-64">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  className="pl-8"
                  placeholder="Search commands, shortcuts, or when"
                  aria-label="Search keybindings"
                />
              </div>
            </div>
            {keybindingIssue ? (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-xs text-warning-foreground">
                <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                <div>
                  <p className="font-medium">
                    The persisted keybindings file has validation issues.
                  </p>
                  <p>{keybindingIssue.message}</p>
                </div>
              </div>
            ) : null}
          </div>

          {draft ? (
            <div className="border-b border-border/60 px-4 py-4 sm:px-5">
              <KeybindingEditor
                draft={draft}
                rows={buildKeybindingRows(keybindings, "")}
                commands={commands}
                whenVariables={whenVariables}
                busy={busyRowId === draft.rowId}
                onCancel={() => setDraft(null)}
                onDelete={() =>
                  draft.initialRow ? void deleteRow(draft.initialRow) : setDraft(null)
                }
                onSave={saveDraft}
              />
            </div>
          ) : null}

          <ScrollArea className="max-h-[min(70vh,48rem)]">
            <div className="divide-y divide-border/60">
              {rows.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground sm:px-5">
                  No keybindings matched this search.
                </div>
              ) : (
                rows.map((row) => {
                  const isBusy = busyRowId === row.id;
                  const shortcutLabel = formatShortcutLabel(row.binding.shortcut);
                  const isEditing = draft?.rowId === row.id;
                  return (
                    <div key={row.id} className="px-4 py-4 sm:px-5">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-foreground">
                              {commandLabel(row.command)}
                            </p>
                            <Badge size="sm" variant={sourceBadgeVariant(row.source)}>
                              {row.source}
                            </Badge>
                            {row.conflicts.length > 0 ? (
                              <Badge size="sm" variant="warning">
                                Conflict
                              </Badge>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">{shortcutLabel}</span>
                            <span>
                              {row.when.length > 0 ? `when ${row.when}` : "Always active"}
                            </span>
                            {row.defaultKey &&
                            (row.defaultKey !== row.key || row.defaultWhen !== row.when) ? (
                              <span>
                                Default: {row.defaultKey}
                                {row.defaultWhen.length > 0 ? ` when ${row.defaultWhen}` : ""}
                              </span>
                            ) : null}
                          </div>
                          {row.conflicts.length > 0 ? (
                            <p className="text-xs text-warning-foreground">
                              Shares a shortcut context with {row.conflicts.join(", ")}.
                            </p>
                          ) : null}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {row.source !== "Default" ? (
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={isBusy}
                              onClick={() => void resetRow(row)}
                            >
                              <RotateCcwIcon className="size-3.5" />
                              {row.defaultKey ? "Reset" : "Remove"}
                            </Button>
                          ) : null}
                          <Button
                            size="xs"
                            variant={isEditing ? "secondary" : "outline"}
                            disabled={isBusy}
                            onClick={() => setDraft(makeDraftState(row, commands))}
                          >
                            <Edit3Icon className="size-3.5" />
                            {isEditing ? "Editing" : "Edit"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
