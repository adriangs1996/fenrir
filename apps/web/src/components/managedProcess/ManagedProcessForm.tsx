import type {
  EnvironmentId,
  ManagedProcess,
  ManagedProcessAutoRestart,
  ManagedProcessProxy,
  ManagedProcessReadiness,
  ManagedProcessScope,
  ProjectId,
  ProjectScriptIcon,
} from "@fenrir/contracts";
import {
  BugIcon,
  FlaskConicalIcon,
  HammerIcon,
  ListChecksIcon,
  MinusIcon,
  PlayIcon,
  PlusIcon,
  WrenchIcon,
} from "lucide-react";
import React, { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { nextManagedProcessId } from "~/projectScripts";
import { readEnvironmentConnection } from "~/environments/runtime";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";

// ---------------------------------------------------------------------------
// Icon picker (reuse SCRIPT_ICONS from ProjectScriptsControl)
// ---------------------------------------------------------------------------

const SCRIPT_ICONS: Array<{ id: ProjectScriptIcon; label: string }> = [
  { id: "play", label: "Play" },
  { id: "test", label: "Test" },
  { id: "lint", label: "Lint" },
  { id: "configure", label: "Configure" },
  { id: "build", label: "Build" },
  { id: "debug", label: "Debug" },
];

function ScriptIcon({
  icon,
  className = "size-3.5",
}: {
  icon: ProjectScriptIcon;
  className?: string;
}) {
  if (icon === "test") return <FlaskConicalIcon className={className} />;
  if (icon === "lint") return <ListChecksIcon className={className} />;
  if (icon === "configure") return <WrenchIcon className={className} />;
  if (icon === "build") return <HammerIcon className={className} />;
  if (icon === "debug") return <BugIcon className={className} />;
  return <PlayIcon className={className} />;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ManagedProcessFormProps {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  mode: "create" | "edit";
  initial?: ManagedProcess | null;
  existingIds: string[];
  onClose: () => void;
}

type ProxyKind = "none" | "portless";
type ReadinessKind = "none" | "portless-http" | "log-pattern";

// ---------------------------------------------------------------------------
// Env key-value editor
// ---------------------------------------------------------------------------

function EnvEditor({
  entries,
  onChange,
}: {
  entries: Array<{ key: string; value: string }>;
  onChange: (entries: Array<{ key: string; value: string }>) => void;
}) {
  const addRow = () => onChange([...entries, { key: "", value: "" }]);
  const removeRow = (index: number) => onChange(entries.filter((_, i) => i !== index));
  const updateRow = (index: number, field: "key" | "value", val: string) =>
    onChange(entries.map((e, i) => (i === index ? { ...e, [field]: val } : e)));

  return (
    <div className="space-y-2">
      {entries.map((entry, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            placeholder="KEY"
            value={entry.key}
            onChange={(e) => updateRow(i, "key", e.target.value)}
            className="flex-1 font-mono text-xs"
          />
          <span className="text-muted-foreground">=</span>
          <Input
            placeholder="value"
            value={entry.value}
            onChange={(e) => updateRow(i, "value", e.target.value)}
            className="flex-1 font-mono text-xs"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => removeRow(i)}
            aria-label="Remove env var"
          >
            <MinusIcon className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="xs" onClick={addRow}>
        <PlusIcon className="size-3.5" />
        Add variable
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main form
// ---------------------------------------------------------------------------

export function ManagedProcessForm({
  environmentId,
  projectId,
  mode,
  initial,
  existingIds,
  onClose,
}: ManagedProcessFormProps) {
  const formId = React.useId();
  const isEditing = mode === "edit";

  // ---- Field state ----
  const [name, setName] = useState(initial?.name ?? "");
  const [id, setId] = useState(initial?.id ?? "");
  const [command, setCommand] = useState(initial?.command ?? "");
  const [icon, setIcon] = useState<ProjectScriptIcon>(initial?.icon ?? "play");
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [scope, setScope] = useState<ManagedProcessScope>(initial?.scope ?? "worktree");
  const [cwd, setCwd] = useState(initial?.cwd ?? "");
  const [envEntries, setEnvEntries] = useState<Array<{ key: string; value: string }>>(() => {
    if (!initial?.env) return [];
    return Object.entries(initial.env).map(([key, value]) => ({ key, value }));
  });
  const [proxyKind, setProxyKind] = useState<ProxyKind>(initial?.proxy ? "portless" : "none");
  const [proxyAppName, setProxyAppName] = useState(initial?.proxy?.appName ?? "");
  const [readinessKind, setReadinessKind] = useState<ReadinessKind>(
    initial?.readiness.kind ?? "none",
  );
  const [readinessPattern, setReadinessPattern] = useState(
    initial?.readiness.kind === "log-pattern" ? initial.readiness.pattern : "",
  );
  const [autoRestartOn, setAutoRestartOn] = useState(initial?.autoRestart?.onCrash ?? false);
  const [maxAttempts, setMaxAttempts] = useState(initial?.autoRestart?.maxAttempts ?? 3);
  const [backoffMs, setBackoffMs] = useState(initial?.autoRestart?.backoffMs ?? 1000);

  // ---- Derived ----
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Auto-generate id from name in create mode
  useEffect(() => {
    if (isEditing) return;
    setId(nextManagedProcessId(name, existingIds));
  }, [name, existingIds, isEditing]);

  // Auto-set readiness to portless-http when proxy switched to portless
  const previousProxyKindRef = React.useRef(proxyKind);
  useEffect(() => {
    if (proxyKind === "portless" && previousProxyKindRef.current === "none") {
      if (readinessKind === "none") {
        setReadinessKind("portless-http");
      }
    }
    if (proxyKind === "none" && readinessKind === "portless-http") {
      setReadinessKind("none");
    }
    previousProxyKindRef.current = proxyKind;
  }, [proxyKind, readinessKind]);

  // Available readiness options depend on proxy
  const readinessOptions = useMemo(() => {
    const opts: Array<{ value: ReadinessKind; label: string }> = [{ value: "none", label: "None" }];
    if (proxyKind === "portless") {
      opts.push({ value: "portless-http", label: "Portless HTTP" });
    }
    opts.push({ value: "log-pattern", label: "Log pattern" });
    return opts;
  }, [proxyKind]);

  // ---- Validate regex ----
  const regexError = useMemo(() => {
    if (readinessKind !== "log-pattern" || readinessPattern.trim() === "") return null;
    try {
      new RegExp(readinessPattern);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Invalid regular expression";
    }
  }, [readinessKind, readinessPattern]);

  // ---- Build payload ----
  const buildDefinition = useCallback((): ManagedProcess | null => {
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    const trimmedId = id.trim();

    if (trimmedName.length === 0) {
      setValidationError("Name is required.");
      return null;
    }
    if (trimmedName.length > 100) {
      setValidationError("Name must be 100 characters or fewer.");
      return null;
    }
    if (trimmedId.length === 0) {
      setValidationError("ID is required.");
      return null;
    }
    if (trimmedCommand.length === 0) {
      setValidationError("Command is required.");
      return null;
    }
    if (trimmedCommand.length > 4096) {
      setValidationError("Command must be 4 KB or fewer.");
      return null;
    }

    // cwd validation: relative, no .. escape
    const trimmedCwd = cwd.trim();
    if (trimmedCwd.length > 0) {
      if (trimmedCwd.startsWith("/")) {
        setValidationError("Working directory must be a relative path.");
        return null;
      }
      const segments = trimmedCwd.split("/");
      if (segments.some((s) => s === "..")) {
        setValidationError('Working directory must not contain ".." segments.');
        return null;
      }
    }

    // Regex validation
    if (readinessKind === "log-pattern") {
      const pat = readinessPattern.trim();
      if (pat.length === 0) {
        setValidationError("Log pattern is required when readiness is set to log-pattern.");
        return null;
      }
      if (regexError) {
        setValidationError(`Invalid regex: ${regexError}`);
        return null;
      }
    }

    // Build env record
    const env: Record<string, string> = {};
    for (const entry of envEntries) {
      const k = entry.key.trim();
      if (k.length > 0) {
        env[k] = entry.value;
      }
    }

    // Build proxy
    let proxy: ManagedProcessProxy | null = null;
    if (proxyKind === "portless") {
      const trimmedAppName = proxyAppName.trim();
      proxy = {
        kind: "portless",
        ...(trimmedAppName.length > 0 ? { appName: trimmedAppName } : {}),
      } as ManagedProcessProxy;
    }

    // Build readiness
    let readiness: ManagedProcessReadiness;
    if (readinessKind === "portless-http") {
      readiness = { kind: "portless-http" };
    } else if (readinessKind === "log-pattern") {
      readiness = {
        kind: "log-pattern",
        pattern: readinessPattern.trim(),
      } as ManagedProcessReadiness;
    } else {
      readiness = { kind: "none" };
    }

    // Build autoRestart
    let autoRestart: ManagedProcessAutoRestart | null = null;
    if (autoRestartOn) {
      autoRestart = {
        onCrash: true,
        maxAttempts: Math.min(Math.max(0, maxAttempts), 20),
        backoffMs: Math.min(Math.max(0, backoffMs), 60_000),
      } as ManagedProcessAutoRestart;
    }

    setValidationError(null);
    return {
      id: trimmedId,
      name: trimmedName,
      command: trimmedCommand,
      icon,
      scope,
      cwd: trimmedCwd.length > 0 ? trimmedCwd : null,
      env,
      proxy,
      readiness,
      autoRestart,
    } as ManagedProcess;
  }, [
    name,
    id,
    command,
    icon,
    scope,
    cwd,
    envEntries,
    proxyKind,
    proxyAppName,
    readinessKind,
    readinessPattern,
    regexError,
    autoRestartOn,
    maxAttempts,
    backoffMs,
  ]);

  // ---- Submit ----
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const definition = buildDefinition();
    if (!definition) return;

    setSubmitting(true);
    try {
      const conn = readEnvironmentConnection(environmentId);
      await conn?.client.managedProcess.upsertDefinition({ projectId, definition });
      onClose();
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Failed to save.");
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Delete ----
  const handleDelete = async () => {
    if (!initial) return;
    setDeleteConfirmOpen(false);
    try {
      const conn = readEnvironmentConnection(environmentId);
      await conn?.client.managedProcess.deleteDefinition({ projectId, processDefId: initial.id });
      onClose();
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Failed to delete.");
    }
  };

  const canSubmit = !submitting && regexError === null;

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit Managed Process" : "Add Managed Process"}</DialogTitle>
            <DialogDescription>
              Long-running services (dev servers, watchers, sidecars).
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <form
              id={formId}
              className="space-y-4 max-h-[60vh] overflow-y-auto pr-1"
              onSubmit={handleSubmit}
            >
              {/* Name + icon */}
              <div className="space-y-1.5">
                <Label htmlFor="mp-name">Name</Label>
                <div className="flex items-center gap-2">
                  <Popover onOpenChange={setIconPickerOpen} open={iconPickerOpen}>
                    <PopoverTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          className="size-9 shrink-0"
                          aria-label="Choose icon"
                        />
                      }
                    >
                      <ScriptIcon icon={icon} className="size-4.5" />
                    </PopoverTrigger>
                    <PopoverPopup align="start">
                      <div className="grid grid-cols-3 gap-2">
                        {SCRIPT_ICONS.map((entry) => {
                          const isSelected = entry.id === icon;
                          return (
                            <button
                              key={entry.id}
                              type="button"
                              className={`relative flex flex-col items-center gap-2 rounded-md border px-2 py-2 text-xs ${
                                isSelected
                                  ? "border-primary/70 bg-primary/10"
                                  : "border-border/70 hover:bg-accent/60"
                              }`}
                              onClick={() => {
                                setIcon(entry.id);
                                setIconPickerOpen(false);
                              }}
                            >
                              <ScriptIcon icon={entry.id} className="size-4" />
                              <span>{entry.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </PopoverPopup>
                  </Popover>
                  <Input
                    id="mp-name"
                    autoFocus
                    placeholder="Dev server"
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              </div>

              {/* ID */}
              <div className="space-y-1.5">
                <Label htmlFor="mp-id">ID</Label>
                <Input
                  id="mp-id"
                  placeholder="dev-server"
                  value={id}
                  readOnly={isEditing}
                  className={isEditing ? "opacity-60" : ""}
                  onChange={(e) => {
                    if (!isEditing) setId(e.target.value);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Slug identifier.{" "}
                  {isEditing ? "Cannot change after creation." : "Auto-generated from name."}
                </p>
              </div>

              {/* Command */}
              <div className="space-y-1.5">
                <Label htmlFor="mp-command">Command</Label>
                <Textarea
                  id="mp-command"
                  placeholder="bun run dev"
                  className="font-mono text-xs"
                  maxLength={4096}
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                />
              </div>

              {/* Scope */}
              <div className="space-y-1.5">
                <Label>Scope</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={scope === "worktree" ? "default" : "outline"}
                    size="xs"
                    onClick={() => setScope("worktree" as ManagedProcessScope)}
                  >
                    Worktree
                  </Button>
                  <Button
                    type="button"
                    variant={scope === "project" ? "default" : "outline"}
                    size="xs"
                    onClick={() => setScope("project" as ManagedProcessScope)}
                  >
                    Project
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {scope === "worktree"
                    ? "One instance per worktree (default). Each worktree gets its own running copy."
                    : "One instance for the whole project. Shared across all worktrees."}
                </p>
              </div>

              {/* Working directory */}
              <div className="space-y-1.5">
                <Label htmlFor="mp-cwd">Working directory</Label>
                <Input
                  id="mp-cwd"
                  placeholder="(scope root)"
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Relative path from scope root. Leave empty to use scope root.
                </p>
              </div>

              {/* Environment variables */}
              <div className="space-y-1.5">
                <Label>Environment variables</Label>
                <EnvEditor entries={envEntries} onChange={setEnvEntries} />
              </div>

              {/* Proxy */}
              <div className="space-y-1.5">
                <Label>Proxy</Label>
                <Select value={proxyKind} onValueChange={(val) => setProxyKind(val as ProxyKind)}>
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="portless">Portless</SelectItem>
                  </SelectPopup>
                </Select>
                {proxyKind === "portless" && (
                  <div className="space-y-1.5 pt-1">
                    <Label htmlFor="mp-proxy-app">App name</Label>
                    <Input
                      id="mp-proxy-app"
                      placeholder={id || "(process id)"}
                      value={proxyAppName}
                      onChange={(e) => setProxyAppName(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Optional. Defaults to the process ID.
                    </p>
                  </div>
                )}
              </div>

              {/* Readiness */}
              <div className="space-y-1.5">
                <Label>Readiness check</Label>
                <Select
                  value={readinessKind}
                  onValueChange={(val) => setReadinessKind(val as ReadinessKind)}
                >
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {readinessOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                {readinessKind === "log-pattern" && (
                  <div className="space-y-1.5 pt-1">
                    <Label htmlFor="mp-readiness-pattern">Pattern (regex)</Label>
                    <Input
                      id="mp-readiness-pattern"
                      placeholder="listening on port \\d+"
                      className="font-mono text-xs"
                      value={readinessPattern}
                      onChange={(e) => setReadinessPattern(e.target.value)}
                    />
                    {regexError && <p className="text-xs text-destructive">{regexError}</p>}
                  </div>
                )}
              </div>

              {/* Auto-restart */}
              <div className="space-y-2">
                <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm">
                  <span>Auto-restart on crash</span>
                  <Switch
                    checked={autoRestartOn}
                    onCheckedChange={(checked) => setAutoRestartOn(Boolean(checked))}
                  />
                </label>
                {autoRestartOn && (
                  <div className="grid grid-cols-2 gap-3 pl-1">
                    <div className="space-y-1">
                      <Label htmlFor="mp-max-attempts">Max attempts</Label>
                      <Input
                        id="mp-max-attempts"
                        type="number"
                        min={0}
                        max={20}
                        value={maxAttempts}
                        onChange={(e) => setMaxAttempts(Number(e.target.value))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="mp-backoff">Backoff (ms)</Label>
                      <Input
                        id="mp-backoff"
                        type="number"
                        min={0}
                        max={60000}
                        value={backoffMs}
                        onChange={(e) => setBackoffMs(Number(e.target.value))}
                      />
                      <p className="text-xs text-muted-foreground">Exponential, capped at 30s.</p>
                    </div>
                  </div>
                )}
              </div>

              {validationError && <p className="text-sm text-destructive">{validationError}</p>}
            </form>
          </DialogPanel>
          <DialogFooter>
            {isEditing && (
              <Button
                type="button"
                variant="destructive-outline"
                className="mr-auto"
                onClick={() => setDeleteConfirmOpen(true)}
              >
                Delete
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button form={formId} type="submit" disabled={!canSubmit}>
              {submitting ? "Saving..." : isEditing ? "Save changes" : "Add process"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete process "{name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Any running instance will be stopped. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button variant="destructive" onClick={handleDelete}>
              Delete process
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
