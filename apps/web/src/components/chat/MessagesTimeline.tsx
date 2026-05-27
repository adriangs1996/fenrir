import {
  type EnvironmentId,
  type MessageId,
  type ServerProviderSkill,
  type TurnId,
} from "@fenrir/contracts";
import {
  createContext,
  memo,
  useCallback,
  useEffect,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { deriveTimelineEntries, formatElapsed } from "../../session-logic";
import { type TurnDiffSummary } from "../../types";
import { summarizeTurnDiffStats } from "../../lib/turnDiffTree";
import ChatMarkdown from "../ChatMarkdown";
import {
  BotIcon,
  CheckIcon,
  CircleAlertIcon,
  EyeIcon,
  GlobeIcon,
  HammerIcon,
  type LucideIcon,
  SquarePenIcon,
  TerminalIcon,
  Undo2Icon,
  WrenchIcon,
  ZapIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { buildExpandedImagePreview, ExpandedImagePreview } from "./ExpandedImagePreview";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { ChangedFilesTree } from "./ChangedFilesTree";
import { DiffStatLabel, hasNonZeroStat } from "./DiffStatLabel";
import { MessageCopyButton } from "./MessageCopyButton";
import {
  MAX_VISIBLE_WORK_LOG_ENTRIES,
  computeStableMessagesTimelineRows,
  deriveMessagesTimelineRows,
  normalizeCompactToolLabel,
  resolveAssistantMessageCopyState,
  type MessagesTimelineRow,
  type StableMessagesTimelineRowsState,
} from "./MessagesTimeline.logic";
import { TerminalContextInlineChip } from "~/modules/terminal";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  deriveDisplayedUserMessageState,
  type ParsedTerminalContextEntry,
} from "~/modules/terminal";
import {
  extractTrailingEditorContexts,
  formatEditorContextLabel,
  type ParsedEditorContextEntry,
  EditorContextInlineChip,
} from "~/modules/neovim-editor";
import { cn } from "~/lib/utils";
import { useUiStateStore } from "~/uiStateStore";
import { type TimestampFormat } from "@fenrir/contracts/settings";
import { formatTimestamp } from "../../timestampFormat";

import {
  buildInlineTerminalContextText,
  formatInlineTerminalContextHeaderLabel as formatInlineTerminalContextLabel,
  textContainsInlineTerminalContextLabels,
} from "~/modules/terminal";
import { formatWorkspaceRelativePath } from "../../filePathDisplay";
import { SkillInlineText } from "./SkillInlineText";

interface TimelineRowSharedState {
  timestampFormat: TimestampFormat;
  routeThreadKey: string;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  workspaceRoot: string | undefined;
  skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
  activeThreadEnvironmentId: EnvironmentId;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onRevertUserMessage: (messageId: MessageId) => void;
  onImageExpand: (preview: ExpandedImagePreview) => void;
}

interface TimelineRowActivityState {
  isWorking: boolean;
  isRevertingCheckpoint: boolean;
}

const TimelineRowCtx = createContext<TimelineRowSharedState | null>(null);
const TimelineRowActivityCtx = createContext<TimelineRowActivityState | null>(null);
const TIMELINE_LIST_HEADER = <div className="h-3 sm:h-4" />;
const TIMELINE_LIST_FOOTER = <div className="h-3 sm:h-4" />;

interface MessagesTimelineProps {
  isWorking: boolean;
  activeTurnInProgress: boolean;
  activeTurnId?: TurnId | null;
  activeTurnStartedAt: string | null;
  listRef: React.RefObject<LegendListRef | null>;
  timelineEntries: ReturnType<typeof deriveTimelineEntries>;
  completionDividerBeforeEntryId: string | null;
  completionSummary: string | null;
  turnDiffSummaryByAssistantMessageId: Map<MessageId, TurnDiffSummary>;
  routeThreadKey: string;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  revertTurnCountByUserMessageId: Map<MessageId, number>;
  onRevertUserMessage: (messageId: MessageId) => void;
  isRevertingCheckpoint: boolean;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  activeThreadEnvironmentId: EnvironmentId;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  timestampFormat: TimestampFormat;
  workspaceRoot: string | undefined;
  skills?: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
  onIsAtEndChange: (isAtEnd: boolean) => void;
}

const EMPTY_TIMELINE_SKILLS: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">> = [];

export const MessagesTimeline = memo(function MessagesTimeline({
  isWorking,
  activeTurnInProgress,
  activeTurnId,
  activeTurnStartedAt,
  listRef,
  timelineEntries,
  completionDividerBeforeEntryId,
  completionSummary,
  turnDiffSummaryByAssistantMessageId,
  routeThreadKey,
  onOpenTurnDiff,
  revertTurnCountByUserMessageId,
  onRevertUserMessage,
  isRevertingCheckpoint,
  onImageExpand,
  activeThreadEnvironmentId,
  markdownCwd,
  resolvedTheme,
  timestampFormat,
  workspaceRoot,
  skills = EMPTY_TIMELINE_SKILLS,
  onIsAtEndChange,
}: MessagesTimelineProps) {
  const rawRows = useMemo(
    () =>
      deriveMessagesTimelineRows({
        timelineEntries,
        completionDividerBeforeEntryId,
        completionSummary,
        isWorking,
        activeTurnInProgress,
        activeTurnId: activeTurnId ?? null,
        activeTurnStartedAt,
        turnDiffSummaryByAssistantMessageId,
        revertTurnCountByUserMessageId,
      }),
    [
      timelineEntries,
      completionDividerBeforeEntryId,
      completionSummary,
      isWorking,
      activeTurnInProgress,
      activeTurnId,
      activeTurnStartedAt,
      turnDiffSummaryByAssistantMessageId,
      revertTurnCountByUserMessageId,
    ],
  );
  const rows = useStableRows(rawRows);

  const handleScroll = useCallback(() => {
    const state = listRef.current?.getState?.();
    if (state) {
      onIsAtEndChange(state.isAtEnd);
    }
  }, [listRef, onIsAtEndChange]);

  const previousRowCountRef = useRef(rows.length);
  useEffect(() => {
    const previousRowCount = previousRowCountRef.current;
    previousRowCountRef.current = rows.length;

    if (previousRowCount > 0 || rows.length === 0) {
      return;
    }

    onIsAtEndChange(true);
    const frameId = window.requestAnimationFrame(() => {
      void listRef.current?.scrollToEnd?.({ animated: false });
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [listRef, onIsAtEndChange, rows.length]);

  const sharedState = useMemo<TimelineRowSharedState>(
    () => ({
      timestampFormat,
      routeThreadKey,
      markdownCwd,
      resolvedTheme,
      workspaceRoot,
      skills,
      activeThreadEnvironmentId,
      onOpenTurnDiff,
      onRevertUserMessage,
      onImageExpand,
    }),
    [
      timestampFormat,
      routeThreadKey,
      markdownCwd,
      resolvedTheme,
      workspaceRoot,
      skills,
      activeThreadEnvironmentId,
      onOpenTurnDiff,
      onRevertUserMessage,
      onImageExpand,
    ],
  );
  const activityState = useMemo<TimelineRowActivityState>(
    () => ({
      isWorking,
      isRevertingCheckpoint,
    }),
    [isRevertingCheckpoint, isWorking],
  );

  const renderItem = useCallback(
    ({ item }: { item: MessagesTimelineRow }) => (
      <div className="mx-auto w-full min-w-0 max-w-3xl overflow-x-clip" data-timeline-root="true">
        <TimelineRowContent row={item} />
      </div>
    ),
    [],
  );

  if (rows.length === 0 && !isWorking) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground/30">
          Send a message to start the conversation.
        </p>
      </div>
    );
  }

  return (
    <TimelineRowCtx.Provider value={sharedState}>
      <TimelineRowActivityCtx.Provider value={activityState}>
        <LegendList<MessagesTimelineRow>
          ref={listRef}
          data={rows}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          estimatedItemSize={90}
          initialScrollAtEnd
          maintainScrollAtEnd
          maintainScrollAtEndThreshold={0.1}
          maintainVisibleContentPosition
          onScroll={handleScroll}
          className="h-full overflow-x-hidden overscroll-y-contain px-3 sm:px-5"
          ListHeaderComponent={TIMELINE_LIST_HEADER}
          ListFooterComponent={TIMELINE_LIST_FOOTER}
        />
      </TimelineRowActivityCtx.Provider>
    </TimelineRowCtx.Provider>
  );
});

function keyExtractor(item: MessagesTimelineRow) {
  return item.id;
}

type TimelineEntry = ReturnType<typeof deriveTimelineEntries>[number];
type TimelineMessage = Extract<TimelineEntry, { kind: "message" }>["message"];
type TimelineWorkEntry = Extract<MessagesTimelineRow, { kind: "work" }>["groupedEntries"][number];
type TimelineRow = MessagesTimelineRow;

function useTimelineRowCtx() {
  const context = useContext(TimelineRowCtx);
  if (!context) {
    throw new Error("TimelineRowCtx missing");
  }
  return context;
}

function useTimelineRowActivityCtx() {
  const context = useContext(TimelineRowActivityCtx);
  if (!context) {
    throw new Error("TimelineRowActivityCtx missing");
  }
  return context;
}

function useStableRows(rows: MessagesTimelineRow[]): MessagesTimelineRow[] {
  const previousStateRef = useRef<StableMessagesTimelineRowsState>({
    byId: new Map<string, MessagesTimelineRow>(),
    result: [],
  });

  return useMemo(() => {
    const nextState = computeStableMessagesTimelineRows(rows, previousStateRef.current);
    previousStateRef.current = nextState;
    return nextState.result as MessagesTimelineRow[];
  }, [rows]);
}

const TimelineRowContent = memo(function TimelineRowContent({ row }: { row: TimelineRow }) {
  return (
    <div
      className={cn(
        "pb-4",
        row.kind === "message" && row.message.role === "assistant" ? "group/assistant" : null,
      )}
      data-timeline-row-id={row.id}
      data-timeline-row-kind={row.kind}
      data-message-id={row.kind === "message" ? row.message.id : undefined}
      data-message-role={row.kind === "message" ? row.message.role : undefined}
    >
      {row.kind === "work" ? <WorkGroupSection row={row} /> : null}
      {row.kind === "message" && row.message.role === "user" ? <UserTimelineRow row={row} /> : null}
      {row.kind === "message" && row.message.role === "assistant" ? (
        <AssistantTimelineRow row={row} />
      ) : null}
      {row.kind === "proposed-plan" ? <ProposedPlanTimelineRow row={row} /> : null}
      {row.kind === "working" ? <WorkingTimelineRow row={row} /> : null}
    </div>
  );
});

function WorkGroupSection({ row }: { row: Extract<TimelineRow, { kind: "work" }> }) {
  const { timestampFormat, workspaceRoot } = useTimelineRowCtx();
  const groupedEntries = row.groupedEntries;
  const [isExpanded, setExpanded] = useState(false);
  const hasOverflow = groupedEntries.length > MAX_VISIBLE_WORK_LOG_ENTRIES;
  const visibleEntries =
    hasOverflow && !isExpanded
      ? groupedEntries.slice(-MAX_VISIBLE_WORK_LOG_ENTRIES)
      : groupedEntries;
  const hiddenCount = groupedEntries.length - visibleEntries.length;
  const onlyToolEntries = groupedEntries.every((entry) => entry.tone === "tool");
  const showHeader = hasOverflow || !onlyToolEntries;
  const groupLabel = onlyToolEntries ? "Tool calls" : "Work log";

  return (
    <div className="rounded-lg border border-border/55 bg-card/35 px-2.5 py-2">
      {showHeader && (
        <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/65">
            {groupLabel} ({groupedEntries.length})
          </p>
          {hasOverflow && (
            <button
              type="button"
              className="rounded-sm px-1 text-[9px] uppercase tracking-[0.12em] text-muted-foreground/65 transition-colors duration-150 hover:bg-muted/45 hover:text-foreground/80"
              onClick={() => setExpanded((current) => !current)}
            >
              {isExpanded ? "Show less" : `Show ${hiddenCount} more`}
            </button>
          )}
        </div>
      )}
      <div className="space-y-0.5">
        {visibleEntries.map((workEntry) => (
          <SimpleWorkEntryRow
            key={`work-row:${workEntry.id}`}
            workEntry={workEntry}
            timestampFormat={timestampFormat}
            workspaceRoot={workspaceRoot}
          />
        ))}
      </div>
    </div>
  );
}

function UserTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "message" }> }) {
  const ctx = useTimelineRowCtx();
  const userImages = row.message.attachments ?? [];
  const editorExtracted = extractTrailingEditorContexts(row.message.text);
  const displayedUserMessage = deriveDisplayedUserMessageState(editorExtracted.promptText);
  const terminalContexts = displayedUserMessage.contexts;
  const editorContexts = editorExtracted.contexts;
  const canRevertAgentWork = typeof row.revertTurnCount === "number";

  return (
    <div className="flex justify-end">
      <div className="group relative max-w-[80%] rounded-2xl rounded-br-sm border border-border bg-secondary px-4 py-3">
        {userImages.length > 0 && (
          <div className="mb-2 grid max-w-[420px] grid-cols-2 gap-2">
            {userImages.map((image: NonNullable<TimelineMessage["attachments"]>[number]) => (
              <div
                key={image.id}
                className="overflow-hidden rounded-lg border border-border/80 bg-background/70"
              >
                {image.previewUrl ? (
                  <button
                    type="button"
                    className="h-full w-full cursor-zoom-in"
                    aria-label={`Preview ${image.name}`}
                    onClick={() => {
                      const preview = buildExpandedImagePreview(userImages, image.id);
                      if (!preview) return;
                      ctx.onImageExpand(preview);
                    }}
                  >
                    <img
                      src={image.previewUrl}
                      alt={image.name}
                      className="block h-auto max-h-[220px] w-full object-cover"
                    />
                  </button>
                ) : (
                  <div className="flex min-h-[72px] items-center justify-center px-2 py-3 text-center text-[11px] text-muted-foreground/70">
                    {image.name}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <CollapsibleUserMessageBody
          text={displayedUserMessage.visibleText}
          terminalContexts={terminalContexts}
          editorContexts={editorContexts}
          skills={ctx.skills}
          footer={
            <>
              <div className="flex items-center gap-1.5 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100">
                {displayedUserMessage.copyText ? (
                  <MessageCopyButton text={displayedUserMessage.copyText} />
                ) : null}
                {canRevertAgentWork ? <RevertUserMessageButton messageId={row.message.id} /> : null}
              </div>
              <p className="text-right text-xs text-muted-foreground/50">
                {formatTimestamp(row.message.createdAt, ctx.timestampFormat)}
              </p>
            </>
          }
        />
      </div>
    </div>
  );
}

function RevertUserMessageButton({ messageId }: { messageId: MessageId }) {
  const ctx = useTimelineRowCtx();
  const activity = useTimelineRowActivityCtx();

  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      disabled={activity.isRevertingCheckpoint || activity.isWorking}
      onClick={() => ctx.onRevertUserMessage(messageId)}
      title="Revert to this message"
    >
      <Undo2Icon className="size-3" />
    </Button>
  );
}

function AssistantTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "message" }> }) {
  const ctx = useTimelineRowCtx();
  const messageText = row.message.text || (row.message.streaming ? "" : "(empty response)");

  return (
    <>
      {row.showCompletionDivider ? (
        <AssistantCompletionDivider completionSummary={row.completionSummary} />
      ) : null}
      <div className="min-w-0 px-1 py-0.5">
        <ChatMarkdown
          text={messageText}
          cwd={ctx.markdownCwd}
          isStreaming={Boolean(row.message.streaming)}
          skills={ctx.skills}
        />
        <AssistantChangedFilesSection turnSummary={row.assistantTurnDiffSummary} />
        <div className="mt-1.5 flex items-center gap-2">
          <p className="text-[10px] text-muted-foreground/30">
            {row.message.streaming ? (
              <LiveMessageMeta
                createdAt={row.message.createdAt}
                durationStart={row.durationStart}
                timestampFormat={ctx.timestampFormat}
              />
            ) : (
              formatMessageMeta(
                row.message.createdAt,
                formatElapsed(row.durationStart, row.message.completedAt),
                ctx.timestampFormat,
              )
            )}
          </p>
          <AssistantCopyButton row={row} />
        </div>
      </div>
    </>
  );
}

function AssistantCompletionDivider({ completionSummary }: { completionSummary: string | null }) {
  return (
    <div className="my-3 flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80">
        {completionSummary ? `Response • ${completionSummary}` : "Response"}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function AssistantChangedFilesSection({
  turnSummary,
}: {
  turnSummary?: TurnDiffSummary | undefined;
}) {
  const ctx = useTimelineRowCtx();
  if (!turnSummary) {
    return null;
  }

  const checkpointFiles = turnSummary.files;
  if (checkpointFiles.length === 0) {
    return null;
  }

  const summaryStat = summarizeTurnDiffStats(checkpointFiles);
  const changedFileCountLabel = String(checkpointFiles.length);
  const allDirectoriesExpanded = useUiStateStore(
    (store) =>
      store.threadChangedFilesExpandedById[ctx.routeThreadKey]?.[turnSummary.turnId] ?? true,
  );
  const setThreadChangedFilesExpanded = useUiStateStore(
    (store) => store.setThreadChangedFilesExpanded,
  );

  return (
    <div className="mt-2 rounded-lg border border-border/80 bg-card/45 p-2.5">
      <div className="sticky top-2 z-10 mb-1.5 flex items-center justify-between gap-2 bg-[color-mix(in_srgb,var(--card)_45%,var(--background))] before:absolute before:inset-x-0 before:-top-2 before:h-2 before:bg-[color-mix(in_srgb,var(--card)_45%,var(--background))] before:content-['']">
        <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/65">
          <span>Changed files ({changedFileCountLabel})</span>
          {hasNonZeroStat(summaryStat) ? (
            <>
              <span className="mx-1">•</span>
              <DiffStatLabel additions={summaryStat.additions} deletions={summaryStat.deletions} />
            </>
          ) : null}
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="xs"
            variant="outline"
            data-scroll-anchor-ignore
            onClick={() =>
              setThreadChangedFilesExpanded(
                ctx.routeThreadKey,
                turnSummary.turnId,
                !allDirectoriesExpanded,
              )
            }
          >
            {allDirectoriesExpanded ? "Collapse all" : "Expand all"}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => ctx.onOpenTurnDiff(turnSummary.turnId, checkpointFiles[0]?.path)}
          >
            View diff
          </Button>
        </div>
      </div>
      <ChangedFilesTree
        key={`changed-files-tree:${turnSummary.turnId}`}
        turnId={turnSummary.turnId}
        files={checkpointFiles}
        allDirectoriesExpanded={allDirectoriesExpanded}
        resolvedTheme={ctx.resolvedTheme}
        onOpenTurnDiff={ctx.onOpenTurnDiff}
      />
    </div>
  );
}

function AssistantCopyButton({ row }: { row: Extract<TimelineRow, { kind: "message" }> }) {
  const assistantCopyState = resolveAssistantMessageCopyState({
    text: row.message.text ?? null,
    showCopyButton: row.showAssistantCopyButton,
    streaming: row.assistantCopyStreaming,
  });

  if (!assistantCopyState.visible) {
    return null;
  }

  return (
    <div className="flex items-center opacity-0 transition-opacity duration-200 group-hover/assistant:opacity-100">
      <MessageCopyButton
        text={assistantCopyState.text ?? ""}
        size="icon-xs"
        variant="outline"
        className="border-border/50 bg-background/35 text-muted-foreground/45 shadow-none hover:border-border/70 hover:bg-background/55 hover:text-muted-foreground/70"
      />
    </div>
  );
}

function ProposedPlanTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "proposed-plan" }>;
}) {
  const ctx = useTimelineRowCtx();

  return (
    <div className="min-w-0 px-1 py-0.5">
      <ProposedPlanCard
        planMarkdown={row.proposedPlan.planMarkdown}
        environmentId={ctx.activeThreadEnvironmentId}
        cwd={ctx.markdownCwd}
        workspaceRoot={ctx.workspaceRoot}
      />
    </div>
  );
}

function WorkingTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "working" }> }) {
  return (
    <div className="py-0.5 pl-1.5">
      <div className="flex items-center gap-2 pt-1 text-[11px] text-muted-foreground/70">
        <span className="inline-flex items-center gap-[3px]">
          <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse" />
          <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse [animation-delay:200ms]" />
          <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse [animation-delay:400ms]" />
        </span>
        <span>
          {row.createdAt ? (
            <>
              Working for <WorkingTimer createdAt={row.createdAt} />
            </>
          ) : (
            "Working..."
          )}
        </span>
      </div>
    </div>
  );
}

