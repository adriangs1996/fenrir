import {
  type EnvironmentId,
  type EditorId,
  type GlobalScript,
  type GlobalScriptProjectDefaults,
  type ProjectId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@fenrir/contracts";
import { scopeThreadRef } from "@fenrir/client-runtime";
import { memo } from "react";
import GitActionsControl from "../GitActionsControl";
import { type DraftId } from "~/composerDraftStore";
import { DiffIcon, TerminalSquareIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type NewGlobalScriptInput,
} from "../ProjectScriptsControl";
import { Toggle } from "../ui/toggle";
import { SidebarTrigger } from "../ui/sidebar";
import { OpenInPicker } from "./OpenInPicker";
import { VpnToolbarButton } from "../VpnToolbarButton";
import { ManagedProcessProjectControl } from "../managedProcess/ManagedProcessProjectControl";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
  activeThreadTitle: string;
  activeProjectId: ProjectId | null;
  activeProjectEnvironmentId: EnvironmentId | null;
  activeProjectName: string | undefined;
  activeProjectManagedProcessCount: number;
  isGitRepo: boolean;
  openInCwd: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalToggleShortcutLabel: string | null;
  diffToggleShortcutLabel?: string | null;
  gitCwd: string | null;
  diffOpen: boolean;
  globalScripts: GlobalScript[];
  globalScriptDefaults: GlobalScriptProjectDefaults[];
  onRunProjectScript: (script: ProjectScript) => void;
  onRunGlobalScript: (script: GlobalScript, altKey: boolean) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onAddGlobalScript: (input: NewGlobalScriptInput) => Promise<void>;
  onUpdateGlobalScript: (scriptId: string, input: NewGlobalScriptInput) => Promise<void>;
  onDeleteGlobalScript: (scriptId: string) => Promise<void>;
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadEnvironmentId,
  activeThreadId,
  draftId,
  activeThreadTitle,
  activeProjectId,
  activeProjectEnvironmentId,
  activeProjectName,
  activeProjectManagedProcessCount,
  isGitRepo,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  terminalAvailable,
  terminalOpen,
  terminalToggleShortcutLabel,
  diffToggleShortcutLabel,
  gitCwd,
  diffOpen,
  globalScripts,
  globalScriptDefaults,
  onRunProjectScript,
  onRunGlobalScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onAddGlobalScript,
  onUpdateGlobalScript,
  onDeleteGlobalScript,
  onToggleTerminal,
  onToggleDiff,
}: ChatHeaderProps) {
  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <h2
          className="min-w-0 shrink truncate text-sm font-medium text-foreground"
          title={activeThreadTitle}
        >
          {activeThreadTitle}
        </h2>
        {activeProjectName && (
          <Badge variant="outline" className="min-w-0 shrink overflow-hidden">
            <span className="min-w-0 truncate">{activeProjectName}</span>
          </Badge>
        )}
        {activeProjectName && !isGitRepo && (
          <Badge variant="outline" className="shrink-0 text-[10px] text-amber-700">
            No Git
          </Badge>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3">
        <VpnToolbarButton />
        {activeProjectScripts && (
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            globalScripts={globalScripts}
            globalScriptDefaults={globalScriptDefaults}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onRunGlobalScript={onRunGlobalScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
            onAddGlobalScript={onAddGlobalScript}
            onUpdateGlobalScript={onUpdateGlobalScript}
            onDeleteGlobalScript={onDeleteGlobalScript}
          />
        )}
        {activeProjectId && activeProjectEnvironmentId && activeProjectName && (
          <ManagedProcessProjectControl
            projectId={activeProjectId}
            environmentId={activeProjectEnvironmentId}
            projectName={activeProjectName}
            definitionCount={activeProjectManagedProcessCount}
          />
        )}
        {activeProjectName && (
          <OpenInPicker
            keybindings={keybindings}
            availableEditors={availableEditors}
            openInCwd={openInCwd}
          />
        )}
        {activeProjectName && (
          <GitActionsControl
            gitCwd={gitCwd}
            activeThreadRef={scopeThreadRef(activeThreadEnvironmentId, activeThreadId)}
            {...(draftId ? { draftId } : {})}
          />
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={terminalOpen}
                onPressedChange={onToggleTerminal}
                aria-label="Toggle terminal tab"
                variant="outline"
                size="xs"
                disabled={!terminalAvailable}
              >
                <TerminalSquareIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!terminalAvailable
              ? "Terminal is unavailable until this thread has an active project."
              : terminalToggleShortcutLabel
                ? `Toggle terminal tab (${terminalToggleShortcutLabel})`
                : "Toggle terminal tab"}
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={diffOpen}
                onPressedChange={onToggleDiff}
                aria-label="Toggle right panel to Diff tab"
                variant="outline"
                size="xs"
                disabled={!isGitRepo && !diffOpen}
              >
                <DiffIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!isGitRepo && !diffOpen
              ? "Diff panel is unavailable because this project is not a git repository."
              : diffToggleShortcutLabel
                ? `Toggle right panel to Diff tab (${diffToggleShortcutLabel})`
                : "Toggle right panel to Diff tab"}
          </TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
});
