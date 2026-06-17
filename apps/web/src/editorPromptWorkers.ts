import { truncate } from "@fenrir/shared/String";

import {
  derivePendingApprovals,
  derivePendingUserInputs,
  isLatestTurnSettled,
} from "./session-logic";
import type { ChatMessage, Thread } from "./types";
import type { EditorWorkerItem } from "~/modules/neovim-editor";

export const EDITOR_TRANSIENT_THREAD_DELETE_DELAY_MS = 1_500;

function latestAssistantDetail(messages: readonly ChatMessage[]): string | null {
  const message = messages.findLast((entry) => entry.role === "assistant" && entry.text.trim());
  if (!message) return null;
  return truncate(message.text.replace(/\s+/g, " "), 120);
}

export function toEditorWorkerItem(thread: Thread): EditorWorkerItem {
  const pendingApprovals = derivePendingApprovals(thread.activities).length > 0;
  const pendingUserInputs = derivePendingUserInputs(thread.activities).length > 0;
  const latestTurnSettled = isLatestTurnSettled(thread.latestTurn, thread.session);
  const hasError = thread.error !== null || thread.latestTurn?.state === "error";
  const status: EditorWorkerItem["status"] = hasError
    ? "error"
    : pendingApprovals || pendingUserInputs
      ? "waiting"
      : latestTurnSettled
        ? "completed"
        : thread.latestTurn?.startedAt
          ? "running"
          : "queued";

  return {
    id: thread.id,
    title: thread.title,
    status,
    detail: hasError ? thread.error : latestAssistantDetail(thread.messages),
    canInterrupt: status === "queued" || status === "running" || status === "waiting",
  };
}
