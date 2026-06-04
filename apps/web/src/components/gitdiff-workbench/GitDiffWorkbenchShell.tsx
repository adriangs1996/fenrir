import type {
  ReviewDiffFileEntry,
  ReviewDiffFilePatch,
  ReviewDiffLane,
  ReviewApplyRawMutationInput,
  ReviewChunkId,
  ReviewFileId,
  ReviewProgressState,
  ReviewRawLaneKind,
  ReviewSessionId,
  ReviewSessionSnapshot,
  SourceControlStackEntry,
  SourceControlStackMutationResult,
  SourceControlStackSnapshot,
  SourceControlStackStreamEvent,
} from "@fenrir/contracts";

import { StackActionBar } from "./StackActionBar";
import { StackConflictBanner } from "./StackConflictBanner";
import { StackOperationDialog } from "./StackOperationDialog";
import { StackSidebar } from "./StackSidebar";
import { ReviewAnnotationPanel } from "./ReviewAnnotationPanel";
import { ReviewDiffViewer } from "./ReviewDiffViewer";
import { ReviewFileList } from "./ReviewFileList";
import { ReviewLaneList } from "./ReviewLaneList";
import type { DiffViewMode } from "./stackUiState";

interface GitDiffWorkbenchShellProps {
  readonly cwd: string;
  readonly sessionId: ReviewSessionId | null;
  readonly reviewSnapshot: ReviewSessionSnapshot | null;
  readonly stackSnapshot: SourceControlStackSnapshot | null;
  readonly lanes: ReadonlyArray<ReviewDiffLane>;
  readonly selectedLane: ReviewRawLaneKind | null;
  readonly selectedPath: string | null;
  readonly selectedEntryId: string | null;
  readonly selectedPatch: ReviewDiffFilePatch | null;
  readonly patchLoading: boolean;
  readonly viewMode: DiffViewMode;
  readonly wrap: boolean;
  readonly rawMutationPending: boolean;
  readonly stackMutationPending: boolean;
  readonly staleMessage: string | null;
  readonly stackResult: SourceControlStackMutationResult | null;
  readonly stackConflict: Extract<
    SourceControlStackStreamEvent,
    { _tag: "operationConflict" }
  > | null;
  readonly onSelectLane: (lane: ReviewRawLaneKind) => void;
  readonly onSelectFile: (file: ReviewDiffFileEntry) => void;
  readonly onSelectEntry: (entry: SourceControlStackEntry) => void;
  readonly onSwitchEntry: (entry: SourceControlStackEntry) => void;
  readonly onCreateEntry: () => void;
  readonly onRestack: () => void;
  readonly onSync: () => void;
  readonly onPublish: () => void;
  readonly onContinueConflict: () => void;
  readonly onAbortConflict: () => void;
  readonly onRefresh: () => void;
  readonly onRawMutation: (input: ReviewApplyRawMutationInput) => void;
  readonly onProgress: (input: {
    readonly fileId?: ReviewFileId;
    readonly chunkId?: ReviewChunkId;
    readonly progressState: ReviewProgressState;
  }) => void;
  readonly onViewModeChange: (viewMode: DiffViewMode) => void;
  readonly onWrapChange: (wrap: boolean) => void;
}

export function GitDiffWorkbenchShell(props: GitDiffWorkbenchShellProps) {
  const selectedLane = props.lanes.find((lane) => lane.kind === props.selectedLane) ?? null;

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      <StackSidebar
        snapshot={props.stackSnapshot}
        selectedEntryId={props.selectedEntryId}
        onSelectEntry={props.onSelectEntry}
        onSwitchEntry={props.onSwitchEntry}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">Git Diff Workbench</div>
            <div className="truncate text-xs text-muted-foreground">{props.cwd}</div>
          </div>
          <div className="text-xs text-muted-foreground">
            {props.sessionId ? "Raw · Combined" : "Loading review session"}
          </div>
        </div>
        <StackActionBar
          snapshot={props.stackSnapshot}
          disabled={props.stackMutationPending}
          onCreateEntry={props.onCreateEntry}
          onRestack={props.onRestack}
          onSync={props.onSync}
          onPublish={props.onPublish}
        />
        <StackConflictBanner
          conflict={props.stackConflict}
          disabled={props.stackMutationPending}
          onContinue={props.onContinueConflict}
          onAbort={props.onAbortConflict}
        />
        <StackOperationDialog result={props.stackResult} />
        {props.staleMessage ? (
          <div className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
            <span>{props.staleMessage}</span>
            <button
              className="text-xs underline underline-offset-4"
              type="button"
              onClick={props.onRefresh}
            >
              Refresh
            </button>
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1">
          <aside className="flex min-h-0 w-80 shrink-0 flex-col border-r border-border bg-background">
            <ReviewLaneList
              lanes={props.lanes}
              selectedLane={props.selectedLane}
              onSelectLane={props.onSelectLane}
            />
            <ReviewFileList
              lane={selectedLane}
              selectedPath={props.selectedPath}
              onSelectFile={props.onSelectFile}
            />
          </aside>
          <ReviewDiffViewer
            patch={props.selectedPatch}
            isLoading={props.patchLoading}
            viewMode={props.viewMode}
            wrap={props.wrap}
            mutationPending={props.rawMutationPending}
            onViewModeChange={props.onViewModeChange}
            onWrapChange={props.onWrapChange}
            onRawMutation={props.onRawMutation}
            onProgress={props.onProgress}
          />
          <ReviewAnnotationPanel
            snapshot={props.reviewSnapshot}
            selectedPath={props.selectedPath}
          />
        </div>
      </main>
    </div>
  );
}
