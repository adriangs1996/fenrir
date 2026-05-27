import {
  ArchiveIcon,
  ArchiveX,
  ChevronDownIcon,
  DownloadIcon,
  InfoIcon,
  LoaderIcon,
  PlusIcon,
  FolderArchiveIcon,
  PencilIcon,
  RefreshCwIcon,
  SaveIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { FontPicker } from "./FontPicker";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultInstanceIdForDriver,
  McpServerId,
  ProviderDriverKind,
  type McpServerDefinition,
  type McpServerTransport,
  type McpValueRef,
  type ProviderInstanceConfig,
  type ScopedThreadRef,
  type ProjectId,
  type ProviderKind,
  type ServerProvider,
  type ServerProviderModel,
  type ServerProviderVersionAdvisory,
} from "@fenrir/contracts";
import { scopeThreadRef } from "@fenrir/client-runtime";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@fenrir/contracts/settings";
import { normalizeModelSlug } from "@fenrir/shared/model";
import { Duration, Equal } from "effect";
import { APP_VERSION } from "../../branding";
import {
  canCheckForUpdate,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
} from "../../components/desktopUpdate.logic";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { resolveAndPersistPreferredEditor } from "../../editorPreferences";
import { isElectron } from "../../env";
import { useTheme } from "../../hooks/useTheme";
import { useFonts } from "../../hooks/useFonts";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import { useArchivedThreadSnapshots } from "../../lib/archivedThreadsState";
import {
  setDesktopUpdateStateQueryData,
  useDesktopUpdateState,
} from "../../lib/desktopUpdateReactQuery";
import {
  MAX_CUSTOM_MODEL_LENGTH,
  getCustomModelOptionsByProvider,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import { ensureLocalApi, readLocalApi } from "../../localApi";
import { getProviderSnapshot } from "../../providerModels";
import { THEME_OPTIONS, isTheme } from "../../lib/theme";
import { useShallow } from "zustand/react/shallow";
import { selectProjectsAcrossEnvironments, useStore } from "../../store";
import { formatRelativeTime, formatRelativeTimeLabel } from "../../timestampFormat";
import { cn } from "../../lib/utils";
import { getFenrirBuiltInMcpServers } from "@fenrir/shared/mcpBuiltIns";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  useRelativeTimeTick,
} from "./settingsLayout";
import { ProjectFavicon } from "../ProjectFavicon";
import {
  useServerAvailableEditors,
  useServerKeybindingsConfigPath,
  useServerObservability,
  useServerProviders,
} from "../../rpc/serverState";
import {
  useInternalPlanRunnerThreadIds,
  usePlanRunnerStore,
  type ArchivedFeatureSummary,
} from "~/modules/plan-runner";
import {
  PROVIDER_DRIVER_DEFINITIONS,
  getProviderDriverDefinition,
  getProviderDriverLabel,
} from "./providerDriverMeta";
import {
  getSingleProviderUpdateProgressToastView,
  isProviderUpdateActive,
} from "../ProviderUpdateLaunchNotification.logic";
import {
  EMBEDDED_EDITOR_LABELS,
  EMBEDDED_EDITOR_OPTIONS,
  isEmbeddedEditorKind,
} from "~/modules/neovim-editor/embeddedEditor";

const TIMESTAMP_FORMAT_LABELS = {
  locale: "System default",
  "12-hour": "12-hour",
  "24-hour": "24-hour",
} as const;

const AUTOMATIC_GIT_FETCH_INTERVAL_OPTIONS = [
  { duration: Duration.seconds(15), label: "15 seconds" },
  { duration: Duration.seconds(30), label: "30 seconds" },
  { duration: Duration.minutes(1), label: "1 minute" },
  { duration: Duration.minutes(5), label: "5 minutes" },
] as const;

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

function getAutomaticGitFetchIntervalLabel(duration: Duration.Duration) {
  const millis = Duration.toMillis(duration);
  return (
    AUTOMATIC_GIT_FETCH_INTERVAL_OPTIONS.find(
      (option) => Duration.toMillis(option.duration) === millis,
    )?.label ?? `${Math.max(1, Math.round(millis / 1000))} seconds`
  );
}

function mcpServerIdFromName(name: string): McpServerId {
  const normalized =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || `mcp-${crypto.randomUUID().slice(0, 8)}`;
  return McpServerId.makeUnsafe(normalized);
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

type SupportedProviderInstanceDriver = "codex" | "claudeAgent" | "cursor" | "opencode";

function isBuiltInProviderKind(value: string): value is ProviderKind {
  return value === "codex" || value === "claudeAgent";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readConfigString(config: unknown, key: string): string {
  if (!isRecord(config)) {
    return "";
  }
  const value = config[key];
  return typeof value === "string" ? value : "";
}

function normalizeProviderInstanceConfig(
  driver: string,
  entry: ProviderInstanceConfig | null | undefined,
): ProviderInstanceConfig | null {
  if (!entry) {
    return null;
  }
  const next: ProviderInstanceConfig = {
    driver: entry.driver,
    ...(entry.displayName && entry.displayName.trim().length > 0
      ? { displayName: entry.displayName.trim() }
      : {}),
    ...(entry.accentColor ? { accentColor: entry.accentColor } : {}),
    ...(typeof entry.enabled === "boolean" ? { enabled: entry.enabled } : {}),
    ...(entry.config !== undefined ? { config: entry.config } : {}),
  };

  return next.driver === driver &&
    next.displayName === undefined &&
    next.accentColor === undefined &&
    next.enabled === undefined &&
    next.config === undefined
    ? null
    : next;
}

type ProviderSettingsCard = {
  cardKey: string;
  instanceId: string;
  driver: string;
  provider: ProviderKind | null;
  displayName: string;
  providerDisplayName: string;
  instanceDisplayNameInput: string;
  isDefaultInstance: boolean;
  supportsLegacySettings: boolean;
  isDirty: boolean;
  liveProvider: ServerProvider | undefined;
  models: ReadonlyArray<ServerProviderModel>;
  statusStyle: (typeof PROVIDER_STATUS_STYLES)[keyof typeof PROVIDER_STATUS_STYLES];
  summary: ReturnType<typeof getProviderSummary>;
  versionLabel: string | null;
  versionAdvisory: ReturnType<typeof getProviderVersionAdvisoryPresentation>;
  providerConfig: (typeof DEFAULT_UNIFIED_SETTINGS.providers)[ProviderKind] | undefined;
};

const PROVIDER_STATUS_STYLES = {
  disabled: {
    dot: "bg-amber-400",
  },
  error: {
    dot: "bg-destructive",
  },
  ready: {
    dot: "bg-success",
  },
  warning: {
    dot: "bg-warning",
  },
} as const;

function getProviderSummary(provider: ServerProvider | undefined) {
  if (!provider) {
    return {
      headline: "Checking provider status",
      detail: "Waiting for the server to report installation and authentication details.",
    };
  }
  if (provider.availability === "unavailable") {
    return {
      headline: "Driver unavailable",
      detail:
        provider.unavailableReason ??
        provider.message ??
        "This configured provider driver is not available in this Fenrir build.",
    };
  }
  if (!provider.enabled) {
    return {
      headline: "Disabled",
      detail:
        provider.message ?? "This provider is installed but disabled for new sessions in Fenrir.",
    };
  }
  if (!provider.installed) {
    return {
      headline: "Not found",
      detail: provider.message ?? "CLI not detected on PATH.",
    };
  }
  if (provider.auth.status === "authenticated") {
    const authLabel = provider.auth.label ?? provider.auth.type;
    return {
      headline: authLabel ? `Authenticated · ${authLabel}` : "Authenticated",
      detail: provider.message ?? null,
    };
  }
  if (provider.auth.status === "unauthenticated") {
    return {
      headline: "Not authenticated",
      detail: provider.message ?? null,
    };
  }
  if (provider.status === "warning") {
    return {
      headline: "Needs attention",
      detail:
        provider.message ?? "The provider is installed, but the server could not fully verify it.",
    };
  }
  if (provider.status === "error") {
    return {
      headline: "Unavailable",
      detail: provider.message ?? "The provider failed its startup checks.",
    };
  }
  return {
    headline: "Available",
    detail: provider.message ?? "Installed and ready, but authentication could not be verified.",
  };
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

function McpServersSettingsSection(props: {
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

function getProviderVersionLabel(version: string | null | undefined) {
  if (!version) return null;
  return version.startsWith("v") ? version : `v${version}`;
}

function getProviderVersionAdvisoryPresentation(
  advisory: ServerProviderVersionAdvisory | undefined,
): {
  readonly detail: string;
  readonly emphasis: "normal" | "strong";
} | null {
  if (!advisory || advisory.status === "current" || advisory.status === "unknown") {
    return null;
  }

  const versionLabel = getProviderVersionLabel(advisory.latestVersion);
  return {
    detail:
      advisory.message ??
      (versionLabel
        ? `Update available: install ${versionLabel}.`
        : "Update available: install the latest provider version."),
    emphasis: "normal",
  };
}

function ProviderLastChecked({ lastCheckedAt }: { lastCheckedAt: string | null }) {
  useRelativeTimeTick();
  const lastCheckedRelative = lastCheckedAt ? formatRelativeTime(lastCheckedAt) : null;

  if (!lastCheckedRelative) {
    return null;
  }

  return (
    <span className="text-[11px] text-muted-foreground/60">
      {lastCheckedRelative.suffix ? (
        <>
          Checked <span className="font-mono tabular-nums">{lastCheckedRelative.value}</span>{" "}
          {lastCheckedRelative.suffix}
        </>
      ) : (
        <>Checked {lastCheckedRelative.value}</>
      )}
    </span>
  );
}

function AboutVersionTitle() {
  return (
    <span className="inline-flex items-center gap-2">
      <span>Version</span>
      <code className="text-[11px] font-medium text-muted-foreground">{APP_VERSION}</code>
    </span>
  );
}

function AboutVersionSection() {
  const queryClient = useQueryClient();
  const updateStateQuery = useDesktopUpdateState();

  const updateState = updateStateQuery.data ?? null;

  const handleButtonClick = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge) return;

    const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";

    if (action === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          setDesktopUpdateStateQueryData(queryClient, result.state);
        })
        .catch((error: unknown) => {
          toastManager.add({
            type: "error",
            title: "Could not download update",
            description: error instanceof Error ? error.message : "Download failed.",
          });
        });
      return;
    }

    if (action === "install") {
      const confirmed = window.confirm(
        getDesktopUpdateInstallConfirmationMessage(
          updateState ?? { availableVersion: null, downloadedVersion: null },
        ),
      );
      if (!confirmed) return;
      void bridge
        .installUpdate()
        .then((result) => {
          setDesktopUpdateStateQueryData(queryClient, result.state);
        })
        .catch((error: unknown) => {
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: error instanceof Error ? error.message : "Install failed.",
          });
        });
      return;
    }

    if (typeof bridge.checkForUpdate !== "function") return;
    void bridge
      .checkForUpdate()
      .then((result) => {
        setDesktopUpdateStateQueryData(queryClient, result.state);
        if (!result.checked) {
          toastManager.add({
            type: "error",
            title: "Could not check for updates",
            description:
              result.state.message ?? "Automatic updates are not available in this build.",
          });
        }
      })
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Could not check for updates",
          description: error instanceof Error ? error.message : "Update check failed.",
        });
      });
  }, [queryClient, updateState]);

  const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";
  const buttonTooltip = updateState ? getDesktopUpdateButtonTooltip(updateState) : null;
  const buttonDisabled =
    action === "none"
      ? !canCheckForUpdate(updateState)
      : isDesktopUpdateButtonDisabled(updateState);

  const actionLabel: Record<string, string> = { download: "Download", install: "Install" };
  const statusLabel: Record<string, string> = {
    checking: "Checking…",
    downloading: "Downloading…",
    "up-to-date": "Up to Date",
  };
  const buttonLabel =
    actionLabel[action] ?? statusLabel[updateState?.status ?? ""] ?? "Check for Updates";
  const description =
    action === "download" || action === "install"
      ? "Update available."
      : "Current version of the application.";

  return (
    <SettingsRow
      title={<AboutVersionTitle />}
      description={description}
      control={
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="xs"
                variant={action === "install" ? "default" : "outline"}
                disabled={buttonDisabled}
                onClick={handleButtonClick}
              >
                {buttonLabel}
              </Button>
            }
          />
          {buttonTooltip ? <TooltipPopup>{buttonTooltip}</TooltipPopup> : null}
        </Tooltip>
      }
    />
  );
}

