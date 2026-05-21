import type {
  EnvironmentId,
  GlobalScript,
  KeybindingCommand,
  ProjectId,
  ProjectScript,
  ScopedThreadRef,
  TerminalOpenInput,
  ThreadId,
} from "@fenrir/contracts";
import { projectScriptRuntimeEnv } from "@fenrir/shared/projectScripts";
import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { readEnvironmentApi } from "../../environmentApi";
import { isElectron } from "../../env";
import { readLocalApi } from "../../localApi";
import { DEFAULT_THREAD_TERMINAL_ID, type Project, type Thread } from "../../types";
import { decodeProjectScriptKeybindingRule } from "~/lib/projectScriptKeybindings";
import { parsePlaceholders, substitutePlaceholders } from "~/lib/placeholders";
import { newCommandId, randomUUID } from "~/lib/utils";
import {
  commandForGlobalScript,
  commandForProjectScript,
  nextProjectScriptId,
} from "~/projectScripts";
import type { NewGlobalScriptInput, NewProjectScriptInput } from "../ProjectScriptsControl";
import { toastManager } from "../ui/toast";

const SCRIPT_TERMINAL_COLS = 120;
const SCRIPT_TERMINAL_ROWS = 30;

interface TerminalLaunchContext {
  cwd: string;
  threadId: ThreadId;
  worktreePath: string | null;
}

interface TerminalStateSnapshot {
  activeTerminalId: string;
  runningTerminalIds: ReadonlyArray<string>;
  terminalIds: ReadonlyArray<string>;
}

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
  activateTerminalTab: (options?: { ensureOpen?: boolean; focus?: boolean }) => void;
  activeProject: Project | null | undefined;
  activeThread: Thread | null | undefined;
  activeThreadId: ThreadId | null;
  activeThreadRef: ScopedThreadRef | null;
  environmentId: EnvironmentId;
  gitCwd: string | null;
  setLastInvokedScriptByProjectId: Dispatch<SetStateAction<Record<string, string>>>;
  setTerminalLaunchContext: Dispatch<SetStateAction<TerminalLaunchContext | null>>;
  setThreadError: (targetThreadId: ThreadId | null, error: string | null) => void;
  storeNewTerminal: (threadRef: ScopedThreadRef, terminalId: string) => void;
  storeSetActiveTerminal: (threadRef: ScopedThreadRef, terminalId: string) => void;
  terminalState: TerminalStateSnapshot;
}

interface UseChatViewScriptsResult {
  deleteGlobalScript: (scriptId: string) => Promise<void>;
  deleteProjectScript: (scriptId: string) => Promise<void>;
  placeholderDialog: PlaceholderDialogState;
  runGlobalScript: (script: GlobalScript, altKey: boolean) => Promise<void>;
  runProjectScript: (
    script: ProjectScript,
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      preferNewTerminal?: boolean;
      rememberAsLastInvoked?: boolean;
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
    activateTerminalTab,
    activeProject,
    activeThread,
    activeThreadId,
    activeThreadRef,
    environmentId,
    gitCwd,
    setLastInvokedScriptByProjectId,
    setTerminalLaunchContext,
    setThreadError,
    storeNewTerminal,
    storeSetActiveTerminal,
    terminalState,
  } = input;
  const [placeholderDialogOpen, setPlaceholderDialogOpen] = useState(false);
  const [pendingGlobalScript, setPendingGlobalScript] = useState<GlobalScript | null>(null);

