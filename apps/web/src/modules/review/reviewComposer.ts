import type {
  ReviewRawLaneKind,
  ReviewStableAnchor,
} from "../../../../../packages/contracts/src/review.ts";

export type ReviewContextAttachmentSourceKind = "chunk" | "file" | "group";

export interface ReviewContextChunkRef {
  readonly sessionId: string;
  readonly groupId: string;
  readonly fileId: string;
  readonly lane: ReviewRawLaneKind;
  readonly normalizedPath: string;
  readonly displayPath: string;
  readonly chunkId: string;
}

export interface ReviewContextChunkSnapshot extends ReviewContextChunkRef {
  readonly anchor: ReviewStableAnchor;
  readonly header: string;
  readonly rawPatch: string;
  readonly codeExcerpt: string;
}

export interface ReviewContextAttachmentDraft {
  readonly id: string;
  readonly createdAt: string;
  readonly sourceKind: ReviewContextAttachmentSourceKind;
  readonly title: string;
  readonly sessionId: string;
  readonly diffCacheToken: string | null;
  readonly chunks: readonly ReviewContextChunkSnapshot[];
}

export interface ReviewContextTraceAttachment {
  readonly attachmentId: string;
  readonly sourceKind: ReviewContextAttachmentSourceKind;
  readonly sessionId: string;
  readonly chunkIds: readonly string[];
  readonly normalizedPaths: readonly string[];
}

export interface ReviewContextTrace {
  readonly attachments: readonly ReviewContextTraceAttachment[];
}

export function dedupeReviewContextChunkRefs(
  refs: ReadonlyArray<ReviewContextChunkRef>,
): ReviewContextChunkRef[] {
  const seen = new Set<string>();
  const deduped: ReviewContextChunkRef[] = [];
  for (const ref of refs) {
    const key = `${ref.sessionId}\u0000${ref.lane}\u0000${ref.normalizedPath}\u0000${ref.chunkId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(ref);
  }
  return deduped;
}

export function isReviewContextAttachmentStale(
  attachment: ReviewContextAttachmentDraft,
  diffCacheToken: string | null | undefined,
): boolean {
  return attachment.diffCacheToken !== (diffCacheToken ?? null);
}

export function countReviewContextFiles(attachment: ReviewContextAttachmentDraft): number {
  return new Set(attachment.chunks.map((chunk) => chunk.normalizedPath)).size;
}

export function buildReviewContextSummaryLabel(attachment: ReviewContextAttachmentDraft): string {
  const chunkCount = attachment.chunks.length;
  const fileCount = countReviewContextFiles(attachment);
  const chunkLabel = `${chunkCount} ${chunkCount === 1 ? "chunk" : "chunks"}`;
  const fileLabel = `${fileCount} ${fileCount === 1 ? "file" : "files"}`;
  return `${chunkLabel} • ${fileLabel}`;
}

export function buildReviewContextTrace(
  attachments: ReadonlyArray<ReviewContextAttachmentDraft>,
): ReviewContextTrace | undefined {
  if (attachments.length === 0) {
    return undefined;
  }
  return {
    attachments: attachments.map((attachment) => ({
      attachmentId: attachment.id,
      sourceKind: attachment.sourceKind,
      sessionId: attachment.sessionId,
      chunkIds: attachment.chunks.map((chunk) => chunk.chunkId),
      normalizedPaths: [...new Set(attachment.chunks.map((chunk) => chunk.normalizedPath))],
    })),
  };
}

export function formatReviewContextPrompt(
  attachments: ReadonlyArray<ReviewContextAttachmentDraft>,
): string {
  if (attachments.length === 0) {
    return "";
  }

  const lines = [
    "Review context is attached below. Base your answer on these frozen diff selections unless I say otherwise.",
  ];

  for (const [attachmentIndex, attachment] of attachments.entries()) {
    lines.push("");
    lines.push(
      `Review attachment ${attachmentIndex + 1}: ${attachment.title} (${buildReviewContextSummaryLabel(attachment)})`,
    );
    lines.push(
      `Trace: attachment=${attachment.id}; source=${attachment.sourceKind}; reviewSession=${attachment.sessionId}`,
    );
    for (const [chunkIndex, chunk] of attachment.chunks.entries()) {
      lines.push("");
      lines.push(`Chunk ${chunkIndex + 1}: ${chunk.displayPath} :: ${chunk.header}`);
      lines.push("Code excerpt:");
      lines.push(chunk.codeExcerpt);
      lines.push("Diff hunk:");
      lines.push(chunk.rawPatch);
    }
  }

  return lines.join("\n");
}
