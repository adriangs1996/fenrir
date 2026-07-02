import type {
  TmuxActor,
  TmuxNeovimPaneInput,
  TmuxPane,
  TmuxPaneStreamSubscribeInput,
  TmuxWorkspaceSnapshot,
} from "@fenrir/contracts";

export const NEOVIM_BOOTSTRAP_ENV_KEYS = [
  "FENRIR_WORKSPACE_ID",
  "FENRIR_WINDOW_ID",
  "FENRIR_NEOVIM_BOOTSTRAP_ID",
  "FENRIR_NEOVIM_PROFILE_ID",
  "FENRIR_NEOVIM_THEME_ID",
  "FENRIR_NEOVIM_KEYBINDING_PROFILE_ID",
  "NVIM_LISTEN_ADDRESS",
] as const;

export type NeovimPaneBootstrapRequest = Omit<
  TmuxNeovimPaneInput,
  "profileId" | "split" | "launchSource"
> & {
  readonly profileId?: TmuxNeovimPaneInput["profileId"];
  readonly split?: TmuxNeovimPaneInput["split"];
  readonly launchSource?: TmuxNeovimPaneInput["launchSource"];
};

export function createNeovimPaneBootstrapInput(
  input: NeovimPaneBootstrapRequest,
): TmuxNeovimPaneInput {
  return {
    ...input,
    profileId: input.profileId ?? "default",
    themeId: input.themeId ?? "fenrir-dark",
    keybindingProfileId: input.keybindingProfileId ?? "native-compatible",
    split: input.split ?? "horizontal",
    launchSource: input.launchSource ?? "user",
  };
}

export function createNeovimOpenFileInput(
  input: NeovimPaneBootstrapRequest & {
    readonly file: NonNullable<TmuxNeovimPaneInput["files"]>[number];
    readonly line?: TmuxNeovimPaneInput["line"];
    readonly column?: TmuxNeovimPaneInput["column"];
  },
): TmuxNeovimPaneInput {
  const { file, ...rest } = input;
  return createNeovimPaneBootstrapInput({
    ...rest,
    files: [file],
  });
}

function sameFiles(left: readonly string[] | undefined, right: readonly string[] | undefined) {
  const leftFiles = left ?? [];
  const rightFiles = right ?? [];
  return (
    leftFiles.length === rightFiles.length &&
    leftFiles.every((file, index) => file === rightFiles[index])
  );
}

export function isMatchingNeovimPane(pane: TmuxPane, input: TmuxNeovimPaneInput): boolean {
  if (pane.status !== "running" || pane.metadata.kind !== "neovim") return false;
  const metadata = pane.metadata.neovim;
  return (
    metadata.workspaceId === input.workspaceId &&
    metadata.windowId === input.windowId &&
    metadata.profileId === (input.profileId ?? "default") &&
    metadata.themeId === (input.themeId ?? "fenrir-dark") &&
    metadata.keybindingProfileId === (input.keybindingProfileId ?? "native-compatible") &&
    sameFiles(metadata.files, input.files) &&
    metadata.line === input.line &&
    metadata.column === input.column
  );
}

export function findRunningNeovimPane(
  snapshot: TmuxWorkspaceSnapshot,
  input: TmuxNeovimPaneInput,
): TmuxPane | null {
  return snapshot.panes.find((pane) => isMatchingNeovimPane(pane, input)) ?? null;
}

export function createPaneStreamSubscribeInput(input: {
  readonly actor: TmuxActor;
  readonly pane: TmuxPane;
  readonly afterSeq?: TmuxPaneStreamSubscribeInput["afterSeq"];
  readonly backfill?: TmuxPaneStreamSubscribeInput["backfill"];
  readonly slowClientPolicy?: TmuxPaneStreamSubscribeInput["slowClientPolicy"];
  readonly maxBufferedChunks?: TmuxPaneStreamSubscribeInput["maxBufferedChunks"];
}): TmuxPaneStreamSubscribeInput {
  return {
    actor: input.actor,
    workspaceId: input.pane.workspaceId,
    paneId: input.pane.paneId,
    ...(input.afterSeq === undefined ? {} : { afterSeq: input.afterSeq }),
    backfill: input.backfill ?? "from-seq",
    slowClientPolicy: input.slowClientPolicy ?? "fast-forward",
    maxBufferedChunks: input.maxBufferedChunks ?? 512,
  };
}
