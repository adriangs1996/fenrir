import type {
  EnvironmentId,
  ManagedProcess,
  ManagedProcessInstance,
  ManagedProcessInstanceStatus,
  ProjectId,
  ProjectScriptIcon,
} from "@fenrir/contracts";
import {
  BugIcon,
  CopyIcon,
  FlaskConicalIcon,
  HammerIcon,
  ListChecksIcon,
  LoaderCircleIcon,
  PlayIcon,
  RotateCwIcon,
  ScrollTextIcon,
  SquareIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { useCallback } from "react";

import { cn } from "~/lib/utils";
import { isSameHostAsServer, urlForDisplay } from "~/managedProcess";
import { withEnvironmentClient } from "~/environments/runtime";
import { toastManager } from "~/components/ui/toast";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipPopup } from "~/components/ui/tooltip";

// ---------- Types ----------

export interface ManagedProcessChipProps {
  definition: ManagedProcess;
  instance: ManagedProcessInstance | null;
  projectId: ProjectId;
  environmentId: EnvironmentId;
  currentWorktreePath: string | null;
  onOpenLogs: () => void;
}

type ChipStatus = ManagedProcessInstanceStatus | "idle";

// ---------- Status helpers ----------

function resolveChipStatus(instance: ManagedProcessInstance | null): ChipStatus {
  return instance?.status ?? "idle";
}

const DOT_CLASSES: Record<ChipStatus, string> = {
  idle: "bg-muted-foreground/40",
  starting: "bg-warning animate-pulse",
  running: "bg-success/60",
  stopping: "bg-warning animate-pulse",
  stopped: "bg-muted-foreground/40",
  crashed: "bg-destructive",
};

function dotClassName(status: ChipStatus, ready: boolean): string {
  if (status === "running" && ready) return "bg-success";
  return DOT_CLASSES[status];
}

function statusLabel(status: ChipStatus, ready: boolean): string {
  if (status === "running" && ready) return "running (ready)";
  if (status === "running") return "running (not ready)";
  return status;
}

// ---------- Icon ----------

function ProcessIcon({
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

// ---------- RPC helpers ----------

function handleRpcError(error: unknown): void {
  const err = error as { code?: string; message?: string } | undefined;
  const code = err?.code;
  const message = err?.message ?? "Unknown error";

  if (code === "portless-not-found") {
    toastManager.add({
      title: "Portless not found",
      description: "Install portless or remove proxy from this definition",
      type: "error",
    });
    return;
  }
  if (code === "spawn-failed") {
    toastManager.add({
      title: "Failed to start",
      description: message,
      type: "error",
    });
    return;
  }
  if (code === "invalid-state") {
    // Silent — UI shouldn't have offered the action
    return;
  }
  // Generic fallback
  toastManager.add({
    title: "Error",
    description: message,
    type: "error",
  });
}

async function startProcess(
  environmentId: EnvironmentId,
  projectId: ProjectId,
  processDefId: string,
  worktreePath: string | null,
): Promise<void> {
  try {
    await withEnvironmentClient(environmentId, (client) =>
      client.managedProcess.start({ projectId, processDefId, worktreePath }),
    );
  } catch (error) {
    handleRpcError(error);
  }
}

async function stopProcess(environmentId: EnvironmentId, instanceId: string): Promise<void> {
  try {
    await withEnvironmentClient(environmentId, (client) =>
      client.managedProcess.stop({ instanceId }),
    );
  } catch (error) {
    handleRpcError(error);
  }
}

async function restartProcess(environmentId: EnvironmentId, instanceId: string): Promise<void> {
  try {
    await withEnvironmentClient(environmentId, (client) =>
      client.managedProcess.restart({ instanceId }),
    );
  } catch (error) {
    handleRpcError(error);
  }
}

async function forceKillProcess(environmentId: EnvironmentId, instanceId: string): Promise<void> {
  try {
    await withEnvironmentClient(environmentId, (client) =>
      client.managedProcess.forceKill({ instanceId }),
    );
  } catch (error) {
    handleRpcError(error);
  }
}

// ---------- URL helpers ----------

function safeParseHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// ---------- URL display ----------

function ProcessUrl({
  instance,
  proxyKind,
}: {
  instance: ManagedProcessInstance;
  proxyKind: string | null;
}) {
  const url = urlForDisplay(instance);
  const { copyToClipboard, isCopied } = useCopyToClipboard();

  if (!url || proxyKind !== "portless") return null;

  // Extract server hostname from the process URL to check reachability.
  const serverHost = safeParseHostname(url);
  const sameHost = isSameHostAsServer(serverHost);

  if (sameHost) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="ml-1 max-w-24 truncate text-[10px] text-info underline-offset-2 hover:underline sm:text-[9px]"
        onClick={(e) => e.stopPropagation()}
      >
        {url}
      </a>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="ml-1 max-w-24 truncate text-[10px] text-muted-foreground sm:text-[9px]"
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard(url);
            }}
          />
        }
      >
        {url}
      </TooltipTrigger>
      <TooltipPopup>
        <p className="flex items-center gap-1">
          {isCopied ? "Copied!" : "URL only resolves on the Fenrir host"}
          {!isCopied && <CopyIcon className="size-3 opacity-60" />}
        </p>
      </TooltipPopup>
    </Tooltip>
  );
}

// ---------- Chip component ----------

