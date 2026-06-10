import { PencilIcon, PlusIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import {
  McpServerId,
  type McpServerDefinition,
  type McpServerTransport,
  type McpValueRef,
} from "@fenrir/contracts";
import type { UnifiedSettings } from "@fenrir/contracts/settings";
import { getFenrirBuiltInMcpServers } from "@fenrir/shared/mcpBuiltIns";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { SettingsSection } from "./settingsLayout";

type McpEditorValueKind = "literal" | "env";

interface McpEditorValueRow {
  id: string;
  key: string;
  kind: McpEditorValueKind;
  value: string;
}

interface McpEditorDraft {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  transportType: McpServerTransport["type"];
  command: string;
  argsText: string;
  cwd: string;
  url: string;
  envRows: McpEditorValueRow[];
  headerRows: McpEditorValueRow[];
}

function mcpServerIdFromName(name: string): McpServerId {
  const normalized =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || `mcp-${crypto.randomUUID().slice(0, 8)}`;
  return McpServerId.make(normalized);
}

function valueRefToEditorRows(values: Record<string, McpValueRef>): McpEditorValueRow[] {
  return Object.entries(values).map(([key, value]) => {
    if (value.type === "env") {
      return {
        id: crypto.randomUUID(),
        key,
        kind: "env",
        value: value.name,
      };
    }
    if (value.type === "secret") {
      return {
        id: crypto.randomUUID(),
        key,
        kind: "env",
        value: value.secretId,
      };
    }
    return {
      id: crypto.randomUUID(),
      key,
      kind: "literal",
      value: value.value,
    };
  });
}

function editorRowsToValueRefs(
  rows: ReadonlyArray<McpEditorValueRow>,
): Record<string, McpValueRef> {
  return Object.fromEntries(
    rows.flatMap((row) => {
      const key = row.key.trim();
      const value = row.value.trim();
      if (!key || !value) return [];
      return [
        [
          key,
          row.kind === "env"
            ? ({ type: "env", name: value } satisfies McpValueRef)
            : ({ type: "literal", value: row.value } satisfies McpValueRef),
        ],
      ];
    }),
  );
}

function mcpServerToEditorDraft(server?: McpServerDefinition): McpEditorDraft {
  const transport = server?.transport;
  return {
    id: server?.id ?? "",
    name: server?.name ?? "",
    description: server?.description ?? "",
    enabled: server?.enabled ?? true,
    transportType: transport?.type ?? "stdio",
    command: transport?.type === "stdio" ? transport.command : "",
    argsText: transport?.type === "stdio" ? transport.args.join(" ") : "",
    cwd: transport?.type === "stdio" ? (transport.cwd ?? "") : "",
    url: transport?.type === "http" || transport?.type === "sse" ? transport.url : "",
    envRows: transport?.type === "stdio" ? valueRefToEditorRows(transport.env) : [],
    headerRows:
      transport?.type === "http" || transport?.type === "sse"
        ? valueRefToEditorRows(transport.headers)
        : [],
  };
}

function parseArgsText(argsText: string): string[] {
  return argsText
    .split(/\s+/u)
    .map((arg) => arg.trim())
    .filter(Boolean);
}

function editorDraftToMcpServer(
  draft: McpEditorDraft,
  existing?: McpServerDefinition,
): McpServerDefinition {
  const now = new Date().toISOString();
  const id = existing?.id ?? mcpServerIdFromName(draft.id || draft.name);
  const base = {
    id,
    name: draft.name.trim() || String(id),
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    enabled: draft.enabled,
    source: "user" as const,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  if (draft.transportType === "stdio") {
    return {
      ...base,
      transport: {
        type: "stdio",
        command: draft.command.trim(),
        args: parseArgsText(draft.argsText),
        env: editorRowsToValueRefs(draft.envRows),
        ...(draft.cwd.trim() ? { cwd: draft.cwd.trim() } : {}),
      },
    };
  }
  return {
    ...base,
    transport: {
      type: draft.transportType,
      url: draft.url.trim(),
      headers: editorRowsToValueRefs(draft.headerRows),
    },
  };
}

function mcpTransportLabel(transport: McpServerTransport): string {
  if (transport.type === "stdio") return `stdio · ${transport.command}`;
  return `${transport.type.toUpperCase()} · ${transport.url}`;
}

function McpValueRowsEditor(props: {
  rows: McpEditorValueRow[];
  label: string;
  onChange: (rows: McpEditorValueRow[]) => void;
}) {
  const addRow = () => {
    props.onChange([
      ...props.rows,
      { id: crypto.randomUUID(), key: "", kind: "literal", value: "" },
    ]);
  };
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">{props.label}</div>
        <Button size="xs" variant="outline" onClick={addRow}>
          <PlusIcon className="size-3.5" />
          Add
        </Button>
      </div>
      {props.rows.length === 0 ? (
        <div className="rounded border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
          None configured.
        </div>
      ) : (
        <div className="grid gap-2">
          {props.rows.map((row) => (
            <div
              key={row.id}
              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)_auto]"
            >
              <Input
                value={row.key}
                placeholder="Name"
                onChange={(event) =>
                  props.onChange(
                    props.rows.map((entry) =>
                      entry.id === row.id ? { ...entry, key: event.target.value } : entry,
                    ),
                  )
                }
              />
              <Select
                value={row.kind}
                onValueChange={(value) =>
                  props.onChange(
                    props.rows.map((entry) =>
                      entry.id === row.id
                        ? { ...entry, kind: value === "env" ? "env" : "literal" }
                        : entry,
                    ),
                  )
                }
              >
                <SelectTrigger aria-label={`${props.label} value type`}>
                  <SelectValue>{row.kind === "env" ? "Env ref" : "Literal"}</SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  <SelectItem value="literal">Literal</SelectItem>
                  <SelectItem value="env">Env ref</SelectItem>
                </SelectPopup>
              </Select>
              <Input
                value={row.value}
                placeholder={row.kind === "env" ? "ENV_NAME" : "Value"}
                onChange={(event) =>
                  props.onChange(
                    props.rows.map((entry) =>
                      entry.id === row.id ? { ...entry, value: event.target.value } : entry,
                    ),
                  )
                }
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove ${row.key || props.label} row`}
                onClick={() => props.onChange(props.rows.filter((entry) => entry.id !== row.id))}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function McpServersSettingsSection(props: {
  settings: UnifiedSettings;
  updateSettings: (patch: Partial<UnifiedSettings>) => void;
}) {
  const userServers = props.settings.mcpServers;
  const defaultIds = props.settings.defaultMcpServerIds;
  const disabledBuiltInIds = props.settings.disabledBuiltInMcpServerIds;
  const allServers = useMemo(
    () => [...getFenrirBuiltInMcpServers(props.settings), ...Object.values(userServers)],
    [props.settings, userServers],
  );
  const [editingId, setEditingId] = useState<McpServerId | "new" | null>(null);
  const [draft, setDraft] = useState<McpEditorDraft>(() => mcpServerToEditorDraft());

  const startNew = () => {
    setDraft(mcpServerToEditorDraft());
    setEditingId("new");
  };
  const startEdit = (server: McpServerDefinition) => {
    if (server.source === "fenrir") return;
    setDraft(mcpServerToEditorDraft(server));
    setEditingId(server.id);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setDraft(mcpServerToEditorDraft());
  };
  const saveDraft = () => {
    const existing = editingId && editingId !== "new" ? userServers[editingId] : undefined;
    const server = editorDraftToMcpServer(draft, existing);
    if (server.transport.type === "stdio" && !server.transport.command.trim()) {
      toastManager.add({ type: "error", title: "MCP stdio servers need a command" });
      return;
    }
    if (
      (server.transport.type === "http" || server.transport.type === "sse") &&
      !URL.canParse(server.transport.url)
    ) {
      toastManager.add({ type: "error", title: "MCP remote servers need a valid URL" });
      return;
    }
    props.updateSettings({
      mcpServers: {
        ...userServers,
        [server.id]: server,
      },
    });
    cancelEdit();
  };
  const deleteServer = (serverId: McpServerId) => {
    const { [serverId]: _removed, ...nextServers } = userServers;
    props.updateSettings({
      mcpServers: nextServers,
      defaultMcpServerIds: defaultIds.filter((id) => id !== serverId),
    });
  };
  const setServerEnabled = (server: McpServerDefinition, enabled: boolean) => {
    if (server.source === "fenrir") {
      const nextDisabledIds = enabled
        ? disabledBuiltInIds.filter((id) => id !== server.id)
        : Array.from(new Set([...disabledBuiltInIds, server.id]));
      props.updateSettings({
        disabledBuiltInMcpServerIds: nextDisabledIds,
        ...(enabled ? {} : { defaultMcpServerIds: defaultIds.filter((id) => id !== server.id) }),
      });
      return;
    }
    props.updateSettings({
      mcpServers: {
        ...userServers,
        [server.id]: {
          ...server,
          enabled,
          updatedAt: new Date().toISOString(),
        },
      },
      ...(enabled ? {} : { defaultMcpServerIds: defaultIds.filter((id) => id !== server.id) }),
    });
  };
  const setDefaultSelected = (server: McpServerDefinition, selected: boolean) => {
    const nextIds = selected
      ? Array.from(new Set([...defaultIds, server.id]))
      : defaultIds.filter((id) => id !== server.id);
    props.updateSettings({ defaultMcpServerIds: nextIds });
  };

  return (
    <SettingsSection title="MCP Servers">
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          Configure Model Context Protocol servers once, then select them per thread.
        </p>
        {allServers.length === 0 ? (
          <div className="rounded border border-dashed border-border/70 px-4 py-5 text-sm text-muted-foreground">
            No MCP servers configured.
          </div>
        ) : (
          allServers.map((server) => (
            <div key={server.id} className="rounded-lg border border-border/70 bg-card/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <div className="truncate text-sm font-medium text-foreground">
                      {server.name}
                    </div>
                    <span className="rounded border border-border/70 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                      {server.source}
                    </span>
                    <span className="rounded border border-border/70 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      {server.transport.type}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {server.description || mcpTransportLabel(server.transport)}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Enabled
                    <Switch
                      checked={server.enabled}
                      onCheckedChange={(checked) => setServerEnabled(server, checked)}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Default
                    <Switch
                      checked={defaultIds.includes(server.id)}
                      disabled={!server.enabled}
                      onCheckedChange={(checked) => setDefaultSelected(server, checked)}
                    />
                  </label>
                  {server.source === "user" ? (
                    <>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => startEdit(server)}
                        aria-label={`Edit ${server.name}`}
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => deleteServer(server.id)}
                        aria-label={`Delete ${server.name}`}
                      >
                        <Trash2Icon />
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          ))
        )}

        {editingId ? (
          <div className="grid gap-3 rounded-lg border border-border bg-card p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                value={draft.name}
                placeholder="Server name"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
              />
              <Input
                value={draft.id}
                placeholder="server-id"
                disabled={editingId !== "new"}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, id: event.target.value }))
                }
              />
            </div>
            <Textarea
              value={draft.description}
              placeholder="Description"
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
            />
            <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
              <Select
                value={draft.transportType}
                onValueChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    transportType:
                      value === "http" || value === "sse" || value === "stdio" ? value : "stdio",
                  }))
                }
              >
                <SelectTrigger aria-label="MCP transport">
                  <SelectValue>{draft.transportType}</SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  <SelectItem value="stdio">stdio</SelectItem>
                  <SelectItem value="http">HTTP</SelectItem>
                  <SelectItem value="sse">SSE</SelectItem>
                </SelectPopup>
              </Select>
              {draft.transportType === "stdio" ? (
                <div className="grid gap-2">
                  <Input
                    value={draft.command}
                    placeholder="Command"
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, command: event.target.value }))
                    }
                  />
                  <Input
                    value={draft.argsText}
                    placeholder="Args, separated by spaces"
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, argsText: event.target.value }))
                    }
                  />
                  <Input
                    value={draft.cwd}
                    placeholder="Working directory (optional)"
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, cwd: event.target.value }))
                    }
                  />
                </div>
              ) : (
                <Input
                  value={draft.url}
                  placeholder="https://example.com/mcp"
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, url: event.target.value }))
                  }
                />
              )}
            </div>
            {draft.transportType === "stdio" ? (
              <McpValueRowsEditor
                label="Environment"
                rows={draft.envRows}
                onChange={(rows) => setDraft((current) => ({ ...current, envRows: rows }))}
              />
            ) : (
              <McpValueRowsEditor
                label="Headers"
                rows={draft.headerRows}
                onChange={(rows) => setDraft((current) => ({ ...current, headerRows: rows }))}
              />
            )}
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                Enabled
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({ ...current, enabled: checked }))
                  }
                />
              </label>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={cancelEdit}>
                  Cancel
                </Button>
                <Button size="sm" onClick={saveDraft}>
                  <SaveIcon className="size-3.5" />
                  Save
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="w-fit" onClick={startNew}>
            <PlusIcon className="size-3.5" />
            Add MCP server
          </Button>
        )}
      </div>
    </SettingsSection>
  );
}