export function useSettingsRestore(onRestored?: () => void) {
  const { theme, setTheme } = useTheme();
  const settings = useSettings();
  const { resetSettings } = useUpdateSettings();

  const isGitWritingModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const areProviderSettingsDirty =
    !Equal.equals(settings.providers, DEFAULT_UNIFIED_SETTINGS.providers) ||
    !Equal.equals(settings.providerInstances, DEFAULT_UNIFIED_SETTINGS.providerInstances);
  const areMcpSettingsDirty =
    !Equal.equals(settings.mcpServers, DEFAULT_UNIFIED_SETTINGS.mcpServers) ||
    !Equal.equals(settings.defaultMcpServerIds, DEFAULT_UNIFIED_SETTINGS.defaultMcpServerIds) ||
    !Equal.equals(
      settings.disabledBuiltInMcpServerIds,
      DEFAULT_UNIFIED_SETTINGS.disabledBuiltInMcpServerIds,
    );

  const changedSettingLabels = useMemo(
    () => [
      ...(theme !== "system" ? ["Theme"] : []),
      ...(settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat
        ? ["Time format"]
        : []),
      ...(settings.embeddedEditor !== DEFAULT_UNIFIED_SETTINGS.embeddedEditor
        ? ["Embedded editor"]
        : []),
      ...(settings.sidebarThreadPreviewCount !== DEFAULT_UNIFIED_SETTINGS.sidebarThreadPreviewCount
        ? ["Visible threads"]
        : []),
      ...(settings.diffWordWrap !== DEFAULT_UNIFIED_SETTINGS.diffWordWrap
        ? ["Diff line wrapping"]
        : []),
      ...(settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace
        ? ["Hide whitespace changes"]
        : []),
      ...(settings.enableAssistantStreaming !== DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming
        ? ["Assistant output"]
        : []),
      ...(Duration.toMillis(settings.automaticGitFetchInterval) !==
      Duration.toMillis(DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval)
        ? ["Automatic Git fetch interval"]
        : []),
      ...(settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode
        ? ["New thread mode"]
        : []),
      ...(settings.addProjectBaseDirectory !== DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory
        ? ["Add-project base directory"]
        : []),
      ...(settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive
        ? ["Archive confirmation"]
        : []),
      ...(settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete
        ? ["Delete confirmation"]
        : []),
      ...(isGitWritingModelDirty ? ["Git writing model"] : []),
      ...(areProviderSettingsDirty ? ["Providers"] : []),
      ...(areMcpSettingsDirty ? ["MCP servers"] : []),
      ...(settings.uiFontFamily !== DEFAULT_UNIFIED_SETTINGS.uiFontFamily ? ["UI Font"] : []),
      ...(settings.uiFontSize !== DEFAULT_UNIFIED_SETTINGS.uiFontSize ? ["UI Font Size"] : []),
      ...(settings.terminalFontFamily !== DEFAULT_UNIFIED_SETTINGS.terminalFontFamily
        ? ["Terminal Font"]
        : []),
      ...(settings.terminalFontSize !== DEFAULT_UNIFIED_SETTINGS.terminalFontSize
        ? ["Terminal Font Size"]
        : []),
      ...(settings.terminalLineHeight !== DEFAULT_UNIFIED_SETTINGS.terminalLineHeight
        ? ["Terminal Line Height"]
        : []),
    ],
    [
      areProviderSettingsDirty,
      areMcpSettingsDirty,
      isGitWritingModelDirty,
      settings.confirmThreadArchive,
      settings.confirmThreadDelete,
      settings.defaultThreadEnvMode,
      settings.diffIgnoreWhitespace,
      settings.diffWordWrap,
      settings.enableAssistantStreaming,
      settings.automaticGitFetchInterval,
      settings.addProjectBaseDirectory,
      settings.sidebarThreadPreviewCount,
      settings.timestampFormat,
      settings.embeddedEditor,
      settings.uiFontFamily,
      settings.uiFontSize,
      settings.terminalFontFamily,
      settings.terminalFontSize,
      settings.terminalLineHeight,
      theme,
    ],
  );

  const restoreDefaults = useCallback(async () => {
    if (changedSettingLabels.length === 0) return;
    const api = readLocalApi();
    const confirmed = await (api ?? ensureLocalApi()).dialogs.confirm(
      ["Restore default settings?", `This will reset: ${changedSettingLabels.join(", ")}.`].join(
        "\n",
      ),
    );
    if (!confirmed) return;

    setTheme("system");
    resetSettings();
    onRestored?.();
  }, [changedSettingLabels, onRestored, resetSettings, setTheme]);

  return {
    changedSettingLabels,
    restoreDefaults,
  };
}

