import type {
  EnvironmentId,
  GlobalScript,
  KeybindingCommand,
  ProjectId,
  ProjectScript,
  ScopedThreadRef,
  ThreadId,
} from "@fenrir/contracts";
import { projectScriptRuntimeEnv } from "@fenrir/shared/projectScripts";
import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { readEnvironmentApi } from "../../environmentApi";
import { isElectron } from "../../env";
import { readLocalApi } from "../../localApi";
import { type Project, type Thread } from "../../types";
import { decodeProjectScriptKeybindingRule } from "~/lib/projectScriptKeybindings";
import { parsePlaceholders, substitutePlaceholders } from "~/lib/placeholders";
import { newCommandId, randomUUID } from "~/lib/utils";
import { buildTmuxActionCommand, useActionRunStore } from "~/modules/action-runs";
import {
  commandForGlobalScript,
  commandForProjectScript,
  nextProjectScriptId,
} from "~/projectScripts";
import type { NewGlobalScriptInput, NewProjectScriptInput } from "../ProjectScriptsControl";
import { toastManager } from "../ui/toast";

const ACTION_TMUX_COLS = 120;
const ACTION_TMUX_ROWS = 30;

interface PersistProjectScriptsInput {
  keybinding?: string | null;
  keybindingCommand: KeybindingCommand;
  nextScripts: ProjectScript[];
  projectId: ProjectId;
}

interface PlaceholderDialogState {
  defaults: Project["globalScriptDefaults"][number] | null;
  onOpenChange: (open: boolean) => void;
  onRun: (values: Record<string, string>, saveAsDefault: boolean) => Promise<void>;
  open: boolean;
  script: GlobalScript | null;
}

interface UseChatViewScriptsInput {
  activeProject: Project | null | undefined;
  activeThread: Thread | null | undefined;
  activeThreadId: ThreadId | null;
  activeThreadRef: ScopedThreadRef | null;
  environmentId: EnvironmentId;
  gitCwd: string | null;
  setLastInvokedScriptByProjectId: Dispatch<SetStateAction<Record<string, string>>>;
  setThreadError: (targetThreadId: ThreadId | null, error: string | null) => void;
}

interface UseChatViewScriptsResult {
  deleteGlobalScript: (scriptId: string) => Promise<void>;
  deleteProjectScript: (scriptId: string) => Promise<void>;
  placeholderDialog: PlaceholderDialogState;
  runGlobalScript: (script: GlobalScript, altKey: boolean) => Promise<void>;
  runProjectScript: (
    script: ProjectScript,
    options?: {
      actionRunId?: string;
      cwd?: string;
      env?: Record<string, string>;
      rememberAsLastInvoked?: boolean;
      source?: "project" | "global";
      worktreePath?: string | null;
    },
  ) => Promise<void>;
  saveGlobalScript: (input: NewGlobalScriptInput) => Promise<void>;
  saveProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  updateGlobalScript: (scriptId: string, input: NewGlobalScriptInput) => Promise<void>;
  updateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
}

