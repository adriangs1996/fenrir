import type { ThreadVisibility } from "@fenrir/contracts";

export interface ThreadVisibilityLike {
  readonly visibility?: ThreadVisibility | undefined;
}

export function resolveThreadVisibility(thread: ThreadVisibilityLike): ThreadVisibility {
  return thread.visibility ?? "normal";
}

export function isUserBrowsableThread(thread: ThreadVisibilityLike): boolean {
  return resolveThreadVisibility(thread) === "normal";
}

export function isEditorTransientThread(thread: ThreadVisibilityLike): boolean {
  return resolveThreadVisibility(thread) === "editorTransient";
}