export function GeneralSettingsPanel() {
  const { theme, setTheme } = useTheme();
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const {
    fonts,
    isLoading: fontsLoading,
    isRefreshing: fontsRefreshing,
    refreshFonts,
  } = useFonts();
  const [openingPathByTarget, setOpeningPathByTarget] = useState({
    keybindings: false,
    logsDirectory: false,
  });
  const [openPathErrorByTarget, setOpenPathErrorByTarget] = useState<
    Partial<Record<"keybindings" | "logsDirectory", string | null>>
  >({});
  const [openProviderDetails, setOpenProviderDetails] = useState<Record<string, boolean>>({
    codex: Boolean(
      settings.providers.codex.binaryPath !== DEFAULT_UNIFIED_SETTINGS.providers.codex.binaryPath ||
      settings.providers.codex.homePath !== DEFAULT_UNIFIED_SETTINGS.providers.codex.homePath ||
      settings.providers.codex.customModels.length > 0,
    ),
    claudeAgent: Boolean(
      settings.providers.claudeAgent.binaryPath !==
        DEFAULT_UNIFIED_SETTINGS.providers.claudeAgent.binaryPath ||
      settings.providers.claudeAgent.customModels.length > 0,
    ),
  });
  const [customModelInputByProvider, setCustomModelInputByProvider] = useState<
    Record<ProviderKind, string>
  >({
    codex: "",
    claudeAgent: "",
  });
  const [newProviderInstanceDriver, setNewProviderInstanceDriver] =
    useState<SupportedProviderInstanceDriver>("codex");
  const [newProviderInstanceId, setNewProviderInstanceId] = useState("");
  const [newProviderInstanceDisplayName, setNewProviderInstanceDisplayName] = useState("");
  const [newProviderInstanceError, setNewProviderInstanceError] = useState<string | null>(null);
  const [customModelErrorByProvider, setCustomModelErrorByProvider] = useState<
    Partial<Record<ProviderKind, string | null>>
  >({});
  const [isRefreshingProviders, setIsRefreshingProviders] = useState(false);
  const refreshingRef = useRef(false);
  const modelListRefs = useRef<Partial<Record<ProviderKind, HTMLDivElement | null>>>({});
  const refreshProviders = useCallback(() => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setIsRefreshingProviders(true);
    void ensureLocalApi()
      .server.refreshProviders()
      .catch((error: unknown) => {
        console.warn("Failed to refresh providers", error);
      })
      .finally(() => {
        refreshingRef.current = false;
        setIsRefreshingProviders(false);
      });
  }, []);

  const runProviderUpdate = useCallback((provider: ServerProvider) => {
    if (!provider.driver || !provider.instanceId || isProviderUpdateActive(provider)) {
      return;
    }
    const driver = provider.driver;
    const instanceId = provider.instanceId;

    const toastId = toastManager.add({
      type: "loading",
      title: `Updating ${getProviderDriverLabel(driver)}`,
      description: "Running provider update command.",
      timeout: 0,
      data: { hideCopyButton: true },
    });

    void ensureLocalApi()
      .server.updateProvider({
        provider: driver,
        instanceId,
      })
      .then(({ providers }) => {
        const updatedProvider =
          providers.find((candidate) => candidate.instanceId === instanceId) ?? provider;
        const view = getSingleProviderUpdateProgressToastView(updatedProvider);
        toastManager.update(toastId, {
          type: view.type,
          title: view.title,
          description: view.description,
          timeout: 0,
          data: {
            hideCopyButton: true,
            ...(view.dismissAfterVisibleMs !== undefined
              ? { dismissAfterVisibleMs: view.dismissAfterVisibleMs }
              : {}),
          },
        });
      })
      .catch((error: unknown) => {
        toastManager.update(toastId, {
          type: "error",
          title: `Could not update ${getProviderDriverLabel(driver)}`,
          description: error instanceof Error ? error.message : "Provider update failed.",
          timeout: 0,
        });
      });
  }, []);

  const keybindingsConfigPath = useServerKeybindingsConfigPath();
  const availableEditors = useServerAvailableEditors();
  const observability = useServerObservability();
  const serverProviders = useServerProviders();
  const providerInstanceMap = settings.providerInstances as Record<string, ProviderInstanceConfig>;
  const updateProviderInstanceEntry = useCallback(
    (
      instanceId: string,
      driver: string,
      updater: (current: ProviderInstanceConfig | undefined) => ProviderInstanceConfig | null,
    ) => {
      const nextProviderInstances: Record<string, ProviderInstanceConfig> = {
        ...providerInstanceMap,
      };
      const nextEntry = normalizeProviderInstanceConfig(
        driver,
        updater(providerInstanceMap[instanceId]),
      );

      if (nextEntry === null) {
        delete nextProviderInstances[instanceId];
      } else {
        nextProviderInstances[instanceId] = nextEntry;
      }

      updateSettings({
        providerInstances: nextProviderInstances as typeof settings.providerInstances,
      });
    },
    [providerInstanceMap, updateSettings],
  );
  const updateProviderDriverConfigField = useCallback(
    (providerCard: ProviderSettingsCard, fieldKey: string, value: string) => {
      const builtInProvider = providerCard.provider;
      if (
        providerCard.supportsLegacySettings &&
        providerCard.isDefaultInstance &&
        builtInProvider
      ) {
        updateSettings({
          providers: {
            ...settings.providers,
            [builtInProvider]: {
              ...settings.providers[builtInProvider],
              [fieldKey]: value,
            },
          },
        });
        return;
      }

      updateProviderInstanceEntry(providerCard.instanceId, providerCard.driver, (current) => {
        const base = current ?? { driver: ProviderDriverKind.makeUnsafe(providerCard.driver) };
        const currentConfig = isRecord(base.config) ? { ...base.config } : {};
        if (value.length > 0) {
          currentConfig[fieldKey] = value;
        } else {
          delete currentConfig[fieldKey];
        }
        const { config: _existingConfig, ...rest } = base;
        return {
          ...rest,
          ...(Object.keys(currentConfig).length > 0 ? { config: currentConfig } : {}),
        };
      });
    },
    [settings.providers, updateProviderInstanceEntry, updateSettings],
  );
  const addProviderInstance = useCallback(() => {
    const instanceId = newProviderInstanceId.trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(instanceId)) {
      setNewProviderInstanceError(
        "Instance ids must start with a letter and use only letters, numbers, underscores, or dashes.",
      );
      return;
    }
    if (providerInstanceMap[instanceId] !== undefined) {
      setNewProviderInstanceError("That provider instance id already exists.");
      return;
    }
    const nextProviderInstances: Record<string, ProviderInstanceConfig> = {
      ...providerInstanceMap,
      [instanceId]: {
        driver: ProviderDriverKind.makeUnsafe(newProviderInstanceDriver),
        ...(newProviderInstanceDisplayName.trim().length > 0
          ? { displayName: newProviderInstanceDisplayName.trim() }
          : {}),
      },
    };
    updateSettings({
      providerInstances: nextProviderInstances as typeof settings.providerInstances,
    });
    setOpenProviderDetails((existing) => ({ ...existing, [instanceId]: true }));
    setNewProviderInstanceId("");
    setNewProviderInstanceDisplayName("");
    setNewProviderInstanceError(null);
  }, [
    newProviderInstanceDisplayName,
    newProviderInstanceDriver,
    newProviderInstanceId,
    providerInstanceMap,
    updateSettings,
  ]);
  const logsDirectoryPath = observability?.logsDirectoryPath ?? null;
  const diagnosticsDescription = (() => {
    const exports: string[] = [];
    if (observability?.otlpTracesEnabled && observability.otlpTracesUrl) {
      exports.push(`traces to ${observability.otlpTracesUrl}`);
    }
    if (observability?.otlpMetricsEnabled && observability.otlpMetricsUrl) {
      exports.push(`metrics to ${observability.otlpMetricsUrl}`);
    }
    const mode = observability?.localTracingEnabled ? "Local trace file" : "Terminal logs only";
    return exports.length > 0 ? `${mode}. OTLP exporting ${exports.join(" and ")}.` : `${mode}.`;
  })();

  const textGenerationModelSelection = resolveAppModelSelectionState(settings, serverProviders);
  const textGenProvider = textGenerationModelSelection.provider;
  const textGenBuiltInProvider = isBuiltInProviderKind(textGenProvider) ? textGenProvider : null;
  const textGenModel = textGenerationModelSelection.model;
  const textGenModelOptions = textGenerationModelSelection.options;
  const gitModelOptionsByProvider = getCustomModelOptionsByProvider(
    settings,
    serverProviders,
    textGenBuiltInProvider,
    textGenModel,
  );
  const isGitWritingModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );

  const openInPreferredEditor = useCallback(
    (target: "keybindings" | "logsDirectory", path: string | null, failureMessage: string) => {
      if (!path) return;
      setOpenPathErrorByTarget((existing) => ({ ...existing, [target]: null }));
      setOpeningPathByTarget((existing) => ({ ...existing, [target]: true }));

      const editor = resolveAndPersistPreferredEditor(availableEditors ?? [], {
        allowEmbedded: false,
      });
      if (!editor) {
        setOpenPathErrorByTarget((existing) => ({
          ...existing,
          [target]: "No available editors found.",
        }));
        setOpeningPathByTarget((existing) => ({ ...existing, [target]: false }));
        return;
      }

      void ensureLocalApi()
        .shell.openInEditor(path, editor)
        .catch((error) => {
          setOpenPathErrorByTarget((existing) => ({
            ...existing,
            [target]: error instanceof Error ? error.message : failureMessage,
          }));
        })
        .finally(() => {
          setOpeningPathByTarget((existing) => ({ ...existing, [target]: false }));
        });
    },
    [availableEditors],
  );

  const openKeybindingsFile = useCallback(() => {
    openInPreferredEditor("keybindings", keybindingsConfigPath, "Unable to open keybindings file.");
  }, [keybindingsConfigPath, openInPreferredEditor]);

  const openLogsDirectory = useCallback(() => {
    openInPreferredEditor("logsDirectory", logsDirectoryPath, "Unable to open logs folder.");
  }, [logsDirectoryPath, openInPreferredEditor]);

  const openKeybindingsError = openPathErrorByTarget.keybindings ?? null;
  const openDiagnosticsError = openPathErrorByTarget.logsDirectory ?? null;
  const isOpeningKeybindings = openingPathByTarget.keybindings;
  const isOpeningLogsDirectory = openingPathByTarget.logsDirectory;

  const addCustomModel = useCallback(
    (provider: ProviderKind) => {
      const customModelInput = customModelInputByProvider[provider];
      const customModels = settings.providers[provider].customModels;
      const normalized = normalizeModelSlug(customModelInput, provider);
      if (!normalized) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "Enter a model slug.",
        }));
        return;
      }
      if (
        serverProviders
          .find((candidate) => candidate.provider === provider)
          ?.models.some((option) => !option.isCustom && option.slug === normalized)
      ) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "That model is already built in.",
        }));
        return;
      }
      if (normalized.length > MAX_CUSTOM_MODEL_LENGTH) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: `Model slugs must be ${MAX_CUSTOM_MODEL_LENGTH} characters or less.`,
        }));
        return;
      }
      if (customModels.includes(normalized)) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "That custom model is already saved.",
        }));
        return;
      }

      updateSettings({
        providers: {
          ...settings.providers,
          [provider]: {
            ...settings.providers[provider],
            customModels: [...customModels, normalized],
          },
        },
      });
      setCustomModelInputByProvider((existing) => ({
        ...existing,
        [provider]: "",
      }));
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));

      const el = modelListRefs.current[provider];
      if (!el) return;
      const scrollToEnd = () => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      requestAnimationFrame(scrollToEnd);
      const observer = new MutationObserver(() => {
        scrollToEnd();
        observer.disconnect();
      });
      observer.observe(el, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 2_000);
    },
    [customModelInputByProvider, serverProviders, settings, updateSettings],
  );

  const removeCustomModel = useCallback(
    (provider: ProviderKind, slug: string) => {
      updateSettings({
        providers: {
          ...settings.providers,
          [provider]: {
            ...settings.providers[provider],
            customModels: settings.providers[provider].customModels.filter(
              (model) => model !== slug,
            ),
          },
        },
      });
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));
    },
    [settings, updateSettings],
  );

  const providerCards = useMemo<ProviderSettingsCard[]>(() => {
    const cards: ProviderSettingsCard[] = [];
    const representedInstanceIds = new Set<string>();

    for (const provider of ["codex", "claudeAgent"] as const) {
      const instanceId = defaultInstanceIdForDriver(provider);
      const liveProvider = getProviderSnapshot(serverProviders, provider);
      const providerConfig = settings.providers[provider];
      const defaultProviderConfig = DEFAULT_UNIFIED_SETTINGS.providers[provider];
      const explicitInstanceConfig = providerInstanceMap[instanceId];
      const statusKey = liveProvider?.status ?? (providerConfig.enabled ? "warning" : "disabled");
      const summary = getProviderSummary(liveProvider);
      const versionAdvisory = getProviderVersionAdvisoryPresentation(liveProvider?.versionAdvisory);
      const models: ReadonlyArray<ServerProviderModel> =
        liveProvider?.models ??
        providerConfig.customModels.map((slug) => ({
          slug,
          name: slug,
          isCustom: true,
          capabilities: null,
        }));

      representedInstanceIds.add(instanceId);
      cards.push({
        cardKey: instanceId,
        instanceId,
        driver: provider,
        provider,
        displayName:
          liveProvider?.displayName ??
          explicitInstanceConfig?.displayName ??
          getProviderDriverLabel(provider),
        providerDisplayName: getProviderDriverLabel(provider),
        instanceDisplayNameInput: explicitInstanceConfig?.displayName ?? "",
        isDefaultInstance: true,
        supportsLegacySettings: true,
        isDirty:
          !Equal.equals(providerConfig, defaultProviderConfig) ||
          explicitInstanceConfig !== undefined,
        liveProvider,
        models,
        statusStyle: PROVIDER_STATUS_STYLES[statusKey],
        summary,
        versionLabel: getProviderVersionLabel(liveProvider?.version),
        versionAdvisory,
        providerConfig,
      });
    }

    for (const [instanceId, instanceConfig] of Object.entries(providerInstanceMap)) {
      if (representedInstanceIds.has(instanceId)) {
        continue;
      }

      const driver = instanceConfig.driver;
      const provider = isBuiltInProviderKind(driver) ? (driver as ProviderKind) : null;
      const liveProvider = serverProviders.find((candidate) => candidate.instanceId === instanceId);
      const statusKey =
        liveProvider?.status ?? ((instanceConfig.enabled ?? true) ? "warning" : "disabled");
      const summary =
        liveProvider !== undefined
          ? getProviderSummary(liveProvider)
          : {
              headline: "Configured instance",
              detail:
                "This provider instance is saved in settings, but Fenrir does not route it yet.",
            };

      cards.push({
        cardKey: instanceId,
        instanceId,
        driver,
        provider,
        displayName: liveProvider?.displayName ?? instanceConfig.displayName ?? instanceId,
        providerDisplayName: getProviderDriverLabel(driver),
        instanceDisplayNameInput: instanceConfig.displayName ?? "",
        isDefaultInstance: false,
        supportsLegacySettings: false,
        isDirty: true,
        liveProvider,
        models: liveProvider?.models ?? [],
        statusStyle: PROVIDER_STATUS_STYLES[statusKey],
        summary,
        versionLabel: getProviderVersionLabel(liveProvider?.version),
        versionAdvisory: getProviderVersionAdvisoryPresentation(liveProvider?.versionAdvisory),
        providerConfig: undefined,
      });
    }

    return cards;
  }, [providerInstanceMap, serverProviders, settings.providers]);

  const lastCheckedAt =
    serverProviders.length > 0
      ? serverProviders.reduce(
          (latest, provider) => (provider.checkedAt > latest ? provider.checkedAt : latest),
          serverProviders[0]!.checkedAt,
        )
      : null;

  return (
    <SettingsPageContainer>
      <SettingsSection title="General">
        <SettingsRow
          title="Theme"
          description="Choose how Fenrir looks across the app."
          resetAction={
            theme !== "system" ? (
              <SettingResetButton label="theme" onClick={() => setTheme("system")} />
            ) : null
          }
          control={
            <Select
              value={theme}
              onValueChange={(value) => {
                if (isTheme(value)) {
                  setTheme(value);
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Theme preference">
                <SelectValue>
                  {THEME_OPTIONS.find((option) => option.value === theme)?.label ?? "System"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {THEME_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="Time format"
          description="System default follows your browser or OS clock preference."
          resetAction={
            settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat ? (
              <SettingResetButton
                label="time format"
                onClick={() =>
                  updateSettings({
                    timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.timestampFormat}
              onValueChange={(value) => {
                if (value === "locale" || value === "12-hour" || value === "24-hour") {
                  updateSettings({ timestampFormat: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Timestamp format">
                <SelectValue>{TIMESTAMP_FORMAT_LABELS[settings.timestampFormat]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="locale">
                  {TIMESTAMP_FORMAT_LABELS.locale}
                </SelectItem>
                <SelectItem hideIndicator value="12-hour">
                  {TIMESTAMP_FORMAT_LABELS["12-hour"]}
                </SelectItem>
                <SelectItem hideIndicator value="24-hour">
                  {TIMESTAMP_FORMAT_LABELS["24-hour"]}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="Embedded editor"
          description="Choose which embedded editor opens when the Editor tab is available."
          resetAction={
            settings.embeddedEditor !== DEFAULT_UNIFIED_SETTINGS.embeddedEditor ? (
              <SettingResetButton
                label="embedded editor"
                onClick={() =>
                  updateSettings({
                    embeddedEditor: DEFAULT_UNIFIED_SETTINGS.embeddedEditor,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.embeddedEditor}
              onValueChange={(value) => {
                if (value !== null && isEmbeddedEditorKind(value)) {
                  updateSettings({ embeddedEditor: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Embedded editor">
                <SelectValue>{EMBEDDED_EDITOR_LABELS[settings.embeddedEditor]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {EMBEDDED_EDITOR_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="Diff line wrapping"
          description="Set the default wrap state when the diff panel opens."
          resetAction={
            settings.diffWordWrap !== DEFAULT_UNIFIED_SETTINGS.diffWordWrap ? (
              <SettingResetButton
                label="diff line wrapping"
                onClick={() =>
                  updateSettings({
                    diffWordWrap: DEFAULT_UNIFIED_SETTINGS.diffWordWrap,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.diffWordWrap}
              onCheckedChange={(checked) => updateSettings({ diffWordWrap: Boolean(checked) })}
              aria-label="Wrap diff lines by default"
            />
          }
        />

        <SettingsRow
          title="Hide whitespace changes"
          description="Ignore pure whitespace churn when the diff panel opens."
          resetAction={
            settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace ? (
              <SettingResetButton
                label="hide whitespace changes"
                onClick={() =>
                  updateSettings({
                    diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.diffIgnoreWhitespace}
              onCheckedChange={(checked) =>
                updateSettings({ diffIgnoreWhitespace: Boolean(checked) })
              }
              aria-label="Hide whitespace changes by default"
            />
          }
        />

        <SettingsRow
          title="Assistant output"
          description="Show token-by-token output while a response is in progress."
          resetAction={
            settings.enableAssistantStreaming !==
            DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming ? (
              <SettingResetButton
                label="assistant output"
                onClick={() =>
                  updateSettings({
                    enableAssistantStreaming: DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.enableAssistantStreaming}
              onCheckedChange={(checked) =>
                updateSettings({ enableAssistantStreaming: Boolean(checked) })
              }
              aria-label="Stream assistant messages"
            />
          }
        />

        <SettingsRow
          title="Automatic Git fetch interval"
          description="Choose how often Fenrir refreshes remote Git status for open repositories."
          resetAction={
            Duration.toMillis(settings.automaticGitFetchInterval) !==
            Duration.toMillis(DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval) ? (
              <SettingResetButton
                label="automatic Git fetch interval"
                onClick={() =>
                  updateSettings({
                    automaticGitFetchInterval: DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={String(Duration.toMillis(settings.automaticGitFetchInterval))}
              onValueChange={(value) => {
                const nextOption = AUTOMATIC_GIT_FETCH_INTERVAL_OPTIONS.find(
                  (option) => String(Duration.toMillis(option.duration)) === value,
                );
                if (nextOption) {
                  updateSettings({ automaticGitFetchInterval: nextOption.duration });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Automatic Git fetch interval">
                <SelectValue>
                  {getAutomaticGitFetchIntervalLabel(settings.automaticGitFetchInterval)}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {AUTOMATIC_GIT_FETCH_INTERVAL_OPTIONS.map((option) => (
                  <SelectItem
                    key={Duration.toMillis(option.duration)}
                    hideIndicator
                    value={String(Duration.toMillis(option.duration))}
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="New threads"
          description="Pick the default workspace mode for newly created draft threads."
          resetAction={
            settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode ? (
              <SettingResetButton
                label="new threads"
                onClick={() =>
                  updateSettings({
                    defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.defaultThreadEnvMode}
              onValueChange={(value) => {
                if (value === "local" || value === "worktree") {
                  updateSettings({ defaultThreadEnvMode: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-44" aria-label="Default thread mode">
                <SelectValue>
                  {settings.defaultThreadEnvMode === "worktree" ? "New worktree" : "Local"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="local">
                  Local
                </SelectItem>
                <SelectItem hideIndicator value="worktree">
                  New worktree
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="Add-project base directory"
          description="Default starting directory when browsing for a project in the command palette."
          resetAction={
            settings.addProjectBaseDirectory !==
            DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory ? (
              <SettingResetButton
                label="add-project base directory"
                onClick={() =>
                  updateSettings({
                    addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
                  })
                }
              />
            ) : null
          }
          control={
            <Input
              aria-label="Add-project base directory"
              className="w-full sm:w-72"
              placeholder="~/"
              value={settings.addProjectBaseDirectory}
              onChange={(event) => {
                updateSettings({ addProjectBaseDirectory: event.target.value });
              }}
            />
          }
        />

        <SettingsRow
          title="Archive confirmation"
          description="Require a second click on the inline archive action before a thread is archived."
          resetAction={
            settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive ? (
              <SettingResetButton
                label="archive confirmation"
                onClick={() =>
                  updateSettings({
                    confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadArchive}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadArchive: Boolean(checked) })
              }
              aria-label="Confirm thread archiving"
            />
          }
        />

        <SettingsRow
          title="Delete confirmation"
          description="Ask before deleting a thread and its chat history."
          resetAction={
            settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete ? (
              <SettingResetButton
                label="delete confirmation"
                onClick={() =>
                  updateSettings({
                    confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadDelete}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadDelete: Boolean(checked) })
              }
              aria-label="Confirm thread deletion"
            />
          }
        />

        <SettingsRow
          title="Text generation model"
          description="Configure the model used for generated commit messages, PR titles, and similar Git text."
          resetAction={
            isGitWritingModelDirty ? (
              <SettingResetButton
                label="text generation model"
                onClick={() =>
                  updateSettings({
                    textGenerationModelSelection:
                      DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <ProviderModelPicker
                provider={textGenProvider}
                model={textGenModel}
                lockedProvider={null}
                providers={serverProviders}
                modelOptionsByProvider={gitModelOptionsByProvider}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onProviderModelChange={(provider, model) => {
                  updateSettings({
                    textGenerationModelSelection: resolveAppModelSelectionState(
                      {
                        ...settings,
                        textGenerationModelSelection: { provider, model },
                      },
                      serverProviders,
                    ),
                  });
                }}
              />
              {textGenBuiltInProvider ? (
                <TraitsPicker
                  provider={textGenBuiltInProvider}
                  models={
                    serverProviders.find((provider) => provider.provider === textGenBuiltInProvider)
                      ?.models ?? []
                  }
                  model={textGenModel}
                  prompt=""
                  onPromptChange={() => {}}
                  modelOptions={
                    textGenModelOptions as Parameters<typeof TraitsPicker>[0]["modelOptions"]
                  }
                  allowPromptInjectedEffort={false}
                  triggerVariant="outline"
                  triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                  onModelOptionsChange={(nextOptions) => {
                    updateSettings({
                      textGenerationModelSelection: resolveAppModelSelectionState(
                        {
                          ...settings,
                          textGenerationModelSelection: {
                            provider: textGenBuiltInProvider,
                            model: textGenModel,
                            ...(nextOptions ? { options: nextOptions } : {}),
                          },
                        },
                        serverProviders,
                      ),
                    });
                  }}
                />
              ) : null}
            </div>
          }
        />
      </SettingsSection>

      <SettingsSection title="Fonts">
        <SettingsRow
          title="UI Font"
          description="Font family used across the application interface."
          resetAction={
            settings.uiFontFamily !== DEFAULT_UNIFIED_SETTINGS.uiFontFamily ? (
              <SettingResetButton
                label="UI font"
                onClick={() =>
                  updateSettings({
                    uiFontFamily: DEFAULT_UNIFIED_SETTINGS.uiFontFamily,
                  })
                }
              />
            ) : null
          }
          control={
            <FontPicker
              value={settings.uiFontFamily}
              onChange={(value) => updateSettings({ uiFontFamily: value })}
              fonts={fonts}
              isLoading={fontsLoading}
              isRefreshing={fontsRefreshing}
              onRefresh={refreshFonts}
            />
          }
        />

        <SettingsRow
          title="UI Font Size"
          description="Base font size for the application interface (10–24px)."
          resetAction={
            settings.uiFontSize !== DEFAULT_UNIFIED_SETTINGS.uiFontSize ? (
              <SettingResetButton
                label="UI font size"
                onClick={() =>
                  updateSettings({
                    uiFontSize: DEFAULT_UNIFIED_SETTINGS.uiFontSize,
                  })
                }
              />
            ) : null
          }
          control={
            <input
              type="number"
              min={10}
              max={24}
              step={1}
              value={settings.uiFontSize}
              onChange={(e) => {
                const val = Number.parseInt(e.target.value, 10);
                if (!Number.isNaN(val)) {
                  updateSettings({ uiFontSize: Math.min(Math.max(val, 10), 24) });
                }
              }}
              className="w-20 rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm"
              aria-label="UI font size"
            />
          }
        />

        <SettingsRow
          title="Terminal Font"
          description="Font family used in the terminal emulator. Monospace fonts recommended."
          resetAction={
            settings.terminalFontFamily !== DEFAULT_UNIFIED_SETTINGS.terminalFontFamily ? (
              <SettingResetButton
                label="terminal font"
                onClick={() =>
                  updateSettings({
                    terminalFontFamily: DEFAULT_UNIFIED_SETTINGS.terminalFontFamily,
                  })
                }
              />
            ) : null
          }
          control={
            <FontPicker
              value={settings.terminalFontFamily}
              onChange={(value) => updateSettings({ terminalFontFamily: value })}
              fonts={fonts}
              filterMonospace
              isLoading={fontsLoading}
              isRefreshing={fontsRefreshing}
              onRefresh={refreshFonts}
            />
          }
        />

        <SettingsRow
          title="Terminal Font Size"
          description="Font size for the terminal emulator (8–24px)."
          resetAction={
            settings.terminalFontSize !== DEFAULT_UNIFIED_SETTINGS.terminalFontSize ? (
              <SettingResetButton
                label="terminal font size"
                onClick={() =>
                  updateSettings({
                    terminalFontSize: DEFAULT_UNIFIED_SETTINGS.terminalFontSize,
                  })
                }
              />
            ) : null
          }
          control={
            <input
              type="number"
              min={8}
              max={24}
              step={1}
              value={settings.terminalFontSize}
              onChange={(e) => {
                const val = Number.parseInt(e.target.value, 10);
                if (!Number.isNaN(val)) {
                  updateSettings({
                    terminalFontSize: Math.min(Math.max(val, 8), 24),
                  });
                }
              }}
              className="w-20 rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm"
              aria-label="Terminal font size"
            />
          }
        />

        <SettingsRow
          title="Terminal Line Height"
          description="Line spacing multiplier for the terminal (1.0–2.0)."
          resetAction={
            settings.terminalLineHeight !== DEFAULT_UNIFIED_SETTINGS.terminalLineHeight ? (
              <SettingResetButton
                label="terminal line height"
                onClick={() =>
                  updateSettings({
                    terminalLineHeight: DEFAULT_UNIFIED_SETTINGS.terminalLineHeight,
                  })
                }
              />
            ) : null
          }
          control={
            <input
              type="number"
              min={1.0}
              max={2.0}
              step={0.1}
              value={settings.terminalLineHeight}
              onChange={(e) => {
                const val = Number.parseFloat(e.target.value);
                if (!Number.isNaN(val)) {
                  updateSettings({
                    terminalLineHeight: Math.min(Math.max(val, 1.0), 2.0),
                  });
                }
              }}
              className="w-20 rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm"
              aria-label="Terminal line height"
            />
          }
        />

        <SettingsRow
          title="Editor Font"
          description="Font family for the embedded editor. Nerd Font icons fall back automatically."
          resetAction={
            settings.editorFontFamily !== DEFAULT_UNIFIED_SETTINGS.editorFontFamily ? (
              <SettingResetButton
                label="editor font"
                onClick={() =>
                  updateSettings({
                    editorFontFamily: DEFAULT_UNIFIED_SETTINGS.editorFontFamily,
                  })
                }
              />
            ) : null
          }
          control={
            <FontPicker
              value={settings.editorFontFamily}
              onChange={(value) => updateSettings({ editorFontFamily: value })}
              fonts={fonts}
              filterMonospace
              isLoading={fontsLoading}
              isRefreshing={fontsRefreshing}
              onRefresh={refreshFonts}
            />
          }
        />

        <SettingsRow
          title="Editor Font Size"
          description="Font size for the embedded editor (8–32px)."
          resetAction={
            settings.editorFontSize !== DEFAULT_UNIFIED_SETTINGS.editorFontSize ? (
              <SettingResetButton
                label="editor font size"
                onClick={() =>
                  updateSettings({
                    editorFontSize: DEFAULT_UNIFIED_SETTINGS.editorFontSize,
                  })
                }
              />
            ) : null
          }
          control={
            <input
              type="number"
              min={8}
              max={32}
              step={1}
              value={settings.editorFontSize}
              onChange={(e) => {
                const val = Number.parseInt(e.target.value, 10);
                if (!Number.isNaN(val)) {
                  updateSettings({
                    editorFontSize: Math.min(Math.max(val, 8), 32),
                  });
                }
              }}
              className="w-20 rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm"
              aria-label="Editor font size"
            />
          }
        />

        <SettingsRow
          title="Editor Line Height"
          description="Line spacing multiplier for the editor (1.0–2.0)."
          resetAction={
            settings.editorLineHeight !== DEFAULT_UNIFIED_SETTINGS.editorLineHeight ? (
              <SettingResetButton
                label="editor line height"
                onClick={() =>
                  updateSettings({
                    editorLineHeight: DEFAULT_UNIFIED_SETTINGS.editorLineHeight,
                  })
                }
              />
            ) : null
          }
          control={
            <input
              type="number"
              min={1.0}
              max={2.0}
              step={0.1}
              value={settings.editorLineHeight}
              onChange={(e) => {
                const val = Number.parseFloat(e.target.value);
                if (!Number.isNaN(val)) {
                  updateSettings({
                    editorLineHeight: Math.min(Math.max(val, 1.0), 2.0),
                  });
                }
              }}
              className="w-20 rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm"
              aria-label="Editor line height"
            />
          }
        />

        <SettingsRow
          title="Editor Font Weight"
          description="Font weight for the editor (100–900, in steps of 100)."
          resetAction={
            settings.editorFontWeight !== DEFAULT_UNIFIED_SETTINGS.editorFontWeight ? (
              <SettingResetButton
                label="editor font weight"
                onClick={() =>
                  updateSettings({
                    editorFontWeight: DEFAULT_UNIFIED_SETTINGS.editorFontWeight,
                  })
                }
              />
            ) : null
          }
          control={
            <select
              value={settings.editorFontWeight}
              onChange={(e) => {
                const val = Number.parseInt(e.target.value, 10);
                if (!Number.isNaN(val)) {
                  updateSettings({ editorFontWeight: val });
                }
              }}
              className="w-28 rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm"
              aria-label="Editor font weight"
            >
              {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          }
        />

        <SettingsRow
          title="Editor Ligatures"
          description="Render programming ligatures (e.g. =>, !=). Disable for fastest paint."
          resetAction={
            settings.editorLigatures !== DEFAULT_UNIFIED_SETTINGS.editorLigatures ? (
              <SettingResetButton
                label="editor ligatures"
                onClick={() =>
                  updateSettings({
                    editorLigatures: DEFAULT_UNIFIED_SETTINGS.editorLigatures,
                  })
                }
              />
            ) : null
          }
          control={
            <input
              type="checkbox"
              checked={settings.editorLigatures}
              onChange={(e) => updateSettings({ editorLigatures: e.target.checked })}
              aria-label="Editor ligatures"
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Providers"
        headerAction={
          <div className="flex items-center gap-1.5">
            <ProviderLastChecked lastCheckedAt={lastCheckedAt} />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                    disabled={isRefreshingProviders}
                    onClick={() => void refreshProviders()}
                    aria-label="Refresh provider status"
                  >
                    {isRefreshingProviders ? (
                      <LoaderIcon className="size-3 animate-spin" />
                    ) : (
                      <RefreshCwIcon className="size-3" />
                    )}
                  </Button>
                }
              />
              <TooltipPopup side="top">Refresh provider status</TooltipPopup>
            </Tooltip>
          </div>
        }
      >
        <div className="border-t border-border/60 px-4 py-3 first:border-t-0 sm:px-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="grid gap-1">
              <span className="text-xs font-medium text-foreground">Driver</span>
              <Select
                value={newProviderInstanceDriver}
                onValueChange={(value) => {
                  if (
                    value === "codex" ||
                    value === "claudeAgent" ||
                    value === "cursor" ||
                    value === "opencode"
                  ) {
                    setNewProviderInstanceDriver(value);
                  }
                }}
              >
                <SelectTrigger className="w-full sm:w-40" aria-label="New provider instance driver">
                  <SelectValue>{getProviderDriverLabel(newProviderInstanceDriver)}</SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {PROVIDER_DRIVER_DEFINITIONS.map((provider) => (
                    <SelectItem key={provider.value} value={provider.value}>
                      {provider.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </label>
            <label className="grid flex-1 gap-1">
              <span className="text-xs font-medium text-foreground">Instance ID</span>
              <Input
                value={newProviderInstanceId}
                onChange={(event) => {
                  setNewProviderInstanceId(event.target.value);
                  if (newProviderInstanceError) {
                    setNewProviderInstanceError(null);
                  }
                }}
                placeholder="codex_work"
                spellCheck={false}
              />
            </label>
            <label className="grid flex-1 gap-1">
              <span className="text-xs font-medium text-foreground">Display name</span>
              <Input
                value={newProviderInstanceDisplayName}
                onChange={(event) => setNewProviderInstanceDisplayName(event.target.value)}
                placeholder="Optional"
                spellCheck={false}
              />
            </label>
            <Button size="sm" className="gap-1.5" onClick={addProviderInstance}>
              <PlusIcon className="size-3.5" />
              Add instance
            </Button>
          </div>
          {newProviderInstanceError ? (
            <p className="mt-2 text-xs text-destructive">{newProviderInstanceError}</p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Create provider instances with their own display name, config, and routing identity.
            </p>
          )}
        </div>
        {providerCards.map((providerCard) => {
          const builtInProvider = providerCard.provider;
          const driverDefinition = getProviderDriverDefinition(providerCard.driver);
          const customModelInput =
            builtInProvider !== null ? customModelInputByProvider[builtInProvider] : "";
          const customModelError =
            builtInProvider !== null ? (customModelErrorByProvider[builtInProvider] ?? null) : null;
          const providerDisplayName = providerCard.displayName;
          const isOpen = openProviderDetails[providerCard.cardKey] ?? false;
          const persistedInstanceConfig = providerInstanceMap[providerCard.instanceId];
          const instanceConfigValue =
            providerCard.supportsLegacySettings && builtInProvider && providerCard.providerConfig
              ? providerCard.providerConfig
              : persistedInstanceConfig?.config;
          const instanceEnabled =
            providerCard.supportsLegacySettings && providerCard.providerConfig
              ? providerCard.providerConfig.enabled
              : (persistedInstanceConfig?.enabled ?? providerCard.liveProvider?.enabled ?? true);

          return (
            <div key={providerCard.cardKey} className="border-t border-border first:border-t-0">
              <div className="px-4 py-4 sm:px-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex min-h-5 items-center gap-1.5">
                      <span
                        className={cn("size-2 shrink-0 rounded-full", providerCard.statusStyle.dot)}
                      />
                      <h3 className="text-sm font-medium text-foreground">{providerDisplayName}</h3>
                      {providerCard.versionLabel ? (
                        <code className="text-xs text-muted-foreground">
                          {providerCard.versionLabel}
                        </code>
                      ) : null}
                      {!providerCard.isDefaultInstance ? (
                        <code className="truncate text-[11px] text-muted-foreground/70">
                          {providerCard.instanceId}
                        </code>
                      ) : null}
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                        {providerCard.isDirty ? (
                          <SettingResetButton
                            label={`${providerDisplayName} provider settings`}
                            onClick={() => {
                              if (providerCard.isDefaultInstance && builtInProvider) {
                                const nextProviderInstances = { ...providerInstanceMap };
                                delete nextProviderInstances[providerCard.instanceId];
                                updateSettings({
                                  providers: {
                                    ...settings.providers,
                                    [builtInProvider]:
                                      DEFAULT_UNIFIED_SETTINGS.providers[builtInProvider],
                                  },
                                  providerInstances:
                                    nextProviderInstances as typeof settings.providerInstances,
                                });
                                setCustomModelErrorByProvider((existing) => ({
                                  ...existing,
                                  [builtInProvider]: null,
                                }));
                                return;
                              }

                              updateProviderInstanceEntry(
                                providerCard.instanceId,
                                providerCard.driver,
                                () => null,
                              );
                            }}
                          />
                        ) : null}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {providerCard.summary.headline}
                      {providerCard.summary.detail ? ` - ${providerCard.summary.detail}` : null}
                    </p>
                    {providerCard.versionAdvisory ? (
                      <p
                        className={cn(
                          "text-xs",
                          providerCard.versionAdvisory.emphasis === "strong"
                            ? "font-medium text-foreground"
                            : "text-amber-700 dark:text-amber-300",
                        )}
                      >
                        {providerCard.versionAdvisory.detail}
                      </p>
                    ) : null}
                    {providerCard.liveProvider?.versionAdvisory?.canUpdate === true &&
                    providerCard.liveProvider.versionAdvisory.updateCommand !== null ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={isProviderUpdateActive(providerCard.liveProvider)}
                          onClick={() => runProviderUpdate(providerCard.liveProvider!)}
                        >
                          {isProviderUpdateActive(providerCard.liveProvider) ? (
                            <LoaderIcon className="size-3.5 animate-spin" />
                          ) : (
                            <DownloadIcon className="size-3.5" />
                          )}
                          Update
                        </Button>
                        <code className="rounded border border-border/70 bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {providerCard.liveProvider.versionAdvisory.updateCommand}
                        </code>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setOpenProviderDetails((existing) => ({
                          ...existing,
                          [providerCard.cardKey]: !existing[providerCard.cardKey],
                        }))
                      }
                      aria-label={`Toggle ${providerDisplayName} details`}
                    >
                      <ChevronDownIcon
                        className={cn("size-3.5 transition-transform", isOpen && "rotate-180")}
                      />
                    </Button>
                    <Switch
                      checked={instanceEnabled}
                      onCheckedChange={(checked) => {
                        if (providerCard.supportsLegacySettings && builtInProvider) {
                          const isDisabling = !checked;
                          const shouldClearModelSelection =
                            isDisabling && textGenProvider === builtInProvider;
                          updateSettings({
                            providers: {
                              ...settings.providers,
                              [builtInProvider]: {
                                ...settings.providers[builtInProvider],
                                enabled: Boolean(checked),
                              },
                            },
                            ...(shouldClearModelSelection
                              ? {
                                  textGenerationModelSelection:
                                    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                                }
                              : {}),
                          });
                          return;
                        }

                        updateProviderInstanceEntry(
                          providerCard.instanceId,
                          providerCard.driver,
                          (current) => ({
                            ...(current ?? {
                              driver: ProviderDriverKind.makeUnsafe(providerCard.driver),
                            }),
                            enabled: Boolean(checked),
                          }),
                        );
                      }}
                      aria-label={`Enable ${providerDisplayName}`}
                    />
                  </div>
                </div>
              </div>

              <Collapsible
                open={isOpen}
                onOpenChange={(open) =>
                  setOpenProviderDetails((existing) => ({
                    ...existing,
                    [providerCard.cardKey]: open,
                  }))
                }
              >
                <CollapsibleContent>
                  <div className="space-y-0">
                    <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                      <label htmlFor={`provider-instance-${providerCard.instanceId}-name`}>
                        <span className="text-xs font-medium text-foreground">Display name</span>
                        <Input
                          id={`provider-instance-${providerCard.instanceId}-name`}
                          className="mt-1.5"
                          value={providerCard.instanceDisplayNameInput}
                          onChange={(event) =>
                            updateProviderInstanceEntry(
                              providerCard.instanceId,
                              providerCard.driver,
                              (current) => ({
                                ...(current ?? {
                                  driver: ProviderDriverKind.makeUnsafe(providerCard.driver),
                                }),
                                displayName: event.target.value,
                              }),
                            )
                          }
                          placeholder={providerCard.providerDisplayName}
                          spellCheck={false}
                        />
                        <span className="mt-1 block text-xs text-muted-foreground">
                          Optional label shown in the UI for this provider instance.
                        </span>
                      </label>
                    </div>

                    <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                      <div className="text-xs font-medium text-foreground">Instance metadata</div>
                      <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                        <div>
                          <span className="block text-[11px] uppercase tracking-[0.08em] text-muted-foreground/65">
                            Driver
                          </span>
                          <code className="mt-1 block text-foreground/85">
                            {providerCard.driver}
                          </code>
                        </div>
                        <div>
                          <span className="block text-[11px] uppercase tracking-[0.08em] text-muted-foreground/65">
                            Instance ID
                          </span>
                          <code className="mt-1 block break-all text-foreground/85">
                            {providerCard.instanceId}
                          </code>
                        </div>
                      </div>
                    </div>

                    {driverDefinition && driverDefinition.settingsFields.length > 0 ? (
                      <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                        <div className="text-xs font-medium text-foreground">Configuration</div>
                        <div className="mt-3 grid gap-3">
                          {driverDefinition.settingsFields.map((field) => (
                            <label
                              key={`${providerCard.instanceId}:${field.key}`}
                              htmlFor={`provider-config-${providerCard.instanceId}-${field.key}`}
                              className="block"
                            >
                              <span className="text-xs font-medium text-foreground">
                                {field.label}
                              </span>
                              <Input
                                id={`provider-config-${providerCard.instanceId}-${field.key}`}
                                className="mt-1.5"
                                type={field.control === "password" ? "password" : "text"}
                                value={readConfigString(instanceConfigValue, field.key)}
                                onChange={(event) =>
                                  updateProviderDriverConfigField(
                                    providerCard,
                                    field.key,
                                    event.target.value,
                                  )
                                }
                                placeholder={field.placeholder}
                                spellCheck={false}
                              />
                              <span className="mt-1 block text-xs text-muted-foreground">
                                {field.description}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {providerCard.supportsLegacySettings && builtInProvider ? (
                      <>
                        <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                          <div className="text-xs font-medium text-foreground">Models</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {providerCard.models.length} model
                            {providerCard.models.length === 1 ? "" : "s"} available.
                          </div>
                          <div
                            ref={(el) => {
                              modelListRefs.current[builtInProvider] = el;
                            }}
                            className="mt-2 max-h-40 overflow-y-auto pb-1"
                          >
                            {providerCard.models.map((model) => {
                              const caps = model.capabilities;
                              const capLabels: string[] = [];
                              if (caps?.supportsFastMode) capLabels.push("Fast mode");
                              if (caps?.supportsThinkingToggle) capLabels.push("Thinking");
                              if (
                                caps?.reasoningEffortLevels &&
                                caps.reasoningEffortLevels.length > 0
                              ) {
                                capLabels.push("Reasoning");
                              }
                              const hasDetails = capLabels.length > 0 || model.name !== model.slug;

                              return (
                                <div
                                  key={`${providerCard.instanceId}:${model.slug}`}
                                  className="flex items-center gap-2 py-1"
                                >
                                  <span className="min-w-0 truncate text-xs text-foreground/90">
                                    {model.name}
                                  </span>
                                  {hasDetails ? (
                                    <Tooltip>
                                      <TooltipTrigger
                                        render={
                                          <button
                                            type="button"
                                            className="shrink-0 text-muted-foreground/40 transition-colors hover:text-muted-foreground"
                                            aria-label={`Details for ${model.name}`}
                                          />
                                        }
                                      >
                                        <InfoIcon className="size-3" />
                                      </TooltipTrigger>
                                      <TooltipPopup side="top" className="max-w-56">
                                        <div className="space-y-1">
                                          <code className="block text-[11px] text-foreground">
                                            {model.slug}
                                          </code>
                                          {capLabels.length > 0 ? (
                                            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                                              {capLabels.map((label) => (
                                                <span
                                                  key={label}
                                                  className="text-[10px] text-muted-foreground"
                                                >
                                                  {label}
                                                </span>
                                              ))}
                                            </div>
                                          ) : null}
                                        </div>
                                      </TooltipPopup>
                                    </Tooltip>
                                  ) : null}
                                  {model.isCustom ? (
                                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                                      <span className="text-[10px] text-muted-foreground">
                                        custom
                                      </span>
                                      <button
                                        type="button"
                                        className="text-muted-foreground transition-colors hover:text-foreground"
                                        aria-label={`Remove ${model.slug}`}
                                        onClick={() =>
                                          removeCustomModel(builtInProvider, model.slug)
                                        }
                                      >
                                        <XIcon className="size-3" />
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>

                          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                            <Input
                              id={`custom-model-${builtInProvider}`}
                              value={customModelInput}
                              onChange={(event) => {
                                const value = event.target.value;
                                setCustomModelInputByProvider((existing) => ({
                                  ...existing,
                                  [builtInProvider]: value,
                                }));
                                if (customModelError) {
                                  setCustomModelErrorByProvider((existing) => ({
                                    ...existing,
                                    [builtInProvider]: null,
                                  }));
                                }
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter") return;
                                event.preventDefault();
                                addCustomModel(builtInProvider);
                              }}
                              placeholder={
                                builtInProvider === "codex"
                                  ? "gpt-6.7-codex-ultra-preview"
                                  : "claude-sonnet-5-0"
                              }
                              spellCheck={false}
                            />
                            <Button
                              className="shrink-0"
                              variant="outline"
                              onClick={() => addCustomModel(builtInProvider)}
                            >
                              <PlusIcon className="size-3.5" />
                              Add
                            </Button>
                          </div>

                          {customModelError ? (
                            <p className="mt-2 text-xs text-destructive">{customModelError}</p>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                        <div className="text-xs font-medium text-foreground">
                          Additional instance status
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {providerCard.liveProvider?.message ??
                            "This configured provider instance is recorded in settings, but Fenrir does not route it yet."}
                        </p>
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          );
        })}
      </SettingsSection>

      <McpServersSettingsSection settings={settings} updateSettings={updateSettings} />

      <SettingsSection title="Advanced">
        <SettingsRow
          title="Keybindings file"
          description="Use Settings > Keybindings for normal edits, or open the persisted `keybindings.json` file directly for advanced changes."
          status={
            <>
              <span className="block break-all font-mono text-[11px] text-foreground">
                {keybindingsConfigPath ?? "Resolving keybindings path..."}
              </span>
              {openKeybindingsError ? (
                <span className="mt-1 block text-destructive">{openKeybindingsError}</span>
              ) : (
                <span className="mt-1 block">Opens in your preferred editor.</span>
              )}
            </>
          }
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={!keybindingsConfigPath || isOpeningKeybindings}
              onClick={openKeybindingsFile}
            >
              {isOpeningKeybindings ? "Opening..." : "Open file"}
            </Button>
          }
        />
      </SettingsSection>

      <SettingsSection title="About">
        {isElectron ? (
          <AboutVersionSection />
        ) : (
          <SettingsRow
            title={<AboutVersionTitle />}
            description="Current version of the application."
          />
        )}
        <SettingsRow
          title="Diagnostics"
          description={`Open the dedicated diagnostics view for traces and process history. ${diagnosticsDescription}`}
          status={
            <>
              <span className="block break-all font-mono text-[11px] text-foreground">
                {logsDirectoryPath ?? "Resolving logs directory..."}
              </span>
              {openDiagnosticsError ? (
                <span className="mt-1 block text-destructive">{openDiagnosticsError}</span>
              ) : null}
            </>
          }
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={!logsDirectoryPath || isOpeningLogsDirectory}
              onClick={openLogsDirectory}
            >
              {isOpeningLogsDirectory ? "Opening..." : "Open logs folder"}
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function ArchivedThreadsPanel() {
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const { unarchiveThread, confirmAndDeleteThread } = useThreadActions();
  // Internal plan-runner threads are persisted but never user-browsable —
  // hide them from the archive panel even if archivedAt is non-null.
  const internalPlanRunnerThreadIds = useInternalPlanRunnerThreadIds();
  const environmentIds = useMemo(
    () => [...new Set(projects.map((project) => project.environmentId))],
    [projects],
  );
  const {
    snapshots: archivedSnapshots,
    error: archivedThreadsError,
    isLoading: archivedThreadsLoading,
    refresh: refreshArchivedThreads,
  } = useArchivedThreadSnapshots(environmentIds);
  const archivedGroups = useMemo(() => {
    const projectByKey = new Map<string, (typeof projects)[number]>(
      projects.map((project) => [`${project.environmentId}:${project.id}`, project] as const),
    );
    const threadsByProjectKey = new Map<
      string,
      Array<
        (typeof archivedSnapshots)[number]["snapshot"]["threads"][number] & {
          readonly environmentId: (typeof archivedSnapshots)[number]["environmentId"];
        }
      >
    >();

    for (const entry of archivedSnapshots) {
      for (const project of entry.snapshot.projects) {
        const key = `${entry.environmentId}:${project.id}`;
        if (projectByKey.has(key)) {
          continue;
        }
        projectByKey.set(key, {
          id: project.id,
          environmentId: entry.environmentId,
          name: project.title,
          cwd: project.workspaceRoot,
          repositoryIdentity: project.repositoryIdentity ?? null,
          defaultModelSelection: project.defaultModelSelection,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          scripts: [...project.scripts],
          managedProcesses: [...(project.managedProcesses ?? [])],
          globalScriptDefaults: [...(project.globalScriptDefaults ?? [])],
        });
      }

      for (const thread of entry.snapshot.threads) {
        if (internalPlanRunnerThreadIds.has(thread.id)) {
          continue;
        }
        const key = `${entry.environmentId}:${thread.projectId}`;
        const projectThreads = threadsByProjectKey.get(key) ?? [];
        projectThreads.push({
          ...thread,
          environmentId: entry.environmentId,
        });
        threadsByProjectKey.set(key, projectThreads);
      }
    }

    return [...projectByKey.entries()]
      .map(([key, project]) => ({
        project,
        threads: [...(threadsByProjectKey.get(key) ?? [])].toSorted((left, right) => {
          const leftKey = left.archivedAt ?? left.createdAt;
          const rightKey = right.archivedAt ?? right.createdAt;
          return rightKey.localeCompare(leftKey) || right.id.localeCompare(left.id);
        }),
      }))
      .filter((group) => group.threads.length > 0);
  }, [archivedSnapshots, internalPlanRunnerThreadIds, projects]);

  const handleArchivedThreadContextMenu = useCallback(
    async (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const clicked = await api.contextMenu.show(
        [
          { id: "unarchive", label: "Unarchive" },
          { id: "delete", label: "Delete", destructive: true },
        ],
        position,
      );

      if (clicked === "unarchive") {
        try {
          await unarchiveThread(threadRef);
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to unarchive thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
        return;
      }

      if (clicked === "delete") {
        await confirmAndDeleteThread(threadRef);
      }
    },
    [confirmAndDeleteThread, unarchiveThread],
  );

  return (
    <SettingsPageContainer>
      {archivedThreadsError ? (
        <SettingsSection title="Archived threads">
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-4 first:border-t-0 sm:px-5">
            <p className="text-sm text-destructive">{archivedThreadsError}</p>
            <Button type="button" size="sm" variant="outline" onClick={refreshArchivedThreads}>
              Retry
            </Button>
          </div>
        </SettingsSection>
      ) : null}
      {archivedGroups.length === 0 ? (
        <SettingsSection title="Archived threads">
          <Empty className="min-h-88">
            <EmptyMedia variant="icon">
              <ArchiveIcon />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>No archived threads</EmptyTitle>
              <EmptyDescription>
                {archivedThreadsLoading
                  ? "Loading archived threads..."
                  : "Archived threads will appear here."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </SettingsSection>
      ) : (
        archivedGroups.map(({ project, threads: projectThreads }) => (
          <SettingsSection
            key={project.id}
            title={project.name}
            icon={<ProjectFavicon environmentId={project.environmentId} cwd={project.cwd} />}
          >
            {projectThreads.map((thread) => (
              <div
                key={thread.id}
                className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 first:border-t-0 sm:px-5"
                onContextMenu={(event) => {
                  event.preventDefault();
                  void handleArchivedThreadContextMenu(
                    scopeThreadRef(thread.environmentId, thread.id),
                    {
                      x: event.clientX,
                      y: event.clientY,
                    },
                  );
                }}
              >
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium text-foreground">{thread.title}</h3>
                  <p className="text-xs text-muted-foreground">
                    Archived {formatRelativeTimeLabel(thread.archivedAt ?? thread.createdAt)}
                    {" \u00b7 Created "}
                    {formatRelativeTimeLabel(thread.createdAt)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 cursor-pointer gap-1.5 px-2.5"
                  onClick={() =>
                    void unarchiveThread(scopeThreadRef(thread.environmentId, thread.id)).catch(
                      (error) => {
                        toastManager.add({
                          type: "error",
                          title: "Failed to unarchive thread",
                          description:
                            error instanceof Error ? error.message : "An error occurred.",
                        });
                      },
                    )
                  }
                >
                  <ArchiveX className="size-3.5" />
                  <span>Unarchive</span>
                </Button>
              </div>
            ))}
          </SettingsSection>
        ))
      )}
    </SettingsPageContainer>
  );
}

// ── Archived Plans Panel ──────────────────────────────────────────────────

function ArchivedFeatureRow({
  feature,
  onUnarchive,
}: {
  feature: ArchivedFeatureSummary;
  onUnarchive: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useRelativeTimeTick();

  const handleUnarchive = async () => {
    setBusy(true);
    setError(null);
    try {
      await onUnarchive();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unarchive failed.";
      if (/already exists/i.test(msg)) {
        setError(
          `A feature named "${feature.featureName}" already exists. Rename or delete the existing .plans/${feature.featureName}/ folder, then retry.`,
        );
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1 border-t border-border px-4 py-3 first:border-t-0 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-foreground">{feature.featureName}</h3>
          <p className="text-xs text-muted-foreground">
            {feature.planCount} {feature.planCount === 1 ? "plan" : "plans"}
            {" · Archived "}
            {formatRelativeTimeLabel(feature.archivedAt)}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 cursor-pointer gap-1.5 px-2.5"
          disabled={busy}
          onClick={() => void handleUnarchive()}
        >
          <ArchiveX className="size-3.5" />
          <span>Unarchive</span>
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function ArchivedPlansPanel() {
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const archivedByProject = usePlanRunnerStore((s) => s.archivedFeaturesByProjectId);

  useEffect(() => {
    void usePlanRunnerStore.getState().fetchArchivedFeatures();
  }, []);

  const archivedGroups = useMemo(() => {
    return projects
      .map((project) => {
        const features = archivedByProject[project.id] ?? [];
        return {
          project,
          features: features.toSorted((a, b) => b.archivedAt.localeCompare(a.archivedAt)),
        };
      })
      .filter((group) => group.features.length > 0);
  }, [projects, archivedByProject]);

  const handleUnarchive = useCallback(async (projectId: ProjectId, archivedDirName: string) => {
    await usePlanRunnerStore.getState().unarchiveFeature(projectId, archivedDirName);
  }, []);

  return (
    <SettingsPageContainer>
      {archivedGroups.length === 0 ? (
        <SettingsSection title="Archived plans">
          <Empty className="min-h-88">
            <EmptyMedia variant="icon">
              <FolderArchiveIcon />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>No archived plans</EmptyTitle>
              <EmptyDescription>Archived plans will appear here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </SettingsSection>
      ) : (
        archivedGroups.map(({ project, features }) => (
          <SettingsSection
            key={project.id}
            title={project.name}
            icon={<ProjectFavicon environmentId={project.environmentId} cwd={project.cwd} />}
          >
            {features.map((feature) => (
              <ArchivedFeatureRow
                key={feature.archivedDirName}
                feature={feature}
                onUnarchive={() => handleUnarchive(project.id, feature.archivedDirName)}
              />
            ))}
          </SettingsSection>
        ))
      )}
    </SettingsPageContainer>
  );
}