  const runProjectScript = useCallback(
    async (
      script: ProjectScript,
      options?: {
        cwd?: string;
        env?: Record<string, string>;
        preferNewTerminal?: boolean;
        rememberAsLastInvoked?: boolean;
        worktreePath?: string | null;
      },
    ) => {
      const api = readEnvironmentApi(environmentId);
      if (!api || !activeThreadId || !activeProject || !activeThread) {
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
      const baseTerminalId =
        terminalState.activeTerminalId ||
        terminalState.terminalIds[0] ||
        DEFAULT_THREAD_TERMINAL_ID;
      const isBaseTerminalBusy = terminalState.runningTerminalIds.includes(baseTerminalId);
      const shouldCreateNewTerminal = Boolean(options?.preferNewTerminal) || isBaseTerminalBusy;
      const targetTerminalId = shouldCreateNewTerminal
        ? `terminal-${randomUUID()}`
        : baseTerminalId;
      const targetWorktreePath = options?.worktreePath ?? activeThread.worktreePath ?? null;

      setTerminalLaunchContext({
        threadId: activeThreadId,
        cwd: targetCwd,
        worktreePath: targetWorktreePath,
      });
      activateTerminalTab({ ensureOpen: true, focus: true });

      if (!activeThreadRef) {
        return;
      }

      if (shouldCreateNewTerminal) {
        storeNewTerminal(activeThreadRef, targetTerminalId);
      } else {
        storeSetActiveTerminal(activeThreadRef, targetTerminalId);
      }

      const runtimeEnv = projectScriptRuntimeEnv({
        project: {
          cwd: activeProject.cwd,
        },
        worktreePath: targetWorktreePath,
        ...(options?.env ? { extraEnv: options.env } : {}),
      });
      const openTerminalInput: TerminalOpenInput = shouldCreateNewTerminal
        ? {
            threadId: activeThreadId,
            terminalId: targetTerminalId,
            cwd: targetCwd,
            ...(targetWorktreePath !== null ? { worktreePath: targetWorktreePath } : {}),
            env: runtimeEnv,
            cols: SCRIPT_TERMINAL_COLS,
            rows: SCRIPT_TERMINAL_ROWS,
          }
        : {
            threadId: activeThreadId,
            terminalId: targetTerminalId,
            cwd: targetCwd,
            ...(targetWorktreePath !== null ? { worktreePath: targetWorktreePath } : {}),
            env: runtimeEnv,
          };

      try {
        await api.terminal.open(openTerminalInput);
        await api.terminal.write({
          threadId: activeThreadId,
          terminalId: targetTerminalId,
          data: `${script.command}\r`,
        });
      } catch (error) {
        setThreadError(
          activeThreadId,
          error instanceof Error ? error.message : `Failed to run script "${script.name}".`,
        );
      }
    },
    [
      activateTerminalTab,
      activeProject,
      activeThread,
      activeThreadId,
      activeThreadRef,
      environmentId,
      gitCwd,
      setLastInvokedScriptByProjectId,
      setTerminalLaunchContext,
      setThreadError,
      storeNewTerminal,
      storeSetActiveTerminal,
      terminalState.activeTerminalId,
      terminalState.runningTerminalIds,
      terminalState.terminalIds,
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
        await runProjectScript({
          id: script.id,
          name: script.name,
          command: script.command,
          icon: script.icon,
          runOnWorktreeCreate: false,
        });
        return;
      }

      const projectDefaults = activeProject?.globalScriptDefaults?.find(
        (entry) => entry.scriptId === script.id,
      );
      const allDefaultsFilled = projectDefaults
        ? placeholders.every((name) => (projectDefaults.defaults[name] ?? "").length > 0)
        : false;

      if (allDefaultsFilled && !altKey) {
        await runProjectScript({
          id: script.id,
          name: script.name,
          command: substitutePlaceholders(script.command, projectDefaults!.defaults),
          icon: script.icon,
          runOnWorktreeCreate: false,
        });
        return;
      }

      setPendingGlobalScript(script);
      setPlaceholderDialogOpen(true);
    },
    [activeProject, activeThread, activeThreadId, runProjectScript],
  );

  const handlePlaceholderRun = useCallback(
    async (values: Record<string, string>, saveAsDefault: boolean) => {
      if (!pendingGlobalScript) {
        return;
      }

      await runProjectScript({
        id: pendingGlobalScript.id,
        name: pendingGlobalScript.name,
        command: substitutePlaceholders(pendingGlobalScript.command, values),
        icon: pendingGlobalScript.icon,
        runOnWorktreeCreate: false,
      });

      if (saveAsDefault && activeProject) {
        const api = readEnvironmentApi(environmentId);
        if (api) {
          const currentDefaults = activeProject.globalScriptDefaults ?? [];
          const existingIndex = currentDefaults.findIndex(
            (entry) => entry.scriptId === pendingGlobalScript.id,
          );
          const newEntry = { scriptId: pendingGlobalScript.id, defaults: values };
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
    },
    [activeProject, environmentId, pendingGlobalScript, runProjectScript],
  );

  const handlePlaceholderDialogOpenChange = useCallback((open: boolean) => {
    setPlaceholderDialogOpen(open);
    if (!open) {
      setPendingGlobalScript(null);
    }
  }, []);

  const placeholderDialogDefaults = useMemo(() => {
    if (!pendingGlobalScript || !activeProject) {
      return null;
    }

    return (
      activeProject.globalScriptDefaults?.find(
        (entry) => entry.scriptId === pendingGlobalScript.id,
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
      script: pendingGlobalScript,
    },
    runGlobalScript,
    runProjectScript,
    saveGlobalScript,
    saveProjectScript,
    updateGlobalScript,
    updateProjectScript,
  };
}