export function useChatViewScripts(input: UseChatViewScriptsInput): UseChatViewScriptsResult {
  const {
    activeProject,
    activeThread,
    activeThreadId,
    activeThreadRef,
    environmentId,
    gitCwd,
    setLastInvokedScriptByProjectId,
    setThreadError,
  } = input;
  const [placeholderDialogOpen, setPlaceholderDialogOpen] = useState(false);
  const [pendingGlobalScript, setPendingGlobalScript] = useState<{
    script: GlobalScript;
    runId: string;
  } | null>(null);
  const submittingPlaceholderRunIdRef = useRef<string | null>(null);

  const runProjectScript = useCallback(
    async (
      script: ProjectScript,
      options?: {
        actionRunId?: string;
        cwd?: string;
        env?: Record<string, string>;
        rememberAsLastInvoked?: boolean;
        source?: "project" | "global";
        worktreePath?: string | null;
      },
    ) => {
      const api = readEnvironmentApi(environmentId);
      if (!api || !activeThreadId || !activeProject || !activeThread || !activeThreadRef) {
        return;
      }

      if (options?.rememberAsLastInvoked !== false) {
        setLastInvokedScriptByProjectId((current) => {
          if (current[activeProject.id] === script.id) {
            return current;
          }
          return { ...current, [activeProject.id]: script.id };
        });
      }

      const targetCwd = options?.cwd ?? gitCwd ?? activeProject.cwd;
      const targetWorktreePath = options?.worktreePath ?? activeThread.worktreePath ?? null;
      const runtimeEnv = projectScriptRuntimeEnv({
        project: {
          cwd: activeProject.cwd,
        },
        worktreePath: targetWorktreePath,
        ...(options?.env ? { extraEnv: options.env } : {}),
      });
      const runId = options?.actionRunId ?? randomUUID();
      const actionRun = useActionRunStore.getState().createActionRun({
        id: runId,
        threadRef: activeThreadRef,
        projectId: activeProject.id,
        source: options?.source ?? "project",
        scriptId: script.id,
        scriptName: script.name,
        command: script.command,
        cwd: targetCwd,
      });
      const command = buildTmuxActionCommand({
        runId: actionRun.id,
        name: script.name,
        command: script.command,
        env: runtimeEnv,
      });

      try {
        await api.terminal.attachTmux({
          projectId: actionRun.tmuxProjectId,
          cwd: targetCwd,
          cols: ACTION_TMUX_COLS,
          rows: ACTION_TMUX_ROWS,
        });
        useActionRunStore.getState().markRunning(actionRun.id);
        await api.terminal.writeTmux({
          projectId: actionRun.tmuxProjectId,
          data: `${command}\r`,
        });
        toastManager.add({
          type: "loading",
          title: `Running "${script.name}"`,
          description: "The action is running in its own tmux session.",
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : `Failed to run script "${script.name}".`;
        useActionRunStore.getState().failActionRun(actionRun.id, message);
        toastManager.add({
          type: "error",
          title: `Could not run "${script.name}"`,
          description: message,
        });
        setThreadError(activeThreadId, message);
      }
    },
    [
      activeProject,
      activeThread,
      activeThreadId,
      activeThreadRef,
      environmentId,
      gitCwd,
      setLastInvokedScriptByProjectId,
      setThreadError,
    ],
  );

  const persistProjectScripts = useCallback(
    async (persistInput: PersistProjectScriptsInput) => {
      const api = readEnvironmentApi(environmentId);
      if (!api) {
        return;
      }

      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId: persistInput.projectId,
        scripts: persistInput.nextScripts,
      });

      const keybindingRule = decodeProjectScriptKeybindingRule({
        keybinding: persistInput.keybinding,
        command: persistInput.keybindingCommand,
      });
      if (!isElectron || !keybindingRule) {
        return;
      }

      const localApi = readLocalApi();
      if (!localApi) {
        throw new Error("Local API unavailable.");
      }
      await localApi.server.upsertKeybinding(keybindingRule);
    },
    [environmentId],
  );

  const saveProjectScript = useCallback(
    async (scriptInput: NewProjectScriptInput) => {
      if (!activeProject) {
        return;
      }

      const nextId = nextProjectScriptId(
        scriptInput.name,
        activeProject.scripts.map((script) => script.id),
      );
      const nextScript: ProjectScript = {
        id: nextId,
        name: scriptInput.name,
        command: scriptInput.command,
        icon: scriptInput.icon,
        runOnWorktreeCreate: scriptInput.runOnWorktreeCreate,
      };
      const nextScripts = scriptInput.runOnWorktreeCreate
        ? [
            ...activeProject.scripts.map((script) =>
              script.runOnWorktreeCreate ? { ...script, runOnWorktreeCreate: false } : script,
            ),
            nextScript,
          ]
        : [...activeProject.scripts, nextScript];

      await persistProjectScripts({
        projectId: activeProject.id,
        nextScripts,
        keybinding: scriptInput.keybinding,
        keybindingCommand: commandForProjectScript(nextId),
      });
    },
    [activeProject, persistProjectScripts],
  );

  const updateProjectScript = useCallback(
    async (scriptId: string, scriptInput: NewProjectScriptInput) => {
      if (!activeProject) {
        return;
      }

      const existingScript = activeProject.scripts.find((script) => script.id === scriptId);
      if (!existingScript) {
        throw new Error("Script not found.");
      }

      const updatedScript: ProjectScript = {
        ...existingScript,
        name: scriptInput.name,
        command: scriptInput.command,
        icon: scriptInput.icon,
        runOnWorktreeCreate: scriptInput.runOnWorktreeCreate,
      };
      const nextScripts = activeProject.scripts.map((script) =>
        script.id === scriptId
          ? updatedScript
          : scriptInput.runOnWorktreeCreate
            ? { ...script, runOnWorktreeCreate: false }
            : script,
      );

      await persistProjectScripts({
        projectId: activeProject.id,
        nextScripts,
        keybinding: scriptInput.keybinding,
        keybindingCommand: commandForProjectScript(scriptId),
      });
    },
    [activeProject, persistProjectScripts],
  );

  const deleteProjectScript = useCallback(
    async (scriptId: string) => {
      if (!activeProject) {
        return;
      }

      const nextScripts = activeProject.scripts.filter((script) => script.id !== scriptId);
      const deletedName = activeProject.scripts.find((script) => script.id === scriptId)?.name;

      try {
        await persistProjectScripts({
          projectId: activeProject.id,
          nextScripts,
          keybinding: null,
          keybindingCommand: commandForProjectScript(scriptId),
        });
        toastManager.add({
          type: "success",
          title: `Deleted action "${deletedName ?? "Unknown"}"`,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not delete action",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        });
      }
    },
    [activeProject, persistProjectScripts],
  );

  const saveGlobalScript = useCallback(async (scriptInput: NewGlobalScriptInput) => {
    const localApi = readLocalApi();
    if (!localApi) {
      return;
    }

    const script = await localApi.server.createGlobalAction({
      name: scriptInput.name,
      command: scriptInput.command,
      icon: scriptInput.icon,
    });
    if (!scriptInput.keybinding) {
      return;
    }

    const rule = decodeProjectScriptKeybindingRule({
      keybinding: scriptInput.keybinding,
      command: commandForGlobalScript(script.id),
    });
    if (!rule) {
      return;
    }
    await localApi.server.upsertKeybinding(rule);
  }, []);

  const updateGlobalScript = useCallback(
    async (scriptId: string, scriptInput: NewGlobalScriptInput) => {
      const localApi = readLocalApi();
      if (!localApi) {
        return;
      }

      await localApi.server.updateGlobalAction(scriptId, {
        name: scriptInput.name,
        command: scriptInput.command,
        icon: scriptInput.icon,
      });
      if (!scriptInput.keybinding) {
        return;
      }

      const rule = decodeProjectScriptKeybindingRule({
        keybinding: scriptInput.keybinding,
        command: commandForGlobalScript(scriptId),
      });
      if (!rule) {
        return;
      }
      await localApi.server.upsertKeybinding(rule);
    },
    [],
  );

  const deleteGlobalScript = useCallback(async (scriptId: string) => {
    const localApi = readLocalApi();
    if (!localApi) {
      return;
    }
    await localApi.server.deleteGlobalAction(scriptId);
  }, []);

  const runGlobalScript = useCallback(
    async (script: GlobalScript, altKey: boolean) => {
      if (!activeThreadId || !activeThread) {
        toastManager.add({
          type: "error",
          title: "Open a thread first",
          description: "Global actions run in a terminal and need an active thread.",
        });
        return;
      }

      const placeholders = parsePlaceholders(script.command);
      if (placeholders.length === 0) {
        await runProjectScript(
          {
            id: script.id,
            name: script.name,
            command: script.command,
            icon: script.icon,
            runOnWorktreeCreate: false,
          },
          { source: "global" },
        );
        return;
      }

      const projectDefaults = activeProject?.globalScriptDefaults?.find(
        (entry) => entry.scriptId === script.id,
      );
      const allDefaultsFilled = projectDefaults
        ? placeholders.every((name) => (projectDefaults.defaults[name] ?? "").length > 0)
        : false;

      if (allDefaultsFilled && !altKey) {
        await runProjectScript(
          {
            id: script.id,
            name: script.name,
            command: substitutePlaceholders(script.command, projectDefaults!.defaults),
            icon: script.icon,
            runOnWorktreeCreate: false,
          },
          { source: "global" },
        );
        return;
      }

      if (!activeProject || !activeThreadRef) {
        toastManager.add({
          type: "error",
          title: "Open a project thread first",
          description: "Global actions with placeholders need a project context.",
        });
        return;
      }

      const runId = randomUUID();
      useActionRunStore.getState().createActionRun({
        id: runId,
        threadRef: activeThreadRef,
        projectId: activeProject.id,
        source: "global",
        scriptId: script.id,
        scriptName: script.name,
        command: script.command,
        cwd: gitCwd ?? activeProject.cwd,
        status: "needs-input",
        placeholderNames: placeholders,
      });
      setPendingGlobalScript({ script, runId });
      setPlaceholderDialogOpen(true);
    },
    [activeProject, activeThread, activeThreadId, activeThreadRef, gitCwd, runProjectScript],
  );

  const handlePlaceholderRun = useCallback(
    async (values: Record<string, string>, saveAsDefault: boolean) => {
      if (!pendingGlobalScript) {
        return;
      }

      submittingPlaceholderRunIdRef.current = pendingGlobalScript.runId;
      await runProjectScript(
        {
          id: pendingGlobalScript.script.id,
          name: pendingGlobalScript.script.name,
          command: substitutePlaceholders(pendingGlobalScript.script.command, values),
          icon: pendingGlobalScript.script.icon,
          runOnWorktreeCreate: false,
        },
        { actionRunId: pendingGlobalScript.runId, source: "global" },
      );

      if (saveAsDefault && activeProject) {
        const api = readEnvironmentApi(environmentId);
        if (api) {
          const currentDefaults = activeProject.globalScriptDefaults ?? [];
          const existingIndex = currentDefaults.findIndex(
            (entry) => entry.scriptId === pendingGlobalScript.script.id,
          );
          const newEntry = { scriptId: pendingGlobalScript.script.id, defaults: values };
          const nextDefaults =
            existingIndex >= 0
              ? currentDefaults.map((entry, index) => (index === existingIndex ? newEntry : entry))
              : [...currentDefaults, newEntry];

          await api.orchestration.dispatchCommand({
            type: "project.meta.update",
            commandId: newCommandId(),
            projectId: activeProject.id,
            globalScriptDefaults: nextDefaults,
          });
        }
      }

      setPendingGlobalScript(null);
      submittingPlaceholderRunIdRef.current = null;
    },
    [activeProject, environmentId, pendingGlobalScript, runProjectScript],
  );

  const handlePlaceholderDialogOpenChange = useCallback(
    (open: boolean) => {
      setPlaceholderDialogOpen(open);
      if (!open) {
        if (
          pendingGlobalScript &&
          submittingPlaceholderRunIdRef.current !== pendingGlobalScript.runId
        ) {
          useActionRunStore.getState().requestCancel(pendingGlobalScript.runId);
        }
        setPendingGlobalScript(null);
      }
    },
    [pendingGlobalScript],
  );

  const placeholderDialogDefaults = useMemo(() => {
    if (!pendingGlobalScript || !activeProject) {
      return null;
    }

    return (
      activeProject.globalScriptDefaults?.find(
        (entry) => entry.scriptId === pendingGlobalScript.script.id,
      ) ?? null
    );
  }, [activeProject, pendingGlobalScript]);

  return {
    deleteGlobalScript,
    deleteProjectScript,
    placeholderDialog: {
      defaults: placeholderDialogDefaults,
      onOpenChange: handlePlaceholderDialogOpenChange,
      onRun: handlePlaceholderRun,
      open: placeholderDialogOpen,
      script: pendingGlobalScript?.script ?? null,
    },
    runGlobalScript,
    runProjectScript,
    saveGlobalScript,
    saveProjectScript,
    updateGlobalScript,
    updateProjectScript,
  };
}