export function ManagedProcessChip({
  definition,
  instance,
  projectId,
  environmentId,
  currentWorktreePath,
  onOpenLogs,
}: ManagedProcessChipProps) {
  const status = resolveChipStatus(instance);
  const ready = instance?.ready ?? false;
  const proxyKind = definition.proxy?.kind ?? null;
  const exitCode = instance?.exitCode ?? null;
  const instanceId = instance?.instanceId ?? null;

  const onStart = useCallback(() => {
    const wt = definition.scope === "project" ? null : currentWorktreePath;
    void startProcess(environmentId, projectId, definition.id, wt);
  }, [environmentId, projectId, definition.id, definition.scope, currentWorktreePath]);

  const onStop = useCallback(() => {
    if (instanceId) void stopProcess(environmentId, instanceId);
  }, [environmentId, instanceId]);

  const onRestart = useCallback(() => {
    if (instanceId) void restartProcess(environmentId, instanceId);
  }, [environmentId, instanceId]);

  const onForceKill = useCallback(() => {
    if (instanceId) void forceKillProcess(environmentId, instanceId);
  }, [environmentId, instanceId]);

  const chipAriaLabel = [
    definition.name,
    statusLabel(status, ready),
    instance ? (urlForDisplay(instance) ?? "no URL") : "no URL",
  ].join(" — ");

  const canStart = !instance || status === "idle" || status === "stopped" || status === "crashed";
  const isRunning = status === "running";
  const isStopping = status === "stopping";
  const isStarting = status === "starting";
  const isCrashed = status === "crashed";

  return (
    <div
      className="group/chip relative flex h-full shrink-0 items-center gap-1 rounded-md border border-border/60 bg-card px-2 text-xs transition-colors hover:border-border"
      role="button"
      tabIndex={0}
      aria-label={chipAriaLabel}
      onClick={(e) => {
        // Only open logs if the click target is the chip itself, not an action button
        if ((e.target as HTMLElement).closest("[data-slot='button']")) return;
        if (instance) onOpenLogs();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (instance) onOpenLogs();
        }
      }}
    >
      {/* Status dot */}
      <span
        role="img"
        aria-label={statusLabel(status, ready)}
        className={cn("size-2 shrink-0 rounded-full", dotClassName(status, ready))}
      >
        {isCrashed && (
          <span className="absolute -top-0.5 -right-0.5 text-[7px] font-bold leading-none text-destructive">
            !
          </span>
        )}
      </span>

      {/* Icon */}
      <ProcessIcon icon={definition.icon} className="size-3 shrink-0 opacity-60" />

      {/* Name */}
      <span className="max-w-20 truncate font-medium">{definition.name}</span>

      {/* URL */}
      {instance && <ProcessUrl instance={instance} proxyKind={proxyKind} />}

      {/* Exit code badge for crashed */}
      {isCrashed && exitCode !== null && (
        <span className="ml-0.5 rounded bg-destructive/10 px-1 text-[10px] font-medium text-destructive sm:text-[9px]">
          exit {exitCode}
        </span>
      )}

      {/* Action buttons */}
      <div className="ml-auto flex shrink-0 items-center gap-0.5 pl-1">
        {canStart && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={isCrashed ? "Restart" : "Start"}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isCrashed && instanceId) {
                      onRestart();
                    } else {
                      onStart();
                    }
                  }}
                />
              }
            >
              {isCrashed ? <RotateCwIcon className="size-3" /> : <PlayIcon className="size-3" />}
            </TooltipTrigger>
            <TooltipPopup>
              <p>{isCrashed ? "Restart" : "Start"}</p>
            </TooltipPopup>
          </Tooltip>
        )}

        {isRunning && (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Stop"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStop();
                    }}
                  />
                }
              >
                <SquareIcon className="size-3" />
              </TooltipTrigger>
              <TooltipPopup>
                <p>Stop</p>
              </TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Restart"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRestart();
                    }}
                  />
                }
              >
                <RotateCwIcon className="size-3" />
              </TooltipTrigger>
              <TooltipPopup>
                <p>Restart</p>
              </TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Logs"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenLogs();
                    }}
                  />
                }
              >
                <ScrollTextIcon className="size-3" />
              </TooltipTrigger>
              <TooltipPopup>
                <p>Logs</p>
              </TooltipPopup>
            </Tooltip>
          </>
        )}

        {isStopping && (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Force kill"
                    onClick={(e) => {
                      e.stopPropagation();
                      onForceKill();
                    }}
                  />
                }
              >
                <XIcon className="size-3" />
              </TooltipTrigger>
              <TooltipPopup>
                <p>Force kill</p>
              </TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Logs"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenLogs();
                    }}
                  />
                }
              >
                <ScrollTextIcon className="size-3" />
              </TooltipTrigger>
              <TooltipPopup>
                <p>Logs</p>
              </TooltipPopup>
            </Tooltip>
          </>
        )}

        {isStarting && (
          <>
            <LoaderCircleIcon className="size-3 animate-spin opacity-60" />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Cancel"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStop();
                    }}
                  />
                }
              >
                <XIcon className="size-3" />
              </TooltipTrigger>
              <TooltipPopup>
                <p>Cancel</p>
              </TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Logs"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenLogs();
                    }}
                  />
                }
              >
                <ScrollTextIcon className="size-3" />
              </TooltipTrigger>
              <TooltipPopup>
                <p>Logs</p>
              </TooltipPopup>
            </Tooltip>
          </>
        )}
      </div>

      {/* Crashed aria-live announcement */}
      {isCrashed && (
        <span className="sr-only" aria-live="polite">
          {definition.name} crashed{exitCode !== null ? ` with exit code ${exitCode}` : ""}
        </span>
      )}
    </div>
  );
}