function formatWorkingTimer(startIso: string, endIso: string): string | null {
  const startedAtMs = Date.parse(startIso);
  const endedAtMs = Date.parse(endIso);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
    return null;
  }

  const elapsedSeconds = Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1000));
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatWorkingTimerNow(startIso: string): string {
  return formatWorkingTimer(startIso, new Date().toISOString()) ?? "0s";
}

function WorkingTimer({ createdAt }: { createdAt: string }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const initialText = formatWorkingTimerNow(createdAt);

  useEffect(() => {
    const updateText = () => {
      if (textRef.current) {
        textRef.current.textContent = formatWorkingTimerNow(createdAt);
      }
    };

    updateText();
    const intervalId = window.setInterval(updateText, 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [createdAt]);

  return <span ref={textRef}>{initialText}</span>;
}

function formatLiveMessageMetaNow(
  createdAt: string,
  durationStart: string | null | undefined,
  timestampFormat: TimestampFormat,
): string {
  const elapsed = durationStart ? formatElapsed(durationStart, new Date().toISOString()) : null;
  return formatMessageMeta(createdAt, elapsed, timestampFormat);
}

function LiveMessageMeta({
  createdAt,
  durationStart,
  timestampFormat,
}: {
  createdAt: string;
  durationStart: string | null | undefined;
  timestampFormat: TimestampFormat;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const initialText = formatLiveMessageMetaNow(createdAt, durationStart, timestampFormat);

  useEffect(() => {
    const updateText = () => {
      if (textRef.current) {
        textRef.current.textContent = formatLiveMessageMetaNow(
          createdAt,
          durationStart,
          timestampFormat,
        );
      }
    };

    updateText();
    if (!durationStart) {
      return;
    }

    const intervalId = window.setInterval(updateText, 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [createdAt, durationStart, timestampFormat]);

  return <span ref={textRef}>{initialText}</span>;
}

function formatMessageMeta(
  createdAt: string,
  duration: string | null,
  timestampFormat: TimestampFormat,
): string {
  if (!duration) return formatTimestamp(createdAt, timestampFormat);
  return `${formatTimestamp(createdAt, timestampFormat)} • ${duration}`;
}

const UserMessageTerminalContextInlineLabel = memo(
  function UserMessageTerminalContextInlineLabel(props: { context: ParsedTerminalContextEntry }) {
    const tooltipText =
      props.context.body.length > 0
        ? `${props.context.header}\n${props.context.body}`
        : props.context.header;

    return <TerminalContextInlineChip label={props.context.header} tooltipText={tooltipText} />;
  },
);

const UserMessageEditorContextInlineLabel = memo(
  function UserMessageEditorContextInlineLabel(props: { context: ParsedEditorContextEntry }) {
    const label = formatEditorContextLabel(props.context);
    const tooltipText =
      props.context.body.length > 0
        ? `${props.context.file}:${props.context.lineStart}-${props.context.lineEnd}\n${props.context.body}`
        : label;

    return <EditorContextInlineChip label={label} tooltipText={tooltipText} />;
  },
);

const MAX_COLLAPSED_USER_MESSAGE_LINES = 8;
const MAX_COLLAPSED_USER_MESSAGE_LENGTH = 600;
const COLLAPSED_USER_MESSAGE_FADE_HEIGHT_REM = 1.75;
const COLLAPSED_USER_MESSAGE_FADE_MASK = `linear-gradient(to bottom, black calc(100% - ${COLLAPSED_USER_MESSAGE_FADE_HEIGHT_REM}rem), transparent)`;

function shouldCollapseUserMessage(text: string): boolean {
  if (text.trim().length === 0) {
    return false;
  }

  return (
    text.length > MAX_COLLAPSED_USER_MESSAGE_LENGTH ||
    text.split("\n").length > MAX_COLLAPSED_USER_MESSAGE_LINES
  );
}

const CollapsibleUserMessageBody = memo(function CollapsibleUserMessageBody(props: {
  text: string;
  terminalContexts: ParsedTerminalContextEntry[];
  editorContexts: ParsedEditorContextEntry[];
  skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
  footer?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasVisibleBody =
    props.text.trim().length > 0 ||
    props.terminalContexts.length > 0 ||
    props.editorContexts.length > 0;
  const canCollapse = hasVisibleBody && shouldCollapseUserMessage(props.text);
  const isCollapsed = canCollapse && !expanded;

  return (
    <div>
      {hasVisibleBody ? (
        <div
          className={cn("relative", isCollapsed && "max-h-44 overflow-hidden")}
          data-user-message-body="true"
          data-user-message-collapsed={isCollapsed ? "true" : "false"}
          data-user-message-collapsible={canCollapse ? "true" : "false"}
          data-user-message-fade={isCollapsed ? "true" : "false"}
          style={
            isCollapsed
              ? {
                  WebkitMaskImage: COLLAPSED_USER_MESSAGE_FADE_MASK,
                  maskImage: COLLAPSED_USER_MESSAGE_FADE_MASK,
                }
              : undefined
          }
        >
          <UserMessageBody
            text={props.text}
            terminalContexts={props.terminalContexts}
            editorContexts={props.editorContexts}
            skills={props.skills}
          />
        </div>
      ) : null}
      {canCollapse || props.footer ? (
        <div
          className={cn(
            "mt-1.5 flex items-center gap-2",
            canCollapse && props.footer ? "justify-between" : "justify-end",
          )}
          data-user-message-footer="true"
        >
          {canCollapse ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              aria-expanded={expanded}
              data-scroll-anchor-ignore
              onClick={() => setExpanded((value) => !value)}
              className="-ml-1 h-6 rounded-md px-1.5 text-xs text-muted-foreground/72 hover:bg-muted/55 hover:text-foreground/85"
            >
              {expanded ? "Show less" : "Show full message"}
            </Button>
          ) : null}
          {props.footer ? (
            <div className="ml-auto flex items-center gap-2">{props.footer}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

const UserMessageBody = memo(function UserMessageBody(props: {
  text: string;
  terminalContexts: ParsedTerminalContextEntry[];
  editorContexts: ParsedEditorContextEntry[];
  skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
}) {
  const hasContexts = props.terminalContexts.length > 0 || props.editorContexts.length > 0;

  if (hasContexts) {
    const hasEmbeddedInlineLabels =
      props.terminalContexts.length > 0 &&
      textContainsInlineTerminalContextLabels(props.text, props.terminalContexts);
    const inlinePrefix = buildInlineTerminalContextText(props.terminalContexts);
    const inlineNodes: ReactNode[] = [];

    if (hasEmbeddedInlineLabels) {
      let cursor = 0;

      for (const context of props.terminalContexts) {
        const label = formatInlineTerminalContextLabel(context.header);
        const matchIndex = props.text.indexOf(label, cursor);
        if (matchIndex === -1) {
          inlineNodes.length = 0;
          break;
        }
        if (matchIndex > cursor) {
          inlineNodes.push(
            <span key={`user-terminal-context-inline-before:${context.header}:${cursor}`}>
              <SkillInlineText text={props.text.slice(cursor, matchIndex)} skills={props.skills} />
            </span>,
          );
        }
        inlineNodes.push(
          <UserMessageTerminalContextInlineLabel
            key={`user-terminal-context-inline:${context.header}`}
            context={context}
          />,
        );
        cursor = matchIndex + label.length;
      }

      if (inlineNodes.length > 0) {
        if (cursor < props.text.length) {
          inlineNodes.push(
            <span key={`user-message-terminal-context-inline-rest:${cursor}`}>
              <SkillInlineText text={props.text.slice(cursor)} skills={props.skills} />
            </span>,
          );
        }

        // Append editor context chips after terminal inline labels
        for (const context of props.editorContexts) {
          inlineNodes.push(
            <span
              key={`user-editor-context-inline-space:${context.file}:${context.lineStart}`}
              aria-hidden="true"
            >
              {" "}
            </span>,
          );
          inlineNodes.push(
            <UserMessageEditorContextInlineLabel
              key={`user-editor-context-inline:${context.file}:${context.lineStart}`}
              context={context}
            />,
          );
        }

        return (
          <div className="whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-foreground">
            {inlineNodes}
          </div>
        );
      }
    }

    for (const context of props.terminalContexts) {
      inlineNodes.push(
        <UserMessageTerminalContextInlineLabel
          key={`user-terminal-context-inline:${context.header}`}
          context={context}
        />,
      );
      inlineNodes.push(
        <span key={`user-terminal-context-inline-space:${context.header}`} aria-hidden="true">
          {" "}
        </span>,
      );
    }

    for (const context of props.editorContexts) {
      inlineNodes.push(
        <UserMessageEditorContextInlineLabel
          key={`user-editor-context-inline:${context.file}:${context.lineStart}`}
          context={context}
        />,
      );
      inlineNodes.push(
        <span
          key={`user-editor-context-inline-space:${context.file}:${context.lineStart}`}
          aria-hidden="true"
        >
          {" "}
        </span>,
      );
    }

    if (props.text.length > 0) {
      inlineNodes.push(
        <span key="user-message-terminal-context-inline-text">
          <SkillInlineText text={props.text} skills={props.skills} />
        </span>,
      );
    } else if (inlinePrefix.length === 0 && props.editorContexts.length === 0) {
      return null;
    }

    return (
      <div className="whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-foreground">
        {inlineNodes}
      </div>
    );
  }

  if (props.text.length === 0) {
    return null;
  }

  return (
    <div className="whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-foreground">
      <SkillInlineText text={props.text} skills={props.skills} />
    </div>
  );
});

function workToneIcon(tone: TimelineWorkEntry["tone"]): {
  icon: LucideIcon;
  className: string;
} {
  if (tone === "error") {
    return {
      icon: CircleAlertIcon,
      className: "bg-rose-500/10 text-rose-300/80 ring-1 ring-rose-400/20",
    };
  }
  if (tone === "thinking") {
    return {
      icon: BotIcon,
      className: "bg-blue-500/10 text-blue-300/75 ring-1 ring-blue-400/15",
    };
  }
  if (tone === "info") {
    return {
      icon: CheckIcon,
      className: "bg-emerald-500/10 text-emerald-300/75 ring-1 ring-emerald-400/15",
    };
  }
  return {
    icon: ZapIcon,
    className: "bg-muted/45 text-muted-foreground/78 ring-1 ring-border/45",
  };
}

function workToneClass(tone: "thinking" | "tool" | "info" | "error"): string {
  if (tone === "error") return "text-rose-200/82 dark:text-rose-200/82";
  if (tone === "tool") return "text-muted-foreground/82";
  if (tone === "thinking") return "text-muted-foreground/76";
  return "text-muted-foreground/72";
}

function workEntryPreview(
  workEntry: Pick<TimelineWorkEntry, "detail" | "command" | "changedFiles">,
  workspaceRoot: string | undefined,
) {
  if (workEntry.command) return workEntry.command;
  if (workEntry.detail) return workEntry.detail;
  if ((workEntry.changedFiles?.length ?? 0) === 0) return null;
  const [firstPath] = workEntry.changedFiles ?? [];
  if (!firstPath) return null;
  const displayPath = formatWorkspaceRelativePath(firstPath, workspaceRoot);
  return workEntry.changedFiles!.length === 1
    ? displayPath
    : `${displayPath} +${workEntry.changedFiles!.length - 1} more`;
}

function workEntryRawCommand(
  workEntry: Pick<TimelineWorkEntry, "command" | "rawCommand">,
): string | null {
  const rawCommand = workEntry.rawCommand?.trim();
  if (!rawCommand || !workEntry.command) {
    return null;
  }
  return rawCommand === workEntry.command.trim() ? null : rawCommand;
}

function workEntryIcon(workEntry: TimelineWorkEntry): LucideIcon {
  if (workEntry.requestKind === "command") return TerminalIcon;
  if (workEntry.requestKind === "file-read") return EyeIcon;
  if (workEntry.requestKind === "file-change") return SquarePenIcon;

  if (workEntry.itemType === "command_execution" || workEntry.command) {
    return TerminalIcon;
  }
  if (workEntry.itemType === "file_change" || (workEntry.changedFiles?.length ?? 0) > 0) {
    return SquarePenIcon;
  }
  if (workEntry.itemType === "web_search") return GlobeIcon;
  if (workEntry.itemType === "image_view") return EyeIcon;

  switch (workEntry.itemType) {
    case "mcp_tool_call":
      return WrenchIcon;
    case "dynamic_tool_call":
    case "collab_agent_tool_call":
      return HammerIcon;
  }

  return workToneIcon(workEntry.tone).icon;
}

function capitalizePhrase(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function toolWorkEntryHeading(workEntry: TimelineWorkEntry): string {
  if (!workEntry.toolTitle) {
    return capitalizePhrase(normalizeCompactToolLabel(workEntry.label));
  }
  return capitalizePhrase(normalizeCompactToolLabel(workEntry.toolTitle));
}

const SimpleWorkEntryRow = memo(function SimpleWorkEntryRow(props: {
  workEntry: TimelineWorkEntry;
  timestampFormat: TimestampFormat;
  workspaceRoot: string | undefined;
}) {
  const { workEntry, timestampFormat, workspaceRoot } = props;
  const iconConfig = workToneIcon(workEntry.tone);
  const EntryIcon = workEntryIcon(workEntry);
  const heading = toolWorkEntryHeading(workEntry);
  const preview = workEntryPreview(workEntry, workspaceRoot);
  const rawCommand = workEntryRawCommand(workEntry);
  const displayText = preview ? `${heading} - ${preview}` : heading;
  const hasChangedFiles = (workEntry.changedFiles?.length ?? 0) > 0;
  const previewIsChangedFiles = hasChangedFiles && !workEntry.command && !workEntry.detail;
  const timestamp = formatTimestamp(workEntry.createdAt, timestampFormat);

  return (
    <div className="rounded-md px-1.5 py-1.5 transition-colors duration-150 hover:bg-muted/25">
      <div className="flex items-start gap-2.5 transition-[opacity,translate] duration-200">
        <span
          className={cn(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
            iconConfig.className,
          )}
        >
          <EntryIcon className="size-3" />
        </span>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex min-w-0 items-baseline justify-between gap-2">
            <p
              className={cn(
                "min-w-0 truncate text-xs font-medium leading-5",
                workToneClass(workEntry.tone),
              )}
              title={rawCommand ? undefined : displayText}
            >
              {heading}
            </p>
            <span className="shrink-0 text-[10px] text-muted-foreground/42">{timestamp}</span>
          </div>
          {preview ? (
            <p
              className={cn(
                "mt-0.5 min-w-0 truncate text-[11px] leading-4 text-muted-foreground/66",
                workEntry.command || rawCommand ? "font-mono" : "",
              )}
              title={rawCommand ? undefined : preview}
            >
              {rawCommand ? (
                <Tooltip>
                  <TooltipTrigger
                    closeDelay={0}
                    delay={75}
                    render={
                      <span className="max-w-full cursor-default text-muted-foreground/65 transition-colors hover:text-muted-foreground/82 focus-visible:text-muted-foreground/82">
                        {preview}
                      </span>
                    }
                  />
                  <TooltipPopup
                    align="start"
                    className="max-w-[min(56rem,calc(100vw-2rem))] px-0 py-0"
                    side="top"
                  >
                    <div className="max-w-[min(56rem,calc(100vw-2rem))] overflow-x-auto px-1.5 py-1 font-mono text-[11px] leading-4 whitespace-nowrap">
                      {rawCommand}
                    </div>
                  </TooltipPopup>
                </Tooltip>
              ) : (
                preview
              )}
            </p>
          ) : null}
        </div>
      </div>
      {hasChangedFiles && !previewIsChangedFiles && (
        <div className="mt-1.5 flex flex-wrap gap-1 pl-7">
          {workEntry.changedFiles?.slice(0, 4).map((filePath) => {
            const displayPath = formatWorkspaceRelativePath(filePath, workspaceRoot);
            return (
              <span
                key={`${workEntry.id}:${filePath}`}
                className="rounded-md border border-border/55 bg-background/75 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/75"
                title={displayPath}
              >
                {displayPath}
              </span>
            );
          })}
          {(workEntry.changedFiles?.length ?? 0) > 4 && (
            <span className="px-1 text-[10px] text-muted-foreground/55">
              +{(workEntry.changedFiles?.length ?? 0) - 4}
            </span>
          )}
        </div>
      )}
    </div>
  );
});
