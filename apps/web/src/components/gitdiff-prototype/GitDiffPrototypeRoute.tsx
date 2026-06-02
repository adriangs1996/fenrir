import {
  CheckIcon,
  ChevronDownIcon,
  Columns2Icon,
  CopyIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitPullRequestIcon,
  KeyboardIcon,
  MessageSquareIcon,
  PlusIcon,
  Rows3Icon,
  SendIcon,
  TextWrapIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "~/lib/utils";

type ReviewMode = "local" | "pr";
type DiffView = "split" | "unified";
type DiffScope = "this" | "stack";
type DiffLineKind = "ctx" | "add" | "del";
type FileStatus = "modified" | "new" | "deleted" | "renamed";
type StackStatus = "approved" | "review" | "draft";

interface DiffLine {
  id: string;
  kind: DiffLineKind;
  oldLine: number | null;
  newLine: number | null;
  content: string;
}

interface DiffHunk {
  id: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  context: string;
  lines: DiffLine[];
}

interface DiffFile {
  id: string;
  path: string;
  oldPath?: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

interface StackDiffDefinition {
  id: string;
  number: number;
  title: string;
  branch: string;
  base: string;
  status: StackStatus;
  sync?: "behind";
  author: {
    name: string;
    color: string;
  };
  fileIds: string[];
}

interface StackDiff extends StackDiffDefinition {
  files: DiffFile[];
  additions: number;
  deletions: number;
}

interface ReviewComment {
  id: string;
  author: string;
  color: string;
  createdAt: string;
  body: string;
  replies?: ReviewComment[];
}

interface ReviewState {
  stagedLineIds: ReadonlySet<string>;
  discardedHunkIds: ReadonlySet<string>;
  commentsByLineId: Readonly<Record<string, ReviewComment[]>>;
  toggleLine: (lineId: string) => void;
  stageLines: (lineIds: ReadonlyArray<string>, staged: boolean) => void;
  toggleHunk: (hunk: DiffHunk) => void;
  discardHunk: (hunkId: string) => void;
  restoreHunk: (hunkId: string) => void;
  addComment: (lineId: string, body: string) => void;
  addReply: (lineId: string, commentId: string, body: string) => void;
}

interface DiffSurfaceProps {
  files: ReadonlyArray<DiffFile>;
  view: DiffView;
  mode: ReviewMode;
  reviewState: ReviewState;
  wrap: boolean;
  activeHunkId: string | null;
  setHunkRef: (hunkId: string, node: HTMLDivElement | null) => void;
}

interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
  isModification: boolean;
}

const SAMPLE_FILES: DiffFile[] = [
  {
    id: "f2",
    path: "packages/contracts/src/reviewComments.ts",
    status: "modified",
    additions: 9,
    deletions: 3,
    hunks: [
      {
        id: "h-f2-1",
        oldStart: 12,
        oldCount: 8,
        newStart: 12,
        newCount: 14,
        context: "export const ReviewCommentDraft",
        lines: [
          line("f2-1", "ctx", 12, 12, "export const ReviewCommentDraft = Schema.Struct({"),
          line("f2-2", "ctx", 13, 13, "  body: ReviewText,"),
          line("f2-3", "del", 14, null, "  line: PositiveInt,"),
          line("f2-4", "add", null, 14, "  anchor: ReviewStableAnchor,"),
          line("f2-5", "add", null, 15, '  side: Schema.Literals(["old", "new"]),'),
          line("f2-6", "ctx", 15, 16, "  path: ReviewNormalizedPath,"),
          line(
            "f2-7",
            "add",
            null,
            17,
            "  parentCommentId: Schema.optionalKey(GitHubReviewCommentId),",
          ),
          line("f2-8", "ctx", 16, 18, "});"),
          line(
            "f2-9",
            "ctx",
            18,
            20,
            "export type ReviewCommentDraft = typeof ReviewCommentDraft.Type;",
          ),
        ],
      },
      {
        id: "h-f2-2",
        oldStart: 31,
        oldCount: 7,
        newStart: 37,
        newCount: 10,
        context: "export const ReviewThread",
        lines: [
          line("f2-10", "ctx", 31, 37, "export const ReviewThread = Schema.Struct({"),
          line("f2-11", "ctx", 32, 38, "  id: GitHubReviewThreadId,"),
          line("f2-12", "del", 33, null, "  isResolved: Schema.Boolean,"),
          line(
            "f2-13",
            "add",
            null,
            39,
            '  state: Schema.Literals(["open", "resolved", "outdated"]),',
          ),
          line("f2-14", "add", null, 40, "  replyCount: NonNegativeInt,"),
          line("f2-15", "ctx", 34, 41, "  comments: Schema.Array(GitHubReviewComment),"),
          line("f2-16", "ctx", 35, 42, "});"),
        ],
      },
    ],
  },
  {
    id: "f0",
    path: "apps/web/src/components/review/CommentThread.tsx",
    status: "modified",
    additions: 14,
    deletions: 8,
    hunks: [
      {
        id: "h-f0-1",
        oldStart: 44,
        oldCount: 15,
        newStart: 44,
        newCount: 22,
        context: "function CommentThread",
        lines: [
          line("f0-1", "ctx", 44, 44, "function CommentThread(props: CommentThreadProps) {"),
          line("f0-2", "del", 45, null, '  const [draft, setDraft] = useState("");'),
          line("f0-3", "add", null, 45, '  const [draftBody, setDraftBody] = useState("");'),
          line(
            "f0-4",
            "add",
            null,
            46,
            "  const [pendingReplyId, setPendingReplyId] = useState<string | null>(null);",
          ),
          line("f0-5", "ctx", 46, 47, "  const submitReply = async () => {"),
          line("f0-6", "del", 47, null, "    await props.onReply(draft);"),
          line("f0-7", "del", 48, null, '    setDraft("");'),
          line(
            "f0-8",
            "add",
            null,
            48,
            "    const optimisticId = props.onOptimisticReply(draftBody);",
          ),
          line("f0-9", "add", null, 49, "    setPendingReplyId(optimisticId);"),
          line("f0-10", "add", null, 50, "    await props.onReply(draftBody, optimisticId);"),
          line("f0-11", "add", null, 51, '    setDraftBody("");'),
          line("f0-12", "add", null, 52, "    setPendingReplyId(null);"),
          line("f0-13", "ctx", 49, 53, "  };"),
          line("f0-14", "ctx", 51, 55, "  return ("),
        ],
      },
      {
        id: "h-f0-2",
        oldStart: 67,
        oldCount: 10,
        newStart: 74,
        newCount: 13,
        context: "reply composer",
        lines: [
          line("f0-15", "ctx", 67, 74, "      <textarea"),
          line("f0-16", "del", 68, null, "        value={draft}"),
          line(
            "f0-17",
            "del",
            69,
            null,
            "        onChange={(event) => setDraft(event.target.value)}",
          ),
          line("f0-18", "add", null, 75, "        value={draftBody}"),
          line("f0-19", "add", null, 76, "        disabled={pendingReplyId !== null}"),
          line(
            "f0-20",
            "add",
            null,
            77,
            "        onChange={(event) => setDraftBody(event.target.value)}",
          ),
          line("f0-21", "ctx", 70, 78, "      />"),
          line("f0-22", "add", null, 79, '      {pendingReplyId ? <Spinner size="xs" /> : null}'),
          line("f0-23", "ctx", 71, 80, "      <Button onClick={submitReply}>Reply</Button>"),
        ],
      },
    ],
  },
  {
    id: "f1",
    path: "apps/web/src/lib/reviewComments.ts",
    status: "modified",
    additions: 11,
    deletions: 6,
    hunks: [
      {
        id: "h-f1-1",
        oldStart: 18,
        oldCount: 13,
        newStart: 18,
        newCount: 18,
        context: "postReviewComment",
        lines: [
          line(
            "f1-1",
            "ctx",
            18,
            18,
            "export async function postReviewComment(input: ReviewCommentInput) {",
          ),
          line("f1-2", "del", 19, null, "  const response = await api.review.comment(input);"),
          line("f1-3", "add", null, 19, "  const response = await api.review.comment({"),
          line("f1-4", "add", null, 20, "    ...input,"),
          line(
            "f1-5",
            "add",
            null,
            21,
            "    clientMutationId: input.clientMutationId ?? crypto.randomUUID(),",
          ),
          line("f1-6", "add", null, 22, "  });"),
          line("f1-7", "ctx", 20, 23, "  if (!response.ok) {"),
          line("f1-8", "del", 21, null, '    throw new Error("Comment failed");'),
          line("f1-9", "add", null, 24, "    throw new ReviewCommentError(response.statusText);"),
          line("f1-10", "ctx", 22, 25, "  }"),
          line("f1-11", "add", null, 26, "  return response.comment;"),
          line("f1-12", "ctx", 23, 27, "}"),
        ],
      },
    ],
  },
  {
    id: "f3",
    path: "apps/web/src/components/review/CommentComposer.tsx",
    status: "new",
    additions: 21,
    deletions: 0,
    hunks: [
      {
        id: "h-f3-1",
        oldStart: 0,
        oldCount: 0,
        newStart: 1,
        newCount: 21,
        context: "new composer",
        lines: [
          line("f3-1", "add", null, 1, 'import { SendIcon } from "lucide-react";'),
          line("f3-2", "add", null, 2, 'import { useState } from "react";'),
          line("f3-3", "add", null, 3, ""),
          line(
            "f3-4",
            "add",
            null,
            4,
            "export function CommentComposer(props: CommentComposerProps) {",
          ),
          line("f3-5", "add", null, 5, '  const [body, setBody] = useState("");'),
          line(
            "f3-6",
            "add",
            null,
            6,
            "  const canSubmit = body.trim().length > 0 && !props.pending;",
          ),
          line("f3-7", "add", null, 7, ""),
          line("f3-8", "add", null, 8, "  return ("),
          line(
            "f3-9",
            "add",
            null,
            9,
            '    <form onSubmit={(event) => props.onSubmit(event, body)} className="comment-composer">',
          ),
          line(
            "f3-10",
            "add",
            null,
            10,
            "      <textarea value={body} onChange={(event) => setBody(event.target.value)} />",
          ),
          line("f3-11", "add", null, 11, '      <button disabled={!canSubmit} type="submit">'),
          line("f3-12", "add", null, 12, '        <SendIcon aria-hidden="true" />'),
          line("f3-13", "add", null, 13, "        Comment"),
          line("f3-14", "add", null, 14, "      </button>"),
          line("f3-15", "add", null, 15, "    </form>"),
          line("f3-16", "add", null, 16, "  );"),
          line("f3-17", "add", null, 17, "}"),
        ],
      },
    ],
  },
  {
    id: "f4",
    path: "apps/web/src/components/review/LegacyCommentBox.tsx",
    status: "deleted",
    additions: 0,
    deletions: 12,
    hunks: [
      {
        id: "h-f4-1",
        oldStart: 1,
        oldCount: 12,
        newStart: 0,
        newCount: 0,
        context: "legacy component",
        lines: [
          line("f4-1", "del", 1, null, "export function LegacyCommentBox(props) {"),
          line("f4-2", "del", 2, null, "  return ("),
          line("f4-3", "del", 3, null, '    <div className="comment-box">'),
          line("f4-4", "del", 4, null, "      <textarea onChange={props.onChange} />"),
          line("f4-5", "del", 5, null, "      <button onClick={props.onSubmit}>Send</button>"),
          line("f4-6", "del", 6, null, "    </div>"),
          line("f4-7", "del", 7, null, "  );"),
          line("f4-8", "del", 8, null, "}"),
        ],
      },
    ],
  },
];

const STACK_DEFS: StackDiffDefinition[] = [
  {
    id: "d1",
    number: 4819,
    title: "Typed comment API",
    branch: "feat/typed-comment-api",
    base: "main",
    status: "approved",
    author: { name: "Sasha Imamura", color: "#b6927b" },
    fileIds: ["f2"],
  },
  {
    id: "d2",
    number: 4821,
    title: "Optimistic comment posting",
    branch: "feat/optimistic-posting",
    base: "feat/typed-comment-api",
    status: "review",
    author: { name: "Devin Oyelaran", color: "#8ba4b0" },
    fileIds: ["f0", "f1"],
  },
  {
    id: "d3",
    number: 4822,
    title: "Comment composer UI",
    branch: "feat/comment-composer",
    base: "feat/optimistic-posting",
    status: "draft",
    sync: "behind",
    author: { name: "Devin Oyelaran", color: "#8ba4b0" },
    fileIds: ["f3", "f4"],
  },
];

const STATUS_META = {
  approved: { label: "Approved", className: "text-success" },
  review: { label: "In review", className: "text-[#7e9cd8]" },
  draft: { label: "Draft", className: "text-muted-foreground" },
} satisfies Record<StackStatus, { label: string; className: string }>;

const DEFAULT_DIFF_ID = "d2";

const SEED_COMMENTS: Record<string, ReviewComment[]> = {
  "f0-8": [
    {
      id: "c1",
      author: "Mira",
      color: "#87a987",
      createdAt: "12m ago",
      body: "Good place for the optimistic mutation id. Can we also rollback the temporary reply on failure?",
      replies: [
        {
          id: "c1-r1",
          author: "Devin",
          color: "#8ba4b0",
          createdAt: "6m ago",
          body: "Yes. The rollback path is in the client helper diff below.",
        },
      ],
    },
  ],
  "f1-9": [
    {
      id: "c2",
      author: "Sasha",
      color: "#b6927b",
      createdAt: "9m ago",
      body: "`ReviewCommentError` should carry the status code for the toast copy.",
    },
  ],
  "f3-10": [
    {
      id: "c3",
      author: "Mira",
      color: "#87a987",
      createdAt: "2m ago",
      body: "Composer looks focused. Please keep this form keyboard friendly.",
    },
  ],
};

function line(
  id: string,
  kind: DiffLineKind,
  oldLine: number | null,
  newLine: number | null,
  content: string,
): DiffLine {
  return { id, kind, oldLine, newLine, content };
}

function buildStack(files: ReadonlyArray<DiffFile>): StackDiff[] {
  const filesById = new Map(files.map((file) => [file.id, file]));
  return STACK_DEFS.map((definition) => {
    const stackFiles = definition.fileIds.flatMap((fileId) => {
      const file = filesById.get(fileId);
      return file ? [file] : [];
    });
    return Object.assign({}, definition, {
      files: stackFiles,
      additions: stackFiles.reduce((sum, file) => sum + file.additions, 0),
      deletions: stackFiles.reduce((sum, file) => sum + file.deletions, 0),
    });
  });
}

const STACK = buildStack(SAMPLE_FILES);

export function GitDiffPrototypeRoute() {
  const [mode, setMode] = useState<ReviewMode>("local");
  const [view, setView] = useState<DiffView>("split");
  const [scope, setScope] = useState<DiffScope>("this");
  const [wordWrap, setWordWrap] = useState(false);
  const [selectedDiffId, setSelectedDiffId] = useState(DEFAULT_DIFF_ID);
  const [helpOpen, setHelpOpen] = useState(false);
  const [activeHunkId, setActiveHunkId] = useState<string | null>(null);
  const hunkRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const reviewState = usePrototypeReviewState();

  const selectedDiff = useMemo(() => getStackDiff(selectedDiffId), [selectedDiffId]);
  const visibleFiles = useMemo(
    () => getVisibleFiles(selectedDiffId, scope),
    [scope, selectedDiffId],
  );

  const setHunkRef = useCallback((hunkId: string, node: HTMLDivElement | null) => {
    hunkRefs.current[hunkId] = node;
  }, []);

  const selectDiff = useCallback((diffId: string) => {
    setSelectedDiffId(diffId);
    setActiveHunkId(null);
  }, []);

  const selectHunk = useCallback(
    (direction: 1 | -1) => {
      const hunks = visibleFiles.flatMap((file) =>
        file.hunks
          .filter((hunk) => !reviewState.discardedHunkIds.has(hunk.id))
          .map((hunk) => hunk.id),
      );
      if (hunks.length === 0) return;
      const currentIndex = activeHunkId ? hunks.indexOf(activeHunkId) : -1;
      const nextIndex =
        currentIndex < 0
          ? direction === 1
            ? 0
            : hunks.length - 1
          : clamp(currentIndex + direction, 0, hunks.length - 1);
      const nextHunkId = hunks[nextIndex];
      if (!nextHunkId) return;
      setActiveHunkId(nextHunkId);
      hunkRefs.current[nextHunkId]?.scrollIntoView({ block: "center", behavior: "smooth" });
    },
    [activeHunkId, reviewState.discardedHunkIds, visibleFiles],
  );

  const activeHunk = useMemo(
    () => findHunk(visibleFiles, activeHunkId),
    [activeHunkId, visibleFiles],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      if (event.key === "?") {
        event.preventDefault();
        setHelpOpen((current) => !current);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case "j":
          event.preventDefault();
          selectHunk(1);
          break;
        case "k":
          event.preventDefault();
          selectHunk(-1);
          break;
        case "s":
          if (mode === "local" && activeHunk) {
            event.preventDefault();
            reviewState.toggleHunk(activeHunk);
          }
          break;
        case "x":
          if (mode === "local" && activeHunkId) {
            event.preventDefault();
            reviewState.discardHunk(activeHunkId);
          }
          break;
        case "u":
          event.preventDefault();
          setView((current) => (current === "split" ? "unified" : "split"));
          break;
        case "m":
          event.preventDefault();
          setMode((current) => (current === "local" ? "pr" : "local"));
          break;
        case "Escape":
          setHelpOpen(false);
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeHunk, activeHunkId, mode, reviewState, selectHunk]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0d0c0c] text-[#c5c9c5]">
      <PrototypeHeader />
      <div className="min-h-0 flex-1">
        <WorkbenchView
          selectedDiff={selectedDiff}
          selectedDiffId={selectedDiffId}
          selectDiff={selectDiff}
          mode={mode}
          setMode={setMode}
          view={view}
          setView={setView}
          scope={scope}
          setScope={setScope}
          wordWrap={wordWrap}
          setWordWrap={setWordWrap}
          helpOpen={() => setHelpOpen(true)}
          files={visibleFiles}
          reviewState={reviewState}
          activeHunkId={activeHunkId}
          setHunkRef={setHunkRef}
        />
      </div>
      {helpOpen && <KeyboardOverlay onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

function PrototypeHeader() {
  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-[#2a2928] bg-[#0d0c0c] px-4">
      <div className="flex items-center gap-2 font-mono text-sm font-semibold">
        <span className="grid size-6 place-items-center rounded-md bg-[#8ba4b0] text-xs font-bold text-[#0d0c0c]">
          GD
        </span>
        GitDiff
        <span className="rounded border border-[#393836] px-1.5 py-0.5 text-[10px] font-medium tracking-[0.12em] text-[#737c73] uppercase">
          Prototype
        </span>
      </div>
      <p className="min-w-0 flex-1 truncate text-xs text-[#737c73]">
        Workbench - sidebar stack rail, compact file tree, and checkbox line staging.
      </p>
    </div>
  );
}

function WorkbenchView(props: WorkbenchViewProps) {
  return (
    <div className="flex h-full min-h-0 bg-[#181616]">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-[#2a2928] bg-[#181616]">
        <div className="border-b border-[#2a2928] p-2">
          <ModePill mode={props.mode} setMode={props.setMode} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="mb-1 flex items-center justify-between px-2 text-[10px] font-semibold tracking-[0.12em] text-[#737c73] uppercase">
            <span>Stack - {STACK.length} diffs</span>
            <ScopeToggle scope={props.scope} setScope={props.setScope} />
          </div>
          <StackRail
            selectedDiffId={props.selectedDiffId}
            onSelect={props.selectDiff}
            reviewState={props.reviewState}
            mode={props.mode}
          />
          <div className="mt-3 px-2 pb-1 text-[10px] font-semibold tracking-[0.12em] text-[#737c73] uppercase">
            {props.scope === "stack"
              ? `Files through ${props.selectedDiff.title}`
              : `${props.files.length} changed files`}
          </div>
          <FileList
            files={props.files}
            scope={props.scope}
            reviewState={props.reviewState}
            mode={props.mode}
          />
        </div>
        <ReviewFooter
          selectedDiff={props.selectedDiff}
          files={props.files}
          reviewState={props.reviewState}
          mode={props.mode}
        />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col bg-[#0d0c0c]">
        <DiffToolbar
          selectedDiff={props.selectedDiff}
          mode={props.mode}
          view={props.view}
          setView={props.setView}
          wordWrap={props.wordWrap}
          setWordWrap={props.setWordWrap}
          onHelp={props.helpOpen}
          localHint="Working tree - stage selected hunks into this stack diff"
        />
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="mx-auto max-w-[1180px]">
            <DiffSurface {...props} wrap={props.wordWrap} />
          </div>
        </div>
      </main>
    </div>
  );
}

interface WorkbenchViewProps {
  selectedDiff: StackDiff;
  selectedDiffId: string;
  selectDiff: (diffId: string) => void;
  mode: ReviewMode;
  setMode: (mode: ReviewMode) => void;
  view: DiffView;
  setView: (view: DiffView) => void;
  scope: DiffScope;
  setScope: (scope: DiffScope) => void;
  wordWrap: boolean;
  setWordWrap: (wordWrap: boolean) => void;
  helpOpen: () => void;
  files: ReadonlyArray<DiffFile>;
  reviewState: ReviewState;
  activeHunkId: string | null;
  setHunkRef: (hunkId: string, node: HTMLDivElement | null) => void;
}

function DiffSurface(props: DiffSurfaceProps) {
  return (
    <div className="space-y-3">
      {props.files.map((file) => (
        <DiffFileCard key={file.id} file={file} {...props} />
      ))}
    </div>
  );
}

function DiffFileCard(props: DiffSurfaceProps & { file: DiffFile }) {
  const { file, mode, reviewState } = props;
  const fileLineIds = useMemo(() => collectChangedLineIds([file]), [file]);
  const fileStageState = getStageState(fileLineIds, reviewState.stagedLineIds);
  const commentCount = countCommentsForFiles([file], reviewState.commentsByLineId);

  const toggleFile = () => {
    reviewState.stageLines(fileLineIds, fileStageState !== "all");
  };

  const revertFile = () => {
    for (const hunk of file.hunks) {
      reviewState.discardHunk(hunk.id);
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border border-[#393836] bg-[#1f1d1d]">
      <div className="sticky top-0 z-10 flex min-h-10 items-center gap-2 border-b border-[#393836] bg-[#282727]/90 px-2.5 py-2 backdrop-blur">
        <FileStatusBadge status={file.status} />
        <div className="min-w-0 flex-1 truncate font-mono text-xs">
          {file.oldPath ? (
            <span className="text-[#737c73]">
              {file.oldPath}
              {" -> "}
            </span>
          ) : null}
          <span className="text-[#737c73]">{dirname(file.path)}</span>
          <span className="font-semibold text-[#c5c9c5]">{basename(file.path)}</span>
        </div>
        {mode === "pr" && commentCount > 0 ? (
          <span className="inline-flex items-center gap-1 rounded border border-[#393836] px-1.5 py-0.5 text-[10px] text-[#737c73]">
            <MessageSquareIcon className="size-3" />
            {commentCount}
          </span>
        ) : null}
        <DiffStat additions={file.additions} deletions={file.deletions} />
        {mode === "local" ? (
          <>
            <MiniButton active={fileStageState === "all"} onClick={toggleFile}>
              {fileStageState === "all" ? (
                <CheckIcon className="size-3" />
              ) : (
                <PlusIcon className="size-3" />
              )}
              {fileStageState === "all" ? "Unstage file" : "Stage file"}
            </MiniButton>
            <MiniButton tone="danger" onClick={revertFile}>
              <Undo2Icon className="size-3" />
              Revert
            </MiniButton>
          </>
        ) : null}
        <MiniButton onClick={() => void navigator.clipboard?.writeText(file.path)}>
          <CopyIcon className="size-3" />
        </MiniButton>
      </div>
      {file.hunks.map((hunk) => (
        <DiffHunkView key={hunk.id} {...props} hunk={hunk} />
      ))}
    </section>
  );
}

function DiffHunkView(props: DiffSurfaceProps & { file: DiffFile; hunk: DiffHunk }) {
  const { hunk, reviewState, mode, activeHunkId } = props;
  const [contextExpanded, setContextExpanded] = useState(false);
  const [composerLineId, setComposerLineId] = useState<string | null>(null);
  const hunkLineIds = useMemo(() => collectHunkLineIds(hunk), [hunk]);
  const hunkStageState = getStageState(hunkLineIds, reviewState.stagedLineIds);
  const isDiscarded = reviewState.discardedHunkIds.has(hunk.id);

  const toggleHunk = () => reviewState.toggleHunk(hunk);

  if (isDiscarded) {
    return (
      <div className="border-t border-[#2a2928] bg-destructive/8 px-3 py-2 text-xs text-[#737c73]">
        <div className="flex items-center gap-2">
          <Undo2Icon className="size-3 text-destructive" />
          <span className="line-through">{hunkLineIds.length} changed lines discarded</span>
          <MiniButton className="ml-auto" onClick={() => reviewState.restoreHunk(hunk.id)}>
            Undo
          </MiniButton>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={(node) => props.setHunkRef(hunk.id, node)}
      data-hunk-id={hunk.id}
      className={cn(
        "border-t border-[#2a2928]",
        activeHunkId === hunk.id && "ring-1 ring-[#8ba4b0]",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 border-b border-[#2a2928] bg-[#282727]/45 px-2 py-1 text-[11px] text-[#737c73]",
          hunkStageState !== "none" && "bg-success/8",
        )}
      >
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-[#282727] hover:text-[#8ba4b0]"
          onClick={() => setContextExpanded((current) => !current)}
        >
          <ChevronDownIcon
            className={cn("size-3 transition-transform", !contextExpanded && "-rotate-90")}
          />
          {contextExpanded ? "Collapse" : "Expand"}
        </button>
        <span className="font-mono text-[#a292a3]">
          @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
        </span>
        <span className="min-w-0 truncate">{hunk.context}</span>
        <div className="ml-auto flex items-center gap-1">
          {mode === "local" ? (
            <>
              <MiniButton active={hunkStageState === "all"} onClick={toggleHunk}>
                {hunkStageState === "all" ? (
                  <CheckIcon className="size-3" />
                ) : (
                  <PlusIcon className="size-3" />
                )}
                {hunkStageState === "none"
                  ? "Stage hunk"
                  : hunkStageState === "partial"
                    ? "Stage rest"
                    : "Staged"}
              </MiniButton>
              <MiniButton tone="danger" onClick={() => reviewState.discardHunk(hunk.id)}>
                <Undo2Icon className="size-3" />
                Discard
              </MiniButton>
            </>
          ) : null}
          <MiniButton onClick={() => copyHunk(hunk)}>
            <CopyIcon className="size-3" />
            Copy
          </MiniButton>
        </div>
      </div>
      <div className="font-mono text-[12px]">
        {contextExpanded ? (
          <ContextExpansionRow hunk={hunk} view={props.view} wrap={props.wrap} />
        ) : null}
        {props.view === "split" ? (
          splitRows(hunk.lines).map((row) => (
            <SplitDiffRow
              key={`${hunk.id}:split:${row.left?.id ?? "empty"}:${row.right?.id ?? "empty"}`}
              row={row}
              mode={mode}
              reviewState={reviewState}
              wrap={props.wrap}
              composerLineId={composerLineId}
              setComposerLineId={setComposerLineId}
            />
          ))
        ) : (
          <UnifiedRows
            hunk={hunk}
            mode={mode}
            reviewState={reviewState}
            wrap={props.wrap}
            composerLineId={composerLineId}
            setComposerLineId={setComposerLineId}
          />
        )}
      </div>
    </div>
  );
}

function UnifiedRows(props: {
  hunk: DiffHunk;
  mode: ReviewMode;
  reviewState: ReviewState;
  wrap: boolean;
  composerLineId: string | null;
  setComposerLineId: (lineId: string | null) => void;
}) {
  const modificationIds = useMemo(
    () => collectModificationIds(props.hunk.lines),
    [props.hunk.lines],
  );
  return (
    <>
      {props.hunk.lines.map((lineItem) => (
        <UnifiedDiffRow
          key={lineItem.id}
          lineItem={lineItem}
          isModification={modificationIds.has(lineItem.id)}
          {...props}
        />
      ))}
    </>
  );
}

function UnifiedDiffRow(props: {
  lineItem: DiffLine;
  isModification: boolean;
  mode: ReviewMode;
  reviewState: ReviewState;
  wrap: boolean;
  composerLineId: string | null;
  setComposerLineId: (lineId: string | null) => void;
}) {
  const { lineItem, isModification, mode, reviewState } = props;
  const isChange = lineItem.kind !== "ctx";
  const tone = isModification && isChange ? "mod" : lineItem.kind;
  const hasComments = reviewState.commentsByLineId[lineItem.id]?.length;

  return (
    <>
      <div className="group/line grid min-h-[22px] grid-cols-[46px_46px_18px_minmax(0,1fr)] items-stretch leading-[23px]">
        <LineNumberCell
          lineId={lineItem.id}
          number={lineItem.kind !== "add" ? lineItem.oldLine : null}
          tone={tone}
          isChange={isChange}
          mode={mode}
          reviewState={reviewState}
        />
        <LineNumberCell
          lineId={lineItem.id}
          number={lineItem.kind !== "del" ? lineItem.newLine : null}
          tone={tone}
          isChange={isChange}
          mode={mode}
          reviewState={reviewState}
          onComment={() => props.setComposerLineId(lineItem.id)}
        />
        <div className={cn("grid place-items-center text-xs", signClass(tone))}>
          {lineItem.kind === "add" ? "+" : lineItem.kind === "del" ? "-" : ""}
        </div>
        <CodeCell tone={tone} wrap={props.wrap} line={lineItem.content} />
      </div>
      {mode === "pr" && isChange && (hasComments || props.composerLineId === lineItem.id) ? (
        <CommentRow
          lineId={lineItem.id}
          reviewState={reviewState}
          composerOpen={props.composerLineId === lineItem.id}
          closeComposer={() => props.setComposerLineId(null)}
        />
      ) : null}
    </>
  );
}

function SplitDiffRow(props: {
  row: SplitRow;
  mode: ReviewMode;
  reviewState: ReviewState;
  wrap: boolean;
  composerLineId: string | null;
  setComposerLineId: (lineId: string | null) => void;
}) {
  const ids = rowIds(props.row);
  const anchorLineId = commentAnchorId(
    ids,
    props.reviewState.commentsByLineId,
    props.composerLineId,
  );

  return (
    <>
      <div className="group/line grid min-h-[22px] grid-cols-[48px_minmax(0,1fr)_48px_minmax(0,1fr)] items-stretch leading-[23px]">
        <SplitSide
          side="left"
          lineItem={props.row.left}
          isModification={props.row.isModification}
          ids={ids}
          {...props}
        />
        <SplitSide
          side="right"
          lineItem={props.row.right}
          isModification={props.row.isModification}
          ids={ids}
          {...props}
        />
      </div>
      {props.mode === "pr" && anchorLineId ? (
        <CommentRow
          lineId={anchorLineId}
          reviewState={props.reviewState}
          composerOpen={props.composerLineId === anchorLineId}
          closeComposer={() => props.setComposerLineId(null)}
        />
      ) : null}
    </>
  );
}

function SplitSide(props: {
  side: "left" | "right";
  lineItem: DiffLine | null;
  isModification: boolean;
  ids: ReadonlyArray<string>;
  mode: ReviewMode;
  reviewState: ReviewState;
  wrap: boolean;
  setComposerLineId: (lineId: string | null) => void;
}) {
  const { lineItem, isModification, ids, mode, reviewState } = props;
  const isChange = Boolean(lineItem && lineItem.kind !== "ctx");
  const tone = !lineItem ? "empty" : isModification && isChange ? "mod" : lineItem.kind;
  const number = lineItem ? (lineItem.kind === "del" ? lineItem.oldLine : lineItem.newLine) : null;
  const lineId = lineItem?.id ?? ids[0] ?? "";
  const commentTarget = lineItem?.id ?? ids.find((id) => reviewState.commentsByLineId[id]);

  return (
    <>
      <LineNumberCell
        lineId={lineId}
        number={number}
        tone={tone}
        isChange={isChange}
        mode={mode}
        reviewState={reviewState}
        rowLineIds={ids}
        onComment={commentTarget ? () => props.setComposerLineId(commentTarget) : undefined}
      />
      <CodeCell tone={tone} wrap={props.wrap} line={lineItem?.content ?? ""} />
    </>
  );
}

function LineNumberCell(props: {
  lineId: string;
  number: number | null;
  tone: DiffLineKind | "mod" | "empty";
  isChange: boolean;
  mode: ReviewMode;
  reviewState: ReviewState;
  rowLineIds?: ReadonlyArray<string> | undefined;
  onComment?: (() => void) | undefined;
}) {
  const rowLineIds = props.rowLineIds ?? [props.lineId];
  const staged =
    rowLineIds.length > 0 &&
    rowLineIds.every((lineId) => props.reviewState.stagedLineIds.has(lineId));

  const onStageClick = () => {
    for (const lineId of rowLineIds) {
      props.reviewState.toggleLine(lineId);
    }
  };

  return (
    <div
      className={cn(
        "relative select-none border-r border-[#2a2928] px-2 text-right text-[11px] tabular-nums",
        gutterClass(props.tone),
      )}
    >
      {props.mode === "local" && props.isChange ? (
        <button
          type="button"
          className={cn(
            "absolute top-1/2 left-1 grid size-3.5 -translate-y-1/2 place-items-center rounded border border-[#56544f] opacity-0 transition-opacity group-hover/line:opacity-100",
            staged && "border-success bg-success text-[#0d0c0c] opacity-100",
          )}
          onClick={(event) => {
            event.stopPropagation();
            onStageClick();
          }}
          aria-label={staged ? "Unstage line" : "Stage line"}
        >
          {staged ? <CheckIcon className="size-2.5" /> : null}
        </button>
      ) : null}
      {props.mode === "pr" && props.isChange && props.onComment ? (
        <button
          type="button"
          className="absolute top-1/2 left-1 grid size-4 -translate-y-1/2 place-items-center rounded bg-[#8ba4b0] text-[#0d0c0c] opacity-0 transition-opacity group-hover/line:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            props.onComment?.();
          }}
          aria-label="Comment on line"
        >
          <MessageSquareIcon className="size-3" />
        </button>
      ) : null}
      {props.number ?? ""}
    </div>
  );
}

function CodeCell(props: { tone: DiffLineKind | "mod" | "empty"; wrap: boolean; line: string }) {
  return (
    <div
      className={cn(
        "min-w-0 px-2 text-[#c5c9c5]",
        codeCellClass(props.tone),
        props.wrap ? "whitespace-pre-wrap break-words" : "overflow-hidden whitespace-pre",
      )}
    >
      <span>{props.line}</span>
    </div>
  );
}

function ContextExpansionRow(props: { hunk: DiffHunk; view: DiffView; wrap: boolean }) {
  const contextLine = `... more context around ${props.hunk.context}`;
  if (props.view === "split") {
    return (
      <div className="grid grid-cols-[48px_minmax(0,1fr)_48px_minmax(0,1fr)] leading-[23px] opacity-70">
        <div className="border-r border-[#2a2928] px-2 text-right text-[11px] text-[#737c73]">
          {Math.max(1, props.hunk.oldStart - 1)}
        </div>
        <CodeCell tone="ctx" wrap={props.wrap} line={contextLine} />
        <div className="border-r border-[#2a2928] px-2 text-right text-[11px] text-[#737c73]">
          {Math.max(1, props.hunk.newStart - 1)}
        </div>
        <CodeCell tone="ctx" wrap={props.wrap} line={contextLine} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[46px_46px_18px_minmax(0,1fr)] leading-[23px] opacity-70">
      <div className="border-r border-[#2a2928] px-2 text-right text-[11px] text-[#737c73]">
        {Math.max(1, props.hunk.oldStart - 1)}
      </div>
      <div className="border-r border-[#2a2928] px-2 text-right text-[11px] text-[#737c73]">
        {Math.max(1, props.hunk.newStart - 1)}
      </div>
      <div />
      <CodeCell tone="ctx" wrap={props.wrap} line={contextLine} />
    </div>
  );
}

function CommentRow(props: {
  lineId: string;
  reviewState: ReviewState;
  composerOpen: boolean;
  closeComposer: () => void;
}) {
  const comments = props.reviewState.commentsByLineId[props.lineId] ?? [];
  return (
    <div className="border-y border-[#2a2928] bg-[#282727]/70 px-4 py-3">
      <div className="ml-16 max-w-3xl space-y-3">
        {comments.map((comment) => (
          <CommentBlock
            key={comment.id}
            lineId={props.lineId}
            comment={comment}
            reviewState={props.reviewState}
          />
        ))}
        {props.composerOpen ? (
          <CommentComposer
            placeholder="Leave a comment on this line..."
            submitLabel="Comment"
            onSubmit={(body) => {
              props.reviewState.addComment(props.lineId, body);
              props.closeComposer();
            }}
            onCancel={props.closeComposer}
          />
        ) : null}
      </div>
    </div>
  );
}

function CommentBlock(props: { lineId: string; comment: ReviewComment; reviewState: ReviewState }) {
  const [replyOpen, setReplyOpen] = useState(false);
  return (
    <div className="flex gap-2">
      <Avatar name={props.comment.author} color={props.comment.color} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="font-semibold text-[#c5c9c5]">{props.comment.author}</span>
          <span className="text-[#737c73]">{props.comment.createdAt}</span>
        </div>
        <p className="mt-1 text-xs leading-5 text-[#a6a69c]">{props.comment.body}</p>
        {props.comment.replies?.map((reply) => (
          <div key={reply.id} className="mt-3 flex gap-2">
            <Avatar name={reply.author} color={reply.color} />
            <div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="font-semibold text-[#c5c9c5]">{reply.author}</span>
                <span className="text-[#737c73]">{reply.createdAt}</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-[#a6a69c]">{reply.body}</p>
            </div>
          </div>
        ))}
        {replyOpen ? (
          <div className="mt-3">
            <CommentComposer
              placeholder="Reply..."
              submitLabel="Reply"
              onSubmit={(body) => {
                props.reviewState.addReply(props.lineId, props.comment.id, body);
                setReplyOpen(false);
              }}
              onCancel={() => setReplyOpen(false)}
            />
          </div>
        ) : (
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#737c73] hover:text-[#8ba4b0]"
            onClick={() => setReplyOpen(true)}
          >
            <MessageSquareIcon className="size-3" />
            Reply
          </button>
        )}
      </div>
    </div>
  );
}

function CommentComposer(props: {
  placeholder: string;
  submitLabel: string;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState("");
  const submit = () => {
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    props.onSubmit(trimmed);
    setBody("");
  };
  return (
    <div className="rounded-md border border-[#56544f] bg-[#282727] p-2">
      <textarea
        className="min-h-16 w-full resize-none bg-transparent text-xs leading-5 text-[#c5c9c5] outline-none placeholder:text-[#737c73]"
        placeholder={props.placeholder}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            submit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            props.onCancel();
          }
        }}
      />
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[#737c73]">Cmd/Ctrl Enter submits</span>
        <MiniButton className="ml-auto" onClick={props.onCancel}>
          Cancel
        </MiniButton>
        <MiniButton tone="primary" disabled={body.trim().length === 0} onClick={submit}>
          <SendIcon className="size-3" />
          {props.submitLabel}
        </MiniButton>
      </div>
    </div>
  );
}

function StackRail(props: {
  selectedDiffId: string;
  onSelect: (diffId: string) => void;
  reviewState: ReviewState;
  mode: ReviewMode;
}) {
  return (
    <div className="px-1 py-2">
      <div className="mb-2 flex items-center gap-1 px-2 text-[10px] text-[#565552]">
        <ChevronDownIcon className="size-3" />
        main at top - newest at bottom
      </div>
      <div className="space-y-0.5">
        <div className="flex gap-2 rounded-md px-1 py-1.5 text-left">
          <span className="relative w-6 shrink-0">
            <span className="absolute top-3 bottom-[-12px] left-1/2 w-px -translate-x-1/2 bg-[#393836]" />
            <span className="relative z-10 grid size-5 place-items-center rounded-full border border-[#56544f] bg-[#181616] text-[#737c73]">
              <GitCommitIcon className="size-3" />
            </span>
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium text-[#737c73]">main</span>
            <span className="block text-[10px] text-[#565552]">base branch</span>
          </span>
        </div>
        {STACK.map((diff, index) => (
          <StackRailNode
            key={diff.id}
            index={index}
            diff={diff}
            active={diff.id === props.selectedDiffId}
            {...props}
          />
        ))}
      </div>
    </div>
  );
}

function StackRailNode(props: {
  diff: StackDiff;
  index: number;
  active: boolean;
  selectedDiffId: string;
  onSelect: (diffId: string) => void;
  reviewState: ReviewState;
  mode: ReviewMode;
}) {
  const meta = STATUS_META[props.diff.status];
  const comments =
    props.mode === "pr"
      ? countCommentsForFiles(props.diff.files, props.reviewState.commentsByLineId)
      : 0;
  return (
    <button
      type="button"
      className={cn(
        "flex w-full gap-2 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-[#282727]",
        props.active && "bg-[#282727] ring-1 ring-[#393836]",
      )}
      onClick={() => props.onSelect(props.diff.id)}
      title={props.diff.branch}
    >
      <span className="relative w-6 shrink-0">
        {props.index < STACK.length - 1 ? (
          <span className="absolute top-3 bottom-[-12px] left-1/2 w-px -translate-x-1/2 bg-[#393836]" />
        ) : null}
        <span
          className={cn(
            "relative z-10 grid size-5 place-items-center rounded-full border bg-[#181616] text-[10px] font-bold",
            meta.className,
            props.active && "shadow-[0_0_0_3px_rgba(139,164,176,0.2)]",
          )}
        >
          {props.index + 1}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-[#c5c9c5]">
          {props.diff.title}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-[10px] text-[#737c73]">
          <span className={cn("font-semibold", meta.className)}>{meta.label}</span>
          <DiffStat additions={props.diff.additions} deletions={props.diff.deletions} />
          {comments > 0 ? (
            <span className="inline-flex items-center gap-0.5">
              <MessageSquareIcon className="size-3" />
              {comments}
            </span>
          ) : null}
          {props.diff.sync === "behind" ? (
            <span className="inline-flex items-center gap-0.5 text-[#ff9e3b]">
              <Undo2Icon className="size-3" />
              sync
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function FileList(props: {
  files: ReadonlyArray<DiffFile>;
  scope: DiffScope;
  reviewState: ReviewState;
  mode: ReviewMode;
}) {
  return (
    <div className="space-y-0.5">
      {props.files.map((file) => {
        const comments =
          props.mode === "pr"
            ? countCommentsForFiles([file], props.reviewState.commentsByLineId)
            : 0;
        const staged =
          getStageState(collectChangedLineIds([file]), props.reviewState.stagedLineIds) === "all";
        const origin = getDiffForFile(file.id);
        return (
          <a
            key={file.id}
            href={`#file-${file.id}`}
            className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[#a6a69c] hover:bg-[#282727] hover:text-[#c5c9c5]"
          >
            {props.scope === "stack" && origin ? (
              <span
                className={cn("size-2 rounded-full", statusDotClass(origin.status))}
                title={origin.title}
              />
            ) : (
              <span className={cn("size-2 rounded-full", fileStatusDotClass(file.status))} />
            )}
            <span className="min-w-0 flex-1 truncate">
              <span className="text-[#737c73]">{dirname(file.path)}</span>
              {basename(file.path)}
            </span>
            {staged ? <CheckIcon className="size-3 shrink-0 text-success" /> : null}
            {comments > 0 ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded border border-[#393836] px-1 text-[10px] text-[#737c73]">
                <MessageSquareIcon className="size-3" />
                {comments}
              </span>
            ) : null}
            <DiffStat additions={file.additions} deletions={file.deletions} />
          </a>
        );
      })}
    </div>
  );
}

function DiffToolbar(props: {
  selectedDiff: StackDiff;
  mode: ReviewMode;
  view: DiffView;
  setView: (view: DiffView) => void;
  wordWrap: boolean;
  setWordWrap: (wordWrap: boolean) => void;
  onHelp: () => void;
  localHint: string;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-[#2a2928] bg-[#0d0c0c] px-3">
      <DiffTitle selectedDiff={props.selectedDiff} mode={props.mode} localHint={props.localHint} />
      <DiffViewControls
        view={props.view}
        setView={props.setView}
        wordWrap={props.wordWrap}
        setWordWrap={props.setWordWrap}
        onHelp={props.onHelp}
      />
    </div>
  );
}

function DiffTitle(props: { selectedDiff: StackDiff; mode: ReviewMode; localHint?: string }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-2">
        {props.mode === "pr" ? (
          <Avatar
            name={props.selectedDiff.author.name}
            color={props.selectedDiff.author.color}
            large
          />
        ) : (
          <GitBranchIcon className="size-4 shrink-0 text-[#8ba4b0]" />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[#c5c9c5]">
            {props.mode === "pr" ? props.selectedDiff.title : (props.localHint ?? "Working tree")}
            {props.mode === "pr" ? (
              <span className="ml-2 text-xs font-normal text-[#737c73]">
                #{props.selectedDiff.number}
              </span>
            ) : null}
          </p>
          <p className="flex min-w-0 items-center gap-1.5 truncate text-[11px] text-[#737c73]">
            <span className="truncate text-[#8ba4b0]">{props.selectedDiff.branch}</span>
            <span>-&gt;</span>
            <span className="truncate">{props.selectedDiff.base}</span>
            {props.selectedDiff.sync === "behind" ? (
              <span className="ml-2 inline-flex items-center gap-1 text-[#ff9e3b]">
                <Undo2Icon className="size-3" />
                needs sync
              </span>
            ) : null}
          </p>
        </div>
      </div>
    </div>
  );
}

function DiffViewControls(props: {
  view: DiffView;
  setView: (view: DiffView) => void;
  wordWrap: boolean;
  setWordWrap: (wordWrap: boolean) => void;
  onHelp: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <SegmentedIconButton
        active={props.view === "split"}
        label="Split view"
        onClick={() => props.setView("split")}
      >
        <Columns2Icon className="size-3.5" />
      </SegmentedIconButton>
      <SegmentedIconButton
        active={props.view === "unified"}
        label="Unified view"
        onClick={() => props.setView("unified")}
      >
        <Rows3Icon className="size-3.5" />
      </SegmentedIconButton>
      <IconButton
        active={props.wordWrap}
        label="Toggle word wrap"
        onClick={() => props.setWordWrap(!props.wordWrap)}
      >
        <TextWrapIcon className="size-3.5" />
      </IconButton>
      <IconButton label="Keyboard shortcuts" onClick={props.onHelp}>
        <KeyboardIcon className="size-3.5" />
      </IconButton>
    </div>
  );
}

function ModePill(props: { mode: ReviewMode; setMode: (mode: ReviewMode) => void }) {
  return (
    <div className="inline-flex rounded-md border border-[#393836] bg-[#1f1d1d] p-0.5">
      <button
        type="button"
        aria-pressed={props.mode === "local"}
        className={cn(
          "inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] text-[#737c73]",
          props.mode === "local" && "bg-[#282727] text-[#c5c9c5]",
        )}
        onClick={() => props.setMode("local")}
      >
        <GitBranchIcon className="size-3" />
        Local
      </button>
      <button
        type="button"
        aria-pressed={props.mode === "pr"}
        className={cn(
          "inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] text-[#737c73]",
          props.mode === "pr" && "bg-[#282727] text-[#c5c9c5]",
        )}
        onClick={() => props.setMode("pr")}
      >
        <GitPullRequestIcon className="size-3" />
        Review
      </button>
    </div>
  );
}

function ScopeToggle(props: { scope: DiffScope; setScope: (scope: DiffScope) => void }) {
  return (
    <div className="inline-flex rounded-md border border-[#393836] bg-[#1f1d1d] p-0.5">
      <button
        type="button"
        aria-pressed={props.scope === "this"}
        className={cn(
          "rounded px-2 py-0.5 text-[10px] text-[#737c73]",
          props.scope === "this" && "bg-[#282727] text-[#c5c9c5]",
        )}
        onClick={() => props.setScope("this")}
      >
        This diff
      </button>
      <button
        type="button"
        aria-pressed={props.scope === "stack"}
        className={cn(
          "rounded px-2 py-0.5 text-[10px] text-[#737c73]",
          props.scope === "stack" && "bg-[#282727] text-[#c5c9c5]",
        )}
        onClick={() => props.setScope("stack")}
      >
        Whole stack
      </button>
    </div>
  );
}

function KeyboardOverlay(props: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-[#56544f] bg-[#1f1d1d] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-[#393836] px-4 py-3">
          <KeyboardIcon className="size-4 text-[#8ba4b0]" />
          <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
          <IconButton className="ml-auto" label="Close shortcuts" onClick={props.onClose}>
            <XIcon className="size-3.5" />
          </IconButton>
        </div>
        <div className="grid gap-x-8 p-4 sm:grid-cols-2">
          <ShortcutHint keys="j / k" label="Next / previous hunk" />
          <ShortcutHint keys="s" label="Stage active hunk" />
          <ShortcutHint keys="x" label="Discard active hunk" />
          <ShortcutHint keys="u" label="Split / unified view" />
          <ShortcutHint keys="m" label="Local / review mode" />
          <ShortcutHint keys="Esc" label="Close overlay" />
        </div>
      </div>
    </div>
  );
}

function ShortcutHint(props: { keys: string; label: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-[#2a2928] py-2 text-xs text-[#a6a69c] last:border-b-0">
      <span className="inline-flex min-w-14 justify-center rounded border border-[#393836] bg-[#282727] px-1.5 py-0.5 font-mono text-[10px] text-[#c5c9c5]">
        {props.keys}
      </span>
      <span>{props.label}</span>
    </div>
  );
}

function ReviewFooter(props: {
  selectedDiff: StackDiff;
  files: ReadonlyArray<DiffFile>;
  reviewState: ReviewState;
  mode: ReviewMode;
}) {
  const comments = countCommentsForFiles(props.files, props.reviewState.commentsByLineId);
  return (
    <div className="border-t border-[#2a2928] px-3 py-2 text-[11px] text-[#737c73]">
      {props.mode === "local" ? (
        <div className="flex items-center gap-2">
          <span>
            <span className="font-semibold text-success">
              {props.reviewState.stagedLineIds.size}
            </span>{" "}
            lines staged
          </span>
          <span className="ml-auto">{props.selectedDiff.branch}</span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <MessageSquareIcon className="size-3" />
          <span>
            <span className="font-semibold text-[#c5c9c5]">{comments}</span> comments in scope
          </span>
        </div>
      )}
    </div>
  );
}

function SegmentedIconButton(props: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.active}
      className={cn(
        "grid size-7 place-items-center rounded-md border border-[#393836] bg-[#1f1d1d] text-[#737c73] hover:text-[#c5c9c5]",
        props.active && "bg-[#282727] text-[#c5c9c5]",
      )}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function IconButton(props: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.active}
      className={cn(
        "grid size-7 place-items-center rounded-md text-[#737c73] hover:bg-[#282727] hover:text-[#c5c9c5]",
        props.active && "bg-[#282727] text-[#c5c9c5]",
        props.className,
      )}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function MiniButton(props: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "default" | "primary" | "danger";
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      className={cn(
        "inline-flex h-6 items-center justify-center gap-1 rounded border border-[#393836] px-2 text-[11px] font-medium text-[#a6a69c] transition-colors hover:border-[#56544f] hover:bg-[#282727] hover:text-[#c5c9c5] disabled:pointer-events-none disabled:opacity-45",
        props.tone === "primary" &&
          "border-[#8ba4b0] bg-[#8ba4b0] text-[#0d0c0c] hover:bg-[#9bb8c4] hover:text-[#0d0c0c]",
        props.tone === "danger" &&
          "text-destructive hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive",
        props.active && "border-success/50 bg-success/10 text-success",
        props.className,
      )}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function Avatar(props: { name: string; color: string; large?: boolean }) {
  const initials = props.name
    .split(/\s+/)
    .flatMap((part) => (part[0] ? [part[0]] : []))
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full text-[10px] font-bold text-[#0d0c0c]",
        props.large ? "size-6" : "size-5",
      )}
      style={{ backgroundColor: props.color }}
      title={props.name}
    >
      {initials}
    </span>
  );
}

function DiffStat(props: { additions: number; deletions: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10.5px] tabular-nums">
      <span className="text-success">+{props.additions}</span>
      <span className="text-[#737c73]">/</span>
      <span className="text-destructive">-{props.deletions}</span>
    </span>
  );
}

function FileStatusBadge(props: { status: FileStatus }) {
  const label =
    props.status === "new"
      ? "added"
      : props.status === "deleted"
        ? "deleted"
        : props.status === "renamed"
          ? "renamed"
          : "modified";
  return (
    <span
      className={cn(
        "rounded border px-1.5 py-0.5 text-[10px] font-semibold",
        fileStatusBadgeClass(props.status),
      )}
    >
      {label}
    </span>
  );
}

function usePrototypeReviewState(): ReviewState {
  const [stagedLineIds, setStagedLineIds] = useState<ReadonlySet<string>>(() => new Set());
  const [discardedHunkIds, setDiscardedHunkIds] = useState<ReadonlySet<string>>(() => new Set());
  const [commentsByLineId, setCommentsByLineId] = useState<
    Readonly<Record<string, ReviewComment[]>>
  >(() => SEED_COMMENTS);

  const toggleLine = useCallback((lineId: string) => {
    setStagedLineIds((current) => {
      const next = new Set(current);
      if (next.has(lineId)) {
        next.delete(lineId);
      } else {
        next.add(lineId);
      }
      return next;
    });
  }, []);

  const stageLines = useCallback((lineIds: ReadonlyArray<string>, staged: boolean) => {
    setStagedLineIds((current) => {
      const next = new Set(current);
      for (const lineId of lineIds) {
        if (staged) {
          next.add(lineId);
        } else {
          next.delete(lineId);
        }
      }
      return next;
    });
  }, []);

  const toggleHunk = useCallback((hunk: DiffHunk) => {
    const lineIds = collectHunkLineIds(hunk);
    setStagedLineIds((current) => {
      const shouldStage = getStageState(lineIds, current) !== "all";
      const next = new Set(current);
      for (const lineId of lineIds) {
        if (shouldStage) {
          next.add(lineId);
        } else {
          next.delete(lineId);
        }
      }
      return next;
    });
  }, []);

  const discardHunk = useCallback((hunkId: string) => {
    setDiscardedHunkIds((current) => new Set(current).add(hunkId));
  }, []);

  const restoreHunk = useCallback((hunkId: string) => {
    setDiscardedHunkIds((current) => {
      const next = new Set(current);
      next.delete(hunkId);
      return next;
    });
  }, []);

  const addComment = useCallback(
    (lineId: string, body: string) => {
      setCommentsByLineId((current) => ({
        ...current,
        [lineId]: [
          ...(current[lineId] ?? []),
          {
            id: `local-${Date.now()}`,
            author: "You",
            color: "#8ba4b0",
            createdAt: "now",
            body,
          },
        ],
      }));
    },
    [setCommentsByLineId],
  );

  const addReply = useCallback(
    (lineId: string, commentId: string, body: string) => {
      setCommentsByLineId((current) => ({
        ...current,
        [lineId]: (current[lineId] ?? []).map((comment) =>
          comment.id === commentId
            ? Object.assign({}, comment, {
                replies: [...(comment.replies ?? []), makeLocalReply(body)],
              })
            : comment,
        ),
      }));
    },
    [setCommentsByLineId],
  );

  return {
    stagedLineIds,
    discardedHunkIds,
    commentsByLineId,
    toggleLine,
    stageLines,
    toggleHunk,
    discardHunk,
    restoreHunk,
    addComment,
    addReply,
  };
}

function getStackDiff(diffId: string): StackDiff {
  return STACK.find((diff) => diff.id === diffId) ?? STACK[0]!;
}

function getStackDiffIndex(diffId: string): number {
  return Math.max(
    0,
    STACK.findIndex((diff) => diff.id === diffId),
  );
}

function getVisibleFiles(diffId: string, scope: DiffScope): DiffFile[] {
  if (scope === "this") {
    return getStackDiff(diffId).files;
  }
  return STACK.slice(0, getStackDiffIndex(diffId) + 1).flatMap((diff) => diff.files);
}

function getDiffForFile(fileId: string): StackDiff | undefined {
  return STACK.find((diff) => diff.fileIds.includes(fileId));
}

function collectChangedLineIds(files: ReadonlyArray<DiffFile>): string[] {
  return files.flatMap((file) => file.hunks.flatMap(collectHunkLineIds));
}

function collectHunkLineIds(hunk: DiffHunk): string[] {
  return hunk.lines.flatMap((lineItem) => (lineItem.kind === "ctx" ? [] : [lineItem.id]));
}

function getStageState(lineIds: ReadonlyArray<string>, stagedLineIds: ReadonlySet<string>) {
  if (lineIds.length === 0) return "none";
  const stagedCount = lineIds.filter((lineId) => stagedLineIds.has(lineId)).length;
  if (stagedCount === 0) return "none";
  if (stagedCount === lineIds.length) return "all";
  return "partial";
}

function splitRows(lines: ReadonlyArray<DiffLine>): SplitRow[] {
  const rows: SplitRow[] = [];
  let index = 0;
  while (index < lines.length) {
    const current = lines[index]!;
    if (current.kind === "ctx") {
      rows.push({ left: current, right: current, isModification: false });
      index += 1;
      continue;
    }

    const deletions: DiffLine[] = [];
    const additions: DiffLine[] = [];
    while (lines[index]?.kind === "del") {
      deletions.push(lines[index]!);
      index += 1;
    }
    while (lines[index]?.kind === "add") {
      additions.push(lines[index]!);
      index += 1;
    }

    const max = Math.max(deletions.length, additions.length);
    for (let offset = 0; offset < max; offset += 1) {
      rows.push({
        left: deletions[offset] ?? null,
        right: additions[offset] ?? null,
        isModification: Boolean(deletions[offset] && additions[offset]),
      });
    }
  }
  return rows;
}

function collectModificationIds(lines: ReadonlyArray<DiffLine>): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const row of splitRows(lines)) {
    if (!row.isModification) continue;
    if (row.left) ids.add(row.left.id);
    if (row.right) ids.add(row.right.id);
  }
  return ids;
}

function rowIds(row: SplitRow): string[] {
  const ids: string[] = [];
  if (row.left && row.left.kind !== "ctx") ids.push(row.left.id);
  if (row.right && row.right.kind !== "ctx" && row.right.id !== row.left?.id) {
    ids.push(row.right.id);
  }
  return ids;
}

function commentAnchorId(
  lineIds: ReadonlyArray<string>,
  commentsByLineId: Readonly<Record<string, ReviewComment[]>>,
  composerLineId: string | null,
): string | null {
  if (composerLineId && lineIds.includes(composerLineId)) return composerLineId;
  return lineIds.find((lineId) => (commentsByLineId[lineId]?.length ?? 0) > 0) ?? null;
}

function findHunk(files: ReadonlyArray<DiffFile>, hunkId: string | null): DiffHunk | null {
  if (!hunkId) return null;
  for (const file of files) {
    const hunk = file.hunks.find((candidate) => candidate.id === hunkId);
    if (hunk) return hunk;
  }
  return null;
}

function countCommentsForFiles(
  files: ReadonlyArray<DiffFile>,
  commentsByLineId: Readonly<Record<string, ReviewComment[]>>,
): number {
  const lineIds = new Set(collectChangedLineIds(files));
  return Object.entries(commentsByLineId).reduce((sum, [lineId, comments]) => {
    if (!lineIds.has(lineId)) return sum;
    return (
      sum +
      comments.length +
      comments.reduce((replySum, comment) => replySum + (comment.replies?.length ?? 0), 0)
    );
  }, 0);
}

function copyHunk(hunk: DiffHunk) {
  const patchText = hunk.lines
    .map(
      (lineItem) =>
        `${lineItem.kind === "add" ? "+" : lineItem.kind === "del" ? "-" : " "}${lineItem.content}`,
    )
    .join("\n");
  void navigator.clipboard?.writeText(patchText);
}

function makeLocalReply(body: string): ReviewComment {
  return {
    id: `reply-${Date.now()}`,
    author: "You",
    color: "#8ba4b0",
    createdAt: "now",
    body,
  };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable;
}

function dirname(pathValue: string): string {
  const index = pathValue.lastIndexOf("/");
  return index < 0 ? "" : pathValue.slice(0, index + 1);
}

function basename(pathValue: string): string {
  const index = pathValue.lastIndexOf("/");
  return index < 0 ? pathValue : pathValue.slice(index + 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function gutterClass(tone: DiffLineKind | "mod" | "empty"): string {
  switch (tone) {
    case "add":
      return "bg-success/14 text-success-foreground";
    case "del":
      return "bg-destructive/14 text-destructive";
    case "mod":
      return "bg-[#7e9cd8]/16 text-[#9bb8f5]";
    case "empty":
      return "bg-[#181616]/70 text-[#565552]";
    case "ctx":
      return "bg-[#181616]/35 text-[#737c73]/70";
  }
}

function codeCellClass(tone: DiffLineKind | "mod" | "empty"): string {
  switch (tone) {
    case "add":
      return "bg-success/10";
    case "del":
      return "bg-destructive/10";
    case "mod":
      return "bg-[#7e9cd8]/14";
    case "empty":
      return "bg-[#181616]/70";
    case "ctx":
      return "bg-[#181616]/35";
  }
}

function signClass(tone: DiffLineKind | "mod" | "empty"): string {
  switch (tone) {
    case "add":
      return "text-success";
    case "del":
      return "text-destructive";
    case "mod":
      return "text-[#7e9cd8]";
    default:
      return "text-[#737c73]";
  }
}

function fileStatusBadgeClass(status: FileStatus): string {
  switch (status) {
    case "new":
      return "border-success/30 bg-success/10 text-success";
    case "deleted":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "renamed":
      return "border-[#b6927b]/35 bg-[#b6927b]/10 text-[#b6927b]";
    case "modified":
      return "border-[#7e9cd8]/35 bg-[#7e9cd8]/10 text-[#9bb8f5]";
  }
}

function fileStatusDotClass(status: FileStatus): string {
  switch (status) {
    case "new":
      return "bg-success";
    case "deleted":
      return "bg-destructive";
    case "renamed":
      return "bg-[#b6927b]";
    case "modified":
      return "bg-[#7e9cd8]";
  }
}

function statusDotClass(status: StackStatus): string {
  switch (status) {
    case "approved":
      return "bg-success";
    case "review":
      return "bg-[#7e9cd8]";
    case "draft":
      return "bg-[#737c73]";
  }
}
